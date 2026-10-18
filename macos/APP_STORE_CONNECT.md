# App Store Connect — Loom (macOS)

Bundle ID: `com.loom.storyteller`  
Team: `WC44W2QVE4` · Category: **Graphics & Design** (+ Utilities) · Price: **$4.95**  
Platform version: **macOS 1.0** · State: **Prepare for Submission** (draft filled 2026-10-15)

Shell: Tauri desktop (`src-tauri/`) — DuckDB, folder mount, WebGPU scatter when available.

## Name / subtitle (shared app info)
- **Name:** Loom Storyteller  
- **Subtitle:** Data stories  

## Promotional text (≤170) — live in ASC
Folder + DuckDB on Mac, live quakes/flights/Wikipedia, or a CSV. Chart it and share. Paid download; your files stay local.

## Description — live in ASC
Loom turns interesting data into charts you can actually read — and share.

On Mac you get the full Loom desktop:

• Link a folder of CSV / Parquet and explore with DuckDB SQL  
• Live feeds — earthquakes, aircraft, Wikipedia edits, crypto, weather, and more  
• Chart suggestions that fit your columns, plus Dive for filters without writing SQL  
• High-density scatter when WebGPU is available  
• Share — PNG for Stories / Square / Wide, or a link that reopens the chart  

Open a local folder, load a CSV, or tap a curated pack / open-data catalog. No account required.

This App Store build is a one-time paid download ($4.95) with no in-app purchases and no login. The same storytelling surface also runs at loom.ibm.io and on iPhone / iPad.

## Keywords
data,chart,csv,sql,duckdb,visualization,productivity,earthquake,flights,wikipedia

## URLs
- Marketing: https://loom.ibm.io  
- Support: https://github.com/mhsenkow/Loom_story_teller  
- Privacy: https://loom.ibm.io/privacy  

## Screenshots — live in ASC (`APP_DESKTOP`, 2880×1800)
Source assets: `macos/store/screenshots/mac16x10/`

1. `01-chart.png` — chart canvas  
2. `02-dive.png` — Dive  
3. `03-explorer.png` — explorer  
4. `04-query.png` — Query / SQL  
5. `05-map.png` — map  

Re-upload: `node scripts/draft-macos-asc.mjs`

## Review notes — live in ASC
Paid one-time ($4.95). No login. Desktop DuckDB + folder mount + live open data.

1. Launch → “What’s interesting right now” or Data & sources → Earthquakes / Wikipedia (or Link a folder).  
2. Chart opens; optional Edit encoding / Query.  
3. Share → export PNG.  

Privacy: https://loom.ibm.io/privacy

## Version attributes
- Copyright: 2026 Michael Senkow  
- Release: After approval  
- Uses IDFA: **No**  

## Mac App Store build (sandbox + user folders)

Same folder model as desktop/iPad: **only folders the user picks** (App Sandbox + `files.user-selected.read-write` + app-scope bookmarks). No blanket home-directory access.

| Piece | Path |
|-------|------|
| Entitlements | `src-tauri/Entitlements.plist` |
| Bundle merge config | `src-tauri/tauri.appstore.conf.json` |
| Provisioning profile | `src-tauri/macos/Loom_Mac_App_Store.provisionprofile` |
| Build script | `make weave-mas` → `src-tauri/target/mas/Loom.pkg` |

```bash
make weave-mas
xcrun altool --upload-app --type macos \
  --file src-tauri/target/mas/Loom.pkg \
  --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"
```

Signing: **Apple Distribution** (app) + **3rd Party Mac Developer Installer** (pkg). Identity overrides: `APPLE_DISTRIBUTION_IDENTITY`, `APPLE_INSTALLER_IDENTITY`.

## Build attached (2026-10-18)
- **Build:** CFBundleVersion `8` (upload UUID `602f6059-faac-470d-9fd1-ad2aa5f0ab48`) — forecast, anomaly, and event overlays
- Prior: CFBundleVersion `7` (upload UUID `078c8561-4e4a-4fc5-9fbf-45f4a46c76c6`) — theme release
- Prior: CFBundleVersion `6` (upload UUID `61164006-5c75-45d8-9f0e-3b9a25b67f18`) — typography and spacing
- Prior: CFBundleVersion `5` (upload UUID `39e94bf0-26ea-4460-ba88-770f491136f5`) — Codex UI + What’s interesting compare charts
- Prior: CFBundleVersion `4` (upload UUID `6cbb5ef1-59c2-43ee-8064-833bec8f935b`) — Gatekeeper fix + honest CSV row counts (`COUNT(*)` on mount/inspect; activateDataset patches deferred zeros)
- Prior: CFBundleVersion `3` (upload UUID `ff90c05f-4476-4dd6-9cef-db1822803759`) — Gatekeeper only
- Prior: CFBundleVersion `2` (`da1394d7-362e-4f85-968d-c4ae8de30ac9`) — VALID, linked to macOS **1.0**
- Local pkg: `src-tauri/target/mas/Loom.pkg` (`bundleVersion` in `tauri.appstore.conf.json`)

## Submitted (2026-10-15)
- macOS **1.0** · build **2** · **WAITING_FOR_REVIEW** (listing)
- **TestFlight:** build **8** — forecast, anomaly, and event overlays
- Build **7** uploaded 2026-10-17 — theme release
- Build **6** uploaded 2026-10-16 — typography and spacing
- Build **5** — Codex updates + discover compares
- Build **4** — CSV row counts + no unsigned extension autoinstall
- Build **3** — Gatekeeper only
- Screenshots: Mac 16:10 ×5 · App preview: `macos/store/preview-mac.mp4` (COMPLETE)
- Rebuild preview: `node scripts/build-app-previews.mjs` · upload: `node scripts/upload-store-media.mjs`
- Confirm **App Privacy** in ASC web UI if Apple still flags it.  

## Notarized DMG (outside the Store)
Already built and notarized for direct install:

`src-tauri/target/release/bundle/dmg/Loom_0.1.1_aarch64.dmg`
