#!/usr/bin/env bash
# Fail fast when Node/npm/Rust versions drift from CI (LOOM-663).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

need_node="${LOOM_NODE_VERSION:-$(cat "$ROOT/.nvmrc")}"
node_major="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$node_major" != "$need_node" ]]; then
  echo "Node $need_node required (CI + .nvmrc); got $(node -v)" >&2
  exit 1
fi

if ! command -v npm >/dev/null; then
  echo "npm is required" >&2
  exit 1
fi

if ! command -v cargo >/dev/null; then
  echo "Rust (cargo) is required for src-tauri checks" >&2
  exit 1
fi

echo "✓ runtimes: node $(node -v), npm $(npm -v), cargo $(cargo --version | awk '{print $2}')"
