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
