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
Open live earthquakes, flights, Wikipedia, crypto, and weather — or drop in a CSV. Make a readable chart and share it. Free. Data stays on your device except the live feeds you choose.

## Description
Loom turns interesting data into charts you can actually read — and share.

On iPad and iPhone you get the same storytelling surface as loom.ibm.io:

• Live feeds — earthquakes, aircraft, Wikipedia edits, crypto, weather, and more  
• Chart suggestions that fit your columns  
• Dive — filter, group, and metric without writing SQL  
• Share — PNG for Stories / Square / Wide, or a link that reopens the chart  

Load a CSV from Files, or tap a curated pack / open-data catalog. No account required.

The macOS Loom app adds folder mount, DuckDB SQL over millions of rows, and WebGPU scatter. This App Store build is the chart + story companion.

## Keywords
data,chart,csv,visualization,story,earthquake,flights,wikipedia,productivity,ipad

## Support URL
https://github.com/mhsenkow/Loom_story_teller

## Marketing URL
https://loom.ibm.io

## Privacy policy URL
https://loom.ibm.io/privacy.html  
(create this page before submit if it 404s — “Data Not Collected” / local-first + optional live HTTPS feeds)

## Age rating
4+ (no unrestricted UGC, no violence). Complete the questionnaire honestly.

## App Privacy
- Live feeds: contact third-party HTTPS APIs / Cloudflare Worker when you open a source  
- Local CSV: stays on device  
- Prefer **Data Not Collected** if you don’t analytics-track; disclose network use for live feeds if required

## Review notes
Loom is free. No login.

1. Launch → “What’s interesting right now” or Data & sources → pick Earthquakes / Wikipedia.  
2. Chart opens with a headline. Change encoding or look via Edit.  
3. Share → export a PNG (Square or Story).  

Outbound HTTPS only for live feeds and open-data catalogs the user selects. Offline demo/mock data works without network.

## Screenshots (required)
- iPad 13" (and iPhone 6.7" if Universal)  
- Capture: live quake map or bar chart, Dive view, Share sheet  
- No “coming soon”

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
