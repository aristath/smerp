# Smerp

The existing Smerp interface, with a Go backend and one JSON data file. Supports browser access and a system-WebView application window on Windows, macOS, and Linux. No Node runtime, database, account service, or internet connection is needed for local use. Android is outside this version's scope.

## Build

Requires Go 1.26 or newer and the native WebView development tools below. Run commands from the repository root. The Go module has two direct dependencies: [decimal arithmetic](https://github.com/shopspring/decimal) and the [system-WebView binding](https://github.com/samcharles93/webview_go). HTTP, templates, JSON, persistence, and configuration use the standard library. HTML, CSS, JavaScript, icons, and scanner WASM are embedded in the executable.

### Linux

Install a C/C++ compiler, `pkg-config`, GTK 3 and WebKitGTK 4.1 development packages:

```sh
# Debian / Ubuntu
sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev
# Fedora
sudo dnf install gcc gcc-c++ pkgconf-pkg-config gtk3-devel webkit2gtk4.1-devel

./build.sh
./bin/smerp -mode browser
```

This build deliberately uses the GTK 3 / WebKitGTK 4.1 backend. Its runtime libraries must also be installed on machines receiving the executable (`libgtk-3-0` / `libwebkit2gtk-4.1-0` on Debian-family systems, `gtk3` / `webkit2gtk4.1` on Fedora).

### macOS

Use macOS 12 or newer, Go, and Xcode Command Line Tools (`xcode-select --install`). Build natively on the target Mac:

```sh
GOTOOLCHAIN=go1.26.11 ./build.sh
open bin/Smerp.app
```

The app bundle opens the dedicated window. Its `Info.plist` supplies the required camera and local-network permission descriptions; it is ad-hoc signed for local use. System WebKit supplies the renderer. To start browser or server mode from Terminal:

```sh
bin/Smerp.app/Contents/MacOS/smerp -mode browser
bin/Smerp.app/Contents/MacOS/smerp -mode server -listen 0.0.0.0:3210
```

Builds use the Mac's current architecture. Go 1.26 retains macOS 12 support; Go 1.27 requires macOS 13. Publishing signed/notarized installers is not part of these local build instructions.

### Windows

Install Go and a C/C++ toolchain, such as MSYS2's UCRT64 GCC/G++ toolchain. Put the toolchain's `bin` directory on `PATH` so Go can find `gcc` and `g++`. Microsoft Edge WebView2 Runtime must be installed. The Go binding includes the necessary WebView2 build headers.

From PowerShell:

```powershell
.\build.ps1
.\bin\smerp.exe -mode browser
.\bin\smerp.exe -mode window
```

The binary supports both modes; it also supports `-mode server`. Build natively on Windows. Camera access additionally depends on Windows privacy settings.

### Built downloads

The desktop archives are in `bin/`: `Smerp-windows-amd64.zip`, `Smerp-macos-universal.zip` (Intel and Apple Silicon), and `Smerp-linux-amd64.tar.gz`. Each contains the executable, run instructions and licenses; `bin/SHA256SUMS` records their checksums. The Mac app is ad-hoc signed, without Apple notarization. See [VERIFICATION.md](VERIFICATION.md) for build tools and actual platform coverage.

The previous Node.js application is preserved in [legacy-node.js/](legacy-node.js/README.md), with its own build/run instructions, configuration and dependencies.

## Run

```sh
smerp -mode browser       # serve the app and open your normal browser
smerp -mode window        # serve the same app in a dedicated system-WebView window
smerp -mode server        # serve without opening an interface
```

Use the executable path produced by the platform build above. The default address is `http://127.0.0.1:3210`. Only one process should own a data file; use its browser/window interface and other devices to access that same process. Closing the browser leaves its server running; Ctrl+C stops it. Closing the dedicated window stops its server, so other devices lose access too.

Flags:

| Flag | Meaning |
| --- | --- |
| `-mode browser\|window\|server` | How to display/start the application; default `browser`, or `window` when launched inside the macOS app bundle. |
| `-listen 127.0.0.1:3210` | Address to listen on. Use `0.0.0.0:3210` to allow other devices. |
| `-data PATH` | JSON data file. The absolute path is printed at startup. |
| `-origin https://workshop.example` | Optional canonical URL when using a reverse proxy; no trailing slash. Leave unset for normal local/LAN use. |

The default data file is `smerp/workshop.json` under the OS user configuration directory: `%AppData%` on Windows, `~/Library/Application Support` on macOS, and `$XDG_CONFIG_HOME` or `~/.config` on Linux. Nothing is loaded from the old Node app. An empty installation is ready for setup; its file is created on the first successful change. All dates and estimates use the backend host's system time and local time zone.

### Other devices

Start with `-listen 0.0.0.0:3210`, allow that port through the host firewall on your trusted network, and open `http://HOST-LAN-IP:3210` on the other device. The host must stay on and the application must keep running. The other device is a browser client, not an independent installation.

Camera scanning needs HTTPS or localhost, plus camera permission. Local-network HTTP supports manual barcode entry and ordinary forms. For camera scanning from another device, provide HTTPS using a reverse proxy and set `-origin` to that canonical HTTPS address. All clients then use that address. The proxy must preserve the public Host header. Public internet access needs access control supplied by the deployment; the app does not include accounts. It does not automatically install a tunnel, publish a port, or change your firewall.

## Data, backups, and stock

Changes are validated and written atomically before becoming visible. Invalid actions and failed writes leave saved data intact. Old forms cannot overwrite newer changes. An invalid working file opens a recovery screen, which offers its original contents for download and can restore a valid backup.

Use **Settings → Backup and restore** to download a complete JSON backup. Store a copy outside the host. Restore validates and previews the file before an explicit full replacement. Window mode uses the native download/save facility. Go backups use their own `smerp-go` format. There are no old-format readers or migration tools.

Individual order views show isolated material sufficiency. The Total materials view shares stock across all open orders. Confirmed orders still protect their reserved materials from another order's production.

Finished stock received after confirmation can fulfil an order through its existing **Complete and hand over** action. This uses stock for the order being handed over; it does not automatically distribute new stock between orders, consume its materials again, or create another production batch.

## Checks

On Linux:

```sh
go test -tags webkitgtk_41 ./...
go test -race -tags webkitgtk_41 ./...
go vet -tags webkitgtk_41 ./...
SMERP_WINDOW_TEST=1 GDK_BACKEND=x11 xvfb-run -a go test -tags webkitgtk_41 -run TestWindowUI -count=1 -timeout 60s -v
```

On Windows/macOS, use `go test ./...` and `go vet ./...`; the native UI test is opt-in with `SMERP_WINDOW_TEST=1` and requires an interactive graphical session. Regular tests use synthetic workshop data in temporary directories. `TestWindowUI` renders the actual interface in the system WebView and exercises both themes, settings, live costing, and staged receiving. See [VERIFICATION.md](VERIFICATION.md) for the checks actually performed and platform limitations.
