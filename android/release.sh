#!/usr/bin/env bash
# Builds the signed APK for the household's phones on this machine.
#   ./release.sh init   makes the signing key, once
#   ./release.sh        builds the next version into app/build/outputs/apk/release/
# The key and its password live in ~/.local/share/fagerteam-coach (readable only by you). Back that folder
# up: every update must be signed with the same key, or the phones won't install it over the old app.
set -euo pipefail
cd "$(dirname "$0")"
KEYS="${FAGER_KEYS:-$HOME/.local/share/fagerteam-coach}"
KEYSTORE="$KEYS/release.jks"
PASSFILE="$KEYS/password"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"

if [ "${1:-}" = init ]; then
  if [ -e "$KEYSTORE" ]; then echo "$KEYSTORE already exists; keeping it." >&2; exit 1; fi
  mkdir -p "$KEYS" && chmod 700 "$KEYS"
  (umask 077 && head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$PASSFILE")
  KEY_PW="$(cat "$PASSFILE")" "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$KEYSTORE" -alias coach \
    -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Fagerteam Coach" \
    -storepass:env KEY_PW -keypass:env KEY_PW
  chmod 600 "$KEYSTORE"
  echo "Made $KEYSTORE. Back up $KEYS somewhere safe."
  exit 0
fi

if [ ! -e "$KEYSTORE" ] || [ ! -e "$PASSFILE" ]; then echo "No signing key in $KEYS; run ./release.sh init first." >&2; exit 1; fi
# A release is built from committed code only, so each version on the phones matches a commit.
if [ -n "$(git status --porcelain -- .)" ]; then echo "android/ has uncommitted changes; commit them first." >&2; exit 1; fi
code=$(( $(sed -n 's/^versionCode=//p' version.properties) + 1 ))
pw="$(cat "$PASSFILE")"
SIGNING_KEYSTORE="$KEYSTORE" SIGNING_STORE_PASSWORD="$pw" SIGNING_KEY_ALIAS=coach SIGNING_KEY_PASSWORD="$pw" \
  VERSION_CODE="$code" ./gradlew --quiet lintRelease assembleRelease
# Saved only after a good build; commit it so the next build counts up from here.
printf 'versionCode=%s\n' "$code" > version.properties
echo "Built version 0.1.$code: $(pwd)/app/build/outputs/apk/release/app-release.apk"
echo "Commit android/version.properties."
