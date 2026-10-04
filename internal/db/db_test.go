package db

import (
	"os"
	"strings"
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

func TestEnvironmentCRUDAndEncryption(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "test-db-env-*.db")
	if err != nil {
		t.Fatalf("create temp db: %v", err)
	}
	tmpFile.Close()
	path := tmpFile.Name()
	defer os.Remove(path)

	secretKey := "test-secret-key-321"
	d, err := New(path, secretKey)
	if err != nil {
		t.Fatalf("New db error: %v", err)
	}
	defer d.Close()

	// 1. Create environment
	envID, err := d.CreateEnvironment(&Environment{
		Name:        "Backend Production",
		Description: "Production variables for backend",
		Variables: []EnvVarItem{
			{Key: "PORT", Value: "8080", IsSecret: false},
			{Key: "DB_PASS", Value: "super-secret-password-xyz", IsSecret: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateEnvironment error: %v", err)
	}

	// 2. Verify stored in SQLite as encrypted
	var rawVars string
	err = d.conn.QueryRow("SELECT variables FROM environments WHERE id = ?", envID).Scan(&rawVars)
	if err != nil {
		t.Fatalf("raw query error: %v", err)
	}
	if !strings.Contains(rawVars, "enc:") {
		t.Fatalf("expected raw variables to contain 'enc:', got %s", rawVars)
	}
	if strings.Contains(rawVars, "super-secret-password-xyz") {
		t.Fatalf("expected plaintext secret NOT to be present in raw database, but found it!")
	}

	// 3. GetEnvironmentByID and verify decryption
	env, err := d.GetEnvironmentByID(envID)
	if err != nil {
		t.Fatalf("GetEnvironmentByID error: %v", err)
	}
	if env == nil || env.Name != "Backend Production" {
		t.Fatalf("expected env Backend Production, got: %+v", env)
	}
	if len(env.Variables) != 2 {
		t.Fatalf("expected 2 variables, got %d", len(env.Variables))
	}
	if env.Variables[1].Value != "super-secret-password-xyz" {
		t.Fatalf("expected decrypted password 'super-secret-password-xyz', got %q", env.Variables[1].Value)
	}

	// 4. Link to Script
	scriptID, err := d.CreateScript(&Script{
		Name:           "Deploy Backend",
		Content:        "echo deploy",
		TimeoutSeconds: 30,
		EnvVars:        "{}",
		EnvID:          &envID,
		WorkingDir:     "/var/www",
	})
	if err != nil {
		t.Fatalf("CreateScript error: %v", err)
	}

	s, err := d.GetScriptByID(scriptID)
	if err != nil || s == nil {
		t.Fatalf("GetScriptByID error: %v", err)
	}
	if s.EnvID == nil || *s.EnvID != envID || s.EnvName != "Backend Production" {
		t.Fatalf("expected script to have EnvID %d and EnvName 'Backend Production', got %+v", envID, s)
	}

	// 5. Link to Hook
	hookID, err := d.CreateHook(&Hook{
		Name:        "Deploy Hook",
		Slug:        "deploy-hook",
		SecretToken: "token-abc-123",
		ScriptID:    &scriptID,
		EnvID:       &envID,
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("CreateHook error: %v", err)
	}

	h, err := d.GetHookByID(hookID)
	if err != nil || h == nil {
		t.Fatalf("GetHookByID error: %v", err)
	}
	if h.EnvID == nil || *h.EnvID != envID || h.EnvName != "Backend Production" {
		t.Fatalf("expected hook to have EnvID %d and EnvName 'Backend Production', got %+v", envID, h)
	}
}
