# Build and run Smerp

For the workshop guide, see the [README](../README.md). Run the commands below from the repository root.

## Linux

Install Go 1.26 or newer and the native development packages:

```sh
# Debian / Ubuntu
sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev

# Fedora
sudo dnf install gcc gcc-c++ pkgconf-pkg-config gtk3-devel webkit2gtk4.1-devel

./build.sh
./bin/smerp
```

The executable needs GTK 3 and WebKitGTK 4.1 runtime libraries on its destination computer. The supplied Linux x86-64 package requires glibc 2.34 or newer.

## macOS

Install Go and Xcode Command Line Tools (`xcode-select --install`), then build:

```sh
GOTOOLCHAIN=go1.26.11 ./build.sh
open bin/Smerp.app
```

This builds for the Mac's current architecture and ad-hoc signs the app. Go 1.26 supports macOS 12; using Go 1.27 requires macOS 13. The packaged universal app supports Intel and Apple Silicon. Builds are not Apple-notarized.

## Windows

Install Go 1.26 or newer and a C/C++ compiler, such as MSYS2's UCRT64 GCC/G++ toolchain. Add its `bin` directory to `PATH`. Window mode requires the [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download).

From PowerShell:

```powershell
.\build.ps1
.\bin\smerp.exe
```

## Run options

| Option | Use |
| --- | --- |
| `-mode browser` | Open the normal browser; the server keeps running until stopped. |
| `-mode window` | Open a dedicated app window; closing it stops the server. Default on every platform. |
| `-mode server` | Serve without opening an interface. |
| `-listen 127.0.0.1:3210` | Default listen address. Set `0.0.0.0:3210` for access from other devices. |
| `-data PATH` | Choose the workshop file. Its absolute path is printed at startup. |
| `-origin https://workshop.example` | Set the browser-facing address for an HTTPS reverse proxy. Use the scheme and host, with no path or trailing slash. |

For example, serve an explicitly chosen workshop without opening a browser:

```sh
./bin/smerp -mode server -data /path/to/workshop.json
```

For automatic startup, run that command with absolute executable/data paths in your operating system's service manager. Use a writable data location and keep one process per workshop file. All dates and scheduling use the host's system clock and local time zone.

## HTTPS access

Configure an HTTPS reverse proxy to forward to Smerp and preserve the public `Host` header. Start Smerp with `-origin` set to that HTTPS address, then use that address on every device. If the proxy runs on the same computer, Smerp can continue listening on `127.0.0.1:3210`.

Smerp has no sign-in screen. Put access control in front of an internet-accessible address. Camera scanning requires HTTPS or localhost and camera permission; [browser camera requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security).

## Check changes

On Linux:

```sh
go test -race -tags webkitgtk_41 ./...
go vet -tags webkitgtk_41 ./...
./build.sh
```

For a real WebView smoke test in an X11/Xvfb session:

```sh
SMERP_WINDOW_TEST=1 GDK_BACKEND=x11 xvfb-run -a \
  go test -tags webkitgtk_41 -run TestWindowUI -count=1 -timeout 60s -v
```

On Windows/macOS, use `go test ./...` and `go vet ./...`. Set `SMERP_WINDOW_TEST=1` in a graphical session to include the native-window test. Tests use synthetic workshops and temporary data files.

Tests cover pricing, fractional quantities, isolated/shared material requirements, reservations, partial production, handover, receiving retries, stale forms, failed saves and backup recovery. The native-window test loads the actual interface and checks themes, settings, live costing and staged receiving.

### Platform checks

As of 2026-11-26:

| Platform | Checked | Still needs a native manual check |
| --- | --- | --- |
| Linux x86-64 | Build, race tests, vet, browser launch, WebKit window rendering and interaction, barcode decoding from synthetic video. | Physical camera capture and native save dialogs. |
| Windows x86-64 | Cross-build; backend tests and release executable startup under Wine. | WebView2 window, camera and save dialogs on Windows. |
| macOS Intel + Apple Silicon | Cross-build, universal app, ad-hoc signature code/resource hashes and macOS 12 headers. | Launch, window, camera and save dialogs on macOS. |

The three desktop download archives and `SHA256SUMS` are tracked under `bin/`. Rebuild and replace them when publishing updated binaries. Each package contains run instructions and [third-party notices](../licenses/README.md).
