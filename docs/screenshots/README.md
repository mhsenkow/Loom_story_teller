# Screenshots

Images used by the main [README](../../README.md). All are captured from the live site, [loom.ibm.io](https://loom.ibm.io), so they show what people actually get.

| File | What it shows | Viewport |
|------|---------------|----------|
| `loom-chart.png` | Chart view — `sales_demo.csv`, Sum of revenue by city (horizontal bars, data labels) | 1440×900 |
| `loom-map.png` | Chart view — USGS past-hour earthquakes, bubble map sized by magnitude, colored by `mag_type` | 1440×900 |
| `loom-dive.png` | Dive — live Wikipedia edits, count over time grouped by `wiki` | 1440×900 |
| `loom-explorer.png` | Explorer — `sales_demo.csv` table with sparklines, value bars, filters | 1440×900 |
| `loom-query.png` | Query — `SELECT * FROM loom_active LIMIT 100` with results | 1440×900 |
| `loom-phone.png` | Chart view on a phone — Sum of units by product | 390×844 |

## How to capture

Every chart setup lives in the URL, so screenshots are reproducible: build a `#chart=…` link with `encodeChartLink` (`src/lib/chartLink.ts`) or a `#dive=…` link with `encodeDiveLink` (`src/lib/dive.ts`) — or just set the chart up in the app and copy the address bar. Opening the link in a fresh browser profile loads the dataset (demo files and live feeds reopen on their own), skips first-run onboarding, and lands on that exact chart.

1. Open each link at the viewport above with a device pixel ratio of 2 (desktop) and a clean profile. A headless Chrome driven by `playwright-core` works well; give live feeds ~10 s to load.
2. For Explorer and Query, open the chart link, then press `1` (Explorer) or `3` (Query) and click **Execute**.
3. Downscale desktop captures to 1600 px wide (`sips -Z 1600 in.png --out out.png` on macOS) to keep the repo light. Keep the phone capture at full size.

Use PNG. Live-feed shots change every time — that's expected.
