package handler

import (
	"net/http"
	"regexp"

	"github.com/script-execution-hooks/internal/config"
	"github.com/script-execution-hooks/internal/db"
)

var validEnvKeyRe = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// EnvironmentsHandler handles /api/environments
func EnvironmentsHandler(database *db.DB, cfg *config.Config) http.HandlerFunc {
	return authMiddleware(cfg, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			listEnvironments(w, database)
		case http.MethodPost:
			createEnvironment(w, r, database)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	})
}

// EnvironmentHandler handles /api/environments/:id
func EnvironmentHandler(database *db.DB, cfg *config.Config) http.HandlerFunc {
	return authMiddleware(cfg, func(w http.ResponseWriter, r *http.Request) {
		id, err := idFromPath(r.URL.Path, "/api/environments/")
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid id")
			return
		}
		switch r.Method {
		case http.MethodGet:
			getEnvironment(w, database, id)
		case http.MethodPut:
			updateEnvironment(w, r, database, id)
		case http.MethodDelete:
			deleteEnvironment(w, database, id)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	})
}

func listEnvironments(w http.ResponseWriter, database *db.DB) {
	envs, err := database.ListEnvironments()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if envs == nil {
		envs = []db.Environment{}
	}
	writeOK(w, envs)
}

func getEnvironment(w http.ResponseWriter, database *db.DB, id int64) {
	e, err := database.GetEnvironmentByID(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if e == nil {
		writeError(w, http.StatusNotFound, "environment not found")
		return
	}
	writeOK(w, e)
}

type environmentRequest struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Variables   []db.EnvVarItem `json:"variables"`
}

func createEnvironment(w http.ResponseWriter, r *http.Request, database *db.DB) {
	var req environmentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	cleanVars := make([]db.EnvVarItem, 0, len(req.Variables))
	for _, item := range req.Variables {
		if item.Key == "" {
			continue
		}
		if !validEnvKeyRe.MatchString(item.Key) {
			writeError(w, http.StatusBadRequest, "invalid variable name: "+item.Key)
			return
		}
		cleanVars = append(cleanVars, item)
	}

	env := &db.Environment{
		Name:        req.Name,
		Description: req.Description,
		Variables:   cleanVars,
	}

	id, err := database.CreateEnvironment(env)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	env.ID = id
	writeJSON(w, http.StatusCreated, map[string]any{"data": env, "ok": true})
}

func updateEnvironment(w http.ResponseWriter, r *http.Request, database *db.DB, id int64) {
	existing, err := database.GetEnvironmentByID(id)
	if err != nil || existing == nil {
		writeError(w, http.StatusNotFound, "environment not found")
		return
	}
	var req environmentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name != "" {
		existing.Name = req.Name
	}
	existing.Description = req.Description

	cleanVars := make([]db.EnvVarItem, 0, len(req.Variables))
	for _, item := range req.Variables {
		if item.Key == "" {
			continue
		}
		if !validEnvKeyRe.MatchString(item.Key) {
			writeError(w, http.StatusBadRequest, "invalid variable name: "+item.Key)
			return
		}
		cleanVars = append(cleanVars, item)
	}
	existing.Variables = cleanVars

	if err := database.UpdateEnvironment(existing); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeOK(w, existing)
}

func deleteEnvironment(w http.ResponseWriter, database *db.DB, id int64) {
	if err := database.DeleteEnvironment(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeOK(w, "deleted")
}
