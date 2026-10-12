#!/usr/bin/env bash
# Validate npm/Makefile → Tauri iOS CLI forwarding (LOOM-666).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Tauri CLI: $(npx tauri --version)"
echo "--- npm run tablet:build (dry help) ---"
npm run tablet:build -- --help >/dev/null
echo "--- npm run tablet:xcode (dry help) ---"
npm run tablet:xcode -- --help >/dev/null
echo "--- ios-submit.sh documents same flags as Makefile tablet-weave ---"
grep -q 'export-method app-store-connect' scripts/ios-submit.sh
grep -q 'export-method app-store-connect' Makefile
echo "✓ iOS CLI entrypoints agree on app-store-connect export"
