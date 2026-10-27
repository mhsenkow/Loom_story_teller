# App Store Connect — Loom (iOS / iPad)

Bundle ID: `com.loom.storyteller`  
Team: `WC44W2QVE4` · Category: **Productivity** · Price: **$4.95**  

Shell: Capacitor (`ios/`) packing the same static UI as [loom.ibm.io](https://loom.ibm.io)

## Name
Loom Storyteller  
(store name — “Loom” alone is taken)

## Subtitle (≤30 chars)
Data stories on your iPad

## Promotional text (≤170)
Live quakes, flights, Wikipedia, crypto, weather — or a CSV. Chart it and share. Paid download; data stays on device except feeds you open.

## Description (live in ASC)
Loom turns interesting data into charts you can actually read — and share.

On iPad and iPhone you get the same storytelling surface as loom.ibm.io:

• Live feeds — earthquakes, aircraft, Wikipedia edits, crypto, weather, and more  
• Chart suggestions that fit your columns  
• Dive — filter, group, and metric without writing SQL  
• Share — PNG for Stories / Square / Wide, or a link that reopens the chart  

Load a CSV from Files, or tap a curated pack / open-data catalog. No account required.

This App Store build is a one-time paid download ($4.95) with no in-app purchases and no login. The separate macOS Loom app adds folder mount, DuckDB SQL, and WebGPU scatter.

## Keywords
data,chart,csv,visualization,story,earthquake,flights,wikipedia,productivity,ipad

## Support URL
https://github.com/mhsenkow/Loom_story_teller

## Marketing URL
https://loom.ibm.io

## Privacy policy URL
https://loom.ibm.io/privacy  
(`privacy.html` redirects here; use the canonical `/privacy` URL in App Store Connect)

## Age rating
4+ (questionnaire complete in ASC).

## App Privacy (portal — API cannot set nutrition labels)
In App Store Connect → App Privacy, set **Data Not Collected** if you do not analytics-track.
Disclose only if you later add SDKs that collect. Live HTTPS feeds the user opens are network requests to third parties / the Worker, not “data collected by you” for Apple’s nutrition labels when you don’t retain identity.

## Content rights
`USES_THIRD_PARTY_CONTENT` (open-data / live upstreams).

## Review notes (live in ASC)
Paid one-time ($4.95). No login. Build **1.0 (8)**. Icon = woven loom cube mark.

1. Launch → “What’s interesting right now” or Data & sources → Earthquakes / Wikipedia.  
2. Chart opens; optional Edit encoding/look.  
3. Share → export PNG.  

Privacy: https://loom.ibm.io/privacy

## Screenshots (live)
- iPhone 6.7" + iPad 13": 5 COMPLETE shots each (`01`–`05`)  
- Adding a 6th requires leaving READY_FOR_REVIEW first

## Icon / logo
Yes — build **22** includes App Icon appearance themes (Any / Dark / Tinted) from `ios/App/.../AppIcon.appiconset` (`AppIcon-1024.png`, `-dark`, `-tinted`). Canonical mark: `brand/loom-icon-1024.png`. Regenerate with `node scripts/prepare-app-icons.mjs` then `npx tauri icon brand/loom-icon-1024.png`.

## Live ASC status (2026-10-27)
- Version **1.0** · build **33** uploaded (delivery `49f1264e-c474-4308-baa8-161d5ee4e2bd`) — ChartView LOOM-141 split + draw wiring fixes · prior TestFlight **32** still Testing
- **Action:** App Review is Waiting for Review on an older build — cancel/remove that submission (or reject and resubmit), attach **33**, then resubmit. TestFlight uploads alone do not change what's in review.
- Prior (2026-10-15): build **26** uploaded (UUID `03f4582a-61c7-40b9-a583-455ffc1b112e`) — Claude chart, Discover, and share updates · prior **25** uploaded (UUID `d68710bb-4f54-44e1-b500-343aa549949f`)
- App Icon: traditional `ios-marketing` + Dark/Tinted (`brand/loom-icon-1024.png`)
- Screenshots: iPhone 6.7" ×6 + iPad 13" ×6 (incl. `06-phone`)
- App preview videos: `preview-iphone67.mp4`, `preview-ipad13.mp4` (15s+, AAC) — rebuild via `node scripts/build-app-previews.mjs`
- Upload media: `node scripts/upload-store-media.mjs`
- ASC admin header may still show a blue placeholder until first App Store release; device/TestFlight/product page use the woven cube
- Portal-only: confirm **App Privacy** nutrition labels if ASC still flags them

## One-time portal setup
1. Xcode → Settings → Accounts → Michael Senkow (team WC44W2QVE4) signed in  
2. developer.apple.com → Identifiers → App ID `com.loom.storyteller` (iOS App) — *or let Xcode create it on first Archive*  
3. App Store Connect → My Apps → New App → iOS → Bundle ID `com.loom.storyteller` → SKU `loom-storyteller`  
4. Paste Name / Subtitle / Description / Keywords / URLs above  
5. Upload build via Archive or `make tablet-cap`

## Build & upload
```bash
npm run build && npx cap sync ios
make tablet-cap          # archive + export IPA (Xcode automatic signing)
# or open Xcode:
npx cap open ios         # Product → Archive → Distribute → App Store Connect
```

API upload:
```bash
export APPLE_API_KEY_ID=397A4HMVSU
export APPLE_API_ISSUER=69a6de78-8ab8-47e3-e053-5b8c7c11a4d1
# key file: ~/.appstoreconnect/private_keys/AuthKey_397A4HMVSU.p8
xcrun altool --upload-app -f ios/build/Loom.ipa -t ios \
  --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"
```

Store assets (generated locally):
- `ios/store/screenshots/iphone67/` — 1290×2796
- `ios/store/screenshots/ipad13/` — 2064×2752
- `ios/store/AppIcon-1024.png`

App preview video is optional; slideshow MP4s without Apple’s full audio/spec requirements fail ASC processing.
