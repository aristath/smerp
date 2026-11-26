#!/bin/sh
set -eu
cd "$(dirname "$0")"
: "${ANDROID_HOME:?Set ANDROID_HOME to your Android SDK directory.}"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"
if [ ! -d "$ANDROID_NDK_HOME" ]; then
 echo 'Install Android NDK 28.2.13676358 first (see docs/building.md).' >&2
 exit 1
fi
mkdir -p .local/bin app/libs
# Keep this private key to sign updates that preserve installed workshop data.
if [ ! -f .local/release.jks ]; then
 umask 077
 if [ ! -f .local/signing-password ]; then
  python3 -c 'import secrets; print(secrets.token_hex(32))' > .local/signing-password
 fi
 SMERP_SIGNING_PASSWORD=$(cat .local/signing-password)
 export SMERP_SIGNING_PASSWORD
 keytool -genkeypair -keystore .local/release.jks -alias smerp -keyalg RSA -keysize 3072 \
  -validity 10000 -dname 'CN=Smerp' -storepass:env SMERP_SIGNING_PASSWORD -keypass:env SMERP_SIGNING_PASSWORD
 unset SMERP_SIGNING_PASSWORD
fi
SMERP_ANDROID_ROOT=$PWD
export PATH="$SMERP_ANDROID_ROOT/.local/bin:$PATH"
(
 cd mobile
 go build -o ../.local/bin/gobind golang.org/x/mobile/cmd/gobind
 go tool gomobile bind -target=android/arm64,android/amd64 -androidapi 26 \
  -trimpath -ldflags='-s -w' -o ../app/libs/workshop.aar .
)
./gradlew :app:assembleRelease --console=plain
cp app/build/outputs/apk/release/app-release.apk ../bin/Smerp-android.apk
