package executor

import (
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
