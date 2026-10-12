# Mobile document picker (LOOM-414)

**Device validation required** for iCloud Drive / Files providers — code + unit tests are in place; manual sign-off on real devices is still required before closing the ticket.

## Implemented behavior

| Scenario | UI / code path |
|----------|----------------|
| Large file over budget | `assertWebIngestByteBudget` in `webIngest.ts` → per-file error in `ingestBrowserFiles` toast (`Sidebar.tsx`) |
| Picker denied / blocked | `formatWebImportError` in `webImportUi.ts` → toast on folder pick, link, resync, file input |
| User cancel picker | `AbortError` → silent (no toast); vault unchanged |
| iCloud / Files not downloaded | `NotReadableError` → retry copy in toast |
| Linked folder permission lost | `resyncLinkedDataFolder` throws → “Allow folder access…” toast |
| Import progress / retry | Progress via `beginWebImport` / `isActiveWebImport`; partial success toast lists skipped files |
| Cancellation mid-import | `WebIngestAbortedError` → no commit; existing vault entries untouched |

Automated coverage:

- `src/lib/__tests__/webImportUi.test.ts` — picker denial, large-file copy, abort
- `src/lib/__tests__/webFormats.test.ts` — byte budget + abort during ingest

## Manual checklist (iOS / iPadOS / Android)

1. Pick iCloud-backed CSV → import succeeds or actionable error (wait-for-download message).
2. Cancel picker → no toast, no partial activation.
3. Revoke folder access → Sync shows allow-access message, not a silent empty table.
4. Pick file over ~48 MB → toast cites desktop app; no browser hang.
5. Multi-select with one bad file → good files land in **My Loom data**; toast notes skipped count.
