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

## Android

Install Go 1.26 or newer, Python 3, and JDK 25. Set `ANDROID_HOME` to your Android SDK directory. Install the SDK command-line tools, then these packages:

```sh
sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;28.2.13676358" "platform-tools"
export ANDROID_HOME=/path/to/Android/Sdk
./android/build.sh
```

The script builds the Go library and a signed APK for ARM64 and x86-64, Android 8+. The result is `bin/Smerp-android.apk`. The Gradle wrapper downloads its pinned Gradle version on the first build. Gradle supplies the Kotlin compiler.

The first build generates a private signing key and password under `android/.local/`. Back up that directory securely; later updates need the same key to preserve installed workshop data. It is excluded from Git. Never distribute the key with the APK. Increase `versionCode` in `android/app/build.gradle.kts` when releasing an update.

Install on an explicitly selected emulator or device:

```sh
adb devices -l
adb -s DEVICE_SERIAL install -r bin/Smerp-android.apk
adb -s DEVICE_SERIAL shell am start -n studio.ergon.smerp/.MainActivity
```

The Go server runs inside the Android app process and listens only on loopback with a private per-process cookie. The workshop is `files/workshop.json` in app-private storage. Activity recreation reuses the server; Android process termination stops it. The HTML interface, barcode decoder and styles are embedded. Camera permission, backup export and restore file selection use Android's native APIs.

Android checks:

```sh
(cd android/mobile && go test -race ./... && go vet ./...)
(cd android && ./gradlew :app:assembleDebug :app:lint)
```

With an emulator or test phone, verify first launch with networking disabled, both themes after force-stop/relaunch, edits and stock surviving restart, camera grant/denial, staged receiving, JSON export and restore through the file picker, Android Back, rotation, background/resume, and keyboard visibility. Debug builds allow WebView inspection; release builds disable it. Use a synthetic workshop for destructive restore tests.

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
| Android ARM64 + x86-64 | Signed APK, lint, Go race tests, offline x86-64 emulator, native file picker restore/export, camera permission and video capture, bundled QR decoder, persistent themes, Back, keyboard insets, rotation and saved delivery after restart. | Physical phone camera focus, real printed barcodes and ARM64 execution. |
| macOS Intel + Apple Silicon | Cross-build, universal app, ad-hoc signature code/resource hashes and macOS 12 headers. | Launch, window, camera and save dialogs on macOS. |

The three desktop download archives, Android APK and `SHA256SUMS` are tracked under `bin/`. Rebuild and replace them when publishing updated binaries. Each package contains run instructions and [third-party notices](../licenses/README.md).
