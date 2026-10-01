package db

import (
	"os"
	"testing"
)

func TestDBMigrationAndRecovery(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "test-db-*.db")
	if err != nil {
		t.Fatalf("create temp db: %v", err)
	}
	tmpFile.Close()
	path := tmpFile.Name()
	defer os.Remove(path)

	d, err := New(path)
	if err != nil {
		t.Fatalf("New db error: %v", err)
	}
	defer d.Close()

	// Insert running log
	hookID := int64(1)
	logID, err := d.CreateLog(&ExecutionLog{
		HookID:    &hookID,
		TriggerIP: "127.0.0.1",
		Status:    "running",
		Payload:   "test payload",
	})
	if err != nil {
		t.Fatalf("CreateLog error: %v", err)
	}

	// Test RecoverStaleLogs
	if err := d.RecoverStaleLogs(); err != nil {
		t.Fatalf("RecoverStaleLogs error: %v", err)
	}

	logs, err := d.ListLogs(10, 0)
	if err != nil {
		t.Fatalf("ListLogs error: %v", err)
	}
	if len(logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(logs))
	}
	if logs[0].Status != "interrupted" {
		t.Fatalf("expected status 'interrupted', got '%s'", logs[0].Status)
	}
	if logs[0].Payload != "test payload" {
		t.Fatalf("expected payload 'test payload', got '%s'", logs[0].Payload)
	}
	_ = logID
}
