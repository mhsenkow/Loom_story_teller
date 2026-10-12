#!/usr/bin/env bash
# =================================================================
# Loom — iOS App Store / TestFlight helper
# =================================================================
# Prerequisites (one-time, in Xcode):
#   1. Xcode → Settings → Accounts → add/re-auth Apple ID (team WC44W2QVE4)
#   2. developer.apple.com → Identifiers → App ID `com.loom.storyteller` (iOS)
#   3. App Store Connect → My Apps → New App → Bundle ID matches
#   4. Xcode → loom_iOS target → Signing → Team + Automatically manage signing
#
# Then from repo root:
#   ./scripts/ios-submit.sh          # archive + export App Store IPA
#   ./scripts/ios-submit.sh open     # open Xcode for Archive UI
#   ./scripts/ios-submit.sh upload   # upload IPA via altool (needs API key)
# =================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CMD="${1:-build}"
IPA_GLOB="src-tauri/gen/apple/build/**/*.ipa"

case "$CMD" in
  open)
    npm run tauri ios build -- --open
    echo "In Xcode: select Any iOS Device → Product → Archive → Distribute App → App Store Connect"
    ;;
  build)
    test -d src-tauri/gen/apple || npm run tauri ios init -- --ci
    npm run tauri ios build -- --export-method app-store-connect
    echo "IPA:"
    find src-tauri/gen/apple/build -name '*.ipa' 2>/dev/null || true
    ;;
  upload)
    IPA="$(find src-tauri/gen/apple/build -name '*.ipa' 2>/dev/null | head -1 || true)"
    if [[ -z "${IPA}" ]]; then
      echo "No IPA found. Run: ./scripts/ios-submit.sh build" >&2
      exit 1
    fi
    if [[ -z "${APPLE_API_KEY_ID:-}" || -z "${APPLE_API_ISSUER:-}" ]]; then
      echo "Set APPLE_API_KEY_ID and APPLE_API_ISSUER, and place AuthKey_\${APPLE_API_KEY_ID}.p8 in ~/.appstoreconnect/private_keys/" >&2
      echo "Or drag ${IPA} into Transporter / use Xcode Organizer → Distribute." >&2
      open -R "$IPA" 2>/dev/null || true
      exit 1
    fi
    xcrun altool --upload-app --type ios --file "$IPA" \
      --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"
    ;;
  *)
    echo "Usage: $0 [build|open|upload]" >&2
    exit 1
    ;;
esac
