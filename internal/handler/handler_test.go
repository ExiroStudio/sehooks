package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
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

