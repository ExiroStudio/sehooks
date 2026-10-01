package handler

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/script-execution-hooks/internal/db"
	"github.com/script-execution-hooks/internal/executor"
)

// WebhookHandler handles POST /webhook/:token
func WebhookHandler(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "POST only")
			return
		}

		// Extract token from /webhook/:token
		token := strings.TrimPrefix(r.URL.Path, "/webhook/")
		token = strings.TrimSuffix(token, "/")
		if token == "" {
			writeError(w, http.StatusBadRequest, "missing token")
			return
		}

		// Look up hook by token
		hook, err := database.GetHookByToken(token)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if hook == nil {
			writeError(w, http.StatusNotFound, "hook not found or disabled")
			return
		}

		// Get client IP
		clientIP := r.Header.Get("X-Forwarded-For")
		if clientIP == "" {
			clientIP = r.RemoteAddr
		}

		// Read request payload (up to 64KB)
		var payload string
		if r.Body != nil {
			bodyBytes, _ := io.ReadAll(io.LimitReader(r.Body, 65536))
			payload = string(bodyBytes)
		}

		// Create log entry
		logEntry := &db.ExecutionLog{
			HookID:    &hook.ID,
			ScriptID:  hook.ScriptID,
			TriggerIP: clientIP,
			Status:    "running",
			Payload:   payload,
		}
		logID, err := database.CreateLog(logEntry)
		if err != nil {
			log.Printf("create log error: %v", err)
		}

		// No script linked
		if hook.ScriptID == nil {
			if logID > 0 {
				_ = database.UpdateLog(logID, nil, "", "no script linked to this hook", 0, "failed")
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":      false,
				"message": "hook has no script linked",
				"hook":    hook.Name,
				"log_id":  logID,
			})
			return
		}

		// Fetch script
		script, err := database.GetScriptByID(*hook.ScriptID)
		if err != nil || script == nil {
			if logID > 0 {
				_ = database.UpdateLog(logID, nil, "", "script not found", 0, "failed")
			}
			writeError(w, http.StatusInternalServerError, "script not found")
			return
		}

		// Parse env vars
		envVars, err := executor.ParseEnvVars(script.EnvVars)
		if err != nil {
			log.Printf("parse env vars error: %v", err)
			envVars = map[string]string{}
		}

		// Inject hook metadata as env vars
		envVars["SEH_HOOK_ID"] = fmt.Sprintf("%d", hook.ID)
		envVars["SEH_HOOK_NAME"] = hook.Name
		envVars["SEH_HOOK_SLUG"] = hook.Slug
		envVars["SEH_TRIGGER_IP"] = clientIP

		// Execute script asynchronously
		go func() {
			result := executor.RunWithPayload(script.Content, script.WorkingDir, envVars, script.TimeoutSeconds, payload)
			exitCode := &result.ExitCode
			if err := database.UpdateLog(logID, exitCode, result.Stdout, result.Stderr, result.DurationMs, result.Status); err != nil {
				log.Printf("update log error: %v", err)
			}
			log.Printf("[hook:%s] status=%s duration=%dms exit=%d", hook.Name, result.Status, result.DurationMs, result.ExitCode)
		}()

		writeJSON(w, http.StatusAccepted, map[string]any{
			"ok":      true,
			"message": "hook triggered, script is running",
			"hook":    hook.Name,
			"log_id":  logID,
		})
	}
}
