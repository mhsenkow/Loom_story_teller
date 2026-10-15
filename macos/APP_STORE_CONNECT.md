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

## Still required before Submit for Review
1. **Mac App Store–signed build** attached to version 1.0  
   - Not the notarized Developer ID DMG (`Loom_0.1.1_aarch64.dmg`) — that is direct distribution only.  
   - Needs App Sandbox entitlements + Mac App Store provisioning + `productbuild` / Transporter `.pkg`.  
2. **App Privacy** nutrition labels in ASC web UI (API JWT cannot set) — choose **Data Not Collected** unless you add tracking SDKs.  
3. Confirm pricing / availability matches iOS ($4.95, same territories).  

## Notarized DMG (outside the Store)
Already built and notarized for direct install:

`src-tauri/target/release/bundle/dmg/Loom_0.1.1_aarch64.dmg`
