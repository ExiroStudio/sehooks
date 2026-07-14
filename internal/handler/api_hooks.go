package handler

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/script-execution-hooks/internal/config"
	"github.com/script-execution-hooks/internal/db"
)

// LoginHandler handles POST /api/auth/login
func LoginHandler(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		var req struct {
			Password string `json:"password"`
		}
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		if req.Password != cfg.AdminPassword {
			writeError(w, http.StatusUnauthorized, "invalid password")
			return
		}
		token := generateToken()
		sessions[token] = time.Now().Add(24 * time.Hour)
		http.SetCookie(w, &http.Cookie{
			Name:     "seh_session",
			Value:    token,
			Path:     "/",
			HttpOnly: true,
			MaxAge:   86400,
		})
		writeOK(w, map[string]string{"token": token})
	}
}

// LogoutHandler handles POST /api/auth/logout
func LogoutHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		delete(sessions, token)
		http.SetCookie(w, &http.Cookie{Name: "seh_session", Value: "", MaxAge: -1, Path: "/"})
		writeOK(w, "logged out")
	}
}

// MeHandler checks if session is valid
func MeHandler(cfg *config.Config) http.HandlerFunc {
	return authMiddleware(cfg, func(w http.ResponseWriter, r *http.Request) {
		writeOK(w, map[string]string{"status": "authenticated"})
	})
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

// HooksHandler handles /api/hooks
func HooksHandler(database *db.DB, cfg *config.Config) http.HandlerFunc {
	return authMiddleware(cfg, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			listHooks(w, database)
		case http.MethodPost:
			createHook(w, r, database)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	})
}

// HookHandler handles /api/hooks/:id
func HookHandler(database *db.DB, cfg *config.Config) http.HandlerFunc {
	return authMiddleware(cfg, func(w http.ResponseWriter, r *http.Request) {
		id, err := idFromPath(r.URL.Path, "/api/hooks/")
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid id")
			return
		}
		// Handle sub-paths: /api/hooks/:id/regen-token
		if strings.HasSuffix(r.URL.Path, "/regen-token") {
			regenToken(w, r, database, id)
			return
		}
		switch r.Method {
		case http.MethodGet:
			getHook(w, database, id)
		case http.MethodPut:
			updateHook(w, r, database, id)
		case http.MethodDelete:
			deleteHook(w, database, id)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	})
}

func listHooks(w http.ResponseWriter, database *db.DB) {
	hooks, err := database.ListHooks()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if hooks == nil {
		hooks = []db.Hook{}
	}
	writeOK(w, hooks)
}

func getHook(w http.ResponseWriter, database *db.DB, id int64) {
	h, err := database.GetHookByID(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if h == nil {
		writeError(w, http.StatusNotFound, "hook not found")
		return
	}
	writeOK(w, h)
}

type hookRequest struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	ScriptID    *int64 `json:"script_id"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
}

var slugRe = regexp.MustCompile(`^[a-z0-9-_]+$`)

func createHook(w http.ResponseWriter, r *http.Request, database *db.DB) {
	var req hookRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Slug == "" {
		req.Slug = slugify(req.Name)
	}
	if !slugRe.MatchString(req.Slug) {
		writeError(w, http.StatusBadRequest, "slug must be lowercase alphanumeric with dashes/underscores")
		return
	}
	h := &db.Hook{
		Name:        req.Name,
		Slug:        req.Slug,
		SecretToken: generateToken(),
		ScriptID:    req.ScriptID,
		Description: req.Description,
		Enabled:     true,
	}
	id, err := database.CreateHook(h)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeError(w, http.StatusConflict, "slug already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.ID = id
	writeJSON(w, http.StatusCreated, map[string]any{"data": h, "ok": true})
}

func updateHook(w http.ResponseWriter, r *http.Request, database *db.DB, id int64) {
	existing, err := database.GetHookByID(id)
	if err != nil || existing == nil {
		writeError(w, http.StatusNotFound, "hook not found")
		return
	}
	var req hookRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name != "" {
		existing.Name = req.Name
	}
	if req.Slug != "" {
		existing.Slug = req.Slug
	}
	existing.ScriptID = req.ScriptID
	existing.Description = req.Description
	existing.Enabled = req.Enabled
	if err := database.UpdateHook(existing); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeOK(w, existing)
}

func deleteHook(w http.ResponseWriter, database *db.DB, id int64) {
	if err := database.DeleteHook(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeOK(w, "deleted")
}

func regenToken(w http.ResponseWriter, r *http.Request, database *db.DB, id int64) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	token := generateToken()
	if err := database.RegenToken(id, token); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeOK(w, map[string]string{"secret_token": token})
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func generateToken() string {
	b := make([]byte, 24)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func slugify(s string) string {
	s = strings.ToLower(s)
	re := regexp.MustCompile(`[^a-z0-9]+`)
	s = re.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 50 {
		s = s[:50]
	}
	return s + "-" + fmt.Sprintf("%d", time.Now().UnixMilli()%10000)
}

func idFromPath(path, prefix string) (int64, error) {
	// Strip prefix
	rest := strings.TrimPrefix(path, prefix)
	// Extract first segment (before any /)
	seg := strings.SplitN(rest, "/", 2)[0]
	return strconv.ParseInt(seg, 10, 64)
}
