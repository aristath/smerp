package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

var mode = flag.String("mode", "window", "window, browser, or server (without opening a UI)")

func main() {
	if err := run(); err != nil {
		log.Print(err)
		if *mode == "window" {
			showStartupError(err.Error())
		}
		os.Exit(1)
	}
}
func run() error {
	config, configErr := os.UserConfigDir()
	address := flag.String("listen", "127.0.0.1:3210", "HTTP listen address; use 0.0.0.0:3210 for other devices")
	path := flag.String("data", filepath.Join(config, "smerp", "workshop.json"), "workshop JSON file")
	origin := flag.String("origin", "", "optional browser-facing URL for a reverse proxy")
	flag.Parse()
	if configErr != nil {
		return configErr
	}
	if *mode != "browser" && *mode != "window" && *mode != "server" {
		return errors.New("Mode must be browser, window, or server.")
	}
	if *origin != "" {
		u, err := url.Parse(*origin)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			return errors.New("Origin must be an HTTP(S) address without a path, query, or trailing slash.")
		}
	}
	absolute, err := filepath.Abs(*path)
	if err != nil {
		return err
	}
	store, err := openStore(absolute)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", *address)
	if err != nil {
		return fmt.Errorf("Could not start Smerp at %s: %w.\n\nCheck whether another copy of Smerp is running. Close it before trying again.", *address, err)
	}
	server := &http.Server{Handler: (&App{store: store, origin: *origin}).handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	host, port, _ := net.SplitHostPort(listener.Addr().String())
	ip := net.ParseIP(host)
	if ip == nil || ip.IsUnspecified() {
		host = "127.0.0.1"
	}
	location := "http://" + net.JoinHostPort(host, port)
	if *origin != "" {
		location = *origin
	}
	fmt.Printf("Smerp is ready at %s\nData: %s\n", location, absolute)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	switch *mode {
	case "window":
		return runWindow(ctx, location)
	case "browser":
		if err := openBrowser(location); err != nil {
			log.Printf("Open %s in your browser: %v", location, err)
		}
	}
	select {
	case <-ctx.Done():
		return nil
	case err := <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
func openBrowser(location string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", location)
	case "darwin":
		cmd = exec.Command("open", location)
	default:
		cmd = exec.Command("xdg-open", location)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
