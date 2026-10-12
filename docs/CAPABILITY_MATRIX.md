# Platform capability matrix (LOOM-616)

**Last verified:** 2026-10-12 (manual + Vitest gates in CI). This replaces speculative “minimum browser” claims.

| Capability | macOS Tauri | iOS Tauri shell | Browser (Chromium) | Browser (Safari) |
|------------|-------------|-----------------|--------------------|------------------|
| DuckDB / folder SQL | Yes | No — web data path | No — mock query | No |
| Own-data import | CSV/Parquet via scan | CSV/TSV/JSON/Parquet/XLSX via picker | Same as iOS | Same; FS Access API varies |
| Linked folder (FS Access) | N/A | Limited | Chrome/Edge | Safari 17.4+ partial |
| Live feeds (34 kinds) | Rust poll → DuckDB | Worker `/api/source/*` → buffer | Worker | Worker |
| WebGPU scatter | When eligible | Same rules | Same | Same; GPU may be unavailable |
| On-screen charts | Canvas 2D + gated WebGPU | Same | Same | Same |
| Vega-Lite | Spec + SVG export only | Same | Same | Same |
| Public story link | Optional data upload | Same | Same | Same |
| IndexedDB dataset cache | N/A | Yes (≤24 LRU) | Yes | Yes; private mode may block |
| Share sheet / export PNG | Native + web fallbacks | iOS share | Download / Web Share | Web Share when available |

**Feature detection:** UI uses `isDesktop()`, `isTauri()`, `navigator.maxTouchPoints`, and explicit checks in `webFolderPick.ts` before showing unsupported controls.

**Fallback copy:** When a capability is missing, Sidebar and Query show the same messages documented in [DOCS.md](../DOCS.md) (browser ingestion section).

**Browserslist:** Derived from this matrix after `npm run build`; do not claim support for APIs not listed here.
