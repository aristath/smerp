#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p bin
case "$(go env GOOS)" in
  linux) go build -tags webkitgtk_41 -trimpath -ldflags='-s -w' -o bin/smerp . ;;
  darwin)
    app=bin/Smerp.app/Contents
    mkdir -p "$app/MacOS"
    go build -trimpath -ldflags='-s -w' -o "$app/MacOS/smerp" .
    cp packaging/Info.plist "$app/Info.plist"
    codesign --force --deep --sign - bin/Smerp.app
    ;;
  windows) go build -trimpath -ldflags='-s -w' -o bin/smerp.exe . ;;
  *) echo 'Supported targets: Windows, macOS, Linux' >&2; exit 1 ;;
esac
