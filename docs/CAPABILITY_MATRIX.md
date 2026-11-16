# Platform capability matrix (LOOM-616)

**Last verified:** 2026-10-27 (manual + Vitest gates in CI; Android Capacitor shell added). This replaces speculative “minimum browser” claims.

| Capability | macOS Tauri | iOS Tauri shell | Android Capacitor | Browser (Chromium) | Browser (Safari) |
|------------|-------------|-----------------|-------------------|--------------------|------------------|
| DuckDB / folder SQL | Yes (CSV built-in; no unsigned extension autoinstall) | No — web data path | No — web data path | No — mock query | No |
| Own-data import | CSV (Parquet/JSON/XLSX await signed helpers — Gatekeeper) | CSV/TSV/JSON/Parquet/XLSX via picker | Same as iOS web path | Same as iOS | Same; FS Access API varies |
| Linked folder (FS Access) | N/A | Limited | Limited (SAF / picker) | Chrome/Edge | Safari 17.4+ partial |
| Live feeds (60 kinds) | Rust poll → DuckDB (bluesky / bgp / pokemon / met via Worker) | Worker `/api/source/*` → buffer | Worker | Worker | Worker |
| Monitors (in-app schedule) | Yes, while app open | Yes, while app open | Yes, while app open | Yes; hidden tabs throttle timers | Same |
| Monitor notifications | Tauri notification plugin | Tauri notification plugin | Web Notifications (when allowed) | Web Notifications | Web Notifications (16.4+; home-screen app on iOS) |
| Always-on monitors | Worker cron → webhook / ntfy | Same | Same | Same + Web Push | Same + Web Push (16.4+, Home Screen app on iOS) |
| Community votes + comments | Worker `/api/social/*` (SocialHub Durable Object) | Same | Same | Same | Same — public live-feed charts only; no account, device token in localStorage |
| Monitor moments (share / NeoSpace) | Share link + image (NeoSpace from web) | Same | Same | Yes | Yes |
| WebGPU scatter | When eligible; custom/category shapes and emoji use Canvas | Same rules | Same rules; GPU rare on WebView | Same | Same; GPU may be unavailable |
| On-screen charts | Canvas 2D + gated WebGPU | Same | Canvas 2D (+ WebGPU if WebView allows) | Same | Same |
| Vega-Lite | Spec + SVG export only | Same | Same | Same | Same |
| Public story link | Optional data upload | Same | Same | Same | Same |
| IndexedDB dataset cache | Used for in-memory remote imports | Yes (24-entry soft LRU; bookmarks and recipe inputs protected) | Same | Same | Same; private mode may block |
| Data library / bookmarks | Yes, local metadata | Same | Same | Same | Same |
| Two-source lookup combinations | Bounded TS join over inspected rows | Same, over web buffers / uploads | Same | Same | Same |
| Combination refresh | Rebuild on open; no continuous result refresh or SQL | Same | Same | Same | Same |
| Share sheet / export PNG | Native + web fallbacks | iOS share | Web Share / download | Download / Web Share | Web Share when available |

**Bundled typography:** All platforms ship the same 16 named fonts. Native builds include every font asset; browsers load faces from Loom as needed and cache used files for offline revisits. PNG captures retain the rendered lettering. SVG carries font-family references and requires those fonts in the external viewer.

**Feature detection:** UI uses `isDesktop()`, `isTauri()`, `navigator.maxTouchPoints`, and explicit checks in `webFolderPick.ts` before showing unsupported controls.

**Fallback copy:** When a capability is missing, Sidebar and Query show the same messages documented in [DOCS.md](../DOCS.md) (browser ingestion section).

**Browserslist:** Derived from this matrix after `npm run build`; do not claim support for APIs not listed here.
