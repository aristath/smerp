package main

import (
	"context"

	webview "github.com/samcharles93/webview_go"
)

func newWindow(location string) (webview.WebView, error) {
	return webview.NewWithOptions(webview.Options{Title: "Smerp", Width: 1280, Height: 900, Hint: webview.HintNone, URL: location})
}
func runWindow(ctx context.Context, location string) error {
	w, err := newWindow(location)
	if err != nil {
		return err
	}
	defer w.Destroy()
	finished := make(chan struct{})
	defer close(finished)
	go func() {
		select {
		case <-ctx.Done():
			_ = w.Terminate()
		case <-finished:
		}
	}()
	return w.Run()
}
