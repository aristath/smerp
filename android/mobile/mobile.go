// Package mobile starts the workshop inside the Android app process.
package mobile

import (
	"context"
	"crypto/rand"
	"errors"
	"net"
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"smerp/internal/workshop"
)

var phoneTime sync.Once

var running struct {
	sync.Mutex
	server   *http.Server
	location string
}

// Start returns the private launch URL. Reopening the activity reuses the server.
func Start(directory, zone string, offsetSeconds int) (string, error) {
	running.Lock()
	defer running.Unlock()
	if running.server != nil {
		return running.location, nil
	}
	// Android's Go runtime otherwise defaults to UTC. Set this once, before serving.
	phoneTime.Do(func() {
		location, err := time.LoadLocation(zone)
		if err != nil {
			location = time.FixedZone(zone, offsetSeconds)
		}
		time.Local = location
	})
	handler, err := workshop.Open(filepath.Join(directory, "workshop.json"), "")
	if err != nil {
		return "", err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	token := rand.Text()
	origin := "http://" + listener.Addr().String()
	server := &http.Server{
		Handler:           privateSession(handler, token),
		ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second,
	}
	running.server = server
	running.location = origin + "/?session=" + token
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			panic(err)
		}
	}()
	return running.location, nil
}

// Stop closes the local listener; Android normally ends it with the app process.
func Stop() error {
	running.Lock()
	defer running.Unlock()
	if running.server == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := running.server.Shutdown(ctx)
	running.server = nil
	running.location = ""
	return err
}

// A per-process cookie keeps other apps on the phone out of the local listener.
func privateSession(next http.Handler, token string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" && r.URL.Path == "/" && r.URL.Query().Get("session") == token {
			http.SetCookie(w, &http.Cookie{Name: "smerp", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Referrer-Policy", "no-referrer")
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}
		cookie, err := r.Cookie("smerp")
		if err != nil || cookie.Value != token {
			http.Error(w, "Open Smerp from its app icon.", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
