//go:build linux && webkitgtk_41

package main

/*
#cgo pkg-config: gtk+-3.0 webkit2gtk-4.1
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <stdlib.h>

static gboolean camera_request(WebKitWebView *view, WebKitPermissionRequest *request, gpointer origin) {
 if (!WEBKIT_IS_USER_MEDIA_PERMISSION_REQUEST(request)) return FALSE;
 const char *uri=webkit_web_view_get_uri(view), *allowed=(const char *)origin;
 size_t size=strlen(allowed);
 if (!uri || strncmp(uri,allowed,size)!=0 || (uri[size]!='/' && uri[size]!='\0')) {
  webkit_permission_request_deny(request); return TRUE;
 }
 WebKitUserMediaPermissionRequest *media=WEBKIT_USER_MEDIA_PERMISSION_REQUEST(request);
 if (!webkit_user_media_permission_is_for_video_device(media) || webkit_user_media_permission_is_for_audio_device(media) || webkit_user_media_permission_is_for_display_device(media)) {
  webkit_permission_request_deny(request); return TRUE;
 }
 GtkWidget *dialog=gtk_message_dialog_new(GTK_WINDOW(gtk_widget_get_toplevel(GTK_WIDGET(view))),GTK_DIALOG_MODAL,GTK_MESSAGE_QUESTION,GTK_BUTTONS_YES_NO,"Allow Smerp to use the camera for barcode scanning?");
 if (gtk_dialog_run(GTK_DIALOG(dialog))==GTK_RESPONSE_YES) webkit_permission_request_allow(request);
 else webkit_permission_request_deny(request);
 gtk_widget_destroy(dialog);return TRUE;
}
static gboolean save_download(WebKitDownload *download,const char *name,gpointer parent) {
 GtkWidget *dialog=gtk_file_chooser_dialog_new("Save backup",GTK_WINDOW(parent),GTK_FILE_CHOOSER_ACTION_SAVE,"Cancel",GTK_RESPONSE_CANCEL,"Save",GTK_RESPONSE_ACCEPT,NULL);
 gtk_file_chooser_set_do_overwrite_confirmation(GTK_FILE_CHOOSER(dialog),TRUE);
 gtk_file_chooser_set_current_name(GTK_FILE_CHOOSER(dialog),name);
 if (gtk_dialog_run(GTK_DIALOG(dialog))==GTK_RESPONSE_ACCEPT) {
  char *path=gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
  char *uri=g_filename_to_uri(path,NULL,NULL);
  webkit_download_set_allow_overwrite(download,TRUE);
  webkit_download_set_destination(download,uri);g_free(uri);g_free(path);
 } else webkit_download_cancel(download);
 gtk_widget_destroy(dialog);return TRUE;
}
static void download_started(WebKitWebContext *context,WebKitDownload *download,gpointer parent) {
 g_signal_connect_object(download,"decide-destination",G_CALLBACK(save_download),parent,0);
}
static void configure_camera(void *handle,const char *origin) {
 char *allowed=g_strdup(origin);
 g_object_set_data_full(G_OBJECT(handle),"smerp-camera-origin",allowed,g_free);
 g_signal_connect(handle,"permission-request",G_CALLBACK(camera_request),allowed);
 GtkWidget *window=gtk_widget_get_toplevel(GTK_WIDGET(handle));
 g_signal_connect_object(webkit_web_view_get_context(WEBKIT_WEB_VIEW(handle)),"download-started",G_CALLBACK(download_started),window,0);
}
*/
import "C"
import (
	webview "github.com/samcharles93/webview_go"
	"unsafe"
)

func configureWindow(w webview.WebView, location string) {
	origin := C.CString(location)
	defer C.free(unsafe.Pointer(origin))
	C.configure_camera(w.NativeHandle(webview.NativeHandleKindBrowserController), origin)
}
