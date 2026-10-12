# Native privacy and capabilities (LOOM-689)

| Surface | Data stays local | Network | Notable capabilities |
|---------|------------------|---------|----------------------|
| Desktop Tauri | DuckDB, folder scan, exports | User-initiated catalog/stream fetches, optional Ollama | FS read/write (gated save paths), shell open URL |
| Web (loom.ibm.io) | IndexedDB uploads, localStorage prefs | Worker `/api/*`, Wikipedia SSE | No DuckDB; uploads capped |
| iOS Tauri shell | Same as web path in WKWebView | Same as web | `shell.open` for https links only |
| Capacitor iOS (secondary) | Same as web | Same as web | Files picker via web APIs |

Optional **Get link** may upload chart-encoded columns (user toggle). Published stories are sandboxed HTML on the Worker origin.

See also [`public/privacy.html`](../public/privacy.html) and [`README.md`](../README.md).
