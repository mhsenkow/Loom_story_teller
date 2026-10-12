#!/usr/bin/env bash
# Preflight bundle id + marketing version alignment (LOOM-669).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PKG_VERSION="$(node -p "require('./package.json').version")"
TAURI_VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
TAURI_ID="$(node -p "require('./src-tauri/tauri.conf.json').identifier")"
IOS_ID="$(node -p "require('./src-tauri/tauri.ios.conf.json').identifier")"
CAP_APP_ID="$(grep -E '^\s*appId:' capacitor.config.ts | sed -E 's/.*"([^"]+)".*/\1/')"

fail=0
[[ "$TAURI_ID" == "$IOS_ID" ]] || { echo "Tauri iOS identifier mismatch: $TAURI_ID vs $IOS_ID" >&2; fail=1; }
[[ "$TAURI_ID" == "$CAP_APP_ID" ]] || { echo "Capacitor appId mismatch: $CAP_APP_ID (expected $TAURI_ID)" >&2; fail=1; }
[[ "$PKG_VERSION" == "$TAURI_VERSION" ]] || {
  echo "package.json version $PKG_VERSION != tauri.conf.json $TAURI_VERSION" >&2
  fail=1
}

echo "✓ iOS identity: $TAURI_ID · release $PKG_VERSION"
exit "$fail"
