# App Review reply — Guideline 2.1 Information Needed

Paste into **Resolution Center** reply, and keep the same text in **App Review Information → Notes**.

---

## 1) Screen recording

Attach a screen recording (QuickTime / iOS Screen Recording) captured on a **physical** iPhone or iPad running the latest iOS/iPadOS:

1. Install the rejected build via **TestFlight** (or Xcode → Run on device).
2. Control Center → Screen Recording → start.
3. Cold-launch Loom Storyteller.
4. Tap **What’s interesting right now** (or **Data & sources** → Earthquakes or Wikipedia).
5. Wait for the chart/headline to appear; briefly open encoding/look controls if shown.
6. Open **Share** and export a PNG (Square or Story) if available.
7. Stop recording. Upload the video in the Resolution Center reply.

Notes for reviewers watching the video:
- **No account / login / registration** — none exist.
- **No UGC posting** — users do not create social posts; they chart public/open data or their own CSV.
- **Paid access** — the app is a **paid App Store download ($4.95)**. There are **no In-App Purchases**. Opening the app after purchase unlocks all features.

---

## 2) Purpose and target audience

**Purpose:** Loom Storyteller turns interesting data into readable charts you can share. On iPhone/iPad it is the same storytelling surface as https://loom.ibm.io — pick a live open-data feed (or a CSV), get a chart suggestion, tweak encoding/look, and export a shareable image or link.

**Problem it solves:** People want to explore public data (quakes, flights, Wikipedia edits, weather, crypto, etc.) and make a clear visual story without setting up a BI stack or writing SQL.

**Target audience:** Curious general users, journalists, students, and analysts who want lightweight chart storytelling on iPad/iPhone. Not an enterprise MDM-only tool.

**Value:** Fast path from “interesting live data” → chart → shareable PNG/link. Local-first for files the user opens; network only when they choose a live/open-data source.

---

## 3) Setup and accessing main features

**Login credentials:** None. No sign-in.

**Sample / demo path (no files required):**
1. Launch the app.
2. On the empty state, tap **What’s interesting right now**, *or* open **Data & sources** and pick **Earthquakes** or **Wikipedia**.
3. A chart opens with a headline. Optionally change chart type / encoding / look via **Edit** / Chart panel.
4. Use **Share** to export PNG (Story / Square / Wide) or a reopenable link when available.

**Optional local file path:** Use Files to open a CSV; the app charts the columns. Reviewers do not need a sample file if they use a live feed.

**Network:** Live feeds need HTTPS. Offline, curated demo/mock paths still work for basic exploration when available.

---

## 4) External services / platforms (core functionality)

| Service | Role |
|--------|------|
| **Apple App Store** | Paid download distribution ($4.95). No IAP / no Stripe / no third-party payments inside the app. |
| **Cloudflare Worker** (`loom.ibm.io` / catalog proxy) | Proxies/caches public open-data catalog and some source fetches for the web-parity iOS shell. |
| **Public data providers** (user-selected) | Examples: USGS (earthquakes), Open-Meteo / NWS (weather), Wikipedia (recent changes), aircraft/flight open feeds, crypto market APIs, World Bank and similar catalog sources. Exact set depends on what the user taps. |
| **No auth provider** | No Sign in with Apple / Google / OAuth. |
| **No analytics / ads SDKs** | No Firebase Analytics, ATT tracking, or ad networks in this build. |

The iOS build is a **Capacitor WKWebView** shell of the Loom web UI (same product surface as loom.ibm.io). Desktop macOS Loom (DuckDB / WebGPU) is a separate app and is **not** this binary.

---

## 5) Regional differences

The app **functions consistently across regions**. There is no geo-locked feature set. Availability of a given live feed depends on that public upstream being reachable from the device’s network, not on App Store region-specific app logic.

---

## 6) Regulated industry / protected material

Loom Storyteller is **not** a regulated financial, health, gambling, or government-services product.

It displays **public open-data / publicly licensed feeds** the user chooses (e.g. USGS earthquakes, Wikipedia public recent changes, weather APIs). We do not claim ownership of upstream data. Content rights in App Store Connect are declared as **Uses Third-Party Content** for those public sources. No special industry credentials are required.

Privacy policy: https://loom.ibm.io/privacy  
Support: https://github.com/mhsenkow/Loom_story_teller  
Marketing: https://loom.ibm.io

---

## Short Notes field copy (App Review Information)

```
RESPONSE TO GUIDELINE 2.1 (new account / information needed)

PURPOSE: Loom Storyteller helps people turn open/live data (or a CSV) into readable charts they can share on iPhone/iPad. Same surface as loom.ibm.io. Target: curious users, students, journalists, light analytics — not enterprise-only.

NO LOGIN. No account registration or deletion. No UGC social posting / reporting flows.

PAID MODEL: One-time App Store purchase ($4.95). No In-App Purchases. All features available after download.

HOW TO REVIEW:
1) Launch app
2) Tap “What’s interesting right now” OR Data & sources → Earthquakes or Wikipedia
3) Chart appears; optional Edit encoding/look
4) Share → export PNG

EXTERNAL SERVICES: Cloudflare Worker catalog/proxy at loom.ibm.io; public upstreams the user selects (USGS, Wikipedia, Open-Meteo/NWS, flights, crypto, etc.). No auth vendors. No ads/analytics SDKs.

REGIONS: Same features worldwide; live feeds need network to their public APIs.

REGULATED/PROTECTED: Not a regulated industry app. Public open data only; third-party content rights declared.

Screen recording of this flow on a physical device is attached in Resolution Center.
```
