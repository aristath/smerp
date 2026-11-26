//go:build windows

package main

/*
#cgo LDFLAGS: -luser32
#include <windows.h>
static void smerp_show_error(const wchar_t *message) {
 MessageBoxW(NULL,message,L"Smerp could not start",MB_OK|MB_ICONERROR|MB_SETFOREGROUND);
}
*/
import "C"
import (
	"syscall"
	"unsafe"

	webview "github.com/samcharles93/webview_go"
)

// WebView2 provides its own permission prompts and download UI.
func configureWindow(w webview.WebView, location string) {}

func showStartupError(message string) {
	text, err := syscall.UTF16PtrFromString(message)
	if err == nil {
		C.smerp_show_error((*C.wchar_t)(unsafe.Pointer(text)))
	}
}
