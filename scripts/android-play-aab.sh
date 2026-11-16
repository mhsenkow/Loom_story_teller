#!/usr/bin/env bash
# =================================================================
# Loom — Build a Play Store Android App Bundle (Capacitor)
# =================================================================
# Usage:
#   ./scripts/android-play-aab.sh          # sync web + release AAB
#   ./scripts/android-play-aab.sh sync     # npm build + cap sync only
#   ./scripts/android-play-aab.sh open     # open Android Studio
#
# Requires: ANDROID_HOME (defaults to ~/Library/Android/sdk),
#           android/keystore.properties (from .secrets/android/).
# Output:   android/app/build/outputs/bundle/release/app-release.aab
# =================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
# Capacitor 8 / AGP need JDK 21+ (source release 21).
if [[ -z "${JAVA_HOME:-}" ]]; then
  for candidate in \
    /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
    /opt/homebrew/opt/openjdk@21 \
    /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
    /opt/homebrew/opt/openjdk@17; do
    if [[ -d "$candidate" ]]; then
      export JAVA_HOME="$candidate"
      break
    fi
  done
fi
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:${PATH:-}"

MODE="${1:-build}"

if [[ ! -d "$ANDROID_HOME" ]]; then
  echo "ANDROID_HOME not found at $ANDROID_HOME" >&2
  exit 1
fi

if [[ ! -f android/keystore.properties ]]; then
  if [[ -f .secrets/android/keystore.properties ]]; then
    cp .secrets/android/keystore.properties android/keystore.properties
    echo "Restored android/keystore.properties from .secrets/android/"
  else
    echo "Missing android/keystore.properties (and .secrets/android/keystore.properties)." >&2
    echo "Create an upload keystore first — see docs/MOBILE_ANDROID.md" >&2
    exit 1
  fi
fi

echo "Building static export…"
npm run build

echo "Syncing Capacitor Android…"
npx cap sync android

if [[ "$MODE" == "sync" ]]; then
  echo "Synced. AAB not built."
  exit 0
fi

if [[ "$MODE" == "open" ]]; then
  npx cap open android
  exit 0
fi

echo "Assembling release bundle…"
(
  cd android
  ./gradlew bundleRelease --quiet
)

AAB="android/app/build/outputs/bundle/release/app-release.aab"
if [[ -f "$AAB" ]]; then
  ls -lh "$AAB"
  echo "✓ Play AAB ready: $AAB"
  echo "  Upload via Play Console → Testing → Internal testing → Create release"
  echo "  Listing copy: android/PLAY_STORE.md"
else
  echo "AAB missing after gradle" >&2
  exit 1
fi
