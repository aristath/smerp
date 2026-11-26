package main

/*
#cgo CFLAGS: -mmacosx-version-min=12.0
#cgo LDFLAGS: -framework Cocoa -framework WebKit
void smerp_setup_webview(void *view);
*/
import "C"
import webview "github.com/samcharles93/webview_go"

func configureWindow(w webview.WebView, location string) {
	C.smerp_setup_webview(w.NativeHandle(webview.NativeHandleKindBrowserController))
}
