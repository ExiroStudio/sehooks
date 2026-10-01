package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
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

	if _, err := tmpFile.WriteString("#!/bin/bash\nset -euo pipefail\n\n" + script); err != nil {
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
