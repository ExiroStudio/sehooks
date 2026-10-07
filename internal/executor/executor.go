package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// Result holds the output of a script execution
type Result struct {
	Stdout     string
	Stderr     string
	ExitCode   int
	DurationMs int64
	Status     string // success, failed, timeout
	Error      error
}

// FileToDeploy represents an additional file to write to the working directory
type FileToDeploy struct {
	Path    string
	Content string
}

// ScriptOptions holds parameters for script execution
type ScriptOptions struct {
	ScriptID       int64
	ScriptType     string // "bash" or "docker_compose"
	Content        string // Bash script or docker-compose.yml
	ComposeCmd     string // Custom compose command
	WorkingDir     string
	EnvVars        map[string]string
	TimeoutSeconds int
	Payload        string
	Files          []FileToDeploy
}

// SafeRelPath validates and returns a clean, safe absolute path inside baseDir
func SafeRelPath(baseDir, relPath string) (string, error) {
	relPath = strings.TrimSpace(relPath)
	if relPath == "" {
		return "", fmt.Errorf("file path cannot be empty")
	}
	if filepath.IsAbs(relPath) || strings.HasPrefix(relPath, "/") || strings.HasPrefix(relPath, "\\") {
		return "", fmt.Errorf("path must be relative, not absolute: %s", relPath)
	}
	cleanRel := filepath.Clean(relPath)
	if cleanRel == "." || cleanRel == ".." || strings.HasPrefix(cleanRel, ".."+string(filepath.Separator)) || strings.HasPrefix(cleanRel, "../") {
		return "", fmt.Errorf("path cannot traverse outside working directory: %s", relPath)
	}

	absBase, err := filepath.Abs(baseDir)
	if err != nil {
		absBase = baseDir
	}
	targetPath := filepath.Join(absBase, cleanRel)
	cleanTarget := filepath.Clean(targetPath)

	if !strings.HasPrefix(cleanTarget, absBase+string(filepath.Separator)) && cleanTarget != absBase {
		return "", fmt.Errorf("path escapes working directory: %s", relPath)
	}

	return cleanTarget, nil
}

// WriteAdditionalFiles safely writes extra files to the working directory
func WriteAdditionalFiles(workingDir string, files []FileToDeploy) error {
	for _, f := range files {
		target, err := SafeRelPath(workingDir, f.Path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return fmt.Errorf("create dir for %s: %w", f.Path, err)
		}
		if err := os.WriteFile(target, []byte(f.Content), 0644); err != nil {
			return fmt.Errorf("write file %s: %w", f.Path, err)
		}
	}
	return nil
}

// WriteDotEnvFile writes .env directly in workingDir for Docker Compose
func WriteDotEnvFile(workingDir string, envVars map[string]string) error {
	if len(envVars) == 0 {
		return nil
	}
	var buf bytes.Buffer
	buf.WriteString("# Generated automatically by SEHooks\n")
	for k, v := range envVars {
		if isValidEnvKey(k) && !strings.HasPrefix(k, "SEH_") {
			escaped := strings.ReplaceAll(v, "\\", "\\\\")
			escaped = strings.ReplaceAll(escaped, "\"", "\\\"")
			escaped = strings.ReplaceAll(escaped, "\n", "\\n")
			buf.WriteString(fmt.Sprintf("%s=\"%s\"\n", k, escaped))
		}
	}
	targetPath := filepath.Join(workingDir, ".env")
	return os.WriteFile(targetPath, buf.Bytes(), 0600)
}

// IsDockerCompose returns true if scriptType or content indicates Docker Compose
func IsDockerCompose(scriptType, content string) bool {
	st := strings.ToLower(strings.TrimSpace(scriptType))
	if st == "docker_compose" || st == "docker-compose" || st == "compose" {
		return true
	}
	// Fallback heuristic: check if content looks like a docker-compose YAML file
	trimmed := strings.TrimSpace(content)
	if strings.HasPrefix(trimmed, "#!") {
		return false // Explicit bash shebang
	}
	for _, line := range strings.Split(trimmed, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "services:") || strings.HasPrefix(line, "version:") {
			return true
		}
		break
	}
	return false
}

// RunScript executes a script with full support for bash/docker-compose and additional files
func RunScript(opts ScriptOptions) Result {
	workDir := strings.TrimSpace(opts.WorkingDir)
	if workDir == "" || workDir == "/tmp" {
		if opts.ScriptID > 0 {
			workDir = fmt.Sprintf("/tmp/sehooks/scripts/%d", opts.ScriptID)
		} else {
			workDir = "/tmp"
		}
	}

	if IsDockerCompose(opts.ScriptType, opts.Content) {
		if err := os.MkdirAll(workDir, 0755); err != nil {
			return Result{Status: "failed", Error: err, Stderr: err.Error(), ExitCode: -1}
		}
		composePath := filepath.Join(workDir, "docker-compose.yml")
		if err := os.WriteFile(composePath, []byte(opts.Content), 0644); err != nil {
			return Result{Status: "failed", Error: fmt.Errorf("write docker-compose.yml: %w", err), Stderr: err.Error(), ExitCode: -1}
		}
		if err := WriteAdditionalFiles(workDir, opts.Files); err != nil {
			return Result{Status: "failed", Error: fmt.Errorf("write additional files: %w", err), Stderr: err.Error(), ExitCode: -1}
		}
		_ = WriteDotEnvFile(workDir, opts.EnvVars)

		cmd := strings.TrimSpace(opts.ComposeCmd)
		if cmd == "" {
			cmd = "docker compose up -d --remove-orphans"
		}
		return RunWithPayload(cmd, workDir, opts.EnvVars, opts.TimeoutSeconds, opts.Payload)
	}

	// Bash mode
	if len(opts.Files) > 0 {
		if err := os.MkdirAll(workDir, 0755); err != nil {
			return Result{Status: "failed", Error: err, Stderr: err.Error(), ExitCode: -1}
		}
		if err := WriteAdditionalFiles(workDir, opts.Files); err != nil {
			return Result{Status: "failed", Error: fmt.Errorf("write additional files: %w", err), Stderr: err.Error(), ExitCode: -1}
		}
	}
	return RunWithPayload(opts.Content, workDir, opts.EnvVars, opts.TimeoutSeconds, opts.Payload)
}

// Run executes a shell script safely with the given options
func Run(script, workingDir string, envVars map[string]string, timeoutSeconds int) Result {
	return RunWithPayload(script, workingDir, envVars, timeoutSeconds, "")
}

// RunWithPayload executes a shell script safely with input payload
func RunWithPayload(script, workingDir string, envVars map[string]string, timeoutSeconds int, payload string) Result {
	start := time.Now()

	if timeoutSeconds <= 0 {
		timeoutSeconds = 30
	}
	if workingDir == "" {
		workingDir = "/tmp"
	}

	// Ensure working directory exists
	if _, err := os.Stat(workingDir); os.IsNotExist(err) {
		workingDir = "/tmp"
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSeconds)*time.Second)
	defer cancel()

	if envVars == nil {
		envVars = make(map[string]string)
	}

	// Create secure .env file with 0600 permissions
	envFile, err := os.CreateTemp("", "seh-env-*.env")
	if err == nil {
		defer os.Remove(envFile.Name())
		var envBuf bytes.Buffer
		envBuf.WriteString("# Generated by SEHooks\n")
		for k, v := range envVars {
			if isValidEnvKey(k) && !strings.HasPrefix(k, "SEH_") {
				escaped := strings.ReplaceAll(v, "\\", "\\\\")
				escaped = strings.ReplaceAll(escaped, "\"", "\\\"")
				escaped = strings.ReplaceAll(escaped, "\n", "\\n")
				envBuf.WriteString(fmt.Sprintf("%s=\"%s\"\n", k, escaped))
			}
		}
		_ = envFile.Chmod(0600)
		_, _ = envFile.Write(envBuf.Bytes())
		_ = envFile.Close()
		envVars["SEH_ENV_FILE"] = envFile.Name()
	}

	// Write script to temp file for safer execution
	tmpFile, err := os.CreateTemp("", "seh-script-*.sh")
	if err != nil {
		return Result{
			Status:   "failed",
			Error:    fmt.Errorf("create temp file: %w", err),
			Stderr:   err.Error(),
			ExitCode: -1,
		}
	}
	defer os.Remove(tmpFile.Name())

	scriptHeader := `#!/bin/bash
set -euo pipefail

# Built-in helper: import environment variables to a target file (default ./.env)
seh_import_env() {
  local target="${1:-.env}"
  if [ -n "${SEH_ENV_FILE:-}" ] && [ -f "${SEH_ENV_FILE}" ]; then
    mkdir -p "$(dirname "$target")" 2>/dev/null || true
    cp "${SEH_ENV_FILE}" "$target"
    chmod 600 "$target" 2>/dev/null || true
    echo "[sehooks] Environment imported to $target"
  else
    echo "[sehooks] Warning: SEH_ENV_FILE not found or empty" >&2
    return 1
  fi
}

`
	if _, err := tmpFile.WriteString(scriptHeader + script); err != nil {
		tmpFile.Close()
		return Result{Status: "failed", Error: err, Stderr: err.Error(), ExitCode: -1}
	}
	tmpFile.Close()

	if err := os.Chmod(tmpFile.Name(), 0700); err != nil {
		return Result{Status: "failed", Error: err, Stderr: err.Error(), ExitCode: -1}
	}

	cmd := exec.CommandContext(ctx, "bash", tmpFile.Name())
	cmd.Dir = workingDir

	// Process group isolation: ensure child processes and pipelines belong to this group
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	// Kill entire process group on cancellation / timeout
	cmd.Cancel = func() error {
		if cmd.Process != nil && cmd.Process.Pid > 0 {
			// Negative PID sends signal to the entire process group
			return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
		return nil
	}

	// Prevent cmd.Wait from hanging forever if child processes keep stdout/stderr open
	cmd.WaitDelay = 2 * time.Second

	// Supply payload to stdin if provided
	if payload != "" {
		cmd.Stdin = strings.NewReader(payload)
		if envVars == nil {
			envVars = make(map[string]string)
		}
		envVars["SEH_PAYLOAD"] = payload
	}

	// Build restricted environment
	env := buildEnv(envVars)
	cmd.Env = env

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	runErr := cmd.Run()
	duration := time.Since(start).Milliseconds()

	result := Result{
		Stdout:     truncate(stdout.String(), 65536),
		Stderr:     truncate(stderr.String(), 65536),
		DurationMs: duration,
	}

	if ctx.Err() == context.DeadlineExceeded {
		result.Status = "timeout"
		result.ExitCode = -1
		result.Error = fmt.Errorf("script timed out after %ds", timeoutSeconds)
		if result.Stderr != "" {
			result.Stderr += "\n"
		}
		result.Stderr += fmt.Sprintf("[TIMEOUT: script exceeded time limit of %ds]", timeoutSeconds)
		return result
	}

	if runErr != nil {
		result.Error = runErr
		result.Status = "failed"
		if exitErr, ok := runErr.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else {
			result.ExitCode = -1
		}
	} else {
		result.Status = "success"
		result.ExitCode = 0
	}

	return result
}

// ParseEnvVars parses a JSON string of env vars into a map
func ParseEnvVars(jsonStr string) (map[string]string, error) {
	if jsonStr == "" || jsonStr == "{}" {
		return map[string]string{}, nil
	}
	var m map[string]string
	if err := json.Unmarshal([]byte(jsonStr), &m); err != nil {
		return nil, err
	}
	return m, nil
}

// buildEnv creates a minimal, safe environment for script execution
func buildEnv(extraVars map[string]string) []string {
	// Allowlisted base env vars
	allowed := []string{
		"PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "TERM",
		"DOCKER_CONFIG", "DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH",
		"GITHUB_TOKEN", "GH_TOKEN", "GIT_SSH_COMMAND",
	}
	env := make([]string, 0, len(allowed)+len(extraVars))

	for _, key := range allowed {
		if val := os.Getenv(key); val != "" {
			env = append(env, key+"="+val)
		}
	}

	// Ensure safe PATH
	hasPATH := false
	for _, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			hasPATH = true
			break
		}
	}
	if !hasPATH {
		env = append(env, "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
	}

	// Add user-defined env vars
	for k, v := range extraVars {
		// Sanitize key: only allow alphanumeric and underscore
		if isValidEnvKey(k) {
			env = append(env, k+"="+v)
		}
	}

	return env
}

func isValidEnvKey(key string) bool {
	if len(key) == 0 {
		return false
	}
	for _, c := range key {
		if !((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') {
			return false
		}
	}
	return true
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "\n...[truncated]"
}
