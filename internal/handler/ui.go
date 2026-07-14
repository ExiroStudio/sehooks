package handler

import (
	"embed"
	"io/fs"
	"net/http"
)

// UIHandler serves the embedded web frontend (SPA).
// Static files (style.css, app.js) are served directly.
// Any other path falls back to index.html for client-side routing.
func UIHandler(assets embed.FS) http.Handler {
	sub, err := fs.Sub(assets, "web")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try to open the requested path in the embedded FS.
		// If it doesn't exist (or is root), serve index.html instead.
		path := r.URL.Path
		if path == "/" || path == "" {
			r.URL.Path = "/"
			fileServer.ServeHTTP(w, r)
			return
		}
		// Strip leading slash for fs.Open
		f, err := sub.Open(path[1:])
		if err != nil {
			// File not found — SPA fallback to index.html
			r.URL.Path = "/"
		} else {
			f.Close()
		}
		fileServer.ServeHTTP(w, r)
	})
}
