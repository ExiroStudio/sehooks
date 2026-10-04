package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/script-execution-hooks/internal/config"
	"github.com/script-execution-hooks/internal/db"
)

func setupTestDB(t *testing.T) (*db.DB, string) {
	tmpFile, err := os.CreateTemp("", "test-hooks-*.db")
	if err != nil {
		t.Fatalf("create temp db: %v", err)
	}
	tmpFile.Close()
	path := tmpFile.Name()

	database, err := db.New(path)
	if err != nil {
		os.Remove(path)
		t.Fatalf("open db: %v", err)
	}
	return database, path
}

func TestWebhookWithPayloadAndTimeout(t *testing.T) {
	database, dbPath := setupTestDB(t)
	defer os.Remove(dbPath)
	defer database.Close()

	// 1. Create a script that reads SEH_PAYLOAD and stdin
	scriptID, err := database.CreateScript(&db.Script{
		Name:           "Echo Payload",
		Content:        `echo "ENV_PAYLOAD: $SEH_PAYLOAD"; echo -n "STDIN: "; cat`,
		TimeoutSeconds: 5,
		EnvVars:        "{}",
		WorkingDir:     "/tmp",
	})
	if err != nil {
		t.Fatalf("create script: %v", err)
	}

	// 2. Create a hook
	hookID, err := database.CreateHook(&db.Hook{
		Name:        "Test Hook",
		Slug:        "test-hook",
		SecretToken: "testsecret123",
		ScriptID:    &scriptID,
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("create hook: %v", err)
	}
	_ = hookID

	// 3. Trigger webhook with payload
	payloadData := `{"event":"push","branch":"main"}`
	req := httptest.NewRequest(http.MethodPost, "/webhook/testsecret123", bytes.NewBufferString(payloadData))
	w := httptest.NewRecorder()

	handler := WebhookHandler(database)
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202 Accepted, got %d: %s", w.Code, w.Body.String())
	}

	// Wait for async execution
	time.Sleep(1 * time.Second)

	logs, err := database.ListLogs(10, 0)
	if err != nil {
		t.Fatalf("list logs: %v", err)
	}
	if len(logs) == 0 {
		t.Fatalf("expected at least 1 log entry")
	}

	lastLog := logs[0]
	if lastLog.Status != "success" {
		t.Fatalf("expected success, got %s (stderr: %s)", lastLog.Status, lastLog.Stderr)
	}
	if lastLog.Payload != payloadData {
		t.Fatalf("expected payload %q, got %q", payloadData, lastLog.Payload)
	}
	if !bytes.Contains([]byte(lastLog.Stdout), []byte("ENV_PAYLOAD: "+payloadData)) {
		t.Fatalf("expected stdout to contain env payload, got: %s", lastLog.Stdout)
	}
	if !bytes.Contains([]byte(lastLog.Stdout), []byte("STDIN: "+payloadData)) {
		t.Fatalf("expected stdout to contain stdin payload, got: %s", lastLog.Stdout)
	}
}

func TestDirectScriptRunAndFilter(t *testing.T) {
	database, dbPath := setupTestDB(t)
	defer os.Remove(dbPath)
	defer database.Close()

	cfg := &config.Config{
		AdminPassword: "admin",
	}

	// Create a script
	scriptID, err := database.CreateScript(&db.Script{
		Name:           "Direct Run Script",
		Content:        `echo "Running directly"`,
		TimeoutSeconds: 5,
		EnvVars:        "{}",
		WorkingDir:     "/tmp",
	})
	if err != nil {
		t.Fatalf("create script: %v", err)
	}

	// Trigger run directly via /api/scripts/:id/run
	reqBody, _ := json.Marshal(map[string]string{"payload": "direct-payload"})
	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/scripts/%d/run", scriptID), bytes.NewBuffer(reqBody))
	req.URL.Path = fmt.Sprintf("/api/scripts/%d/run", scriptID)

	// Add auth session
	token := "session123"
	SetSession(token, time.Now().Add(1*time.Hour))
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	handler := ScriptHandler(database, cfg)
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202 Accepted, got %d: %s", w.Code, w.Body.String())
	}

	time.Sleep(1 * time.Second)

	// Verify log exists and can be filtered
	logs, err := database.ListLogsFiltered(0, "success", "Direct Run Script", 10, 0)
	if err != nil {
		t.Fatalf("list filtered logs: %v", err)
	}
	if len(logs) == 0 {
		t.Fatalf("expected at least 1 filtered log")
	}
	if logs[0].Status != "success" {
		t.Fatalf("expected success, got %s", logs[0].Status)
	}

	// Test ClearAllLogs
	delReq := httptest.NewRequest(http.MethodDelete, "/api/logs", nil)
	delReq.Header.Set("Authorization", "Bearer "+token)
	delW := httptest.NewRecorder()
	logsHandler := LogsHandler(database, cfg)
	logsHandler.ServeHTTP(delW, delReq)

	if delW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for delete logs, got %d", delW.Code)
	}

	afterLogs, _ := database.ListLogs(10, 0)
	if len(afterLogs) != 0 {
		t.Fatalf("expected 0 logs after clear, got %d", len(afterLogs))
	}
}

func TestConcurrentSessions(t *testing.T) {
	token := "concurrent-token"
	SetSession(token, time.Now().Add(1*time.Hour))

	done := make(chan bool)
	for i := 0; i < 50; i++ {
		go func(idx int) {
			if idx%3 == 0 {
				SetSession(fmt.Sprintf("token-%d", idx), time.Now().Add(1*time.Hour))
			} else if idx%3 == 1 {
				ValidateAndRefreshSession(token)
			} else {
				DeleteSession(fmt.Sprintf("token-%d", idx))
			}
			done <- true
		}(i)
	}

	for i := 0; i < 50; i++ {
		<-done
	}
}

func TestEnvironmentsAPIAndExecution(t *testing.T) {
	database, dbPath := setupTestDB(t)
	defer os.Remove(dbPath)
	defer database.Close()

	cfg := &config.Config{
		AdminPassword: "admin",
	}

	token := "admin-token-env"
	SetSession(token, time.Now().Add(1*time.Hour))

	// 1. Create environment via POST /api/environments
	envBody, _ := json.Marshal(map[string]any{
		"name":        "Test Backend Env",
		"description": "Backend variables for testing",
		"variables": []map[string]any{
			{"key": "APP_PORT", "value": "5000", "is_secret": false},
			{"key": "SECRET_KEY", "value": "my-very-secret-token", "is_secret": true},
		},
	})
	postReq := httptest.NewRequest(http.MethodPost, "/api/environments", bytes.NewBuffer(envBody))
	postReq.Header.Set("Authorization", "Bearer "+token)
	postW := httptest.NewRecorder()
	EnvironmentsHandler(database, cfg).ServeHTTP(postW, postReq)

	if postW.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", postW.Code, postW.Body.String())
	}

	var postResp struct {
		Data db.Environment `json:"data"`
	}
	if err := json.Unmarshal(postW.Body.Bytes(), &postResp); err != nil {
		t.Fatalf("unmarshal post resp: %v", err)
	}
	envID := postResp.Data.ID

	// 2. Create script linked to this environment
	scriptID, err := database.CreateScript(&db.Script{
		Name:           "Script with Env",
		Content:        `echo "PORT=$APP_PORT"; echo "SECRET=$SECRET_KEY"; seh_import_env; cat .env`,
		TimeoutSeconds: 5,
		EnvVars:        `{"OVERRIDE_VAR":"123"}`,
		EnvID:          &envID,
		WorkingDir:     "/tmp",
	})
	if err != nil {
		t.Fatalf("create script: %v", err)
	}

	// 3. Create hook linked to this script
	hookID, err := database.CreateHook(&db.Hook{
		Name:        "Hook with Env",
		Slug:        "hook-with-env",
		SecretToken: "token-env-hook",
		ScriptID:    &scriptID,
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("create hook: %v", err)
	}
	_ = hookID

	// 4. Trigger webhook
	hookReq := httptest.NewRequest(http.MethodPost, "/webhook/token-env-hook", nil)
	hookW := httptest.NewRecorder()
	WebhookHandler(database).ServeHTTP(hookW, hookReq)

	if hookW.Code != http.StatusAccepted {
		t.Fatalf("expected 202 Accepted, got %d: %s", hookW.Code, hookW.Body.String())
	}

	time.Sleep(1 * time.Second)

	logs, err := database.ListLogs(1, 0)
	if err != nil || len(logs) == 0 {
		t.Fatalf("expected log entry, got %v", err)
	}

	lastLog := logs[0]
	if lastLog.Status != "success" {
		t.Fatalf("expected success, got %s (stderr: %s)", lastLog.Status, lastLog.Stderr)
	}

	if !strings.Contains(lastLog.Stdout, "PORT=5000") {
		t.Fatalf("expected stdout to contain PORT=5000, got: %s", lastLog.Stdout)
	}
	if !strings.Contains(lastLog.Stdout, "SECRET=my-very-secret-token") {
		t.Fatalf("expected stdout to contain SECRET=my-very-secret-token, got: %s", lastLog.Stdout)
	}
	if !strings.Contains(lastLog.Stdout, `APP_PORT="5000"`) {
		t.Fatalf("expected stdout to contain imported .env file content, got: %s", lastLog.Stdout)
	}
}


