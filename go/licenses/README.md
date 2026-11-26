# Third-party components

The Go module uses shopspring/decimal and samcharles93/webview_go (MIT). The embedded frontend retains Alpine CSP and Vue reactivity/shared (MIT), and the ZXing WASM wrapper (MIT). The scanner also incorporates ZXing-C++ (Apache-2.0). License texts are included here; the built JavaScript retains its upstream license comments.

The WebView binding uses the operating system's WebKit/GTK or WebView2 runtime; those runtimes are not bundled by this project. See the binding's vendored dependency notices for its native build headers.
