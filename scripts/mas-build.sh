#!/usr/bin/env bash
# =================================================================
# Build + sign a Mac App Store .pkg (sandbox + user-selected folders)
# =================================================================
# Requires: Apple Distribution + 3rd Party Mac Developer Installer certs,
#           src-tauri/macos/Loom_Mac_App_Store.provisionprofile
# Upload: xcrun altool --upload-app --type macos --file Loom.pkg \
#           --apiKey $APPLE_API_KEY_ID --apiIssuer $APPLE_API_ISSUER
# =================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_NAME="Loom"
DIST_ID="${APPLE_DISTRIBUTION_IDENTITY:-Apple Distribution: Michael Senkow (WC44W2QVE4)}"
INSTALLER_ID="${APPLE_INSTALLER_IDENTITY:-3rd Party Mac Developer Installer: Michael Senkow (WC44W2QVE4)}"
PROFILE="$ROOT/src-tauri/macos/Loom_Mac_App_Store.provisionprofile"
OUT_DIR="$ROOT/src-tauri/target/mas"
PKG="$OUT_DIR/${APP_NAME}.pkg"

if [[ ! -f "$PROFILE" ]]; then
  echo "Missing $PROFILE — create a Mac App Store Connect profile for com.loom.storyteller" >&2
  exit 1
fi

export APPLE_SIGNING_IDENTITY="$DIST_ID"

echo "→ Building release binary (no bundle)…"
npm run tauri build -- --no-bundle

echo "→ Bundling sandboxed .app (App Store config)…"
npm run tauri bundle -- --bundles app --config src-tauri/tauri.appstore.conf.json

APP="$ROOT/src-tauri/target/release/bundle/macos/${APP_NAME}.app"
if [[ ! -d "$APP" ]]; then
  echo "Expected app at $APP" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
rm -f "$PKG"

echo "→ productbuild → $PKG"
xcrun productbuild \
  --sign "$INSTALLER_ID" \
  --component "$APP" /Applications \
  "$PKG"

echo "✓ MAS package: $PKG"
echo "  Upload: xcrun altool --upload-app --type macos --file \"$PKG\" --apiKey \$APPLE_API_KEY_ID --apiIssuer \$APPLE_API_ISSUER"
