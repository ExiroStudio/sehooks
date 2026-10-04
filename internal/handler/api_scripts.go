package handler

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/script-execution-hooks/internal/config"
	"github.com/script-execution-hooks/internal/db"
	"github.com/script-execution-hooks/internal/executor"
)

// ScriptsHandler handles /api/scripts
func ScriptsHandler(database *db.DB, cfg *config.Config) http.HandlerFunc {
	return authMiddleware(cfg, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			listScripts(w, database)
		case http.MethodPost:
			createScript(w, r, database)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	})
}

// ScriptHandler handles /api/scripts/:id
func ScriptHandler(database *db.DB, cfg *config.Config) http.HandlerFunc {
	return authMiddleware(cfg, func(w http.ResponseWriter, r *http.Request) {
		id, err := idFromPath(r.URL.Path, "/api/scripts/")
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid id")
			return
		}
		if strings.HasSuffix(r.URL.Path, "/run") {
			runScriptDirectly(w, r, database, id)
			return
		}
		switch r.Method {
		case http.MethodGet:
			getScript(w, database, id)
		case http.MethodPut:
			updateScript(w, r, database, id)
		case http.MethodDelete:
			deleteScript(w, database, id)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	})
}

func runScriptDirectly(w http.ResponseWriter, r *http.Request, database *db.DB, id int64) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	script, err := database.GetScriptByID(id)
	if err != nil || script == nil {
		writeError(w, http.StatusNotFound, "script not found")
		return
	}

	var req struct {
		Payload string `json:"payload"`
	}
	_ = decodeJSON(r, &req)

	clientIP := r.Header.Get("X-Forwarded-For")
	if clientIP == "" {
		clientIP = r.RemoteAddr
	}

	logEntry := &db.ExecutionLog{
		HookID:    nil,
		ScriptID:  &script.ID,
		TriggerIP: clientIP + " (Direct)",
		Status:    "running",
		Payload:   req.Payload,
	}
	logID, err := database.CreateLog(logEntry)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	envVars := ResolveExecutionEnv(database, nil, script)
	envVars["SEH_SCRIPT_ID"] = fmt.Sprintf("%d", script.ID)
	envVars["SEH_SCRIPT_NAME"] = script.Name
	envVars["SEH_TRIGGER_IP"] = clientIP

	var filesToDeploy []executor.FileToDeploy
	for _, f := range script.Files {
		filesToDeploy = append(filesToDeploy, executor.FileToDeploy{
			Path:    f.Path,
			Content: f.Content,
		})
	}

	go func() {
		opts := executor.ScriptOptions{
			ScriptID:       script.ID,
			ScriptType:     script.ScriptType,
			Content:        script.Content,
			ComposeCmd:     script.ComposeCmd,
			WorkingDir:     script.WorkingDir,
			EnvVars:        envVars,
			TimeoutSeconds: script.TimeoutSeconds,
			Payload:        req.Payload,
			Files:          filesToDeploy,
		}
		result := executor.RunScript(opts)
		exitCode := &result.ExitCode
		_ = database.UpdateLog(logID, exitCode, result.Stdout, result.Stderr, result.DurationMs, result.Status)
	}()

	writeJSON(w, http.StatusAccepted, map[string]any{
		"ok":      true,
		"message": "script execution started",
		"log_id":  logID,
	})
}

func listScripts(w http.ResponseWriter, database *db.DB) {
	scripts, err := database.ListScripts()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if scripts == nil {
		scripts = []db.Script{}
	}
	writeOK(w, scripts)
}

func getScript(w http.ResponseWriter, database *db.DB, id int64) {
	s, err := database.GetScriptByID(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if s == nil {
		writeError(w, http.StatusNotFound, "script not found")
		return
	}
	writeOK(w, s)
}

type scriptFileRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type scriptRequest struct {
	Name           string              `json:"name"`
	Description    string              `json:"description"`
	ScriptType     string              `json:"script_type"` // "bash" or "docker_compose"
	Content        string              `json:"content"`
	ComposeCmd     string              `json:"compose_cmd"`
	TimeoutSeconds int                 `json:"timeout_seconds"`
	EnvVars        string              `json:"env_vars"`
	EnvID          *int64              `json:"env_id"`
	WorkingDir     string              `json:"working_dir"`
	Files          []scriptFileRequest `json:"files"`
}

func createScript(w http.ResponseWriter, r *http.Request, database *db.DB) {
	var req scriptRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.TimeoutSeconds <= 0 {
		req.TimeoutSeconds = 30
	}
	if req.EnvVars == "" {
		req.EnvVars = "{}"
	}
	if req.WorkingDir == "" {
		req.WorkingDir = "/tmp"
	}
	if req.ScriptType == "" {
		req.ScriptType = "bash"
	}
	if strings.Contains(req.EnvVars, "<script") {
		writeError(w, http.StatusBadRequest, "invalid env vars")
		return
	}

	var dbFiles []db.ScriptFile
	for _, f := range req.Files {
		cleanPath := strings.TrimSpace(f.Path)
		if cleanPath == "" {
			continue
		}
		if _, err := executor.SafeRelPath("/tmp", cleanPath); err != nil {
			writeError(w, http.StatusBadRequest, "invalid file path: "+err.Error())
			return
		}
		dbFiles = append(dbFiles, db.ScriptFile{
			Path:    cleanPath,
			Content: f.Content,
		})
	}

	s := &db.Script{
		Name:           req.Name,
		Description:    req.Description,
		ScriptType:     req.ScriptType,
		Content:        req.Content,
		ComposeCmd:     req.ComposeCmd,
		TimeoutSeconds: req.TimeoutSeconds,
		EnvVars:        req.EnvVars,
		EnvID:          req.EnvID,
		WorkingDir:     req.WorkingDir,
		Files:          dbFiles,
	}
	id, err := database.CreateScript(s)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.ID = id
	writeJSON(w, http.StatusCreated, map[string]any{"data": s, "ok": true})
}

func updateScript(w http.ResponseWriter, r *http.Request, database *db.DB, id int64) {
	existing, err := database.GetScriptByID(id)
	if err != nil || existing == nil {
		writeError(w, http.StatusNotFound, "script not found")
		return
	}
	var req scriptRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name != "" {
		existing.Name = req.Name
	}
	if req.ScriptType != "" {
		existing.ScriptType = req.ScriptType
	}
	existing.ComposeCmd = req.ComposeCmd
	existing.Description = req.Description
	existing.Content = req.Content
	if req.TimeoutSeconds > 0 {
		existing.TimeoutSeconds = req.TimeoutSeconds
	}
	if req.EnvVars != "" {
		existing.EnvVars = req.EnvVars
	}
	existing.EnvID = req.EnvID
	if req.WorkingDir != "" {
		existing.WorkingDir = req.WorkingDir
	}

	if req.Files != nil {
		var dbFiles []db.ScriptFile
		for _, f := range req.Files {
			cleanPath := strings.TrimSpace(f.Path)
			if cleanPath == "" {
				continue
			}
			if _, err := executor.SafeRelPath("/tmp", cleanPath); err != nil {
				writeError(w, http.StatusBadRequest, "invalid file path: "+err.Error())
				return
			}
			dbFiles = append(dbFiles, db.ScriptFile{
				Path:    cleanPath,
				Content: f.Content,
			})
		}
		existing.Files = dbFiles
	}

	if err := database.UpdateScript(existing); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeOK(w, existing)
}

func deleteScript(w http.ResponseWriter, database *db.DB, id int64) {
	if err := database.DeleteScript(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeOK(w, "deleted")
}
