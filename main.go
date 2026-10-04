package main

import (
	"embed"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/script-execution-hooks/internal/config"
	"github.com/script-execution-hooks/internal/db"
	"github.com/script-execution-hooks/internal/handler"
)

//go:embed web
var webAssets embed.FS

func main() {
	cfg := config.Load()

	// Init database
	database, err := db.New(cfg.DatabasePath, cfg.SecretKey)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer database.Close()

	mux := http.NewServeMux()

	// ── Auth
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(cfg))
	mux.HandleFunc("/api/auth/logout", handler.LogoutHandler())
	mux.HandleFunc("/api/auth/me", handler.MeHandler(cfg))

	// ── Environments API
	mux.HandleFunc("/api/environments", handler.EnvironmentsHandler(database, cfg))
	mux.HandleFunc("/api/environments/", handler.EnvironmentHandler(database, cfg))

	// ── Hooks API
	mux.HandleFunc("/api/hooks", handler.HooksHandler(database, cfg))
	mux.HandleFunc("/api/hooks/", handler.HookHandler(database, cfg))

	// ── Scripts API
	mux.HandleFunc("/api/scripts", handler.ScriptsHandler(database, cfg))
	mux.HandleFunc("/api/scripts/", handler.ScriptHandler(database, cfg))

	// ── Logs & Config API
	mux.HandleFunc("/api/logs", handler.LogsHandler(database, cfg))
	mux.HandleFunc("/api/logs/", handler.LogHandler(database, cfg))
	mux.HandleFunc("/api/config", handler.ConfigHandler(database, cfg))

	// ── Webhook trigger (public)
	mux.HandleFunc("/webhook/", handler.WebhookHandler(database))

	// ── Static UI (SPA, must be last)
	mux.Handle("/", handler.UIHandler(webAssets))

	// Wrap with logger + CORS
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	log.Printf("🚀 Script Execution Hooks running at http://%s", addr)
	log.Printf("   DB: %s | Admin password: %s", cfg.DatabasePath, maskPassword(cfg.AdminPassword))
	log.Printf("   Env: SEH_ADMIN_PASSWORD, SEH_PORT, SEH_HOST, SEH_DB_PATH")

	srv := &http.Server{
		Addr:         addr,
		Handler:      logMiddleware(mux),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

func logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		// Allow credentials from UI origin
		w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
		if !strings.HasPrefix(r.URL.Path, "/api/auth") {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
		}
	})
}

func maskPassword(p string) string {
	if len(p) <= 2 {
		return "***"
	}
	return p[:2] + strings.Repeat("*", len(p)-2)
}
