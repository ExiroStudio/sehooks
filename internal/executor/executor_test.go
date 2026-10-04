package executor

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTimeout(t *testing.T) {
	start := time.Now()
	res := Run("sleep 10", "", nil, 2)
	duration := time.Since(start)

	if res.Status != "timeout" {
		t.Fatalf("expected status 'timeout', got '%s'", res.Status)
	}
	if duration > 4*time.Second {
		t.Fatalf("expected timeout in ~2s, but took %v", duration)
	}
}

func TestPayload(t *testing.T) {
	res := RunWithPayload("cat", "", nil, 5, "hello payload")
	if res.Status != "success" {
		t.Fatalf("expected success, got %s: %s", res.Status, res.Stderr)
	}
	if res.Stdout != "hello payload" {
		t.Fatalf("expected 'hello payload', got '%s'", res.Stdout)
	}
}

func TestSehImportEnv(t *testing.T) {
	dir, err := os.MkdirTemp("", "seh-test-workdir-*")
	if err != nil {
		t.Fatalf("mkdir temp: %v", err)
	}
	defer os.RemoveAll(dir)

	envVars := map[string]string{
		"APP_NAME": "my-backend",
		"PORT":     "9000",
	}

	script := `
echo "Direct env: $APP_NAME"
seh_import_env
cat .env
`
	res := Run(script, dir, envVars, 5)
	if res.Status != "success" {
		t.Fatalf("expected success, got %s (stderr: %s)", res.Status, res.Stderr)
	}

	content, err := os.ReadFile(filepath.Join(dir, ".env"))
	if err != nil {
		t.Fatalf("read .env file: %v", err)
	}

	sContent := string(content)
	if !strings.Contains(sContent, `APP_NAME="my-backend"`) || !strings.Contains(sContent, `PORT="9000"`) {
		t.Fatalf(".env file does not contain expected variables: %s", sContent)
	}

	// Test importing to custom specific path with subdirectories
	scriptCustom := `
seh_import_env config/docker/production.env
`
	resCustom := Run(scriptCustom, dir, envVars, 5)
	if resCustom.Status != "success" {
		t.Fatalf("expected success for custom target, got %s (stderr: %s)", resCustom.Status, resCustom.Stderr)
	}

	contentCustom, err := os.ReadFile(filepath.Join(dir, "config", "docker", "production.env"))
	if err != nil {
		t.Fatalf("read custom .env file: %v", err)
	}
	if !strings.Contains(string(contentCustom), `APP_NAME="my-backend"`) {
		t.Fatalf("custom env file does not contain expected variables: %s", string(contentCustom))
	}
}

func TestSafeRelPath(t *testing.T) {
	base := "/tmp/test-base"

	// Valid relative paths
	valid := []string{"nginx.conf", "conf.d/app.conf", "a/b/c.txt", "file_1.yaml"}
	for _, p := range valid {
		target, err := SafeRelPath(base, p)
		if err != nil {
			t.Fatalf("expected valid path for %q, got error: %v", p, err)
		}
		if !strings.HasPrefix(target, base) {
			t.Fatalf("expected target %q to start with base %q", target, base)
		}
	}

	// Invalid / dangerous paths
	invalid := []string{
		"",
		"   ",
		"/etc/passwd",
		"../../etc/shadow",
		"../foo",
		"a/../../outside",
		".",
		"..",
	}
	for _, p := range invalid {
		_, err := SafeRelPath(base, p)
		if err == nil {
			t.Fatalf("expected error for path traversal %q, but got nil", p)
		}
	}
}

func TestRunScriptWithAdditionalFiles(t *testing.T) {
	dir, err := os.MkdirTemp("", "seh-test-files-*")
	if err != nil {
		t.Fatalf("mkdir temp: %v", err)
	}
	defer os.RemoveAll(dir)

	opts := ScriptOptions{
		ScriptType: "bash",
		Content:    "cat nginx.conf && cat conf.d/default.conf",
		WorkingDir: dir,
		TimeoutSeconds: 5,
		Files: []FileToDeploy{
			{Path: "nginx.conf", Content: "server { listen 80; }"},
			{Path: "conf.d/default.conf", Content: "proxy_pass http://localhost:3000;"},
		},
	}

	res := RunScript(opts)
	if res.Status != "success" {
		t.Fatalf("expected success, got %s: %s", res.Status, res.Stderr)
	}
	if !strings.Contains(res.Stdout, "server { listen 80; }") || !strings.Contains(res.Stdout, "proxy_pass http://localhost:3000;") {
		t.Fatalf("expected stdout to contain file contents, got: %q", res.Stdout)
	}
}

func TestRunScriptDockerComposePreparation(t *testing.T) {
	dir, err := os.MkdirTemp("", "seh-test-compose-*")
	if err != nil {
		t.Fatalf("mkdir temp: %v", err)
	}
	defer os.RemoveAll(dir)

	opts := ScriptOptions{
		ScriptType: "docker_compose",
		Content:    "services:\n  app:\n    image: nginx:alpine",
		ComposeCmd: "echo 'MOCK COMPOSE RUN'; test -f docker-compose.yml && test -f nginx.conf && test -f .env",
		WorkingDir: dir,
		TimeoutSeconds: 5,
		EnvVars: map[string]string{
			"PORT": "8080",
			"HOST": "127.0.0.1",
		},
		Files: []FileToDeploy{
			{Path: "nginx.conf", Content: "events {} http { server {} }"},
		},
	}

	res := RunScript(opts)
	if res.Status != "success" {
		t.Fatalf("expected success, got %s: %s", res.Status, res.Stderr)
	}
	if !strings.Contains(res.Stdout, "MOCK COMPOSE RUN") {
		t.Fatalf("expected stdout to contain mock compose output, got: %q", res.Stdout)
	}

	// Verify docker-compose.yml exists
	composeBytes, err := os.ReadFile(filepath.Join(dir, "docker-compose.yml"))
	if err != nil {
		t.Fatalf("expected docker-compose.yml: %v", err)
	}
	if !strings.Contains(string(composeBytes), "services:") {
		t.Fatalf("expected docker-compose.yml content, got %s", string(composeBytes))
	}

	// Verify .env exists and has PORT
	envBytes, err := os.ReadFile(filepath.Join(dir, ".env"))
	if err != nil {
		t.Fatalf("expected .env: %v", err)
	}
	if !strings.Contains(string(envBytes), `PORT="8080"`) {
		t.Fatalf("expected .env to contain PORT, got %s", string(envBytes))
	}

	// Verify nginx.conf exists
	nginxBytes, err := os.ReadFile(filepath.Join(dir, "nginx.conf"))
	if err != nil {
		t.Fatalf("expected nginx.conf: %v", err)
	}
	if !strings.Contains(string(nginxBytes), "events {}") {
		t.Fatalf("expected nginx.conf content, got %s", string(nginxBytes))
	}
}
