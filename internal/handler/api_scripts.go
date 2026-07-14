package handler

import (
	"net/http"
	"strings"

	"github.com/script-execution-hooks/internal/config"
	"github.com/script-execution-hooks/internal/db"
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

type scriptRequest struct {
	Name           string `json:"name"`
	Description    string `json:"description"`
	Content        string `json:"content"`
	TimeoutSeconds int    `json:"timeout_seconds"`
	EnvVars        string `json:"env_vars"`
	WorkingDir     string `json:"working_dir"`
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
	if strings.Contains(req.EnvVars, "<script") {
		writeError(w, http.StatusBadRequest, "invalid env vars")
		return
	}
	s := &db.Script{
		Name:           req.Name,
		Description:    req.Description,
		Content:        req.Content,
		TimeoutSeconds: req.TimeoutSeconds,
		EnvVars:        req.EnvVars,
		WorkingDir:     req.WorkingDir,
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
	existing.Description = req.Description
	existing.Content = req.Content
	if req.TimeoutSeconds > 0 {
		existing.TimeoutSeconds = req.TimeoutSeconds
	}
	if req.EnvVars != "" {
		existing.EnvVars = req.EnvVars
	}
	if req.WorkingDir != "" {
		existing.WorkingDir = req.WorkingDir
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
