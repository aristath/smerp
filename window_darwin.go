package main

/*
#cgo CFLAGS: -mmacosx-version-min=12.0
#cgo LDFLAGS: -framework Cocoa -framework WebKit
#include <stdlib.h>
void smerp_setup_webview(void *view);
void smerp_show_error(const char *message);
*/
import "C"
import (
	"unsafe"

	webview "github.com/samcharles93/webview_go"
)

func configureWindow(w webview.WebView, location string) {
	C.smerp_setup_webview(w.NativeHandle(webview.NativeHandleKindBrowserController))
}

func showStartupError(message string) {
	text := C.CString(message)
	defer C.free(unsafe.Pointer(text))
	C.smerp_show_error(text)
}
