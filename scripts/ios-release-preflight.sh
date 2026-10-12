#!/usr/bin/env bash
# LOOM-650 — Archive preflight (provenance + signing sanity, no upload)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== Loom iOS release preflight =="
echo "git commit: $(git rev-parse HEAD 2>/dev/null || echo unknown)"
echo "shell: Tauri iOS (primary) — see docs/MOBILE_IOS.md"
"$ROOT/scripts/ios-version-check.sh"
"$ROOT/scripts/ios-cli-check.sh"
echo "npm version: $(node -p "require('./package.json').version")"
test -f src-tauri/tauri.ios.conf.json && echo "tauri.ios.conf.json: present"
echo "OK — ready for manual archive (make tablet-weave / Xcode)"
