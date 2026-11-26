//go:build windows

package main

import webview "github.com/samcharles93/webview_go"

// WebView2 provides its own permission prompts and download UI.
func configureWindow(w webview.WebView, location string) {}
