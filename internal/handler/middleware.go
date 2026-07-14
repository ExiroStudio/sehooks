package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/script-execution-hooks/internal/config"
)

// Session stores active session tokens (in-memory, simple)
var sessions = make(map[string]time.Time)

// authMiddleware protects API routes
func authMiddleware(cfg *config.Config, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized: missing token")
			return
		}
		expiry, ok := sessions[token]
		if !ok || time.Now().After(expiry) {
			delete(sessions, token)
			writeError(w, http.StatusUnauthorized, "unauthorized: invalid or expired session")
			return
		}
		// Refresh session
		sessions[token] = time.Now().Add(24 * time.Hour)
		next(w, r)
	}
}

func extractToken(r *http.Request) string {
	// Try Authorization: Bearer <token>
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	// Try cookie
	if c, err := r.Cookie("seh_session"); err == nil {
		return c.Value
	}
	return ""
}

// writeJSON writes a JSON response
func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// writeError writes a JSON error response
func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// writeOK writes a success JSON response
func writeOK(w http.ResponseWriter, v any) {
	writeJSON(w, http.StatusOK, map[string]any{"data": v, "ok": true})
}

// decodeJSON decodes request body into v
func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}
