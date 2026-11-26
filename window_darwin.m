#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

@interface SmerpDownloadDelegate : NSObject <WKNavigationDelegate, WKDownloadDelegate>
@end
@implementation SmerpDownloadDelegate
- (void)webView:(WKWebView *)view decidePolicyForNavigationResponse:(WKNavigationResponse *)response decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler {
 NSString *disposition=@"";
 if ([response.response isKindOfClass:[NSHTTPURLResponse class]]) disposition=[(NSHTTPURLResponse *)response.response valueForHTTPHeaderField:@"Content-Disposition"];
 decisionHandler([disposition.lowercaseString hasPrefix:@"attachment"] ? WKNavigationResponsePolicyDownload : WKNavigationResponsePolicyAllow);
}
- (void)webView:(WKWebView *)view navigationResponse:(WKNavigationResponse *)response didBecomeDownload:(WKDownload *)download {
 download.delegate=self;
}
- (void)download:(WKDownload *)download decideDestinationUsingResponse:(NSURLResponse *)response suggestedFilename:(NSString *)filename completionHandler:(void (^)(NSURL *))completionHandler {
 NSSavePanel *panel=[NSSavePanel savePanel];
 panel.nameFieldStringValue=filename;
 completionHandler([panel runModal]==NSModalResponseOK ? panel.URL : nil);
}
- (void)download:(WKDownload *)download didFailWithError:(NSError *)error resumeData:(NSData *)resumeData {
 if (error.code!=NSURLErrorCancelled) [[NSAlert alertWithError:error] runModal];
}
@end
static void confirm_dialog(id delegate, SEL selector, WKWebView *view, NSString *message, WKFrameInfo *frame, void (^decisionHandler)(BOOL)) {
 NSAlert *alert=[[[NSAlert alloc] init] autorelease];
 alert.messageText=message;
 [alert addButtonWithTitle:@"OK"];
 [alert addButtonWithTitle:@"Cancel"];
 decisionHandler([alert runModal]==NSAlertFirstButtonReturn);
}
void smerp_setup_webview(void *handle) {
 WKWebView *view=(WKWebView *)handle;
 // Retain the binding's existing file chooser delegate and add its missing JS confirmation prompt.
 class_addMethod(object_getClass(view.UIDelegate),@selector(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:),(IMP)confirm_dialog,"v@:@@@@");
 SmerpDownloadDelegate *delegate=[[SmerpDownloadDelegate alloc] init];
 view.navigationDelegate=delegate;
 objc_setAssociatedObject(view,@"smerp-download-delegate",delegate,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
 [delegate release];
}
