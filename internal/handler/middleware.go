package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/script-execution-hooks/internal/config"
)

// Session stores active session tokens (in-memory, thread-safe)
var (
	sessionsMu sync.RWMutex
	sessions   = make(map[string]time.Time)
)

// SetSession records or updates an active session token thread-safely
func SetSession(token string, expiry time.Time) {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	sessions[token] = expiry
}

// DeleteSession removes a session token thread-safely
func DeleteSession(token string) {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	delete(sessions, token)
}

// ValidateAndRefreshSession checks if a token is valid and extends its lifetime
func ValidateAndRefreshSession(token string) bool {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	expiry, ok := sessions[token]
	if !ok || time.Now().After(expiry) {
		delete(sessions, token)
		return false
	}
	sessions[token] = time.Now().Add(24 * time.Hour)
	return true
}

// authMiddleware protects API routes
func authMiddleware(cfg *config.Config, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized: missing token")
			return
		}
		if !ValidateAndRefreshSession(token) {
			writeError(w, http.StatusUnauthorized, "unauthorized: invalid or expired session")
			return
		}
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
