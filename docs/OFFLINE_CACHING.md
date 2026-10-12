# Offline caching design (LOOM-458)

**User-data boundary:** Only explicitly imported files, saved views, and Worker-fetched buffers already on device may be read offline. No silent sync of private folders to cloud.

| Layer | Offline read | Offline write | Clear |
|-------|--------------|---------------|-------|
| `localStorage` (`persist.ts`) | Settings, recents, views | Same | Settings → reset scopes (future LOOM-551) |
| IndexedDB (`webFileStore.ts`) | Last 24 imported samples | Import while online | Eviction LRU; user clear doc in LOOM-278 |
| Worker Cache API | Public source JSON | Server only | TTL expiry |
| DuckDB (desktop) | Full folder | Scan/import | User deletes files |

**UI:** Airplane mode shows existing buffers; live feeds show last poll timestamp and retry when online (`webStreams`).

**Service worker:** `public/sw.js` (LOOM-458/459/457) — app shell + `/api/source/*` stale-while-revalidate + share-target ingest; registered from `WebServiceWorker.tsx` when not Tauri.

**Offline start (LOOM-416):** `sw.js` also serves the cached `/` shell and `/_next/static/*` chunks when the network is down, so a cold offline session can boot and reopen IndexedDB uploads. `OfflineBanner` probes `/build-id.txt` (not just `navigator.onLine`), lists remote data that can't refresh, and dispatches `loom:reconnected` so only the pending live feed retries.

**Workspace backup (LOOM-659):** Settings → Local data exports/imports a versioned `loom-workspace` JSON (views, dashboards, snippets, per-file column prefs; datasets referenced, not embedded).
