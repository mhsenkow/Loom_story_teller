# Update channels by platform (LOOM-651)

| Platform | Delivery | User recovery | Local data |
|----------|----------|---------------|------------|
| macOS `.app` | Manual download / future Tauri updater (not enabled) | Re-open same `.loom-data` folder | DuckDB + files on disk |
| Web `loom.ibm.io` | Deploy on merge/tag | Hard refresh; stale chunk → clear site data | IndexedDB + localStorage |
| iOS App Store | TestFlight / store update | Reinstall; see [MOBILE_ACCEPTANCE.md](./MOBILE_ACCEPTANCE.md) | Same as web IDB path |

**Rules**

1. Do not enable desktop auto-update until signatures and rollback are tested (LOOM-439).
2. iOS never uses the desktop updater; App Store versioning is canonical (`scripts/ios-version-check.sh`).
3. Worker API version bumps must stay backward compatible for one release or gate with feature flags.

**Interrupted updates:** Browser preserves IDB unless user clears site data; desktop preserves mounted folder path in `persist.ts` last session.
