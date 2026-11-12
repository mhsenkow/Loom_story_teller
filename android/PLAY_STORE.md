# Google Play Console — Loom (Android)

Application ID: `com.loom.storyteller`  
Category: **Productivity** · Price: **$4.95** (one-time; no IAP)  
Shell: Capacitor (`android/`) packing the same static UI as [loom.ibm.io](https://loom.ibm.io)

## One-time Console setup

1. Join [Google Play Console](https://play.google.com/console) ($25 USD one-time developer fee if new).
2. **Create app** → name **Loom Storyteller**, default language English (US), app, paid.
3. Enable **Play App Signing** (default). First upload uses the Loom **upload key** in `.secrets/android/`.
4. Complete **Dashboard** tasks before Production: privacy policy, App content (rating, target audience, news/COVID as N/A), Data safety, Store listing, Paid app setup / countries.

## Store listing

### Name
Loom Storyteller  
(short name / launcher: **Loom**)

### Short description (≤80)
Live feeds or a CSV to charts you can share. Data stays on-device.

### Full description
Loom turns interesting data into charts you can actually read — and share.

On Android you get the same storytelling surface as loom.ibm.io:

• Live feeds — earthquakes, aircraft, Wikipedia edits, crypto, weather, and more  
• Chart suggestions that fit your columns  
• Dive — filter, group, and metric without writing SQL  
• Share — PNG for Stories / Square / Wide, or a link that reopens the chart  

Load a CSV from Files, or tap a curated pack / open-data catalog. No account required.

This Play build is a one-time paid download ($4.95) with no in-app purchases and no login. Desktop Loom (macOS) adds folder mount, DuckDB SQL, and WebGPU scatter.

### Graphics
| Asset | File in repo |
|-------|----------------|
| App icon 512×512 | `android/store-assets/icon-512-opaque.png` (use if Console rejects alpha) or `icon-512.png` |
| Feature graphic 1024×500 | `android/store-assets/feature-graphic-1024x500.png` |
| Phone screenshots | ≥2 — capture from emulator / device (reuse iOS shots cropped to phone if needed) |
| 7" / 10" tablet | Optional but recommended |

Canonical mark: `brand/loom-icon-1024.png`. Regenerated via `node scripts/prepare-app-icons.mjs`.

### Contact
- Support: https://github.com/mhsenkow/Loom_story_teller  
- Marketing: https://loom.ibm.io  
- Privacy: https://loom.ibm.io/privacy  

## Data safety / content

Mirror iOS App Privacy posture: **no analytics SDK**; disclose network access for user-opened live feeds and optional public share uploads. Privacy policy URL above.

Content rating: questionnaire → expect **Everyone** / PEGI 3-style for productivity + open-data charts (no user-generated chat, no ads).

## Build & upload

```bash
make phone-weave
# → android/app/build/outputs/bundle/release/app-release.aab
```

Play Console → **Testing → Internal testing → Create new release** → upload AAB → add yourself as tester → share opt-in link.

When Internal looks good: promote to Closed testing or Production. First Production review often takes 1–7 days for new developers.

## Versioning

| Field | Location | First Play |
|-------|----------|------------|
| `versionName` | `android/app/build.gradle` | `1.0` |
| `versionCode` | same | `1` (must increase every upload) |

## Upload key fingerprints (local)

Printed when the keystore was created; also:

```bash
keytool -list -v -keystore .secrets/android/loom-upload.jks -alias loom-upload
```

Play Console → App integrity shows the **app signing** cert after first upload; keep the upload key backup.

## Review notes (paste for reviewers)

Paid one-time ($4.95). No login. WebView shell of loom.ibm.io.

1. Launch → “What’s interesting right now” or Data & sources → Earthquakes / Wikipedia.  
2. Chart opens; optional Edit encoding/look.  
3. Share → export PNG.  

Privacy: https://loom.ibm.io/privacy

## Status

- **2026-10-28 (later):** Paid price set to **USD $4.95** (localized). Store listing copy + graphics (icon, feature graphic, 4 phone screenshots) saved. App content declarations (including **Data safety** + **Content ratings**) already actioned. **Internal testing** release **1 (1.0)** published (Active); email list **Loom internal** (`mhsenkow@gmail.com`) created and selected. Opt-in: `https://play.google.com/apps/internaltest/4700044818851405085`. **Closed testing – Alpha** track exists; still need countries + testers + release on that track, then **12 opted-in testers × 14 days** before Production application.
- **2026-10-28:** Play Console app **Loom Story Teller** (`com.loom.storyteller`) created. Privacy, ads, sign-in, government, finance, health, target audience, category (Productivity), and contact details filled.
- **2026-10-27:** Capacitor `android/` scaffolded; release AAB via `make phone-weave`.
