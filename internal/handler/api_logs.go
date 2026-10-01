package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/script-execution-hooks/internal/config"
	"github.com/script-execution-hooks/internal/db"
)

// LogsHandler handles /api/logs
func LogsHandler(database *db.DB, cfg *config.Config) http.HandlerFunc {
	return authMiddleware(cfg, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			if err := database.ClearAllLogs(); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeOK(w, "all logs cleared")
			return
		}
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		limit := queryInt(r, "limit", 50)
		offset := queryInt(r, "offset", 0)
		hookIDStr := r.URL.Query().Get("hook_id")
		status := r.URL.Query().Get("status")
		search := r.URL.Query().Get("search")

		var hookID int64
		if hookIDStr != "" {
			var e error
			hookID, e = strconv.ParseInt(hookIDStr, 10, 64)
			if e != nil {
				writeError(w, http.StatusBadRequest, "invalid hook_id")
				return
			}
		}

		logs, err := database.ListLogsFiltered(hookID, status, search, limit, offset)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if logs == nil {
			logs = []db.ExecutionLog{}
		}
		writeOK(w, logs)
	})
}

// LogHandler handles /api/logs/:id
func LogHandler(database *db.DB, cfg *config.Config) http.HandlerFunc {
	return authMiddleware(cfg, func(w http.ResponseWriter, r *http.Request) {
		// Extract id from path — handle /api/logs/:id
		pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/logs/"), "/")
		if len(pathParts) == 0 || pathParts[0] == "" {
			writeError(w, http.StatusBadRequest, "invalid id")
			return
		}
		id, err := strconv.ParseInt(pathParts[0], 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid id")
			return
		}
		if r.Method != http.MethodDelete {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		if err := database.DeleteLog(id); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeOK(w, "deleted")
	})
}

// ConfigHandler handles /api/config
func ConfigHandler(database *db.DB, cfg *config.Config) http.HandlerFunc {
	return authMiddleware(cfg, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			conf, err := database.GetAllConfig()
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeOK(w, conf)
		case http.MethodPut:
			var updates map[string]string
			if err := decodeJSON(r, &updates); err != nil {
				writeError(w, http.StatusBadRequest, "invalid body")
				return
			}
			for k, v := range updates {
				if err := database.SetConfig(k, v); err != nil {
					writeError(w, http.StatusInternalServerError, err.Error())
					return
				}
			}
			writeOK(w, "updated")
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	})
}

func queryInt(r *http.Request, key string, def int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return i
}
