# Android shell — Play Store path

Loom on Android uses **Capacitor** wrapping the same static Next export (`out/`) as the browser and iOS web-parity shells. There is no DuckDB on Android.

| Item | Value |
|------|--------|
| Application ID | `com.loom.storyteller` |
| Shell | Capacitor (`android/` + `capacitor.config.ts`) |
| Data | Web-parity: uploads, IndexedDB, Worker `/api/*` |
| Min / target SDK | 24 / 36 |
| Dev | `make phone` (sync + Android Studio) |
| Play AAB | `make phone-weave` / `./scripts/android-play-aab.sh` |

## Why Capacitor (not Tauri Android)

iOS App Store release stays on **Tauri iOS**. Android ships Capacitor so we keep one WebView shell with Play’s expected Gradle / App Bundle flow, matching the experimental Capacitor iOS tree without competing with the Tauri iOS archive.

## Signing (upload key)

Play App Signing should own the **app signing key**. Loom keeps a local **upload key**:

- Keystore: `.secrets/android/loom-upload.jks` (gitignored)
- Properties: `.secrets/android/keystore.properties` → copied to `android/keystore.properties` by the build script

Never commit `.jks` / `keystore.properties`. Back up `.secrets/android/` offline; losing the upload key requires a Play Console key reset.

## Before each Play release

1. Bump `versionCode` / `versionName` in `android/app/build.gradle`.
2. `./scripts/android-play-aab.sh`
3. Upload `app-release.aab` to Internal testing (then Closed / Production).
4. Complete [android/PLAY_STORE.md](../android/PLAY_STORE.md) checklist (listing, rating, privacy, data safety).
5. Smoke [MOBILE_ACCEPTANCE.md](./MOBILE_ACCEPTANCE.md) on a physical device or emulator.

## Feature parity

Same matrix row as browser / iOS web path in [CAPABILITY_MATRIX.md](./CAPABILITY_MATRIX.md): no DuckDB, Worker feeds, share via Web Share / download.
