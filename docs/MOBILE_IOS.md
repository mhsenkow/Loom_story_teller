# iOS shells — maintained strategy (LOOM-652)

Loom ships two iOS wrappers around the same static Next export (`out/`). They are **not** interchangeable for release.

## Production path: Tauri iOS (`src-tauri/gen/apple`)

| Item | Value |
|------|--------|
| Bundle ID | `com.loom.storyteller` |
| Team | `WC44W2QVE4` |
| Native bridge | Tauri 2 (`src-tauri/src/mobile.rs` — no DuckDB) |
| Data | Web-parity: browser ingestion + Worker APIs |
| Dev | `make tablet` / `npm run tablet` |
| IPA | `make tablet-weave` / `./scripts/ios-submit.sh build` |
| Xcode | `make tablet-xcode` |

This is the **supported App Store / TestFlight** path documented in `AGENTS.md`.

## Experimental / legacy: Capacitor (`ios/` + `capacitor.config.ts`)

| Item | Notes |
|------|--------|
| Same bundle ID | Kept for parity experiments; do not archive both to App Store Connect |
| Bridge | Capacitor WebView only |
| Build | `npx cap sync ios` after `npm run build` — not wired into `make tablet-weave` |

Use Capacitor only when explicitly testing Capacitor plugins. Release ownership stays with **Tauri iOS**.

## Feature parity matrix

| Capability | Tauri iOS | Capacitor |
|------------|-----------|-----------|
| Static export in bundle | Yes | Yes |
| DuckDB / folder IPC | No (by design) | No |
| Worker `/api/*` | Yes (absolute origin) | Yes |
| Native share / export fallbacks | Web Share + download | Same |
| TestFlight automation | `scripts/ios-submit.sh` | Manual Xcode |

## Before each mobile release

1. `./scripts/ios-version-check.sh`
2. `./scripts/ios-cli-check.sh` (Tauri CLI flag sanity)
3. Complete [MOBILE_ACCEPTANCE.md](./MOBILE_ACCEPTANCE.md)
