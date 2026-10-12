# Loom — 700-item improvement backlog

A full audit of Loom (web build, desktop app, Cloudflare Worker, MCP Worker, build and tooling) covering UX, accessibility, speed, correctness, security and code health. It was audited on 2026-10-07 against `main` @ `579ca83`, plus the uncommitted `src/app/page.tsx` change and the untracked `src/components/NeoSpaceIngest.tsx`.

Every item is a checkbox with a concrete "done when", tied to real code. **Line numbers are approximate**: they drift as soon as earlier items land, so find code by the symbol or quoted snippet, not by the line number alone.

---

## How to work through this (Cursor / Composer instructions)

1. **Read `AGENTS.md` and `DOCS.md` first** and follow their conventions: IPC only through `src/lib/tauri.ts`, Zustand only, tokens from `globals.css` (no new hex), static export (no API routes), and changelog entries for anything users will notice.
2. **Work in order, one item (or one tight cluster of related items) per change.** Phases go P1 → P2 → P3, and within a phase, areas go from security to docs. Tick the box (`- [x]`) when the item's "done when" holds.
3. **Do these enablers first, even though they're filed under P2.** Many P1 accessibility and UX items depend on them:
   - **#088** CI workflow, so every later change is checked on push.
   - **#067** whole-store `useLoomStore()` → selectors, plus the lint rule that bans the no-argument form.
   - **#280** shared `Dialog` / `Sheet` primitives with focus trap, restore and Escape. #074 (Onboarding) and most dialog/sheet items build on this.
   - **#281** shared `Button`.
   - **#503** DOM test environment (jsdom + Testing Library), and **#483** `eslint-plugin-jsx-a11y`.
   - **#026 + #197** go together: the `openDataset()` store action that resets per-dataset state, plus the single "dataset loaded → recommend → select" pipeline that a dozen call sites duplicate today.
4. **After each change, run:** `npx tsc --noEmit && npx eslint src && npx vitest run`. Run `npm run build` when touching imports or bundling. Run `cd src-tauri && cargo test` for Rust items. Note that `make test` does **not** run cargo yet until #460 lands, and `npm test` starts watch mode.
5. **Respect the phone goal:** on phones the loop is *find fun data → make a viz → share it*. Scope phone-only tweaks with `max-md:` and keep desktop density unchanged. Live feeds 404 under plain `next dev`, so test web flows with the local Worker (`.claude/launch.json` → `loom-web-live` + `wrangler dev`).
6. **Don't batch-rewrite.** Items like "split ChartView.tsx" or "split recommendations.ts" should land as several small, behaviour-preserving moves, each one green.
7. When an item turns out to be wrong or already fixed, tick it and add `— n/a: <reason>` instead of forcing a change.

**Legend:** `[P1]` user-visible bug, security hole, a11y blocker or big perf win · `[P2]` meaningful improvement · `[P3]` polish. Category tags: `security`, `bug`, `ux`, `a11y`, `mobile`, `perf`, `code`, `test`, `docs`, `dx`, `build`, `ci`, `deps`, `ops`, `seo`, `pwa`.

---

## Start here: the 30 highest-leverage items

| # | Why it matters |
|---|---|
| **#001** | "Get link" uploads up to 2,500 rows of *every* column to a public URL with no opt-in |
| **#002** | Stored XSS: dashboard microsite footer interpolates file names unescaped |
| **#003** | CSV exports pass `=HYPERLINK(...)`-style formulas straight into Excel/Sheets |
| **#004–#006** | Desktop: `csp: null`, arbitrary-path file writes, and `open_external_url` launching any scheme |
| **#007** | `/api/fetch-csv` is an open 32 MB proxy on loom.ibm.io |
| **#008** | User-published story HTML is served script-enabled on the app's own origin |
| **#009–#010** | XSS in the ChatGPT widget and on the MCP `/preview` route |
| **#048** | GPU scatter buffers leak on every pan/zoom |
| **#021, #022** | Web CSV parsing drops the last row of any file without a trailing newline, and strips leading zeros from ZIP/FIPS codes |
| **#026** | Filters, selections and anomaly indices leak across datasets |
| **#028** | Chart-view PNG thumbnails in localStorage hit the quota and *silently stop all saves* |
| **#031, #032** | Year columns get summed ("Sum of year") and ID columns are used as measures |
| **#042** | Date cells show the previous day for everyone in the Americas |
| **#044** | Dark flash on every load for light-theme users |
| **#058** | Every share-format tap waits on 1–3 s of fixed `sleep()`s |
| **#062, #068** | 278 kB of world/US atlas JSON and 13 render-blocking font families on first load |
| **#066** | On phones, the static HTML paints the sidebar plus an 88 dvh sheet until 542 kB of JS runs |
| **#067** | 23 whole-store subscriptions re-render the app on every hover, toast and 3 s feed poll |
| **#070** | 60+ chart kinds expose nothing to screen readers |
| **#074** | The first-run Onboarding modal can't be used from the keyboard |
| **#081, #082** | Live feeds keep polling in background tabs, and the first-visit discover scan leaves ~35 feeds running forever |
| **#085** | Shared links unfurl with no image, title card or favicon |
| **#088** | There is no CI on push or PR, only a tag-triggered release |

---

## Measurements at audit time

- **Build:** `npm run build` passes. `/` = **542 kB First Load JS (gzip)**: `app/page` chunk 325 kB gz / 1.12 MB raw, plus a 114 kB gz chunk that is mostly world-atlas + us-atlas TopoJSON. There are **0** uses of `next/dynamic` / `React.lazy`. Vega + vega-lite (267 kB gz) are already lazy (SVG export only).
- **CSS/fonts:** one 77 kB (15 kB gz) blocking stylesheet, plus a blocking Google Fonts request for **13 families / 43 faces**.
- **Quality gates:** `tsc` 0 errors. ESLint 0 errors / **63 warnings** (27 `exhaustive-deps`). Vitest **35 files / 768 tests pass** in 3.6 s, all `src/lib`, node environment, **0 component tests, 0 e2e**. The 52 Rust tests run nowhere automatically. `mcp/` has **107 type errors**. `workers/` is excluded from `tsc`.
- **Dependencies:** `npm audit --omit=dev` reports 7 issues (1 critical `next`, 6 high incl. `vega-lite`/`vega-expression` XSS). `vega@6` is installed against `vega-lite@5`, whose peer is `vega@5` (an invalid tree). `@tauri-apps/plugin-fs` and `plugin-shell` are imported 0 times.
- **Delivery:** no `public/` directory, so there's no favicon, manifest, OG image, `robots.txt` or `_headers`. The SPA fallback returns `index.html` with a 200 for `/favicon.ico` and stale chunk URLs. No service worker.
- **Biggest files:** `ChartView.tsx` 7,532 lines · `DetailPanel.tsx` 4,645 · `recommendations.ts` 3,921 · `sources.rs` 3,253 · `oddCharts.ts` 2,744 · `Sidebar.tsx` 2,117.
- **Backlog mix:** 90 P1 · 430 P2 · 180 P3. By area: Speed 110 · Accessibility 71 · Charts 63 · App shell 57 · Tests 49 · Explorer/Query/Dive 49 · Security 38 · Mobile 37 · Desktop 35 · Data ingest 31 · Recommendations 29 · Build/CI 28 · Docs/DX 27 · State 19 · Worker/MCP 17 · Share/export 16 · Web delivery 13 · Catalogs/formatting 11.

---

# Phase 1 — P1: user-visible bugs, security holes, big wins


## P1 · Security & privacy (11)


### Share sheet & capture

- [ ] **#001** **[P1] [security]** Make data upload on "Get link" an explicit choice — `publishStory` always attaches `buildShareDataSnapshot` (up to 2,500 rows of *every* column of `sampleRows`, plus stats) to a public 7-day link; the PII warning sits only under the NeoSpace button. Add an "Include data (N rows, M columns)" toggle, default off for local and uploaded files, and limit to the chart's encoded columns; done when "Get link" on a local CSV uploads image-only unless opted in. (`src/components/ShareSheet.tsx:203`)

### Share pages & social export

- [ ] **#002** **[P1] [security]** Escape data-source labels in the dashboard microsite — the footer builds `slots.map((s) => s.sourceLabel).filter(Boolean).join("; ")` without `escapeHtml`, while every other field is escaped. A file named `<img src=x onerror=alert(1)>.csv` (or a "Query: …" label holding SQL with `<`) runs script in the exported or published page. Escape each label; done when a test with `<script>` in a source label yields `&lt;script&gt;`. (`src/lib/dashboardMicrosite.ts:141`)

### CSV / ZIP export

- [ ] **#003** **[P1] [security]** Neutralise spreadsheet formulas in CSV exports — `escapeCsvCell` quotes commas/quotes but passes cells starting with `=`, `+`, `-`, `@`, tab or CR, so public catalog or stream values like `=HYPERLINK(...)` run when the export is opened in Excel/Sheets. Prefix such strings with `'` (leave real numbers alone); done when `=1+1` exports as `'=1+1` and a unit test covers each trigger character. (`src/lib/csvExport.ts:9`)

### Tauri security (config, capabilities, IPC surface)

- [ ] **#004** **[P1] [security]** Set a real Content-Security-Policy for the desktop webview — `"csp": null` disables Tauri's CSP entirely, so any HTML/script injected via a catalog description, CSV cell or shared link runs with full access to every custom IPC command (arbitrary file write, URL open). Add a `default-src 'self'; connect-src ipc: http://ipc.localhost <explicit upstream hosts> http://localhost:11434; img-src 'self' data: blob:` policy; done when the app runs with a non-null CSP and an injected `<script>` in a rendered string is blocked. (`src-tauri/tauri.conf.json:25`)
- [ ] **#005** **[P1] [security]** Restrict `write_text_file` / `write_binary_file` to paths the user just chose in a save dialog — both accept any absolute path from the webview and `create_dir_all` its parent, so a single XSS can overwrite `~/.zshrc` or drop LaunchAgents. Track dialog-returned paths in managed state (or move the save dialog into Rust and return a one-time token); done when writing to a path not issued by the save dialog returns an error. (`src-tauri/src/commands.rs:179`)
- [ ] **#006** **[P1] [security]** Allow only `https:`/`http:`/`mailto:` schemes in `open_external_url` — it passes any string to `opener::open`, so `file:///…/x.command`, `/Applications/Terminal.app` or a custom URL scheme launches local programs. Parse with `url::Url`, check the scheme allowlist, reject everything else; done when a unit test shows `file:` and bare paths are rejected. (`src-tauri/src/commands.rs:759`)

### Cloudflare Worker: /api/fetch-csv and catalog

- [ ] **#007** **[P1] [security]** Close the open proxy on `/api/fetch-csv` — any client can make loom.ibm.io fetch any public URL (up to 32 MB) and serve it back with `Access-Control-Allow-Origin: *`, with no rate limit or origin check, so it can be used for anonymous bandwidth, scraping and hosting arbitrary content under an IBM domain. Require same-origin `Origin`/`Sec-Fetch-Site`, add a per-IP Rate Limiting binding, and restrict CORS to Loom origins; done when a cross-site request or more than N/min per IP gets 403/429. (`workers/catalog-proxy.ts:127`)

### Cloudflare Worker: stories (/s/*), feedback, and abuse controls

- [ ] **#008** **[P1] [security]** Isolate user-published story HTML from the app origin — `/api/stories` stores client-supplied HTML verbatim and `/s/<id>` serves it as `text/html` on loom.ibm.io with no CSP, so anyone can host script-running pages (phishing on an IBM domain, access to the app's localStorage/same-origin APIs). Serve stories from a separate origin, or add `Content-Security-Policy: sandbox allow-popups; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'`, or render server-side from a JSON spec; done when a story containing `<script>` cannot read `localStorage` of loom.ibm.io. (`workers/catalog-proxy.ts:957`)

### MCP / ChatGPT plugin Worker

- [ ] **#009** **[P1] [security]** Escape tool output in the ChatGPT widget — `widget.html` builds cards with `innerHTML` from `r.title`, `r.subtitle`, `r.reason` and `r.kind`, which come from user-pasted CSV column names, so a header like `<img src=x onerror=…>` executes in the widget. Build nodes with `textContent`; done when a CSV with an HTML header renders literally. (`mcp/src/widget.html:82`)
- [ ] **#010** **[P1] [security]** Fix reflected XSS on `/preview` — `widgetDocument` inlines `JSON.stringify(seed)` from the `?seed=` query into a `<script>` (a `"</script><script>…"` string breaks out), the CSP allows `'unsafe-inline'`, and `data.loomUrl` is assigned to `open.href` unchecked (`javascript:` URLs). Escape `<`, `>`, `&`, U+2028/2029 in the JSON, allow only `https:` for `loomUrl`, and drop `'unsafe-inline'` for scripts (use a nonce); done when `/preview?seed={"title":"</script><script>alert(1)</script>"}` doesn't execute. (`mcp/src/index.ts:31`)

### Security

- [ ] **#011** **[P1] [security]** Require an allowed `Origin` on POST `/api/stories` and `/api/feedback` — the check is skipped when `Origin` is absent (`requestOrigin && !originAllowed(...)`), so curl/scripts bypass it; reject missing Origin for these POSTs. (`workers/catalog-proxy.ts:819-828`)

## P1 · Charts — correctness & UX (9)


### WebGPU rendering correctness

- [x] **#012** **[P1] [bug]** Fix WebGPU scatter points ignoring the plot pad — shader maps into the padded plot rect (`pad_x`/`pad_y` device px); GPU upload and axes overlay share the same `resolveChartPad` inputs from `chartRenderOpts`. (`src/shaders/scatter.wgsl`)

### Canvas chart correctness

- [ ] **#013** **[P1] [bug]** Place tick labels with the same log/symlog mapping as the data — line, area and scatter plot values through `scaleY(...)` for `yScale: "log" | "symlog"` but then call `drawChartTicks`/`drawChartGrid`, which position ticks linearly (`bottom - (v - yMin)/span`), so labels sit at the wrong heights. Add a `yTransform` option to `drawChartTicks`/`drawChartGrid` and generate log ticks (1, 10, 100…); done when a value of 100 on a 1–10,000 log axis is drawn at the 50% height next to the "100" label. (`src/lib/chartLooks.ts:443`)
- [ ] **#014** **[P1] [bug]** Fix "Compare previous" drawing on top of the original line — `prevOverlay` keeps each earlier-half point's own `t`, so the dashed "(earlier)" series is painted exactly over the first half of the solid line and shows nothing new; area does the same at ChartView.tsx:5463. Shift the earlier half onto the later half's x-positions (the ChartCard thumbnail already stretches it); done when a 2-period series shows the dashed earlier period aligned under the later period. (`src/components/ChartView.tsx:4930`)
- [ ] **#015** **[P1] [bug]** Draw smart overlays with the renderer's scales — `drawSmartOverlays` rebuilds its own linear min/max scale from raw rows, ignoring scatter zoom (`scatterViewBounds`), log y, nice-tick domain extension and band/time x axes, so trend, forecast and anomaly rings land in the wrong place on anything except an unzoomed linear scatter. Use `ropts.scales` (already filled by every renderer) and skip overlays when a renderer has no numeric x scale; done when a trend line on a zoomed scatter passes through the same points before and after zoom. (`src/components/ChartView.tsx:3877`)
- [ ] **#016** **[P1] [bug]** Make anomaly row indices consistent — `anomalyZScore` and `anomalyMAD` increment `idx` only for numeric cells, while `anomalyIQR` increments it for every row, so z-score/MAD results drift by one per null and ChartView (ChartView.tsx:3893) plus the Explorer table highlight the wrong rows. Always push the real row index; done when a column with leading nulls flags the same rows under all three methods. (`src/lib/smartAnalytics.ts:99`)
- [ ] **#017** **[P1] [bug]** Fix cluster colouring using a valid-point counter as the row index — `rowIdx` only advances for rows with finite x/y and is then looked up in `clusterByRow` (keyed by sample row index), so one NaN row shifts every cluster colour after it. Look up by `ri` (and map through any time-window/subsample index); done when clustering data with NaN rows colours each point by its own cluster. (`src/components/ChartView.tsx:4192`)
- [ ] **#018** **[P1] [bug]** Use one row-index space for hover, selection and overlays — `chartSampleRows` is time-windowed (ChartView.tsx:301) and density kinds then paint `sub.rows` (ChartView.tsx:2093), yet `setHoveredRowIndex`, `setSelectedRowIndices` (lasso/brush, ChartView.tsx:1712/1743) and `drawSmartOverlays` use indices into those derived arrays while Explorer reads them as `sampleRows` indices. Carry an `originalIndex` array through `applyChartTimeWindow` and `subsampleRowsForDensity`; done when brushing points with a "Last 7d" window highlights the same rows in the table. (`src/components/ChartView.tsx:1712`)

### PNG / export pipeline

- [ ] **#019** **[P1] [bug]** Include WebGPU scene/globe pixels in PNG exports — the PNG handler composites the WebGPU canvas only when `ac.kind === "scatter"`, so "Save view" snapshots (ChartView.tsx:2999) and non-capture PNG exports of firefly/scatter3d/globe/globeTrail contain only the background and footnote. Always repaint through the Canvas fallback (`renderGpuSceneCanvas`) for export, as the cube branch already does; done when a globe PNG shows the points. (`src/components/ChartView.tsx:1221`)

### Tooltips & hit testing

- [ ] **#020** **[P1] [ux]** Register hit targets for odd charts, maps, GPU-scene fallbacks and parallel coordinates — `renderOddChart`, `renderGeoMapCanvas` and `renderGpuSceneCanvas` get no `hits` array, and `renderFullParallel` pushes none, so these ~40 kinds fall back to `pickLineLikeNearestFixed`/`pickFallbackNominalBands` (chartTooltip.ts:843–878), which guess rows from generic x/y geometry and show a row that isn't under the pointer (e.g. hovering France on a choropleth shows a random row). Thread `hits` through `OddRenderOpts`/`GeoRenderOpts` and push a target per mark (use `ctx.isPointInPath` for map regions); done when hovering any mark of every kind in `ODD_CHART_KINDS`/`GEO_MAP_KINDS` shows that mark's values. (`src/components/ChartView.tsx:2404`)

## P1 · Data ingest & live feeds (5)


### Web CSV parsing & type inference

- [ ] **#021** **[P1] [bug]** Stop dropping the last row of complete CSVs — `trimToCompleteCsvRecords` cuts back to the last newline even when the file is complete, so any CSV without a trailing newline loses its final record (verified: `"a,b\n1,2\n3,4"` parses to only `[1,2]`). Trim only when the fetch was Range-truncated (pass a `truncated` flag from `fetchCsvTextWeb`) or when the tail record is short of the header width. Done when a test with no trailing newline keeps every row. (`src/lib/mock-data.ts:228`)
- [ ] **#022** **[P1] [bug]** Preserve leading-zero codes — per-cell `coerceCsvNumber` turns `"02134"` into `2134` and types the column DOUBLE (verified), breaking ZIP/FIPS joins for choropleths and mangling IDs; keep columns VARCHAR when non-empty values have leading zeros or fixed-width digit strings. Done when a `zip,fips` fixture round-trips as strings with leading zeros. (`src/lib/mock-data.ts:293`)

### Live buffers & polling (web)

- [ ] **#023** **[P1] [bug]** Fix the start/stop race — `webSourceStart` sets `running`, awaits the first poll, then unconditionally creates the `setInterval`; if `webSourceStop` runs during that await (user taps stop, discover timeout) a zombie poller keeps fetching with `running: false`. Re-check `buf.running` (or a generation counter) after the await. Done when a test calling stop during the first poll sees no further fetches. (`src/lib/webStreams.ts:1097`)
- [ ] **#024** **[P1] [bug]** Detect a dead Wikipedia EventSource — `es.onerror` is a no-op, so when the browser stops reconnecting (`readyState === CLOSED` after an HTTP error or network change) the card still says running and `lastError` is never set; check readyState, record the error, and reconnect with backoff. Done when a stubbed EventSource that closes surfaces `last_error` and reconnects. (`src/lib/webStreams.ts:1050`)
- [ ] **#025** **[P1] [bug]** Keep SpaceX unknown outcomes null — `parseSpacex` maps `success: null` (upcoming / unknown) to `false` via `Boolean()`, so the discover hook counts upcoming flights as failures (discoverStories.ts:497–502) and the "Success rate" pie (recommendations.ts:3520) understates success; keep null and exclude upcoming from the rate. Done when a fixture with 2 successes + 1 upcoming reports 100%. (`src/lib/webStreams.ts:570`)

## P1 · State & persistence (4)


### Store architecture & selectors

- [ ] **#026** **[P1] [bug]** Reset per-dataset state when a new dataset opens — `setSelectedFile` only swaps the file and `handleSelectFile` (Sidebar.tsx:256) only clears columnStats/sampleRows, so `tableFilterRowIndices`, `selectedRowIndices`, `smartResults` (anomaly indices), `pinnedTooltips`, `lassoPoints`, `tableColumnFilters`, `crosshairPos` survive and index into the wrong rows; add an `openDataset(file, inspect, recs)` action that atomically resets a declared DATASET_SCOPED key list in one `set`. Done when a store test opens A, sets filters/anomaly/selection, opens B, and asserts all are cleared in a single update. (`src/lib/store.ts:721`)
- [ ] **#027** **[P1] [bug]** Remove the sticky `streamActive` flag — it is set `true` for every poll source (Sidebar.tsx:965, Onboarding.tsx:292) and never set `false`, and `startDeepScan` checks `path === "stream://wiki" || s.streamActive`, so a deep scan on a CSV or USGS after visiting any live feed is profiled as the Wikipedia stream; derive "is wiki" from `selectedFile.path`. Done when `streamActive` is deleted and a test deep-scans a CSV after opening a source and gets `source.kind === "file"`. (`src/lib/store.ts:1251`)

### Persistence & hydration

- [ ] **#028** **[P1] [bug]** Keep chart-view thumbnails out of localStorage — `snapshotImageDataUrl` holds full-size PNG data URLs from `pngExportHandler` (captureStoryPreviews.ts:121) for up to 30 views; once the key passes ~5 MB, `safeSetItem` silently drops the write and every later chart view / story save is lost on reload. Store thumbnails in IndexedDB (or downscale to ~320 px JPEG) and keep only an id in localStorage. Done when saving 30 story views persists and reloads intact. (`src/components/HydrateStore.tsx:290`)
- [ ] **#029** **[P1] [ux]** Surface storage failures — `safeSetItem` swallows QuotaExceededError and returns void, so the try/catch blocks in HydrateStore (266/281/306/321/333) are dead and users are never told a save failed; return a boolean (or throw a typed QuotaError) and toast "Couldn't save — browser storage is full". Done when a test stubbing `setItem` to throw triggers exactly one toast. (`src/lib/persist.ts:36`)

## P1 · Recommendations & discover (6)


### Recommendation quality

- [ ] **#030** **[P1] [bug]** Match time-like names by token, not substring — `inferType` treats any VARCHAR whose name *contains* DATE/TIME/DAY/YEAR as temporal, so `candidate` (DATE), `holiday`, `monday`, `lifetime_value` become time axes for line charts; split names on `_`/space/camelCase and match whole tokens. Done when tests show `candidate` → nominal and `created_date` → temporal. (`src/lib/recommendations.ts:219`)
- [ ] **#031** **[P1] [ux]** Treat integer years as time, not measures — the dtype check runs before name hints, so `year`/`yr` INTEGER columns are quantitative: `recommend()` builds no line charts for year-indexed tables (OWID, World Bank CSVs) and emits "Sum of year by …" bars and year scatters instead. Classify integer columns named year/yr with values in 1000–2100 as temporal for X and exclude them from measures. Done when an OWID fixture's top rec is a line over Year and no rec aggregates `year`. (`src/lib/recommendations.ts:215`)
- [ ] **#032** **[P1] [ux]** Exclude identifier columns from measures — numeric `id`, `zip`, `fips`, `rank`, `objectid` columns are summed, scattered and used as weights (scatter pairs take the first 5–6 numerics in file order at 1162; pie at 1550 and sankey weight at 1883 take `numCols[0]`); flag numerics whose name matches id/code/rank or whose distinct_count ≈ row count and keep them out of y/size/weight. Done when a fixture with leading `id` and `zip` columns yields no rec using them as a measure. (`src/lib/recommendations.ts:1162`)
- [ ] **#033** **[P1] [bug]** Never put signed values on a log axis — the curated crypto "Cap vs change · log Y" puts `change_24h_pct` (often negative) on log Y, `expandRecommendationsWithExtras` adds a `-logy` variant to every line/scatter (2875, 2951), and random draws pick log 18% of the time (2233); gate log on `min_value > 0` and use symlog otherwise. Done when no rec with `yScale: "log"` has a y column whose min ≤ 0 across all source stories. (`src/lib/recommendations.ts:3443`)
- [ ] **#034** **[P1] [bug]** Give live-story recs stable ids — `recommendStreamStory`/`recommendSourceStory` build ids from `Date.now()` (`stream-${Date.now()}-…`, `${kind}-${Date.now()}-…`), but custom titles, annotations and reference lines are keyed by `activeChart.id` (ChartView.tsx:816/3424, DetailPanel.tsx:3782), so a user's edits on a live-feed chart vanish whenever the feed is reopened or discover reruns; derive ids from kind + encoding like `createChartRec`. Done when reopening USGS keeps a custom title on "Quake map". (`src/lib/recommendations.ts:3304`)

### Viz preferences, Ollama, IPC bridge, changelog

- [ ] **#035** **[P1] [bug]** Accept camelCase chart kinds from Ollama — `parseSuggestion` lowercases `chartKind` and then checks `CHART_KINDS`, which contains `forceBubble`, `arcDiagram`, `corrMatrix`, `geoPoints`, …, so any suggestion of those kinds is rejected and "Suggest with AI" silently fails; map case-insensitively to the canonical kind (and match column names case-insensitively). Done when a test response `{"chartKind":"forceBubble",…}` parses. (`src/lib/ollama.ts:99`)

## P1 · Explorer, Query, Dive & Cube (6)


### Explorer data table

- [ ] **#036** **[P1] [bug]** Fix sparkline/heat/bar data reading the wrong column — `useNumericColumnData` does `Number(row[ci])` with `ci` = index into the *visible/reordered* `columns`, but rows are in raw `allColumns` order; `numericColSet` likewise reads `types[ci]`. Hiding or reordering any column makes header sparklines, value bars, heat tint and numeric detection describe a different column. Map through `allColumns.indexOf(col)` in both; done when a test with a reordered `columnOrder` shows each column's min/max matching its own data. (`src/components/ExplorerView.tsx:141`)
- [ ] **#037** **[P1] [bug]** Stop small decimals rendering as "0" — numeric cells use bare `toLocaleString()` (max 3 fraction digits), so 0.00012 shows "0" and 1e-7 shows "0". Use a shared cell formatter with significant-digit precision (e.g. `maximumSignificantDigits: 6` below 1); done when 0.00012 renders "0.00012" in Explorer and Query results. (`src/components/ExplorerView.tsx:485`)

### SQL query view

- [ ] **#038** **[P1] [ux]** Stop the "plain English" box from wiping the user's SQL — pressing Enter builds a `prompt` that is never used and replaces the editor contents with a placeholder `SELECT * … LIMIT 100`, with no undo. Hide the input until an NL backend exists or insert the comment above the current SQL; done when the existing query is never lost. (`src/components/QueryView.tsx:301`)
- [ ] **#039** **[P1] [bug]** Don't block valid DuckDB statements in the validator — `validateQuery` counts parentheses inside string literals and comments (`WHERE t LIKE '%:)%'` → "Unmatched ')'") and rejects FROM-first, DESCRIBE, SUMMARIZE, PIVOT and SHOW. Skip quoted/commented text and downgrade the keyword check to a warning; done when those queries run. (`src/lib/queryValidate.ts:16`)
- [ ] **#040** **[P1] [bug]** Don't clobber the dataset with query results — every Execute calls `setSampleRows(result)` and `setColumnStats` with zeroed `null_count`/`distinct_count`, so Explorer's null % and profiles, Dive's web fallback and deep scan then run on an aggregate result while the header still shows the original file. Keep query results separate and make "Chart this →" opt in; done when an aggregate query leaves Explorer showing the original sample. (`src/components/QueryView.tsx:119`)

### Dive builder & engine

- [ ] **#041** **[P1] [bug]** Validate shared `#dive=` links before using them — `decodeDiveLink` only checks that `query.metrics` is an array, then `sanitizeDiveQuery` calls `q.groupBy.filter`, `q.filters`, `q.limit` etc. A hand-edited or older link missing `groupBy` throws inside `useMemo` and blanks the Dive view. Default every field and coerce types; done when a link with `{"metrics":[]}` opens a default dive. (`src/lib/dive.ts:995`)

## P1 · Catalogs, sessions & formatting (1)


### Formatting & time utilities

- [ ] **#042** **[P1] [bug]** Fix date cells shifting a day in the Americas — `formatDateCell` does `new Date("2025-03-01")` (parsed as UTC midnight) then reads local `getDate()/getHours()`, so in UTC−5 a DATE value shows "2025-02-28 19:00". Format date-only strings without a Date round-trip and treat naive timestamps as wall-clock (as `dive.ts toTime` already does); done when a DATE column reads 2025-03-01 in every time zone (test with `TZ=America/New_York`). (`src/lib/dateFormat.ts:18`)

## P1 · App shell, panels & NeoSpace handoff (5)


### NeoSpace handoff

- [ ] **#043** **[P1] [bug]** Suppress the first-run Discover sheet on NeoSpace handoffs — Onboarding only skips when the hash has `#chart=/#dive=/#story=` (Onboarding.tsx:157), so a first-time visitor arriving via `?from=neospace` gets the z-200 discover modal on top of the insight chart NeoSpaceIngest just opened. Have Onboarding also skip when `from=neospace` is in the query (or have the ingest set a store flag that closes it). Done when a fresh profile opening `/?from=neospace` lands directly on the ingested chart. (`src/components/Onboarding.tsx:157`)

### Root layout & document

- [ ] **#044** **[P1] [ux]** Remove the dark flash for light-theme users — `<html data-theme="dark" className="dark">` is baked into the static export, and ThemeApplicator only corrects it after hydration, so light-theme and OS-light users see a dark flash. Add a small inline pre-hydration script that reads `loom-app-settings` (falling back to prefers-color-scheme) and sets data-theme/class. Done when a reload in the Paper theme shows no dark frame. (`src/app/layout.tsx:32`)

### DetailPanel — Dashboards tab

- [ ] **#045** **[P1] [ux]** Add undo to dashboard and slot removal — both remove immediately with no confirm or undo, so a whole saved story is gone after one tap (slot removal at :687). Keep the last removed item in the store and offer Undo in the toast. Done when a deleted dashboard can be restored within 5s. (`src/components/DetailPanel.tsx:594`)

### DetailPanel — Chart encoding & visual controls

- [ ] **#046** **[P1] [ux]** Add undo for chart changes — Shuffle (⟳), Random (✦), visual presets (which replace all overrides, :3854), Shuffle look (:3868) and every encoding edit overwrite activeChart or the overrides with no way back. Keep a bounded history in the store and expose Undo in the toast and on ⌘Z. Done when a shuffle can be reverted in one tap. (`src/components/DetailPanel.tsx:3228`)

### Overlays & small shell components

- [ ] **#047** **[P1] [bug]** Keep stories that already streamed in when the 22s scan timeout fires — on slow networks the timeout resolves `[]`, then `setStories([])` and phase "error" wipe the stories that `onStory` had streamed in (they flash back as more feeds report), and the timer is never cleared. Keep the streamed list on timeout and clear the timer. Done when a throttled 3G scan never shows "Couldn't reach live feeds" after stories appeared. (`src/components/Onboarding.tsx:140`)

## P1 · Speed & performance (22)


### WebGPU rendering correctness

- [ ] **#048** **[P1] [perf]** Stop `LoomRenderer.uploadData` leaking GPU buffers — every call allocates new `dataBuffer`/`screenBuffer` without destroying the previous ones, and ChartView calls it on every pan/zoom/hover-triggered redraw (ChartView.tsx:2047). Destroy the old buffers (as `webgpuScenes.ts:210` already does) or reuse them when the capacity fits; done when 200 wheel-zooms leave GPU memory flat in Chrome's task manager. (`src/lib/webgpu.ts:214`)
- [ ] **#049** **[P1] [perf]** Upload scatter data once and pan/zoom with uniforms only — the draw effect re-runs `extractScatterData()`, `subsampleRowsForDensity` and `uploadData` (re-packing every point) for every `scatterView` change. Memoize the packed `Float32Array` on `[chartSampleRows, encoding, scale bucket]` and call only `render(eff…)` on view changes; done when a pan frame does no `createBuffer` and no row loop. (`src/components/ChartView.tsx:2015`)

### Performance — React & bundle

- [ ] **#050** **[P1] [perf]** Subscribe ChartView to store slices, not the whole store — `const {...} = useLoomStore()` with no selector re-renders this 7.5k-line component on every store write (hover index, crosshair, toasts, dashboard changes, other views' state). Use `useShallow` selectors per concern; done when React Profiler shows no ChartView render on `setHoveredRowIndex` from another view. (`src/components/ChartView.tsx:190`)
- [ ] **#051** **[P1] [perf]** Code-split ChartView — `page.tsx` imports `ChartView` statically, so the Explorer landing page ships the whole chart layer (ChartView, oddCharts ~110KB of source, gpuScenes, geoMaps, d3-geo, topojson, WGSL shaders). Use `next/dynamic(() => import("@/components/ChartView"), { ssr: false })` with a skeleton; done when the first-load JS for `/` drops by the chart chunk in `next build` output. (`src/app/page.tsx:20`)
- [ ] **#052** **[P1] [perf]** Stop re-uploading GPU scene data every animation frame — the firefly clock calls `setSceneTime` every rAF, which re-renders ChartView and re-runs the draw effect, which calls `extractGpuScenePoints` (8k-row loop) and `uploadData` (destroys and recreates two buffers) 60×/s. Run the clock inside the renderer (`setTime` + `render` in its own rAF) and upload only when data/encoding changes; done when firefly animates with zero React renders per frame. (`src/components/ChartView.tsx:1144`)
- [ ] **#053** **[P1] [perf]** Orbit 3D scenes and globes with camera uniforms only — each pointermove calls `setSceneOrbit`, re-running the whole draw effect: re-extracting points, re-uploading buffers, and for Canvas maps re-projecting every country to SVG strings. Keep orbit in a ref, call `setCamera` + `render()` directly, and commit to state on pointerup; done when dragging a globe causes no React renders and no buffer creation. (`src/components/ChartView.tsx:3091`)
- [ ] **#054** **[P1] [perf]** Render suggestion thumbnails lazily — every `ChartCard` draws synchronously on mount and again on its ResizeObserver's initial callback, each running `applyChartTimeWindow` over the full sample and a full mini-render; with 20–40 recs on a phone that's millions of row visits before first interaction, including offscreen rail cards. Draw on `IntersectionObserver` visibility inside `requestIdleCallback`, share one downsampled row set per dataset, and cache the bitmap by `rec.id + theme`; done when opening Chart view on a mid-range phone keeps the main thread free of long tasks over 50ms. (`src/components/ChartCard.tsx:242`)

### App shell (page.tsx)

- [ ] **#055** **[P1] [perf]** Stop Home from re-rendering on every store write — `Home` destructures `useLoomStore()` with no selector, so the whole tree (TopBar, Sidebar, DetailPanel, views) re-renders on every write, including toasts and 2–3s stream-status polls. Use per-field selectors or `useShallow`. Done when the React Profiler shows no Home render on `setToast`. (`src/app/page.tsx:386`)

### Sidebar

- [ ] **#056** **[P1] [perf]** Stop the live-feed cards re-rendering each other — every SourceCard (~34) plus WikiStreamSection (Sidebar.tsx:615) destructures the whole store, and each running card's 3s poll writes to the store, so every card re-renders on every poll. Select `s.sourceStatuses[def.kind]` plus stable actions. Done when the Profiler shows only the polled card re-rendering. (`src/components/Sidebar.tsx:918`)

### DetailPanel — structure & performance

- [ ] **#057** **[P1] [perf]** Use selectors throughout DetailPanel — ChartPanelView (:2598), ExportView (:1537), DashboardsView (:215), SettingsView (:787), StatsView (:1397), SmartView (:2203), SaveChartViewButton (:2557) and the root (:110) all destructure the whole store, so the ~2k-line ChartPanelView re-renders on every toast and poll. Convert them to selectors or `useShallow`, and add a lint rule banning `useLoomStore()` with no arguments (23 call sites repo-wide). Done when a live-feed poll doesn't re-render ChartPanelView. (`src/components/DetailPanel.tsx:2598`)

### Share sheet & capture

- [ ] **#058** **[P1] [perf]** Replace fixed sleeps in platform capture with a render-done signal — every capture waits `sleep(350)` + `baseWait` 550–900 ms (+400 ms per retry), so each format tap in the share sheet takes 1–3 s on phones. Have the chart resolve a "painted" promise (Vega `runAsync` / WebGPU `onSubmittedWorkDone`) and drop the timers; done when switching Square→Story renders in under 500 ms on a mid-range phone. (`src/lib/capturePlatformPng.ts:155`)

### Web CSV parsing & type inference

- [ ] **#059** **[P1] [perf]** Stop tokenizing rows that will be discarded — `parseCsvRecords` parses the entire text (plus a full pre-scan in `trimToCompleteCsvRecords`) with char-by-char `cur += ch`, then `parseCsvToInspectResult` slices to `rowCap`; a 50 MB pack is fully tokenized to keep 60k rows. Stop after `rowCap + 1` records and extract fields with `slice` between delimiters. Done when parsing a 20 MB fixture is ≥3× faster in a Vitest bench. (`src/lib/mock-data.ts:273`)

### Live buffers & polling (web)

- [ ] **#060** **[P1] [perf]** Stop copying the buffer on every push — `trim()` does `buf.rows.slice(...)` whenever `rows.length > maxRows`, and the Wikipedia stream calls `pushRows` per SSE event, so at the 8k cap each edit (20–50/s) allocates an 8k-element array; trim in batches (e.g. when >1.1× cap) or use a ring buffer. Done when a bench of 50k pushes at cap shows O(1) amortized cost. (`src/lib/webStreams.ts:71`)
- [ ] **#061** **[P1] [perf]** Bound `seenIds` — append feeds add every id forever (wiki per event at line 82, OpenSky `icao|ts` per aircraft per poll at 985) while `trim` drops rows, so a phone left on the live stream grows memory without bound; rebuild `seenIds` from retained rows when trimming or use a bounded LRU set. Done when after 100k wiki events `seenIds.size ≤ maxRows`. (`src/lib/webStreams.ts:82`)

### Bundle and code splitting

- [ ] **#062** **[P1] [perf]** Stop shipping world/US atlases in the first-load chunk — `recommendations.ts` imports `isGeoRegionField` from `geoAtlas.ts`, which statically imports `countries-110m.json` (108 kB), `land-110m.json` (55 kB) and `states-10m.json` (115 kB), landing in initial chunk `746-*.js` (114 kB gz). Move the name regexes (`isGeoRegionField`, `isLatField`, `isLonField`) into a new dependency-free `src/lib/geoFields.ts` and import that from `recommendations.ts`; done when `grep -c arcs out/_next/static/chunks/746-*.js` is 0 and First Load JS drops by ≥80 kB. (`src/lib/recommendations.ts:60`)
- [ ] **#063** **[P1] [perf]** Make atlas loading async — `getAtlas()` is synchronous over statically-imported JSON; change to `loadAtlas(kind): Promise<AtlasBundle>` using `await import("world-atlas/countries-110m.json")` etc., and have `renderGeoMapCanvas` render a "Loading map…" frame until resolved; done when atlas JSON is in its own lazy chunk that only downloads on a geo chart kind. (`src/lib/geoAtlas.ts:12-14,256`)
- [ ] **#064** **[P1] [perf]** Lazy-load non-default views — `ExplorerView`, `QueryView`, `DiveView` and `DashboardCanvas` are conditionally rendered but statically imported; wrap each with `next/dynamic(() => import(...), { ssr: false, loading: () => <Skeleton/> })`; done when `out/index.html` page chunk shrinks and Dive/Query code (`dive.ts` 42 kB + `diveExpr.ts` 30 kB + `DiveView.tsx` 61 kB + `QueryView.tsx` 24 kB source) appears only in separate chunks. (`src/app/page.tsx:19-22,794-797`)
- [ ] **#065** **[P1] [perf]** Split the WebGPU renderers out of the critical path — `LoomRenderer`, `LoomSceneRenderer`, `LoomCubeRenderer` (+ 15.9 kB of WGSL) are statically imported but only constructed inside effects; replace with `const { LoomRenderer } = await import("@/lib/webgpu")` at the construction sites and keep `import type` at the top; done when `vertex_main` no longer appears in `app/page-*.js`. (`src/components/ChartView.tsx:17,48-49,1111-1123`)

### Core Web Vitals and runtime responsiveness

- [ ] **#066** **[P1] [perf]** Fix mobile CLS/LCP from drawers that open in the static HTML — store defaults `sidebarOpen: true, panelOpen: true` so the prerendered `index.html` paints the 20 rem sidebar overlay, a backdrop and an 88dvh bottom sheet on phones until JS (542 kB gz) runs the `matchMedia` effect that closes them; hide them in CSS until hydrated (e.g. `max-md:hidden` unless `html[data-hydrated]`, set in a layout inline script/effect) or default both to `false` and open on desktop in the effect; done when Lighthouse mobile shows CLS < 0.1 and the first paint at 390 px shows the chart canvas, not the sheet. (`src/lib/store.ts:620-621`, `src/app/page.tsx:499-510`)
- [ ] **#067** **[P1] [perf]** Replace whole-store `useLoomStore()` destructuring with selectors — 23 call sites subscribe to every change (ChartView 1, DetailPanel 8, Sidebar 3, page 2, HydrateStore, ThemeApplicator, TopBar, ExplorerView, QueryView, ShareSheet, Onboarding, PreviewFooter, PromptDialog); use `useLoomStore(useShallow(s => ({...})))`; add an ESLint `no-restricted-syntax` rule banning zero-arg `useLoomStore()`; done when `grep -rn 'useLoomStore()' src | wc -l` is 0. (`src/components/ChartView.tsx:207`)

### Fonts and CSS

- [ ] **#068** **[P1] [perf]** Stop render-blocking on 13 Google Font families — `layout.tsx` loads Fira Code, IBM Plex Mono/Sans, Inter, JetBrains Mono, Josefin Sans, Libre Baskerville, Lora, Oswald, Share Tech Mono, Source Code Pro, Source Sans 3, Space Mono (43 faces) in one blocking stylesheet on every load; load only the default `inter` (+ one mono) at boot and inject the other families' `<link>` from `ThemeApplicator` when the user picks that font/look; done when the initial HTML references ≤2 families. (`src/app/layout.tsx:36-39`)

### Delivery: Workers static assets, caching, headers

- [ ] **#069** **[P1] [perf]** Set immutable caching for hashed assets — there is no `_headers` file, so Workers static assets serve `/_next/static/*` with the default revalidating cache policy; add `public/_headers` with `/_next/static/*\n  Cache-Control: public, max-age=31536000, immutable` and `/*.html`/`/` `Cache-Control: public, max-age=0, must-revalidate`; done when `curl -sI https://loom.ibm.io/_next/static/chunks/webpack-*.js` shows `immutable`. (`wrangler.jsonc:8-13`)

## P1 · Accessibility (8)


### Accessibility

- [ ] **#070** **[P1] [a11y]** Give the chart an accessible name and description — the three canvases have no role or label, and the non-scatter interaction overlay is `aria-hidden`, so screen readers announce nothing for 60+ chart kinds. Wrap the stage in `role="img"` (or `figure` + `figcaption`) labelled with the title and a generated summary (kind, fields, aggregate, row count, top/bottom values from the hit summaries); done when VoiceOver on a bar chart reads e.g. "Bar chart: revenue by region, 12 bars, highest West 1.2M". (`src/components/ChartView.tsx:3293`)
- [ ] **#071** **[P1] [a11y]** Fix low-contrast series colours in the default dark palette — `THEME_CHART.dark = VIZ_CATEGORICAL.slice(0,8)` includes purple `#5A24C7`, dark blue `#00487C` and burgundy `#850550`, all well under the 3:1 non-text contrast minimum against the dark chart background `#0a0a0c`, so series 3, 5 and 8 nearly vanish. Lighten those stops for dark surfaces or pick a dark-tuned order; done when every `THEME_CHART[theme]` colour has ≥3:1 contrast against `THEME_UI[theme].bg` (enforced by a test). (`src/lib/chartPalettes.ts:12`)
- [ ] **#072** **[P1] [a11y]** Unify the label-ink helpers on a real WCAG check — there are three: `chartLayout.contrastingInk` (gamma-uncorrected luma > 0.55), `chartPalettes.contrastingInk` (relative luminance > 0.45) and `chartInk.inkOn` (> 0.4). The WCAG crossover is L≈0.18, so mid-tones like the default orange `#F0701A` get white text at about 2.9:1 on pie/treemap/heatmap labels. Keep one helper that returns whichever of black/white has the higher contrast ratio; done when one implementation remains and labels on every palette colour reach ≥4.5:1. (`src/lib/chartLayout.ts:337`)

### DetailPanel — Stats / Export / Smart

- [ ] **#073** **[P1] [a11y]** Replace the hard-coded amber banners with tokens — the Export error uses `text-amber-500/90 bg-amber-500/10` and the Encoding "Doesn't fit this table" banner uses `text-amber-200/90` (:3208), which is about 1.3:1 on the light themes. Use the `loom-warning` tokens and add `role="alert"`. Done when both banners meet 4.5:1 in Light and Paper. (`src/components/DetailPanel.tsx:1974`)

### Overlays & small shell components

- [ ] **#074** **[P1] [a11y]** Make the Onboarding modal keyboard-usable — it has no Escape handler, no initial focus and no focus trap, so keyboard users start behind it. Its 32px close button (:411), the progress text that isn't announced (:565), and 9–10px labels (:421, :596) add to the problem. Use the shared Dialog, focus the first story card, and add aria-live to the progress text. Done when Escape closes it and Tab stays inside. (`src/components/Onboarding.tsx:376`)

### Design tokens & CSS (globals.css / tailwind.config.ts)

- [ ] **#075** **[P1] [a11y]** Add a readable text accent for dark mode — the default dark accent `#6a5ce0` used as text (`text-loom-accent` links like "Open chart", "Clear filters", Explore) is 3.76:1 on surface and 3.41:1 on elevated, below AA for small text. Add a `--loom-accent-text` token (for example `#b4adff`) for text use. Done when every accent text in the dark theme is at least 4.5:1. (`src/styles/globals.css:158`)

### Explorer data table

- [ ] **#076** **[P1] [a11y]** Make column sorting keyboard-operable — the sort target is a bare `<th onClick>` with no tabIndex/role, so keyboard and switch users cannot sort at all. Wrap the header label in a `<button>` (keep `aria-sort` on the th); done when Tab reaches each header and Enter/Space toggles sort. (`src/components/ExplorerView.tsx:870`)
- [ ] **#077** **[P1] [a11y]** Scroll the keyboard-focused row into view — ArrowUp/Down only update `focusedRowIndex`; with virtualization the focused row leaves the viewport and isn't rendered. Call `rowVirtualizer.scrollToIndex(i)` and expose it via `aria-activedescendant` + row ids; done when holding ArrowDown through 500 rows keeps the ring visible and screen readers announce the row. (`src/components/ExplorerView.tsx:816`)

## P1 · Mobile & touch (phone loop) (5)


### SQL query view

- [ ] **#078** **[P1] [mobile]** Turn off mobile text mangling in the SQL editor — the textarea sets `spellCheck={false}` but not `autoCapitalize="off"`, `autoCorrect="off"` or `autoComplete="off"`, so iOS capitalises "Select" and auto-corrects identifiers. Done when typing `select ts from wiki_stream` on iOS stays verbatim. (`src/components/QueryView.tsx:340`)

### Store architecture & selectors

- [ ] **#079** **[P1] [mobile]** Cap `webFileCache` — every parsed web CSV (up to 1.5M cells, mock-data.ts:259) is kept in the store for the whole session with no eviction, so browsing a few curated packs on a phone can exhaust memory; make it an LRU of ~3 entries (or a cell budget of ~3M) outside reactive state. Done when opening 6 packs keeps at most 3 cached and heap stays bounded. (`src/lib/store.ts:325`)

### Web CSV parsing & type inference

- [ ] **#080** **[P1] [mobile]** Parse CSVs in a Web Worker — `parseCsvToInspectResult` runs on the main thread from Sidebar.tsx:314/369, WebSessionResume.tsx:302 and NeoSpaceIngest.tsx:101, freezing phones for seconds on 1.5M-cell packs; move parse + stats into a module worker and return the result (transfer typed arrays where possible). Done when loading a curated pack on a mid-range phone keeps INP <200 ms and shows a progress state. (`src/lib/mock-data.ts:262`)

### Live buffers & polling (web)

- [ ] **#081** **[P1] [mobile]** Pause polling when the tab is hidden — no `visibilitychange` handling exists anywhere in src; every web poller and the Wikipedia EventSource keep running in background tabs, draining phone battery and data. Suspend timers / close the ES when hidden and resume with an immediate poll on visible. Done when a hidden tab issues zero `/api/source/*` requests over 5 minutes in a test with a stubbed `document.visibilityState`. (`src/lib/webStreams.ts:1100`)

### Discover stories

- [ ] **#082** **[P1] [mobile]** Don't leave 35 feeds running after the discover scan — `probeKind`/`probeWiki` call `sourceStart`/`streamStart` for all 34 sources plus the Wikipedia SSE and nothing ever stops them (only Sidebar stop buttons call `sourceStop`), so after the first-visit scan a phone keeps ~35 pollers alive indefinitely. Probe with a one-shot fetch + `parseSourceRows`, or stop every source the user didn't open when the modal closes. Done when, after closing discover without picking, no `/api/source/*` requests occur. (`src/lib/discoverStories.ts:861`)

## P1 · Desktop app (Tauri / Rust) (2)


### Rust: DuckDB connection, startup, and query layer

- [ ] **#083** **[P1] [bug]** Don't depend on the network for core DuckDB extensions at first launch — `INSTALL parquet; LOAD parquet;` must download from extensions.duckdb.org when the `bundled` crate lacks the `parquet` feature, and its error propagates to `.expect("Failed to initialize DuckDB")`, crashing an offline first launch. Enable the duckdb crate `parquet`/`json` features (statically linked) and make excel/sqlite optional; done when the app starts with networking disabled on a clean `~/.duckdb`. (`src-tauri/src/db.rs:82`)

### Rust: Wikipedia SSE stream

- [ ] **#084** **[P1] [bug]** Buffer partial SSE lines across chunks — `stream.rs` splits each network chunk with `text.lines()` and parses only lines starting with `data: `, so every event split across a chunk boundary is dropped (both halves fail), silently losing a share of edits and undercounting eps. Keep a carry-over byte buffer, split on `\n`, and handle multi-line `data:` fields per the SSE spec; done when a test feeding an event split at every byte offset parses it exactly once. (`src-tauri/src/stream.rs:319`)

## P1 · Web delivery, SEO & PWA (3)


### Meta tags, share cards and SEO

- [ ] **#085** **[P1] [seo]** Add Open Graph and Twitter card metadata to the root page — `#chart=…`/`#dive=…` links (the main phone share path) unfurl with only the root page's tags, and `out/index.html` has no `og:*`/`twitter:*`; add `metadataBase: new URL("https://loom.ibm.io")`, `openGraph: { title, description, images: ["/og.png"], type: "website", siteName: "Loom" }`, `twitter: { card: "summary_large_image" }`; done when `out/index.html` contains `og:image` and the Slack/iMessage unfurl shows a picture. (`src/app/layout.tsx:11-14`)
- [ ] **#086** **[P1] [seo]** Create `public/og.png` (1200×630, < 150 kB) from a real chart (reuse `docs/screenshots/loom-map.png`) — there is no `public/` directory at all today. (`next.config.mjs:8`)
- [ ] **#087** **[P1] [pwa]** Add favicon and touch icons — no `favicon.ico`/`icon.png`/`apple-icon.png`, and the SPA fallback serves `index.html` (200, text/html) for `/favicon.ico`; add `src/app/icon.png` (512) and `src/app/apple-icon.png` (180) generated from `src-tauri/icons/128x128@2x.png`/`icon.icns`; done when `out/` contains them and `curl -sI https://loom.ibm.io/favicon.ico` returns an image type. (`src/app/layout.tsx:11`)

## P1 · Build, CI & tooling (2)


### CI

- [ ] **#088** **[P1] [ci]** Add `.github/workflows/ci.yml` on `push`/`pull_request` — only a tag-triggered release workflow exists, so nothing checks main; job `web` (ubuntu-latest, `actions/setup-node` with `node-version-file: .nvmrc`, `cache: npm`): `npm ci` → `npx tsc --noEmit` → `npx eslint . --max-warnings=63` → `npx vitest run` → `npm run build` → bundle-budget script; done when a PR shows a green "web" check. (`.github/workflows/release-tauri.yml:10-13`)
- [ ] **#089** **[P1] [ci]** Catch untracked-file build breaks — `src/app/page.tsx` (modified) imports untracked `src/components/NeoSpaceIngest.tsx`; committing one without the other breaks the build, and only CI on a clean checkout would catch it; the `web` job above covers this — make it a required branch-protection check. (`src/app/page.tsx:36`)

## P1 · Tests (1)


### Testing

- [ ] **#090** **[P1] [test]** Add Playwright e2e for the phone journey — none exist; add `e2e/phone-share.spec.ts` (`devices["iPhone 14"]`, serve `out/` + `wrangler dev` with fixture-backed `/api/source/*`) covering: cold load shows chart CTA → tap "What's interesting right now" → chart renders (canvas non-blank) → Share sheet opens → "Copy chart link" yields `#chart=` URL that reopens the same chart; done when it runs in CI. (`docs/screenshots/README.md:13-17`)

---

# Phase 2 — P2: meaningful improvements


## P2 · Security & privacy (16)


### Dive builder & engine

- [ ] **#091** **[P2] [security]** Guard user regexes against catastrophic backtracking — `~`/`!~` filters and `regexp_*` derived columns compile user (and shared-link) patterns and run them over 30k rows on the main thread; a pattern like `(a+)+$` freezes the tab. Cap pattern length, reject nested quantifiers, or run in the worker with a timeout; done when `(a+)+$` on long strings can't hang the UI. (`src/lib/dive.ts:465`)

### Session resume, hydration & persistence

- [ ] **#092** **[P2] [security]** Ask before auto-fetching a URL from a shared link — a `#chart=` link with `url` makes `openSharedCsv` fetch any third-party URL through `/api/fetch-csv` on page load, with no prompt. Show "This link loads data from host.example — Load?" first; done when opening such a link makes no request until confirmed. (`src/components/WebSessionResume.tsx:116`)
- [ ] **#093** **[P2] [security]** Validate shared snapshot contents deeply — `parseShareDataSnapshot` passes through `rows` without checking cell types, `stats` as `ColumnInfo[]` unchecked, and `source.url` without a scheme check (it becomes the "Raw data" provenance link and a refetch URL). Check rows are arrays of primitives, cap sizes, and allow only `https:` URLs; done when a snapshot with object cells or a `javascript:` URL is rejected or cleaned. (`src/lib/shareLineage.ts:110`)

### Persistence & hydration

- [ ] **#094** **[P2] [security]** Validate persisted JSON instead of casting — `saved.theme as typeof prev.theme`, `fontScale` any number, `db as DashboardItem[]`, `c.chart as unknown as ChartViewItem["chart"]` let corrupt or stale values (unknown theme, fontScale 3, chart without `xField`) flow straight into rendering; add per-key schemas (zod or hand guards) and drop invalid entries. Done when a fuzz test of malformed storage never throws and yields defaults. (`src/components/HydrateStore.tsx:106`)

### Viz preferences, Ollama, IPC bridge, changelog

- [ ] **#095** **[P2] [security]** Validate payloads at the IPC/Worker boundary — `invoke<T>` trusts Rust results and webStreams parsers cast upstream bodies (`body as {…}`), so shape drift shows up as NaN charts deep in rendering; add lightweight runtime guards (zod or hand-written) for `InspectResult`, `SourceStatus`, and each source body, logging drift once per kind. Done when a malformed `/api/source/usgs` body produces a `last_error` like "Unexpected USGS response" instead of empty or NaN rows. (`src/lib/tauri.ts:31`)

### Tauri security (config, capabilities, IPC surface)

- [ ] **#096** **[P2] [security]** Gate custom commands with app-level permissions — capabilities only cover plugin permissions (`core/fs/dialog/shell`), while all 25 custom commands in `generate_handler!` are callable unconditionally. Declare an app manifest in `build.rs` (`tauri_build::Attributes::app_manifest`) and list allowed commands in `capabilities/default.json`; done when removing a command from the capability makes `invoke` fail. (`src-tauri/src/lib.rs:42`)
- [ ] **#097** **[P2] [security]** Remove the unused `tauri-plugin-fs` and `tauri-plugin-shell` (and their `fs:*` / `shell:*` permissions and `plugins.shell.open`) — the frontend never imports `@tauri-apps/plugin-fs` or `plugin-shell` (only `plugin-dialog`), so they are pure attack surface. Done when `Cargo.toml`, `lib.rs`, `capabilities/default.json`, `tauri.conf.json` and `package.json` no longer reference them and `make check` passes. (`src-tauri/capabilities/default.json:8`)
- [ ] **#098** **[P2] [security]** Validate `folder_path` in `save_csv_to_folder` against the currently mounted folder — the doc comment says it "only allows writing under the path the user picked", but any folder string from the webview is accepted. Keep the mounted folder in Rust state (set by `scan_folder`) and require `folder_path` to equal it; done when a call with another directory errors. (`src-tauri/src/commands.rs:122`)
- [ ] **#099** **[P2] [security]** Stop silently overwriting existing files in `save_csv_to_folder` — `File::create` truncates any same-named CSV (e.g. the user's own `data.csv`). Use `OpenOptions::create_new` and suffix `-1`, `-2` on conflict; done when saving twice yields two files. (`src-tauri/src/commands.rs:168`)
- [ ] **#100** **[P2] [security]** Restrict user SQL to a single read-only SELECT in `query_file` / `stream_query` / `source_query` — today any statement (`COPY … TO '/path'`, `ATTACH`, `INSTALL httpfs`, `SET`, multi-statement) is executed against the shared connection. Wrap as `SELECT * FROM (<user sql>) LIMIT n` and reject statements that fail to parse as a subquery; done when `COPY (SELECT 1) TO '/tmp/x.csv'` is rejected and tests cover it. (`src-tauri/src/db.rs:375`)

### Cloudflare Worker: /api/fetch-csv and catalog

- [ ] **#101** **[P2] [security]** Harden the SSRF host check and re-check redirects — `isBlockedHost` misses bracketed IPv6 (`new URL("http://[::1]").hostname === "[::1]"`), `127.0.0.0/8` beyond `.1`, `169.254.0.0/16`, `100.64.0.0/10`, `0.0.0.0/8`, `fc00::/7`, and `redirect: "follow"` lets any allowed host 302 to a blocked one. Parse IP literals properly, follow redirects manually (`redirect: "manual"`, ≤5 hops) re-validating each `Location`; done when tests cover each range and a redirect to a blocked host. (`workers/catalog-proxy.ts:119`)

### Cloudflare Worker: stories (/s/*), feedback, and abuse controls

- [ ] **#102** **[P2] [security]** Use a real distributed rate limiter — `rateBuckets` is an in-isolate `Map`, so limits reset per isolate/colo and are trivially bypassed by spreading requests; it guards stories (KV writes) and feedback (GitHub token). Use the Workers Rate Limiting binding (`ratelimits` in `wrangler.jsonc`) or a Durable Object counter; done when the 20/hour story limit holds across colos. (`workers/catalog-proxy.ts:73`)
- [ ] **#103** **[P2] [security]** Check request size before `request.json()` — `/api/stories` and `/api/feedback` parse the full body (up to the 100 MB platform limit) before validating `html.length`, costing CPU/memory per abusive request. Reject when `Content-Length` exceeds ~6 MB (stories) / 512 KB (feedback) and read with a capped stream; done when an oversized POST is rejected without parsing. (`workers/catalog-proxy.ts:839`)

### Docker, Makefile, scripts

- [ ] **#104** **[P2] [security]** Run the Docker image as a non-root user — the runner stage runs `serve` as root. Add `USER node` (the node image ships it) and keep files read-only; done when `docker compose exec loom-web id` shows uid 1000. (`Dockerfile:34`)

### Delivery: Workers static assets, caching, headers

- [ ] **#105** **[P2] [security]** Add baseline security headers for the app shell in `public/_headers` — `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `X-Frame-Options: SAMEORIGIN` (or CSP `frame-ancestors`). (`wrangler.jsonc:8`)
- [ ] **#106** **[P2] [security]** Roll out a Content-Security-Policy in Report-Only first — allow `self`, `fonts.googleapis.com`/`fonts.gstatic.com`, Socrata/GitHub raw/Wikimedia `connect-src`, `blob:`/`data:` images; switch to enforcing after a week of clean reports. (`wrangler.jsonc:8`)

## P2 · Charts — correctness & UX (38)


### WebGPU rendering correctness

- [ ] **#107** **[P2] [bug]** Make WebGPU point size DPR-aware — the shader treats `point_size` as device pixels (`half_x = size / viewport_width` with `viewport_width = canvas.width`), but ChartView passes CSS-px radii (`marks.maxR * 2`), so GPU dots are half the size of the Canvas fallback on retina phones. Multiply by `stageDpr()` (or pass DPR as a uniform); done when GPU and Canvas scatter of the same data show identical dot sizes at DPR 3. (`src/lib/webgpu.ts:297`)
- [ ] **#108** **[P2] [bug]** Lift the hard 8-colour palette cap in GPU paths — the palette buffer holds 8 RGB triples and the shader does `category % 8u`; `gpuScenes.ts:266` also folds categories with `% 8`, so the 9th category silently reuses the 1st colour with no legend to explain it. Size the palette buffer to `min(n, 32)` and fold the rest into an "Other" colour; done when a 12-category scatter shows 12 distinct colours (or 11 + Other) in both GPU and Canvas modes. (`src/lib/webgpu.ts:188`)
- [ ] **#109** **[P2] [bug]** Draw a legend for WebGPU scatter — the overlay pass draws frame, ticks, title and footnote, but never `drawLegend`, so a colour-encoded scatter loses its key as soon as WebGPU kicks in (Canvas fallback shows it). Reuse the legend path at ChartView.tsx:2459–2477 on the overlay canvas; done when toggling WebGPU on/off never changes the presence of the legend. (`src/components/ChartView.tsx:2583`)
- [ ] **#110** **[P2] [bug]** Draw the title on WebGPU scenes and globes — the scene branch only fills the background and paints the footnote on both layers; `drawChartTitleBlock` is never called, so firefly/scatter3d/globe charts have no headline on screen or in shares, while the Canvas fallback has one. Paint the title on the axes overlay in this branch; done when scatter3d shows the same title with and without WebGPU. (`src/components/ChartView.tsx:1910`)
- [ ] **#111** **[P2] [bug]** Build the GPU axes overlay from `chartRenderOpts` instead of raw `chartVisualOverrides` — the overlay uses `chartVisualOverrides.chartPadding ?? 56`, `axisFontSize ?? 10`, `showGrid !== false` and `ui.muted`, while the GPU points use `chartRenderOpts.chartPadding` (36/46 on compact/medium), `axisFontSize` 11, and grid off on compact/plain. Pad, fonts and grid differ between the two layers. Pass `chartRenderOpts` through; done when overlay and point layers compute the same `pad` at 360px and 1200px widths. (`src/components/ChartView.tsx:2586`)
- [ ] **#112** **[P2] [bug]** Handle `GPUDevice.lost` — none of the three renderers listen to `device.lost`, so after a GPU reset (common when iOS backgrounds Safari) the chart stays blank with `gpuReady` still true. Subscribe in `init()`, flip `gpuReady` false and re-init or fall back to Canvas; done when `device.destroy()` from devtools makes the chart repaint via Canvas. (`src/lib/webgpu.ts:92`)
- [ ] **#113** **[P2] [bug]** Guard `init()` against destroy-while-awaiting — ChartView destroys renderers on kind change while `init()` is still awaiting `requestAdapter`/`requestDevice`; the abandoned instance then creates a device and configures the shared canvas after `destroy()` ran, leaking the device and stealing the canvas context. Track a `destroyed` flag and `device.destroy()` on late resolve; done when rapid kind switching (10× in 1s) leaves at most one live device. (`src/lib/webgpu.ts:80`)
- [ ] **#114** **[P2] [code]** Share one GPU device/adapter module across `LoomRenderer`, `LoomSceneRenderer` and `LoomCubeRenderer` — each duplicates adapter/device acquisition, `parseColorToRgb` and palette packing (webgpu.ts:42, webgpuScenes.ts:89, webgpuCube.ts:60). Extract `src/lib/gpuDevice.ts` with a ref-counted device; done when the three classes take a device instead of requesting their own. (`src/lib/webgpuScenes.ts:92`)

### Canvas chart correctness

- [ ] **#115** **[P2] [bug]** Show the real row count in the "ghost" watermark — it prints `rows.length`, which is the density subsample (≤3,500) for scatter/bubble/hexbin/parallel, not the rows behind the chart. Use `sub.total` (or `chartSampleRows.rows.length`); done when a 20k-row scatter watermark reads 20,000. (`src/components/ChartView.tsx:2498`)
- [ ] **#116** **[P2] [bug]** Share scales across facet panels — each small-multiple cell calls `renderFullBar/Line/Area/Scatter` on its own rows, so every panel gets its own y (and x) domain and a short bar in one panel can be larger than a tall bar in another. Compute a global domain before the loop and pass it in (with an optional "independent scales" toggle); done when two facets with values 10 and 100 draw bars at 10% vs 100% height. (`src/components/ChartView.tsx:2228`)
- [ ] **#117** **[P2] [bug]** Title the axes in faceted mode — `drawAxisFieldLabels` is skipped when `useFacets` is true, so faceted charts have no x/y field names anywhere on the canvas or in exports. Draw one shared x title under the grid and a y title in the left gutter; done when a faceted bar export names both fields. (`src/components/ChartView.tsx:2176`)
- [ ] **#118** **[P2] [bug]** Respect `yAggregate` in the sunburst — inner values accumulate `agg === "count" ? 1 : v`, so mean/min/max silently become sums while the tooltip's `valueTitle` says "Average …". Collect value arrays per node and reuse `aggregateValues`; done when a sunburst with Mean shows the same numbers as the bar chart of the same fields. (`src/components/ChartView.tsx:6385`)
- [ ] **#119** **[P2] [bug]** Use contrasting ink for correlation-matrix values — cell labels use `opts.themeText`, so dark-theme white text sits on pale ramp cells (and vice versa), often below 3:1. Use `contrastingInk(fill)` as the heatmap does at ChartView.tsx:5161; done when every r label meets 4.5:1 against its cell in light and dark themes. (`src/components/ChartView.tsx:7036`)
- [ ] **#120** **[P2] [bug]** Use a diverging palette for correlation r — r ∈ [−1,1] is mapped onto `continuousStops` (a sequential ramp) and then faded by `0.35 + |r|·0.65` alpha, so −0.9 and +0.9 look like "light vs dark of the same hue" and r≈0 blends into the background. Use a diverging palette centred at 0, opaque fills, and a −1…+1 ramp key; done when the corrMatrix has a key and ±r read as opposite hues. (`src/components/ChartView.tsx:7021`)
- [ ] **#121** **[P2] [bug]** Make correlation-matrix tooltips work — its hit targets use `match: []` and no `rowIndex`, and `rowForHitTarget` returns null for that case, so hovering a cell never shows its `summary`. Let summary-only targets resolve (e.g. return `-1` and skip `setHoveredRowIndex`); done when hovering a cell shows "Row/Col/r". (`src/lib/chartTooltip.ts:161`)
- [ ] **#122** **[P2] [bug]** Avoid `Math.min(...values)` and `Math.max(...values)` on unbounded arrays — `aggregateValues` spreads every value in a group (also chartTooltip.ts:187 and oddCharts.ts:172), which throws `RangeError: Maximum call stack size exceeded` beyond ~120k values (e.g. min/max of a single-category bar over a big sample) and the draw `catch` then leaves a blank chart. Use a loop reducer; done when min/max over 500k values returns without throwing. (`src/components/ChartView.tsx:4247`)
- [ ] **#123** **[P2] [bug]** Guard MAD anomalies against zero spread and nulls — `anomalyMAD` divides by `mad(vals)` with no zero check (MAD=0 marks every non-median value as an anomaly), and both z-score/MAD use `Number(r[col])`, which turns `null`/`""` into 0 and counts them as data. Treat null/empty as missing and return [] when MAD is 0; done when a column with 60% identical values and some nulls yields no false anomalies. (`src/lib/smartAnalytics.ts:145`)
- [ ] **#124** **[P2] [bug]** Stop the y-axis title overlapping tick labels on narrow pads — `gx = max(fs*0.75+2, min(pad*0.38, pad-10, pad-46))` collapses to ~9px whenever `pad < 46` (the compact pad is 36), right where right-aligned tick labels like "1.5k" end. Measure the widest tick label and place the title left of it (or drop it below the plot on compact); done when a 360px-wide line chart shows no overlap between the rotated title and the tick labels. (`src/lib/chartLooks.ts:669`)
- [ ] **#125** **[P2] [bug]** Redraw after web fonts load — charts paint with `ctx.font = "... 'IBM Plex Sans'"` before Google Fonts finish loading (no `document.fonts` usage anywhere), so the first paint uses fallback metrics for gutters/ellipsis and never repaints when the font arrives. Bump `refreshKey` on `document.fonts.ready` and on `loadingdone`; done when choosing Libre Baskerville on a cold load repaints in that face without a manual Refresh. (`src/components/ChartView.tsx:2543`)
- [ ] **#126** **[P2] [bug]** Keep "paper"/"newsprint" backgrounds stable — `drawChartBackground` scatters 1,600–2,200 `Math.random()` specks on every paint, so the texture flickers on every hover/pan repaint and two exports of the same chart differ. Pre-render a seeded noise tile once and fill with `createPattern`; done when repeated redraws give pixel-identical backgrounds. (`src/lib/chartLooks.ts:85`)
- [ ] **#127** **[P2] [bug]** Fix the scatter mini-map viewport rectangle — `vx1`/`vy1` are computed and never used, and the rect is always drawn at `MW/2 - vw/2`, so the "you are here" box stays centred however far you pan. Position it from the effective bounds; done when panning to the top-left corner moves the box to the mini-map's top-left. (`src/components/ChartView.tsx:3401`)
- [ ] **#128** **[P2] [bug]** Make "Save as SVG" match what's on screen or say why not — the SVG handler compiles `vegaSpec`, but the visible chart is a custom Canvas renderer (looks, facets, overlays and odd/geo/GPU kinds aren't in the spec), and stream/source recs carry `spec: {}`, so compile fails and returns null with only a console warning. Disable SVG for kinds without a real spec and label it "Vega approximation" otherwise; done when the Export tab never offers an SVG button that silently fails. (`src/components/ChartView.tsx:1310`)
- [ ] **#129** **[P2] [bug]** Validate shared-link visual overrides before applying them — `cleanVisual` accepts any key matching `/^[A-Za-z]…/` with any string or number, and `ChartLinkSync` writes them straight into `chartVisualOverrides`, so a crafted `#chart=` link can set `pointSize: 1e6`, `chartPadding: -500` or an arbitrary `fontFamily` string. Whitelist keys and clamp ranges (reuse the DetailPanel option lists); done when a link with out-of-range values is clamped and unknown keys are dropped. (`src/lib/chartLink.ts:122`)

### PNG / export pipeline

- [ ] **#130** **[P2] [bug]** Share one WebGPU-eligibility predicate between the render and the export handler — the export copy of `useWebGPUScatter` omits `hasSmartOverlays`, `connectScatterTrail`, `showMarginals` and custom ref-lines, so with marginals on it composites a stale or blank WebGPU canvas over the Canvas-drawn scatter. Extract `canUseWebGpuScatter(state)` and call it in both places; done when exports with marginals/trail/overlays match the screen. (`src/components/ChartView.tsx:549`)

### Tooltips & hit testing

- [ ] **#131** **[P2] [code]** Delete the legacy per-kind geometry switch in `pickCanvasTooltipRowIndex` once every renderer registers hits — ~300 lines re-derive layouts with magic offsets (`- 20`, `- 24`, `w - 2*pad - 40`) that no longer match the renderers (e.g. box ranks by median, but the fallback sorts by `localeCompare`). Done when the function only handles `targets`, with a test that every `CHART_KIND_OPTIONS` kind paints at least one target. (`src/lib/chartTooltip.ts:577`)

### Interaction (scatter, orbit, keyboard)

- [ ] **#132** **[P2] [bug]** Stop `onMouseOut` from ending brush/lasso early — `onMouseOut={handleScatterMouseUp}` fires when the pointer crosses any child element, committing a half-drawn brush, while `onMouseLeave` cancels it and the window `mouseup` listener (ChartView.tsx:1541) ignores brush/lasso, so `brushStartRef` can get stuck. Use pointer capture (`setPointerCapture`) and finalize only on `pointerup`/`pointercancel`; done when dragging a brush outside the chart and releasing still selects the covered points. (`src/components/ChartView.tsx:3225`)
- [ ] **#133** **[P2] [bug]** Select all rows inside a lasso or brush, not only the drawn subsample — selection iterates `scatterDataRef.points`, which in the WebGPU path holds only the ≤4,500 subsampled points, so dense charts under-select and the "N points lassoed" toast is wrong. Test against the full `extractScatterData` result; done when brushing the whole plot of a 20k-row scatter selects 20k rows. (`src/components/ChartView.tsx:1706`)
- [ ] **#134** **[P2] [bug]** Make orbit wheel-zoom block page scroll — the stage's React `onWheel` calls `e.preventDefault()`, but React registers wheel listeners as passive, so the browser logs a warning and the page scrolls while zooming a globe or cube. Attach a native `{ passive: false }` listener as the scatter overlay does (ChartView.tsx:1613); done when wheel over a 3D scene zooms without scrolling the panel. (`src/components/ChartView.tsx:3114`)
- [ ] **#135** **[P2] [bug]** Scope the global chart shortcuts — the window `keydown` handler grabs `L` (and calls `preventDefault`) even with ⌘/Ctrl held, breaking ⌘L/Ctrl+L (address bar) while a tooltip is visible; its arrow/+/− handling also fires when a `<select>` or button elsewhere has focus (only INPUT/TEXTAREA/contentEditable are excluded). Bail on modifier keys before the `L` branch, exclude SELECT/role=listbox, and require focus inside the stage for arrows; done when ⌘L works and arrow keys in the Detail panel selects don't pan the scatter. (`src/components/ChartView.tsx:975`)
- [ ] **#136** **[P2] [bug]** Play the entrance animation once per chart, not on every redraw — with `animateEntrance` on, the 600ms wipe re-runs whenever the giant draw effect re-fires (pan, zoom, title edit, theme, smart results), so panning a scatter replays the wipe each frame. Key the animation on `activeChart.id` and skip it for interaction-driven repaints; done when panning never re-triggers the clip wipe. (`src/components/ChartView.tsx:2525`)

### Empty, loading & error states

- [ ] **#137** **[P2] [ux]** Show an error state when a renderer throws — `drawOneFrame` catches every exception with `console.warn("Chart draw error")` and leaves a half-painted or blank canvas. Draw an in-canvas message ("This chart couldn't render — try another encoding") with a retry, and log to the existing toast; done when forcing a throw in `renderFullBar` shows a visible message. (`src/components/ChartView.tsx:2519`)
- [ ] **#138** **[P2] [ux]** Replace silent early returns in Canvas renderers with empty-state messages — `renderFullRadar` (<3 numeric axes), `renderFullNetwork`/`renderFullArcDiagram` (no Color/target), `renderFullScatter` (`yi < 0`) and `renderFullHistogram` (`!bins`) just return, leaving a framed, titled, empty plot. Return a reason string like `renderOddChart` does and paint it with `drawEmptyMessage`; done when each case shows a one-line hint naming the missing field. (`src/components/ChartView.tsx:5962`)
- [ ] **#139** **[P2] [ux]** Add a loading state while sample rows load — the draw effect returns when `sampleRows` is null, so after picking a dataset the stage is a blank theme-coloured box with no spinner (common on phones over slow networks). Render a skeleton/"Loading rows…" overlay when `selectedFile && !sampleRows`; done when a throttled 3G load shows progress instead of an empty stage. (`src/components/ChartView.tsx:1812`)
- [ ] **#140** **[P2] [ux]** Fold categories beyond the palette into "Other" — scatter/strip/legend colour by `cols[cat % cols.length]`, so a 20-category colour field repeats colours and the fallback legend (ChartView.tsx:2470) lists duplicate swatches for different labels. Cap distinct colours at palette size, group the tail as "Other", and say so in the legend; done when no two legend entries share a swatch. (`src/components/ChartView.tsx:4194`)

### Maintainability

- [ ] **#141** **[P2] [code]** Split ChartView.tsx into hooks and components — the 7,532-line file mixes stage sizing, three GPU renderer lifecycles, export handlers, scatter/orbit/cube interactions, keyboard shortcuts, toolbar JSX and 30+ renderers. Extract `useChartStage`, `useGpuRenderers`, `useScatterInteractions`, `useChartExport`, `useChartShortcuts`, and `ChartToolbar`/`SuggestionRail`/`ChartTooltip` components; done when ChartView.tsx is under 1,000 lines and each hook has a single concern. (`src/components/ChartView.tsx:189`)
- [ ] **#142** **[P2] [code]** Move the Canvas renderers out of the component file — `renderFull*` (ChartView.tsx:3512–7532) are pure functions but unexported, so they can't be unit-tested or reused by thumbnails/exports. Move them to `src/lib/canvasCharts/*.ts` behind one `renderCanvasChart(kind, ctx, …)` dispatcher; done when ChartView imports the dispatcher and a test file imports individual renderers. (`src/components/ChartView.tsx:3512`)
- [ ] **#143** **[P2] [code]** Consolidate duplicated chart helpers — `aggregateValues` (ChartView.tsx:4242, chartTooltip.ts:182, oddCharts.ts:~165), `numRange` (ChartView.tsx:4017, chartTooltip.ts:192, ChartCard `numericRange`), `quartiles` (ChartView.tsx:5264, ChartCard.tsx:1060), `roundedBox`/`roundedRect` (ChartView.tsx:3850/7524) and `isNumericType` vs `inferVegaType` vs `columnLooksTemporal` each exist in several variants with different edge cases (e.g. chartTooltip's `numRange` returns `[0,1]` for empty data, ChartView's returns `[Infinity,-Infinity]±1`). Move them to `chartAxes.ts`/`dsTransforms.ts`; done when each helper has one exported implementation with tests. (`src/components/ChartView.tsx:4242`)
- [ ] **#144** **[P2] [code]** Render thumbnails with the full renderers in "mini" mode — ChartCard's ~1,400-line `paintKind` re-implements every kind and has drifted: `drawBar` hard-codes `agg = "sum"` (ignores `yAggregate`) and always sorts by value even for years/hours, `drawForceBubble` seeds with `Math.random()`, and log Y isn't applied although the card shows a "log Y" badge. Reuse the extracted renderers with a `mini` flag (as `renderOddChart` already supports); done when a thumbnail and the full chart of the same rec use the same aggregation and order. (`src/components/ChartCard.tsx:835`)

## P2 · Data ingest & live feeds (24)


### Web CSV parsing & type inference

- [ ] **#145** **[P2] [bug]** Normalize cells to the inferred column type — DOUBLE columns keep stray strings and VARCHAR columns keep numbers because coercion happens per cell before typing; after choosing the type, map DOUBLE cells to `number | null` and VARCHAR cells back to their original trimmed strings. Done when every column's cells match its declared type in a mixed fixture. (`src/lib/mock-data.ts:299`)
- [ ] **#146** **[P2] [bug]** Tighten `coerceCsvNumber` — it ends with `Number(s)`, which accepts hex (`"0x1A"` → 26, verified), binary/octal literals and `"Infinity"` handling quirks, and it doesn't parse accounting negatives `"(1,234)"`; gate with a decimal/exponent regex and add parentheses-negative support. Done when tests cover hex → null and `(1,234)` → -1234. (`src/lib/mock-data.ts:250`)
- [ ] **#147** **[P2] [bug]** Treat common null tokens as null — only `""`/`null` are nulled, so `N/A`, `NA`, `n/a`, `..`, `—`, `#N/A` (frequent in gov data) stay as strings and can push a numeric column under the 50% threshold to VARCHAR. Done when a column with 40% `N/A` and 60% numbers types as DOUBLE with nulls. (`src/lib/mock-data.ts:289`)
- [ ] **#148** **[P2] [bug]** Infer DATE/TIMESTAMP for web CSVs — all non-numeric columns become VARCHAR, so time charts depend on `inferType`'s fragile name heuristics; mark columns as DATE/TIMESTAMP when ≥80% of non-null values parse as ISO date/datetime. Done when a `when` column of ISO dates yields a line chart in `recommend()` without a date-like name. (`src/lib/mock-data.ts:299`)
- [ ] **#149** **[P2] [bug]** Compute real min/max for text columns — `statsFromData` reports the first and last row as min/max for non-numeric columns, so ISO date columns show wrong ranges (used by chart time spans and Stats); compute lexicographic min/max (correct for ISO strings) and leave other text null. Done when an unsorted date column reports its true earliest/latest. (`src/lib/mock-data.ts:86`)
- [ ] **#150** **[P2] [bug]** Avoid argument-spread min/max — `Math.min(...nums)` / `Math.max(...nums)` spread up to 60k values (and 12k in webStreams.ts:107), close to JavaScriptCore's ~65k argument limit on iOS; replace with a loop. Done when a 100k-row test computes stats without RangeError. (`src/lib/mock-data.ts:86`)
- [ ] **#151** **[P2] [bug]** De-duplicate header names — duplicate or blank headers (two `value` columns, trailing empty header) are kept verbatim, and every `columns.indexOf(name)` lookup then resolves to the first one; rename to `value_2`, `column_3`. Done when a duplicate-header fixture yields unique column names and distinct values per column. (`src/lib/mock-data.ts:278`)
- [ ] **#152** **[P2] [ux]** Stop silent mock fallbacks on web — `mockInspect`/`mockQuery` return the scatter demo for any unknown path, and `queryFile` on web ignores the SQL entirely (tauri.ts:72), so a web Query run "succeeds" with the raw table; throw for unknown paths and reject SQL on web like `streamQuery` does. Done when web Query shows an explicit "SQL needs the desktop app" error. (`src/lib/mock-data.ts:95`)
- [ ] **#153** **[P2] [bug]** Seed demo data — `generateScatterData`/`generateSalesData` use `Math.random` at module load, so a shared `#chart=` link to `mock://sales.csv` opens with different numbers for the recipient; use a seeded PRNG (e.g. mulberry32 with a fixed seed). Done when two module loads produce identical demo rows. (`src/lib/mock-data.ts:59`)

### Live buffers & polling (web)

- [ ] **#154** **[P2] [bug]** Prevent overlapping polls — `setInterval` fires regardless of an in-flight poll (12 s Worker timeout, 20 s direct debt fetch), so slow responses can land out of order and an older replace-mode body overwrites newer data; schedule the next poll with `setTimeout` after completion and abort the previous controller. Done when a test with a slow first response never applies it after a newer one. (`src/lib/webStreams.ts:1100`)
- [ ] **#155** **[P2] [ux]** Track data freshness — `BufferState`/status expose `lastError` but no `lastSuccessAt`, so cards and chart footers can't say "updated 3 min ago" or flag stale data after failures; add `last_success_at` (and stale threshold = 3× pollMs) to SourceStatus. Done when a card shows "stale" after three failed polls. (`src/lib/webStreams.ts:134`)
- [ ] **#156** **[P2] [bug]** Make events/sec side-effect free — `statusFromBuffer` mutates `lastCountAt` on every call, so the rate depends on who asked last (Sidebar every 2–3 s, discover, Onboarding) and spikes or reads 0; maintain a rolling-window counter updated in `pushRows`. Done when two back-to-back status calls return the same rate. (`src/lib/webStreams.ts:139`)
- [ ] **#157** **[P2] [bug]** Reset rate counters on clear — `webSourceClear` / `webStreamClear` zero `totalEvents` but keep `lastCountAt.count`, so the next status reports a negative `events_per_sec`; reset `lastCountAt` too. Done when a test clear → status returns `events_per_sec >= 0`. (`src/lib/webStreams.ts:1132`)
- [ ] **#158** **[P2] [bug]** Honor registry `orderBy` in web snapshots — `snapshotFromBuffer` just reverses insertion order while desktop applies `SourceDef.orderBy`, so "newest first" for replace feeds depends on upstream order and the launches hook's `strAt(sample, 0, "name")` (discoverStories.ts:567) isn't the next launch; implement a small comparator from the `orderBy` string. Done when web and desktop snapshot order match for every source in a registry-driven test. (`src/lib/webStreams.ts:122`)
- [ ] **#159** **[P2] [bug]** Compute snapshot stats over the returned rows — stats cover the whole buffer while `sample` is `limit` rows (discover asks for 300/400), so distinct/null counts and min/max describe rows the chart never sees and can mis-steer `recommend()`. Done when `stats.null_count` equals nulls in `sample.rows` for a capped snapshot. (`src/lib/webStreams.ts:121`)
- [ ] **#160** **[P2] [bug]** Fix text min/max in buffer stats — for non-numeric columns min/max are the first/last inserted value, so TIMESTAMP columns of feeds delivered newest-first report the newest time as `min_value`; compute lexicographic min/max for ISO timestamps. Done when USGS `ts` min < max in a fixture test. (`src/lib/webStreams.ts:105`)
- [ ] **#161** **[P2] [bug]** Don't put missing quakes at Null Island — `parseUsgs` writes `0` for missing latitude/longitude/depth, plotting them at 0°,0° on every map; emit `null`. Done when a feature without geometry yields null coordinates. (`src/lib/webStreams.ts:213`)
- [ ] **#162** **[P2] [bug]** Emit null, not "", for missing strings — many parsers use `String(x ?? "")` (parseUsgs place/magType, all of parseNws, parseHn, parseCrypto…), creating blank-label bars and inflating distinct counts; route VARCHAR cells through `strCell`. Done when no parser emits `""` for an absent upstream field in fixture tests. (`src/lib/webStreams.ts:211`)
- [ ] **#163** **[P2] [bug]** Use null change for FX `/latest` — the latest-rates shape sets `change_pct` to `0`, which charts and hooks read as "no move" instead of "unknown"; emit `null`. Done when the latest-shape fixture yields null change_pct. (`src/lib/webStreams.ts:459`)
- [ ] **#164** **[P2] [bug]** Normalize every TIMESTAMP through `isoOrNull` — parseNws (effective/expires), parseHn, parseLobsters, parseFema, parseSpacex, parseLaunches store raw upstream strings (with offsets or none) while other feeds store UTC ISO, so time windows and string comparisons (e.g. `ts > newestTs`) mix formats. Done when every TIMESTAMP column in parser fixtures ends with `Z`. (`src/lib/webStreams.ts:242`)
- [ ] **#165** **[P2] [bug]** Parse space-separated naive timestamps as UTC — `isoOrNull("2026-10-07 12:00:00")` skips the `T` branch and goes through `Date.parse` in the device's local zone, so values shift by the viewer's timezone; replace the space with `T` and append `Z` for naive strings. Done when a test under `TZ=America/Los_Angeles` and `TZ=UTC` yields the same ISO. (`src/lib/webStreams.ts:272`)
- [ ] **#166** **[P2] [bug]** Use the numeric recent-change id for Wikipedia events — `parseWikiEvent` strips non-digits from the `meta.id` UUID and `Number()`s it (20-digit floats, lossy), falling back to `Date.now()` which can collide; use the event's numeric `id` (or keep `meta.id` as a string dedupe key). Done when ids are exact integers or stable strings and two events in the same ms aren't deduped. (`src/lib/webStreams.ts:1007`)
- [ ] **#167** **[P2] [ux]** Map fetch failures to friendly copy — `fetchSourceJson` surfaces `Source x failed (502)` or a raw JSON `SyntaxError` when an HTML fallback is served, and AbortError shows as "signal is aborted"; check `content-type`, and map 429/5xx/timeout/offline to messages like "Rate-limited upstream — retrying in 2 min". Done when each case has a unit test with the expected message. (`src/lib/webStreams.ts:184`)

### Source registry & duplicated logic

- [ ] **#168** **[P2] [code]** Fold merge strategy into SourceDef — `SOURCE_MERGE` is a parallel table keyed by SourceKind with dedupe keys as column indexes (`key: 0`), so adding a source touches another file and reordering columns silently breaks dedupe; add `merge: { mode, key: "id" }` (by column name) to each SourceDef. Done when SOURCE_MERGE is deleted and the registry test asserts every merge key is a real column. (`src/lib/webStreams.ts:918`)

## P2 · State & persistence (11)


### Store architecture & selectors

- [ ] **#169** **[P2] [bug]** Guard `startDeepScan` against stale snapshots — it captures `s` before a rAF + 40 ms delay, then writes `chartRecs: result.deck.length ? result.deck : s.chartRecs` and `vizScanStatus: "ready"` even if the user closed the deck or opened another file meanwhile; add a scan token and re-read `get()` inside `run`, aborting if `vizSwipeOpen` is false or the file path changed. Done when a fake-timer test closing the deck mid-scan leaves `chartRecs` untouched. (`src/lib/store.ts:1224`)
- [ ] **#170** **[P2] [bug]** Apply stack mode on swipe-to-keep — `swipeViz` sets `activeChart` directly and skips the `barStackMode` sync that `setActiveChart` performs (store.ts:745), so kept stacked/100% bar recs render grouped; route through shared `selectChartPatch(rec)`. Done when a test swiping right on a `barStackMode: "percent"` rec sets `barStackMode === "percent"`. (`src/lib/store.ts:1298`)
- [ ] **#171** **[P2] [bug]** Fix `applyChartView` file mismatch — when the view's file is not in `files` (live feeds, web CSVs) it keeps the previous `selectedFile` (`file || s.selectedFile`) while replacing `sampleRows` with the snapshot, so the header, provenance card and share links point at the wrong dataset; it also leaves `smartResults`/`barStackMode` from the prior chart. Synthesize a FileEntry from `filePath`/`fileName` and reset chart-scoped state. Done when a test applies a view for an unopened `stream://usgs` and `selectedFile.path === "stream://usgs"`. (`src/lib/store.ts:1059`)
- [ ] **#172** **[P2] [bug]** Return null when `createStoryDashboard` fails — on the catch path the setter returns `s` but the action returns `get().activeDashboardId ?? dbId`, i.e. the previous dashboard's id, so callers navigate to the wrong dashboard; track a success flag like `addChartView`. Done when a test forcing JSON clone failure gets `null`. (`src/lib/store.ts:1035`)
- [ ] **#173** **[P2] [bug]** Replace `Date.now()` ids — table views, annotations, pinned tooltips, ref lines, snapshots, query views, dashboards and dashboard slots (`v-`, `ann-`, `pt-`, `rl-`, `snap-`, `qv-`, `db-`, `ds-${Date.now()}`) collide when two are created in the same millisecond (e.g. rapid taps, scripted story creation); add a `newId(prefix)` helper using `crypto.randomUUID()`. Done when no `${Date.now()}`-only id remains in store.ts. (`src/lib/store.ts:852`)
- [ ] **#174** **[P2] [bug]** Cascade deletes to dashboard slots — `removeChartView` / `removeTableView` / `removeQueryView` leave slots whose `viewId` no longer exists, which render as empty tiles and persist forever; filter slots across `dashboards` in the same `set`. Done when a test removing a chart view leaves no slot referencing it. (`src/lib/store.ts:1037`)
- [ ] **#175** **[P2] [code]** Stop storing `vegaSpec` separately from `activeChart.spec` — `setActiveChart` copies `chart.spec` into `vegaSpec`, but the independent `setVegaSpec` setter lets them drift (e.g. Sidebar sets `setVegaSpec(null)` separately); derive the spec via selector or remove the setter. Done when `setVegaSpec` has no callers outside tests. (`src/lib/store.ts:318`)

### Persistence & hydration

- [ ] **#176** **[P2] [bug]** Strip row snapshots from persisted table views — HydrateStore passes full store `TableViewItem`s (including `snapshotData` rows and `querySql`) to `setPersistedTableViews`, while persist's `TableViewItem` type claims they are absent; 20 views × sample rows can blow the quota. Persist only UI state (or move snapshots to IndexedDB) and make the persist type match. Done when the persisted JSON contains no `rows`. (`src/lib/persist.ts:192`)
- [ ] **#177** **[P2] [bug]** Persist chart-view `querySql` and a data plan — `ChartViewItemPersist` omits `querySql` and `snapshotData`, so after reload story dashboards built from live feeds (which only had `createStoryDashboard`'s snapshot) render empty and SQL-backed views lose their query. Persist `querySql`, and either a capped snapshot in IndexedDB or a `needsRefresh` flag the dashboard UI honors. Done when a reloaded USGS story dashboard shows data or a clear "Refresh data" prompt. (`src/lib/persist.ts:215`)
- [ ] **#178** **[P2] [bug]** Don't persist defaults on first visit — the `appSettings` persist effect runs in the same commit as hydration with the default value, so a first visit writes `reducedMotion: false` and default theme, and from then on `saved` exists so the OS prefers-reduced-motion and the ibm.tools shared theme (lines 113–136) are never consulted again. Persist only user-changed keys (or `reducedMotion: "auto"`). Done when toggling OS reduce-motion after the first visit is respected on next load. (`src/components/HydrateStore.tsx:200`)
- [ ] **#179** **[P2] [code]** Version persisted keys — none of the 11 `loom-*` keys carry a schema version and the theme rename is an ad-hoc inline migration; wrap values as `{ v, data }` with a `MIGRATIONS[key][v]` table run in the getters. Done when a test upgrades a v0 `loom-app-settings` with `theme: "high-contrast"` via the migration table, not HydrateStore. (`src/lib/persist.ts:8`)

## P2 · Recommendations & discover (21)


### Discover stories

- [ ] **#180** **[P2] [ux]** Report which feeds failed — `withTimeout` resolves null after 10 s while the probe keeps running, and both probes `catch { return [] }`, so the modal can't say "3 feeds unavailable" and late probes still start sources; thread an AbortSignal and return `{ kind, stories, error }`. Done when the Onboarding hint shows a failed-feed count from a stubbed failure. (`src/lib/discoverStories.ts:964`)
- [ ] **#181** **[P2] [bug]** Use one Kp→G mapping — the spaceweather hook uses `Math.floor(peak) - 4` while the `storm_level` column uses `stormLevel()`'s `Math.round`, so Kp 4.67 shows "Quiet sun" in the headline while the chart says G1; call `stormLevel(peak)`. Done when a fixture with Kp 4.67 headlines a G1 storm. (`src/lib/discoverStories.ts:613`)
- [ ] **#182** **[P2] [bug]** Don't headline forecasts as current weather — the meteo hook takes the max temperature over all rows, including today's forecast hours, and says "X hottest at …" as if now; restrict to each city's latest row with `ts <= now`. Done when a fixture with a hotter future hour headlines the current reading. (`src/lib/discoverStories.ts:309`)
- [ ] **#183** **[P2] [bug]** Scan all FEMA rows for the newest declaration — the hook only looks at the first 40 rows, which (with insertion-order snapshots) need not contain the newest; scan every row. Done when a fixture whose newest declaration is row 150 headlines it. (`src/lib/discoverStories.ts:444`)
- [ ] **#184** **[P2] [code]** Replace the 720-line `hookFor` if-chain with a typed map — `const HOOKS: Record<DiscoverKind, HookFn>` (one small function per feed, ideally colocated with each source's story) gives compile-time exhaustiveness and testable units. Done when adding a SourceKind without a hook fails `tsc`. (`src/lib/discoverStories.ts:127`)

### Recommendation quality

- [ ] **#185** **[P2] [ux]** Only index ratio-scale measures to 100 — "Temp indexed to 100" divides °C by a starting value that can be ~0 or negative, producing meaningless ratios, and the expander adds `idx100` to every line (2857) including single series; require strictly positive values and ≥2 series. Done when meteo's story no longer ships an indexed temperature chart. (`src/lib/recommendations.ts:3379`)
- [ ] **#186** **[P2] [ux]** Run curated story charts through the same cardinality guards — `mk()` bypasses `fitEncodingToKind`, so "Bot vs Human" is colored by ~300 wikis and "Edits faceted by wiki" makes ~300 panels (3193–3196), HN/Lobsters scatters are colored/faceted by author (3430–3432, 3734–3735), and COVID stacks continents by ~200 countries (3547); cap color/facet fields at 12 or attach `topN`. Done when a test asserts every curated rec's color/row field has ≤12 distinct values or a topN. (`src/lib/recommendations.ts:3196`)
- [ ] **#187** **[P2] [ux]** Replace the per-satellite beeswarm — Starlink "Mean motion swarm" uses `object_name` (~7k satellites) as the category axis, one band per satellite; use a binned shell (e.g. inclination rounded) or a histogram. Done when the Starlink story has no chart with >40 categories on an axis. (`src/lib/recommendations.ts:3727`)
- [ ] **#188** **[P2] [ux]** Stop "one of every kind" from dominating the rail — `diversifyRecommendations` pass 0 inserts the best rec of each of ~70 kinds before anything else, so with `limit = 72` the rail is ordered by kind and odd/GPU charts outrank the second-best bar or line; restrict pass 0 to kinds within ~25 points of the top score or to ~8 slots. Done when a sales fixture's top 10 has ≥2 bar/line recs and no rec scoring <50. (`src/lib/recommendations.ts:335`)
- [ ] **#189** **[P2] [ux]** Gate and cap auto variants — `expandRecommendationsWithExtras` adds up to ~10 variants per line (roll7, roll30, idx100, zscore, logy, anom, vs-y2/prev, two time windows, facet) without checking data (30-point rolling on 20 points, zscore on one series); require enough points/series per variant and cap variants per base rec at 3. Done when a 20-point single-series line yields ≤3 variants. (`src/lib/recommendations.ts:2817`)
- [ ] **#190** **[P2] [bug]** Make `recommend()` deterministic — odd/cube/geo kinds are shuffled with the biased `.sort(() => Math.random() - 0.5)` and given random scores (1922–1960), and `mergeStoryCharts` uses random encodings (3278), so the rail reorders on every open and shared-link restore/tests can flake; seed a PRNG from the schema signature. Done when two `recommend()` calls on the same input return identical ids in order. (`src/lib/recommendations.ts:1922`)
- [ ] **#191** **[P2] [ux]** Align line vs area default aggregates — line defaults to mean while area defaults to sum (and `effectiveYAggregate` repeats the split), so switching a chart from line to area silently changes the numbers; choose one default per measure semantics (mean for rates, sum for counts/amounts) shared by both. Done when line→area on the same encoding keeps the same aggregate. (`src/lib/recommendations.ts:778`)
- [ ] **#192** **[P2] [bug]** Carry time windows through random builds and locks — `tryBuildRandomChartRec` hand-builds `extra` without `timeWindowField`/`timeWindow` (2616–2629), and `applyEncodingLocks` drops them too (2154–2171), so the window drawn in `withRandomEncodingExtras` never reaches the chart; use `randomEncodingToExtra` and copy the fields in the lock merge. Done when a seeded random draw with a window yields a rec with that window. (`src/lib/recommendations.ts:2616`)
- [ ] **#193** **[P2] [ux]** Don't draw lines across unordered names — `getRandomEncoding` for line/area falls back to any nominal column as X when there is no time column (`pick(timeCols.length > 0 ? timeCols : nomCols)`), producing lines across e.g. city names; return null (or allow only ordinal-looking small columns). Done when shuffle on a no-time schema never returns line/area over a free-text column. (`src/lib/recommendations.ts:2317`)
- [ ] **#194** **[P2] [ux]** Emit one distribution chart per (category, measure) — strip, box, violin and ridgeline are all generated for the same pairs (1461, 1489, 1634, 1732), so four near-identical distribution charts crowd the rail; pick one by group size/n (strip for small n, box for many groups, violin/ridgeline for ≤10 groups with n≥50) and leave the rest to the type picker. Done when no rail contains more than one distribution kind for the same pair. (`src/lib/recommendations.ts:1461`)

### Recommendations — maintainability & performance

- [ ] **#195** **[P2] [code]** Split recommendations.ts (3.9k lines) — type inference, scoring, `createChartRec`, random encodings, variant expansion, 34 curated source stories and SQL snippets share one file; move to `recs/columns.ts`, `recs/createChartRec.ts`, `recs/recommend.ts`, `recs/random.ts`, `recs/expand.ts`, `sourceStories/<kind>.ts`, `sqlSnippets.ts`, re-exporting the public API from recommendations.ts. Done when no file exceeds ~800 lines and all importers compile unchanged. (`src/lib/recommendations.ts:1`)
- [ ] **#196** **[P2] [code]** Classify columns once — `columns.filter(c => inferType(...))` runs three times in ~10 functions (585, 1137, 2180, 2278, 2485, 2694) and vizPreferences keeps its own, drifted copy of the dtype table (missing UBIGINT/UINTEGER, vizPreferences.ts:73); add a shared `classifyColumns(columns)` (memoized by array identity) used by both modules. Done when `inferType` has a single implementation imported by vizPreferences. (`src/lib/recommendations.ts:585`)
- [ ] **#197** **[P2] [code]** Centralize the "dataset loaded → recommend → select" pipeline — the sequence `setColumnStats → setSampleRows → recommend → setChartRecs → setActiveChart` is copy-pasted ~12 times (Sidebar.tsx:204/275/336/396, WebSessionResume.tsx:95/259/313, NeoSpaceIngest.tsx:140, QueryView.tsx:131) with subtle differences; expose one store action (pairs with the `openDataset` reset) taking `{ file, inspect, story? }`. Done when those call sites invoke the action and the per-dataset reset happens everywhere. (`src/lib/store.ts:738`)

### Viz preferences, Ollama, IPC bridge, changelog

- [ ] **#198** **[P2] [bug]** Fix word boundaries in preference tags — `isTemporalLike`/`isGeoLike`/`isIdLike` use `\b`, but `_` is a word character, so `created_date`, `acq_ts`, `start_lat`, `station_id` never match and swipes on most real columns learn nothing for those tags; split names on `[_\W]` before matching. Done when tests show `created_date` → temporalLike and `start_lat` → geoLike. (`src/lib/vizPreferences.ts:58`)
- [ ] **#199** **[P2] [code]** Single source of truth for the preference model — the model lives in both `store.vizPreferences` and a module-level `cachedModel`, synced by hand in four places (store.ts:1220/1285, HydrateStore.tsx:187/335) and `swipeViz` also writes localStorage directly; have `recommend()` receive prefs from the store (or have the cache subscribe to it) and keep one persistence writer. Done when `setCachedVizPreferences` is called from one place. (`src/lib/vizPreferences.ts:237`)
- [ ] **#200** **[P2] [bug]** Keep Ollama model tags and add a timeout — `listOllamaModels` strips `:tag` (`llama3.2:1b` → `llama3.2`), which 404s when only a tagged variant is installed, and `/api/generate` has no AbortController, so a hung local model leaves the UI waiting forever; keep the full name, use `AbortSignal.timeout(30_000)`, and return a typed failure reason (unreachable / model missing / bad JSON) for the toast. Done when tests cover each failure reason. (`src/lib/ollama.ts:28`)

## P2 · Explorer, Query, Dive & Cube (23)


### Explorer data table

- [ ] **#201** **[P2] [bug]** Fix numeric range filter for negative numbers — `f.includes("-")` then `split("-")` turns "-5" into `["", "5"]`, and `Number("")` is 0, so "-5" filters to [0,5]; "5-" yields b=0. Parse with a regex like `^(-?\d*\.?\d+)?\s*(?:\.\.|–|to)\s*(-?\d*\.?\d+)?$` and treat bare numbers as equality; done when "-5" matches -5 and "-10..-2" matches that range. (`src/components/ExplorerView.tsx:327`)
- [ ] **#202** **[P2] [bug]** Make the sort comparator total and null-aware — `Number(null)`/`Number("")` are 0 and `Number(true)` is 1, so blanks sort among zeros, and mixing numeric diffs with `localeCompare` for mixed columns gives an inconsistent order. Sort nulls last, compare by column type, use `Intl.Collator({numeric:true})`, and add the declared-but-unused third "unsorted" click state; done when blanks always sit at the end in both directions. (`src/components/ExplorerView.tsx:264`)
- [ ] **#203** **[P2] [bug]** Keep column order when hiding a column — `columnOrder` is applied only when `columnOrder.length === list.length`, so after a drag-reorder, hiding any column silently reverts to source order. Apply order by rank regardless of length; done when reorder → hide → show preserves the custom order. (`src/components/ExplorerView.tsx:186`)
- [ ] **#204** **[P2] [bug]** Put column visibility changes on the undo stack — the Columns checkboxes and "Reset to all" call `setTablePrefs` without `pushTableUndo`, so ↶ can't undo hiding a column (only drags and view applies). Done when hide-column → Undo restores it. (`src/components/ExplorerView.tsx:668`)
- [ ] **#205** **[P2] [bug]** Scope table prefs per dataset — `tablePrefs.visibleColumns/columnOrder` is a single global (persisted) value, so hiding `id` in one file hides `id` in every other file with that column. Key prefs by `selectedFile.path` (or schema signature); done when two files keep independent column setups across reloads. (`src/components/ExplorerView.tsx:182`)
- [ ] **#206** **[P2] [bug]** Keep selections stable on live streams — selection is stored as indices into `sampleRows.rows`, which shift each time a poll/SSE snapshot replaces the sample, so checked rows silently become different rows. Pause updates while rows are selected or key selection by a row identity; done when selected rows stay the same across 3 refreshes. (`src/components/ExplorerView.tsx:423`)
- [ ] **#207** **[P2] [ux]** Say the table is a sample — the header shows the file's total `row_count` while the grid, filters and sort only cover `sampleRows`, so "No rows match" can be wrong for the full file. Show "Showing 1,000 of 2.4M rows (sample)" and point to Query for full-table filtering; done when sampled datasets show the sample size beside the total. (`src/components/ExplorerView.tsx:547`)
- [ ] **#208** **[P2] [ux]** Add column resizing and full-value reveal — every cell is clamped to `max-w-[200px] truncate` and the only full value is a `title` tooltip (unavailable on touch). Add drag-to-resize header handles (persisted per file) and a tap/Enter cell-detail popover; done when a 400-char cell can be read on a phone. (`src/components/ExplorerView.tsx:469`)
- [ ] **#209** **[P2] [ux]** Export the current view, not just selected rows — the only CSV export in Explorer is for selected rows and it writes all raw columns in source order. Add "Export filtered view" honouring visible columns, order and filters; done when the exported header matches the on-screen columns. (`src/components/ExplorerView.tsx:561`)

### SQL query view

- [ ] **#210** **[P2] [bug]** Reset the editor SQL when the dataset changes — `localSql` is initialised once from `querySql || defaultSql`, so after switching from `stream://wiki` to a CSV the editor still targets `wiki_stream`. Reset to the new default (or keep SQL per path) on `selectedFile.path` change; done when switching files shows the right table name. (`src/components/QueryView.tsx:44`)
- [ ] **#211** **[P2] [bug]** Show the right table name in the schema panel and header — they always say/insert `loom_active`, even for streams and poll sources where the table is `wiki_stream` or `sourceTable`. Use the resolved table name; done when clicking the table chip on a USGS source inserts its real table. (`src/components/QueryView.tsx:372`)
- [ ] **#212** **[P2] [bug]** Quote identifiers inserted from the schema list — `insertAtCursor(col.name)` inserts raw names, so `Trip Distance` or `order` produces invalid SQL. Use the same `ident()` quoting as `dive.ts`; done when clicking a spaced column yields `"Trip Distance"`. (`src/components/QueryView.tsx:380`)
- [ ] **#213** **[P2] [ux]** Say when results are capped — every query runs with a hard 10,000-row limit but the header prints `total_rows` with no truncation notice, and Export CSV silently exports only those rows. Show "first 10,000 of N" and offer a full export on desktop; done when a capped result is labelled as capped. (`src/components/QueryView.tsx:438`)
- [ ] **#214** **[P2] [bug]** Remove the magic sticky offset on result headers — `th` uses `sticky top-7` to sit below the toolbar, but the toolbar is `flex-wrap`, so when it wraps to two lines the column headers slide under it. Put toolbar and header in one sticky container or measure the toolbar height; done when headers stay visible with a wrapped toolbar at 800px width. (`src/components/QueryView.tsx:488`)
- [ ] **#215** **[P2] [ux]** Add SQL syntax highlighting and autocomplete — the editor is a plain `textarea` with no highlighting, completion of tables/columns, bracket matching or Tab indent. Lazy-load a light CodeMirror 6 + `@codemirror/lang-sql` fed by `columnStats`; done when typing `SELECT tr` suggests matching columns. (`src/components/QueryView.tsx:340`)

### Dive builder & engine

- [ ] **#216** **[P2] [bug]** Align weekly buckets to Mondays — `bucketFloor` floors `(t + off)` to multiples of 7 days from the Unix epoch, which was a Thursday, so "per 1 week" buckets run Thu–Wed while `timeTicks` puts week ticks on Mondays and DuckDB's `time_bucket` (shown in SQL) uses Monday 2000-01-03. Floor weeks to local Monday midnight; done when weekly buckets start on Mondays and match the SQL preview. (`src/lib/dive.ts:599`)
- [ ] **#217** **[P2] [bug]** Keep daily buckets on local midnight across DST — buckets are `first + i * bucketMs` with one fixed offset, so after a DST change day buckets start at 23:00 or 01:00 and labels drift by an hour. Generate day/week buckets with calendar arithmetic (`setDate`); done when a series crossing a DST change has every bucket at 00:00. (`src/lib/dive.ts:730`)
- [ ] **#218** **[P2] [bug]** Stop `formatDiveNumber` showing tiny values as "0" — `toFixed(3)` then stripping zeros turns 0.0004 into "0", and non-integers below 10k skip thousands separators ("1234.5" vs "1,234"). Use `Intl.NumberFormat` with `maximumSignificantDigits` and grouping; done when 0.0004 → "0.0004" and 1234.5 → "1,234.5". (`src/lib/dive.ts:1012`)
- [ ] **#219** **[P2] [bug]** Read newest rows for desktop poll sources — `loadDiveDataset` runs `SELECT * FROM ${table}` with no ORDER BY, so on large tables the 30k-row cap returns arbitrary rows, not the newest ones the header comment promises. Append the registry's `orderBy`; done when Dive on a busy source shows the latest timestamps. (`src/lib/diveSource.ts:58`)
- [ ] **#220** **[P2] [ux]** Ask before replacing the chart data with "Open as cube" — `openCube` calls `setSampleRows` with up to 20k filtered dive rows, silently replacing the dataset that Explorer, Chart and Share use. Use a separate chart-data slot or show an undoable toast; done when returning to Explorer after a cube shows the original sample or offers to restore it. (`src/components/DiveView.tsx:327`)

### Dive time series & chip input

- [ ] **#221** **[P2] [bug]** Keep the pinned crosshair across live refreshes — the `[series]` effect resets `pinned` and `hover` whenever `series` changes identity, which happens on every 5 s live refresh, so a pinned readout vanishes mid-read. Only reset when series keys or bucket size change; done when a pinned crosshair survives 3 refreshes. (`src/components/DiveTimeSeries.tsx:162`)

### Data cube pivot

- [ ] **#222** **[P2] [bug]** Use one time zone for cube time labels — `asTime` parses naive strings as local time (date-only ones as UTC), but `formatTime` labels with `getUTC*`, so a US user sees "Mar 1 05:00"-style labels shifted by their offset. Reuse `toTime` from `dive.ts` and format in local time; done when bin labels match the raw values for naive timestamps. (`src/lib/dataCube.ts:111`)

### Swipe discovery deck

- [ ] **#223** **[P2] [ux]** Add "Undo last swipe" — a mis-swipe on a phone is permanent (the preference model learns from it right away). Keep the last decision and offer Undo for a few seconds (store-level `unswipeViz`); done when an accidental Skip can be undone and the preference event is rolled back. (`src/components/VizSwipeDeck.tsx:84`)

## P2 · Share & export (9)


### Share sheet & capture

- [ ] **#224** **[P2] [bug]** Don't share a stale image after a failed re-render — when a new capture starts the old `blob` is kept, and on failure `ready` is still true (`!!blob && !capturing`), so "Share image" sends the previous format/headline. Clear `blob` when a capture starts or gate actions on `!failed`; done when a failed Story render disables Share. (`src/components/ShareSheet.tsx:115`)
- [ ] **#225** **[P2] [bug]** Restore all UI state after a capture — `captureNow` forces `setViewMode("chart")` and `setDashboardsExpanded(false)` but its `finally` restores only target, aspect and sidebar, so sharing from an expanded dashboard or another view leaves the user somewhere else. Snapshot and restore both; done when capture from an expanded dashboard returns to it. (`src/lib/capturePlatformPng.ts:132`)
- [ ] **#226** **[P2] [bug]** Serialize story preview and carousel captures with share captures — `captureOne` and `exportStoryCarouselZip` call `applyChartView` and read `pngExportHandler` outside `captureChain`, so they can run alongside a share-sheet capture and restore each other's forced sizes. Route them through the same queue; done when overlapping a carousel export and the share sheet produces correct images. (`src/lib/captureStoryPreviews.ts:104`)
- [ ] **#227** **[P2] [bug]** Always clear the preview-capture overlay — `captureStoryDashboardPreviews` has no try/finally, so an exception inside the loop leaves `previewCapture` set and the dashboards collapsed. Wrap in try/finally like `captureChartViewPreview`; done when a thrown handler still clears the overlay. (`src/lib/captureStoryPreviews.ts:170`)
- [ ] **#228** **[P2] [bug]** Restore the active chart after a carousel export — each slide calls `applyChartView(cid)`, leaving the last slide's chart active afterwards. Snapshot `activeChart`/overrides first and restore in `finally`; done when the user's chart is unchanged after exporting a pack. (`src/lib/exportStoryCarousel.ts:67`)
- [ ] **#229** **[P2] [code]** De-duplicate capture helpers — `afterPaint`, `sleep`, `waitForPngHandler`, `looksLikeFailedCapture` and `blobToDataUrl` are copy-pasted across `capturePlatformPng.ts`, `captureStoryPreviews.ts` and `exportStoryCarousel.ts`. Keep one module; done when each helper exists once. (`src/lib/captureStoryPreviews.ts:11`)

### Share pages & social export

- [ ] **#230** **[P2] [bug]** Use hosted URLs for microsite og:image — `buildDashboardMicrositeHtml` puts the data URL straight into `og:image`/`twitter:image`; unfurlers ignore `data:` URLs, so dashboard links get no preview (the chart share page already uses `LOOM_OG_IMG_TOKEN`). Use the same token rewrite; done when a published dashboard unfurls with an image in Slack. (`src/lib/dashboardMicrosite.ts:78`)

### CSV / ZIP export

- [ ] **#231** **[P2] [bug]** Delay `revokeObjectURL` after starting a download — `downloadCsv` and `downloadBlob` revoke the URL right after `a.click()`, which can cancel the download in Firefox and Safari. Revoke in `setTimeout(…, 30_000)` (or on focus) and append the anchor to the DOM; done when large CSV/ZIP downloads finish in Safari and Firefox. (`src/lib/csvExport.ts:34`)
- [ ] **#232** **[P2] [bug]** Add a UTF-8 BOM for Excel — without `﻿`, Excel on Windows/Mac opens the CSV as Windows-1252 and mangles accents and emoji. Prepend the BOM (toggle for purists); done when "São Paulo" opens correctly in Excel. (`src/lib/csvExport.ts:28`)

## P2 · Catalogs, sessions & formatting (5)


### Public catalogs & remote CSV

- [ ] **#233** **[P2] [ux]** Add "Load more" to Socrata results — searches are fixed at `limit: 30` with no paging, so long-tail datasets can't be reached. Pass `offset` to the Discovery API and append; done when "Load more" fetches results 31–60. (`src/components/PublicCatalogSections.tsx:104`)
- [ ] **#234** **[P2] [bug]** Don't retry non-retryable CSV errors on the fallback origin — `fetchCsvTextWeb` catches *every* error, including the xlsx guard and upstream 4xx, then downloads the whole file again from `DEFAULT_CATALOG_ORIGIN`, doubling data use and replacing the useful message. Retry only on network failure / 404 from same-origin; done when an xlsx URL makes one request and shows the xlsx message. (`src/lib/openDataCatalog.ts:395`)
- [ ] **#235** **[P2] [ux]** Add timeouts and cancellation to catalog fetches — `fetchJsonDatasets`, `fetchCsvTextWeb`, `searchSocrata` and `fetchTidyTuesdayIndex` have no `AbortSignal`/timeout, so a hung upstream leaves "Loading…" forever and stale searches keep downloading. Thread an `AbortController` (cancel on new search/unmount, 20 s timeout); done when changing the query aborts the previous request. (`src/lib/openDataCatalog.ts:377`)

### Deep scan

- [ ] **#236** **[P2] [bug]** Stop name heuristics marking text columns as temporal — `inferType` checks `name.includes("TS")`, `"DAY"` etc., so VARCHAR columns like `PRODUCTS`, `COMMENTS`, `ACCOUNTS`, `EVENTS` or `HOLIDAY_NAME` are profiled as temporal and get no category charts. Match whole tokens (`/(^|_)(ts|date|time|…)(_|$)/i`) and confirm with a parse rate; done when `products` profiles as nominal in a deepScan test. (`src/lib/deepScan.ts:78`)
- [ ] **#237** **[P2] [bug]** Don't divide full-table distinct counts by sample size — `distinctRatio` uses `col.distinct_count` (whole file) over `nonNull.length` (sample), clamped to 1, so sampled datasets look high-cardinality and drop out of nominal-pair scoring (`distinctRatio < 0.5`). Compute distinct over the same sample; done when a 2M-row file with 12 regions keeps a low distinct ratio. (`src/lib/deepScan.ts:179`)

## P2 · App shell, panels & NeoSpace handoff (44)


### NeoSpace handoff

- [ ] **#238** **[P2] [bug]** Fix the ready-ping target origin — `(window.opener).location.origin` always throws for a real cross-origin opener, so the code always falls back to `https://neospace.ibm.io`, and preview (`*.neospace-dc4.pages.dev`) or localhost NeoSpace never receives `loom-neospace-ready`. Take the origin from `document.referrer` (or an `?origin=` param), validate it with isAllowedOrigin, and post only to that. Done when a preview deploy completes the handshake. (`src/components/NeoSpaceIngest.tsx:65`)
- [ ] **#239** **[P2] [bug]** Restrict the localhost origin allowance to dev builds — isAllowedOrigin accepts any port on `localhost`/`127.0.0.1` over any scheme in production, so any local page that opens Loom can inject datasets. Gate it behind `process.env.NODE_ENV !== "production"` and require `https:` for non-local hosts. Done when a unit test shows `http://localhost:9999` is rejected in a production build. (`src/components/NeoSpaceIngest.tsx:41`)
- [ ] **#240** **[P2] [bug]** Attach the message listener only during a handoff — the `message` listener is attached on every visit, so any allowed-origin opener or frame can replace the user's open dataset at any point in the session. Register it only when `fromNeo` is true, and remove it after the first ingest or a 30s timeout. Done when visiting `/` without the param registers no listener. (`src/components/NeoSpaceIngest.tsx:188`)

### Root layout & document

- [ ] **#241** **[P2] [bug]** Load Geist or stop offering it — "Geist" appears in the Typeface setting (lookSystem.ts:88) and the chart font list (DetailPanel.tsx:4192) but is missing from the font link, so it silently renders as Inter or the system fallback. Add the face or remove the option. Done when choosing Geist visibly changes the type. (`src/app/layout.tsx:37`)

### App shell (page.tsx)

- [ ] **#242** **[P2] [bug]** Ignore global shortcuts while a modal is open — the keydown handler switches views on 1–4 and toggles drawers on `[`/`]` even when Onboarding, WhatsNew, ShareSheet or the focused-slot view is open, changing the screen underneath. Return early when an `[aria-modal="true"]` element exists (or from a store flag). Done when pressing 2 inside WhatsNew does nothing. (`src/app/page.tsx:512`)
- [ ] **#243** **[P2] [bug]** Use panel-tab shortcuts the browser doesn't claim — ⌘/Ctrl+1–6 is taken by tab switching in most browsers, so the documented shortcut (page.tsx:694) doesn't reach the web build. Switch to Alt+1–6 (or only advertise it on Tauri) and update the help text. Done when the shortcut works in Chrome on the web build. (`src/app/page.tsx:535`)
- [ ] **#244** **[P2] [bug]** Make Escape close only the topmost layer — one Escape both closes Help and exits share-ready, so dismissing a nested dialog during share-ready also exits the frame. Close only the top layer (dialog stack or a `defaultPrevented` check). Done when Escape in PromptDialog during share-ready keeps the frame. (`src/app/page.tsx:527`)
- [ ] **#245** **[P2] [ux]** Make Help reachable on phones — the `?` button is `hidden sm:flex` (TopBar.tsx:246) and there's no keyboard, yet the dialog includes phone-only gesture help (`md:hidden`, page.tsx:698) that nobody on a phone can open. Add a Help/Shortcuts entry to the mobile sidebar or the Settings tab. Done when a 375px user can open Help. (`src/app/page.tsx:698`)
- [ ] **#246** **[P2] [ux]** Keep one feedback flow — the Help → Feedback tab and the FeedbackNotes FAB both file GitHub issues but with different image caps (48k vs 350k chars), title rules and kinds. Keep FeedbackNotes and have the Help tab open it. Done when only one feedback form exists. (`src/app/page.tsx:718`)
- [ ] **#247** **[P2] [code]** Move Help and image helpers out of page.tsx — `readFileAsDataUrl`/`shrinkImageDataUrlForGithub` duplicate FeedbackNotes.tsx:32-73, and the 130-line Help dialog lives inside HomeContent. Move them to `components/HelpDialog.tsx` and `lib/imageShrink.ts`. Done when page.tsx is layout only (<300 lines). (`src/app/page.tsx:421`)
- [ ] **#248** **[P2] [ux]** Make dashboard Refresh do something, or remove it — the "Refresh" button only stamps `lastRefreshedAt` (title says "Mark as refreshed now"), and the interval select schedules nothing (same in DetailPanel.tsx:434/447). Either re-snapshot slots on the interval or drop both controls. Done when picking "1 min" actually refreshes previews, or the control is gone. (`src/app/page.tsx:187`)

### Sidebar

- [ ] **#249** **[P2] [bug]** Keep live-feed status polling alive when the sidebar closes — polling lives in per-card `setInterval`s that are cleared on unmount (Sidebar.tsx:930, :624), Sidebar returns null when closed (Sidebar.tsx:417), and nothing restarts polling on remount. Reopened cards show frozen counts, and Explore stays disabled if the buffer was 0 at connect. Move polling into one store-level poller keyed by running kinds. Done when closing and reopening the sidebar shows live counts. (`src/components/Sidebar.tsx:417`)
- [ ] **#250** **[P2] [bug]** Stop "Open CSVs" from wiping earlier web files — handleLoadFiles replaces the whole `webFileCache` and `files` list, so previously explored web or NeoSpace files lose their cache and show "can't be reopened" in Recent. Merge into the existing cache like handleLoadRemoteCsv does (Sidebar.tsx:383). Done when an explored pack still reopens after uploading a local CSV. (`src/components/Sidebar.tsx:325`)
- [ ] **#251** **[P2] [bug]** Handle uploads with no CSV — selecting only non-CSV files sets mountedFolder to `web://`, wipes the file list and shows nothing; parse errors only `console.error` (Sidebar.tsx:346). Toast "No CSV files found" and keep the prior list. Done when choosing a .xlsx produces a message and no data loss. (`src/components/Sidebar.tsx:306`)
- [ ] **#252** **[P2] [ux]** Show folder and save errors to the user — pick-folder, rescan and save-to-folder failures only `console.error` (Sidebar.tsx:92, :105, :1426), so the spinner stops with no explanation. Toast `ipcErrorMessage(e)`. Done when a denied folder shows an error toast. (`src/components/Sidebar.tsx:92`)
- [ ] **#253** **[P2] [ux]** Make "Drop CSVs here" true — the lede invites dropping files but the Sidebar has no onDragOver/onDrop handlers. Add a drop zone to the Open files section (and ideally the empty canvas), or change the copy. Done when dropping a CSV opens it. (`src/components/Sidebar.tsx:1504`)
- [ ] **#254** **[P2] [bug]** Open external links through the Tauri bridge — DatasetPreviewModal uses `window.open` (Sidebar.tsx:597) and many raw `<a target=_blank>` links (Sidebar.tsx:1068, 1155, 1612, 1748, 1794-1828), while ProvenanceCard routes through `openExternalUrl`. On desktop these may not reach the system browser. Add one `openExternal()` helper and use it everywhere. Done when every Sidebar link opens the system browser in Tauri. (`src/components/Sidebar.tsx:597`)
- [ ] **#255** **[P2] [code]** Move hard-coded catalog data into lib — CURATED_OPEN_PACKS (100 lines) and the "More portals" list are data inside a component. Move them to `src/lib/openDataCatalog.ts` with a test that URLs are https and ids are unique. Done when Sidebar imports them. (`src/components/Sidebar.tsx:798`)
- [ ] **#256** **[P2] [code]** Split Sidebar.tsx — break the 2.1k-line file into `components/sidebar/{FilesView,DataRegionView,SourceCard,WikiStreamSection,DiscoverDatasetCard,DatasetPreviewModal,CkanDiscoverToolbar}.tsx`. Done when Sidebar.tsx is under 400 lines. (`src/components/Sidebar.tsx:1301`)
- [ ] **#257** **[P2] [code]** Render Wikipedia with the generic feed card — WikiStreamSection duplicates SourceCard's connect, poll, explore and clear logic and UI (Sidebar.tsx:614-791 vs 917-1079). Model wiki as a registry-like entry rendered by one LiveFeedCard. Done when one component renders all live feeds. (`src/components/Sidebar.tsx:614`)

### DetailPanel — structure & performance

- [ ] **#258** **[P2] [code]** Split DetailPanel.tsx — break the 4.6k-line file into `components/panel/{DashboardsTab,SettingsTab,StatsTab,ExportTab,SmartTab,chart/EncodingSection,chart/VisualSection}.tsx`. Done when DetailPanel.tsx is just the tab shell (<250 lines). (`src/components/DetailPanel.tsx:109`)
- [ ] **#259** **[P2] [code]** Collapse the ten apply* callbacks into one rebuild helper — each repeats `createChartRec(kind, columnStats, x, y, color, tableName, {...extraFromChart(), patch})`, and `extraFromChart` carries 23 hand-listed deps (:2648). Add a pure `chartRecExtras(rec)` in lib with a test and one `rebuild(patch)` helper. Done when the apply* callbacks are 2–3 lines each. (`src/components/DetailPanel.tsx:2740`)
- [ ] **#260** **[P2] [bug]** Recognise all numeric column types — numeric detection is hard-coded twice (DetailPanel.tsx:2215, :3105) as INTEGER/BIGINT/FLOAT/DOUBLE/DECIMAL/REAL, so SMALLINT, TINYINT, HUGEINT and UBIGINT columns are missing from Size, Compare Y and the Smart pickers. Share a tested `isNumericType` (dataCube.ts:438 already has one). Done when a SMALLINT column appears in Size options. (`src/components/DetailPanel.tsx:3105`)

### DetailPanel — mobile sheet & tabs

- [ ] **#261** **[P2] [ux]** Replace the "Select a file to inspect" dead end — web users have no files to select. Reuse the StartHere CTA (discover scan / browse data) in this empty state. Done when the empty Stats tab offers "What's interesting right now". (`src/components/DetailPanel.tsx:195`)

### DetailPanel — Dashboards tab

- [ ] **#262** **[P2] [bug]** Allow stream dashboards on the web — "Stream dashboard" refuses on web with "require the desktop app", but streamSnapshot has a web implementation (tauri.ts:202) and the sidebar Wikipedia card works on web. Remove the `checkTauri()` gate. Done when a stream dashboard builds in the browser. (`src/components/DetailPanel.tsx:292`)
- [ ] **#263** **[P2] [code]** Build microsite HTML in one place — slot-to-microsite code is copied three times (:329 handleExportMicrosite, :1803 handleStoryBundle, :1872 handlePublishStory), and the last two look up chartViews only, so table and query slots get raw ids as labels. Extract `buildDashboardMicrositeForId()` into lib/dashboardMicrosite.ts with a test. Done when all three call it and query slots show names. (`src/components/DetailPanel.tsx:1803`)

### DetailPanel — Settings tab

- [ ] **#264** **[P2] [ux]** Add a "System" theme option — there's no theme that follows prefers-color-scheme (ThemeApplicator.tsx:41 only normalizes the stored theme), so everyone defaults to dark. Add Auto and resolve it through a matchMedia listener. Done when OS light mode with Auto renders the light theme. (`src/components/DetailPanel.tsx:827`)
- [ ] **#265** **[P2] [ux]** Add a reset for look settings — with 13 themes, 9 chromes, fonts and scale there's no "Reset to defaults", so users can get stuck in hard-to-read combinations. Add a reset button to Settings. Done when one tap restores the default look. (`src/components/DetailPanel.tsx:945`)
- [ ] **#266** **[P2] [bug]** Handle OS reduced-motion in one place and keep it live — the OS check is duplicated in ThemeApplicator.tsx:25-38 and HydrateStore.tsx:113-135 and runs only before settings are saved. After that, JS motion in ChartView and VizSwipeDeck ignores later OS changes. Make reducedMotion `system|on|off`, resolved by one matchMedia listener. Done when toggling the OS setting changes chart animation without a reload. (`src/components/ThemeApplicator.tsx:25`)

### DetailPanel — Stats / Export / Smart

- [ ] **#267** **[P2] [bug]** Don't report a copy that failed — handleCopyChartConfig calls `void navigator.clipboard.writeText` and shows "Copied!" even when the promise rejects, and handleCopySpec (:2734) has no catch. Await the write (or use copyTextToClipboard) and show the error. Done when a denied clipboard shows an error instead of "Copied!". (`src/components/DetailPanel.tsx:1719`)
- [ ] **#268** **[P2] [bug]** Always leave the social frame after video export — handleExportVideo returns early when no canvas is found without clearing `socialExportTarget`, so the app stays stuck in the frame. Move the reset into `finally`. Done when a failed video export restores the normal chart frame. (`src/components/DetailPanel.tsx:1931`)
- [ ] **#269** **[P2] [bug]** Restore the user's chart aspect after share-ready — the share-ready toggle and video export write the preset aspect into the persisted `appSettings.chartAspect` (:1742, :1923) and never put it back. Remember the previous aspect and restore it on exit. Done when exiting share-ready returns to the previous aspect. (`src/components/DetailPanel.tsx:1742`)
- [ ] **#270** **[P2] [ux]** Organise the Export tab and name the target dashboard — 10+ identically styled full-width buttons mix per-chart and per-dashboard actions, and the dashboard actions silently use `activeDashboardId ?? dashboards[0]` (:1760, :1793, :1862). Group them under "This chart" and "Story: <dashboard name>". Done when users can see which dashboard will be exported. (`src/components/DetailPanel.tsx:2051`)
- [ ] **#271** **[P2] [ux]** Confirm before publishing a public link — "Publish story link" uploads to the Worker and copies a public URL without saying it's public. Add a confirm step that states visibility and how to remove it. Done when publishing needs an explicit confirm. (`src/components/DetailPanel.tsx:1861`)
- [ ] **#272** **[P2] [bug]** Show disabled and empty-result states on Smart "Run" — the buttons have no disabled styling (:2338, 2383, 2397, 2444, 2469), so disabled looks enabled, and when runAnomaly etc. return null nothing happens. Add `disabled:opacity-50` and a "No result for this column" toast. Done when an unrunnable card looks disabled and an empty result explains itself. (`src/components/DetailPanel.tsx:2338`)
- [ ] **#273** **[P2] [bug]** Clamp the Smart number inputs — `Number("")` becomes 0, so horizon, threshold and k can be 0 or out of range (:2329, :2364, :2461). Clamp to min/max on change. Done when clearing the k field can't run k-means with k=0. (`src/components/DetailPanel.tsx:2461`)

### DetailPanel — Chart encoding & visual controls

- [ ] **#274** **[P2] [bug]** Validate the reference-line input with a single form — two PromptDialogs are chained with `setTimeout(50)`, an empty value becomes `Number("")=0` and adds a line at 0, NaN is ignored silently, and the remove × (:3785) has no aria-label. Use one small form (number + label) with validation. Done when an empty value shows an error and no line at 0 appears. (`src/components/DetailPanel.tsx:3764`)
- [ ] **#275** **[P2] [ux]** Add a reset for visual overrides — the Visual tab has dozens of overrides but no "Reset to defaults", only presets that replace everything. Add a reset button at the top. Done when one tap restores the default look for the chart. (`src/components/DetailPanel.tsx:3843`)

### Overlays & small shell components

- [ ] **#276** **[P2] [bug]** Show toasts above modals — Toast is `z-[130]` while Onboarding is `z-[200]` and WhatsNew `z-[210]`, so "Couldn't open: …" from openStory (Onboarding.tsx:323) is hidden behind the overlay. Define a z-index scale in tailwind.config.ts (values from 35 to 210 are scattered across the shell) with toast on top. Done when the openStory error toast is visible over Onboarding. (`src/components/Toast.tsx:26`)
- [ ] **#277** **[P2] [bug]** Handle failed confirms and accidental backdrop taps in PromptDialog — `handleConfirm` chains `.then()` with no catch, so a rejected onConfirm leaves the dialog stuck open with no error, and a backdrop tap (:54) cancels and discards typed text on phones. Add a catch with an inline error, and don't dismiss on backdrop when the value is dirty. Done when a failing save shows an error and keeps the dialog. (`src/components/PromptDialog.tsx:40`)
- [ ] **#278** **[P2] [ux]** Reposition the feedback button — on desktop the FAB sits bottom-left (left .75rem, bottom 2rem) over the sidebar file list and status bar, and on phones in chart view it's offset by a magic `11.5rem` that duplicates MOBILE_LIVE_EDIT_SHEET (useMediaQuery.ts:44). Anchor it to the main canvas and derive the offset from the constant. Done when it never covers sidebar rows. (`src/components/FeedbackNotes.tsx:163`)
- [ ] **#279** **[P2] [bug]** Make SuiteMenu links safe in the desktop app — they are plain anchors: the current "loom" item (`https://loom.ibm.io/`, no target) navigates (or is blocked from navigating) the Tauri webview away from the app, and the others rely on `target=_blank`. Use `openExternal` on Tauri and render the current item as non-link text. Done when clicking items in the desktop app opens the system browser and never replaces the app. (`src/components/SuiteMenu.tsx:134`)

### Shared primitives & tests

- [ ] **#280** **[P2] [code]** Create shared Dialog and Sheet components — the overlay markup (fixed inset-0 loom-overlay, stopPropagation card, `rounded-t-2xl sm:rounded-xl`, safe-bottom margin) is copied in page.tsx:651, PromptDialog.tsx:53, WhatsNew.tsx:115, Onboarding.tsx:377, FeedbackNotes.tsx:178 and Sidebar.tsx:541, each with different focus and Escape gaps. Add `components/ui/Dialog.tsx` and `Sheet.tsx` and migrate those copies. Done when all six use it. (`src/components/PromptDialog.tsx:53`)
- [ ] **#281** **[P2] [code]** Create a shared Button component — long button class strings are copied, e.g. the accent-outline "text-2xs py-1 px-2.5 … border-loom-accent bg-loom-accent/10 text-loom-accent" about 10 times in Sidebar and "w-full px-3 py-2 text-xs font-medium … bg-loom-elevated border" about 12 times in ExportView. Add `components/ui/Button.tsx` with variants (primary, ghost, accent-outline, danger) and sizes (sm, md, tap). Done when those copies are replaced. (`src/components/DetailPanel.tsx:2059`)

## P2 · Speed & performance (66)


### WebGPU rendering correctness

- [ ] **#282** **[P2] [perf]** Destroy the device in `LoomSceneRenderer.destroy` and `LoomCubeRenderer.destroy` — both null the reference but never call `device.destroy()` or `context.unconfigure()`, unlike `LoomRenderer`, so every scene/cube kind switch leaks a GPUDevice until GC. Done when switching scatter3d↔dataCube 20× keeps a single device in `chrome://gpu` stats. (`src/lib/webgpuScenes.ts:314`)
- [ ] **#283** **[P2] [perf]** Stop re-creating a WebGPU device on every kind change — the init effect destroys and re-inits a `LoomRenderer` (new adapter + device + pipelines) whenever `activeChart.kind` changes, even bar→line where WebGPU is never used. Init lazily only for kinds that can use it and keep one device across kinds; done when bar→line→pie triggers zero `requestDevice` calls. (`src/components/ChartView.tsx:1093`)

### Tooltips & hit testing

- [ ] **#284** **[P2] [perf]** Build tooltip summaries lazily — `renderFullScatter` allocates two arrays, a `match` array and a `summary` object per point on every paint (3,500+ objects per pan frame), and bubble/strip do the same. Store `{cx,cy,r,rowIndex}` only and build the summary in `handleCanvas2DPointerMove` for the picked target; done when a pan frame allocates O(1) objects per point. (`src/components/ChartView.tsx:4226`)
- [ ] **#285** **[P2] [perf]** Throttle pointer and wheel handlers to animation frames — `onMouseMove`/`onPointerMove` call `setScatterTooltip`/`setChartTooltip`/`setHoveredRowIndex` per event, and wheel events call `setScatterView` per event, each triggering a full React render (and a full canvas repaint for wheel). Coalesce into one rAF per frame; done when a 120Hz trackpad pan produces ≤60 repaints/s. (`src/components/ChartView.tsx:1556`)

### Interaction (scatter, orbit, keyboard)

- [ ] **#286** **[P2] [perf]** Keep crosshair and lasso pointer state local — `setCrosshairPos` and `setLassoPoints([...lassoPoints, p])` write to the global Zustand store on every mousemove (the lasso copies a growing array, O(n²)), re-rendering every store subscriber. Hold them in refs/local state and publish only the final selection; done when drawing a 500-point lasso causes no store writes until mouseup. (`src/components/ChartView.tsx:1641`)

### Performance — React & bundle

- [ ] **#287** **[P2] [perf]** Memoize ChartCard and its click handler — ChartView renders `chartRecs.map(rec => <ChartCard onClick={() => selectRecommendation(rec)} …/>)`, so every ChartView render (hover, crosshair) re-renders every card. Wrap `ChartCard` in `React.memo` and pass `rec.id` + a stable `onSelect`; done when hovering the main chart doesn't re-render cards in the Profiler. (`src/components/ChartView.tsx:2864`)
- [ ] **#288** **[P2] [perf]** Stop the data-cube pivot animation from re-rendering ChartView every frame — `setCubeAnim(t)` runs per rAF for 650ms, re-rendering the whole component and re-running the full draw effect. Drive the tween from a ref inside a dedicated rAF that calls the cube draw directly; done when a pivot animation causes ≤2 React renders. (`src/components/ChartView.tsx:653`)
- [ ] **#289** **[P2] [perf]** Memoize `extractScatterData` output — it walks every row and is called up to three times per scatter paint (main GPU branch, Canvas branch at ChartView.tsx:2216, and the overlay effect at 2584) on every pan/zoom, since `useCallback` only memoizes the function. Turn it into a `useMemo` value keyed on rows + encoding; done when a pan frame does no row iteration for scatter extraction. (`src/components/ChartView.tsx:1752`)
- [ ] **#290** **[P2] [perf]** Place the "auto" legend without `getImageData` — `drawLegend` reads back four canvas regions on every paint to score corners, forcing a GPU→CPU sync (slow on mobile Safari) on each pan/hover repaint. Score corners from the registered hit targets/marks instead; done when legend placement does no pixel readback. (`src/components/ChartView.tsx:3784`)
- [ ] **#291** **[P2] [perf]** Draw map geometry directly to the context — basemap and choropleth loops do `new Path2D(path(f))`, i.e. d3 builds an SVG path string per feature that the browser re-parses, on every paint (and every orbit move for orthographic maps). Use `geoPath(projection, ctx)` and cache projected `Path2D`s per projection key; done when a choropleth repaint is under 8ms on a mid-range phone. (`src/lib/geoMaps.ts:534`)
- [ ] **#292** **[P2] [perf]** Coalesce Canvas repaints into one per frame — the 2D draw effect repaints synchronously for each state change (wheel deltas, tooltip-triggered renders that change deps, resize), with a 40-entry dependency list. Schedule `drawOneFrame` through a single rAF and cancel stale frames in cleanup; done when a fast wheel zoom produces at most one repaint per frame. (`src/components/ChartView.tsx:2542`)
- [ ] **#293** **[P2] [perf]** Only compute kind-support rows while the picker is open — `supportMap` evaluates `support()` for all ~60 kinds whenever the `support` prop identity changes, even with the popover closed, and the Encoding panel re-renders often. Gate the memo on `open` (fit count can be computed on open); done when typing in other Encoding fields doesn't call `support()`. (`src/components/ChartKindPicker.tsx:47`)

### NeoSpace handoff

- [ ] **#294** **[P2] [perf]** Cap the size of incoming handoff payloads — the code parses `files[].csv` synchronously with no count or byte limit, so a 200 MB string freezes the main thread. Limit to about 10 files and 25 MB total, and toast when data is dropped. Done when an oversized payload is rejected with a message and the UI stays responsive. (`src/components/NeoSpaceIngest.tsx:87`)

### App shell (page.tsx)

- [ ] **#295** **[P2] [perf]** Use selectors in DashboardCanvas — it also destructures the whole store (16 fields), so the expanded dashboard grid re-renders on unrelated writes. Switch to selectors or `useShallow`. Done when a toast doesn't re-render DashboardCanvas. (`src/app/page.tsx:56`)

### TopBar

- [ ] **#296** **[P2] [perf]** Use selectors in TopBar — it destructures 15 fields from the whole store, so it re-renders on every write including stream polls. Switch to selectors. Done when TopBar doesn't render on `setSourceStatus`. (`src/components/TopBar.tsx:67`)

### Sidebar

- [ ] **#297** **[P2] [perf]** Use selectors in the Sidebar root — it destructures 30 fields from the whole store. Switch to selectors or `useShallow`. Done when a toast doesn't re-render Sidebar. (`src/components/Sidebar.tsx:57`)
- [ ] **#298** **[P2] [perf]** Defer the catalog fetches — opening Data & sources immediately fetches Data.gov (80 rows, q=csv) and data.gov.uk, even though phone users mostly use the live feeds and packs at the top. Fetch when the section scrolls into view (IntersectionObserver) or on first search. Done when opening the region costs no catalog requests until scrolled. (`src/components/Sidebar.tsx:1371`)

### DetailPanel — structure & performance

- [ ] **#299** **[P2] [perf]** Only stringify the Vega spec when it's shown — `JSON.stringify(vegaSpec, null, 2)` runs on every ChartPanelView render, but the Vega section is collapsed by default (:3804) and specs can embed sample rows. Compute it inside the open branch with useMemo. Done when no stringify runs while the section is closed. (`src/components/DetailPanel.tsx:3063`)

### Overlays & small shell components

- [ ] **#300** **[P2] [perf]** Stop the discover scan when the sheet is dismissed — `cancelled` only flips on unmount, and Onboarding never unmounts, so dismissing it keeps fetching ~35 feeds and calling setState (expensive on phones). Abort with an AbortController on dismiss or openStory. Done when Skip leaves no further network requests. (`src/components/Onboarding.tsx:112`)
- [ ] **#301** **[P2] [perf]** Use selectors in Onboarding — it destructures 14 setters from the whole store and is always mounted, so it re-renders on every store write. Select the setters individually or use `getState()`. Done when a toast doesn't re-render Onboarding. (`src/components/Onboarding.tsx:94`)
- [ ] **#302** **[P2] [perf]** Select only promptDialog in PromptDialog — `useLoomStore()` with no selector re-renders this always-mounted component on every write. Select `promptDialog` and `setPromptDialog` only. Done when toasts don't re-render it. (`src/components/PromptDialog.tsx:93`)
- [ ] **#303** **[P2] [perf]** Use selectors in PreviewFooter — it destructures 6 fields from the whole store. Use selectors. Done when stream polls don't re-render the footer. (`src/components/PreviewFooter.tsx:19`)

### Explorer data table

- [ ] **#304** **[P2] [perf]** Replace the whole-store destructure with narrow selectors — `useLoomStore()` with no selector re-renders the full table on any store change (hover, toasts, live stream ticks), contrary to the guidance at the top of `store.ts`. Use per-field selectors / `useShallow`; done when React Profiler shows no Explorer re-render on toast/hover changes outside the table. (`src/components/ExplorerView.tsx:165`)
- [ ] **#305** **[P2] [perf]** Make the filter debounce actually debounce — `displayRows` memo depends on `filterInputValues`, which updates on every keystroke, so the full filter pass runs per key and the 300 ms timer only delays the store write. Derive filtering from the debounced value (or `useDeferredValue`); done when typing into a filter on 10k rows triggers one filter pass per pause. (`src/components/ExplorerView.tsx:304`)
- [ ] **#306** **[P2] [perf]** Hoist per-cell lookups out of render loops — `columnStats.find` and `allColumns.indexOf` run per cell in `renderCell` and per row×column in the filter loop (O(rows·cols²)). Precompute `Map<col,{rawIdx,isDate,isNum}>` once per columns change; done when a 10k×40 render profile shows no `find`/`indexOf` hotspots. (`src/components/ExplorerView.tsx:452`)

### SQL query view

- [ ] **#307** **[P2] [perf]** Use narrow selectors in QueryView — it destructures ~30 fields from `useLoomStore()` with no selector, re-rendering the editor and up to 100 result rows on every unrelated store change (live polling ticks included). Done when Profiler shows no QueryView renders during idle stream updates. (`src/components/QueryView.tsx:21`)

### Dive builder & engine

- [ ] **#308** **[P2] [perf]** Pause live refresh in background tabs — the 5 s (web) / 10 s (desktop) `setInterval` reloads and re-runs profiling, derived columns and `runDive` even when the tab is hidden, which drains phone batteries. Skip ticks when `document.visibilityState === "hidden"` and refresh on return; done when no reloads happen while the tab is hidden. (`src/components/DiveView.tsx:158`)
- [ ] **#309** **[P2] [perf]** Move dive evaluation off the main thread — `applyDerivedColumns` + `profileDiveColumns` + `runDive` over up to 30k rows run synchronously on every query edit and every live refresh. Run them in a Web Worker (or at least defer with `useDeferredValue` + transition); done when typing in a filter on 30k rows keeps input latency under 50 ms. (`src/components/DiveView.tsx:202`)

### Swipe discovery deck

- [ ] **#310** **[P2] [perf]** Render the peek card as a still — the background "next" card mounts a full live `ChartCard` (Vega/WebGPU) at 35% opacity, doubling render cost on every swipe on phones. Render a cached thumbnail or skeleton until it becomes current; done when only one live chart renders in the deck. (`src/components/VizSwipeDeck.tsx:266`)

### CSV / ZIP export

- [ ] **#311** **[P2] [perf]** Use a table-driven CRC32 for ZIP packs — `crc32` loops 8 bit-steps per byte, about 240M operations for a 10-slide 1080×1920 pack, which freezes phones for seconds. Precompute the 256-entry table (or use `CompressionStream` where available); done when a 30 MB pack zips in under 200 ms on desktop. (`src/lib/zipStore.ts:8`)

### Public catalogs & remote CSV

- [ ] **#312** **[P2] [perf]** Don't search Socrata on mount — `SocrataCatalogSection` sends a "311" Discovery query as soon as it mounts, even when collapsed or never looked at, on every page load. Search lazily (on expand or IntersectionObserver) and cache the last result in `sessionStorage`; done when a cold load with the section collapsed makes no Socrata request. (`src/components/PublicCatalogSections.tsx:100`)

### Formatting & time utilities

- [ ] **#313** **[P2] [perf]** Cache `Intl.DateTimeFormat` in zone conversions — `zonedCivilToUtcMs` builds a new formatter on each of up to 4 iterations per value, and `nycWallToUtcIso` runs it for every Socrata row (tens of thousands). Memoize one formatter per time zone; done when converting 50k NYC timestamps takes under 100 ms. (`src/lib/zonedTime.ts:53`)

### Deep scan

- [ ] **#314** **[P2] [perf]** Keep the scanning spinner moving — `deepRecommend` runs profiling, 66 Pearson pairs and contingency tables over every sample row synchronously, freezing the "Scanning…" animation on phones. Run it in a worker, or yield between phases with `await scheduler.yield()`; done when the spinner animates through a 10k-row scan. (`src/lib/deepScan.ts:413`)

### Store architecture & selectors

- [ ] **#315** **[P2] [perf]** Stop storing derived uptime — `streamUptimeSecs` / `uptime_secs` are pure functions of `startedAt` but are written into the store every 2 s (Sidebar.tsx:632), guaranteeing a fresh object and re-render each tick; compute uptime in the card with a local 1 s ticker. Done when `streamUptimeSecs` and `uptime_secs` are removed from LoomState. (`src/lib/store.ts:451`)
- [ ] **#316** **[P2] [perf]** Make `setSourceStatus` a no-op when nothing changed — it always spreads a new `sourceStatuses` map for every 3 s per-card poll, so all `sourceStatuses` subscribers re-render for 34 feeds; shallow-compare the status fields and expose a per-kind selector `(s) => s.sourceStatuses[kind]`. Done when an idle running feed causes zero renders of other source cards. (`src/lib/store.ts:1217`)
- [ ] **#317** **[P2] [perf]** Make deep-scan progress real and off the main thread — "Profiling columns…", "Scoring charts…", "Ranking for you…" are set synchronously in the same task as `deepRecommend`, so only the last message paints while the UI freezes; yield (`await` a rAF) between phases or move `deepRecommend` to a Web Worker. Done when each message is visible for ≥1 frame and the main-thread task is <50 ms on a 12k-row dataset. (`src/lib/store.ts:1245`)
- [ ] **#318** **[P2] [perf]** Prune chart-keyed maps — `chartTitleOverrides`, `chartAnnotations`, `customRefLines` are keyed by chart id, grow for the whole session, and `removeChartAnnotation` leaves empty arrays; prune keys not referenced by `chartRecs`, `activeChart` or `chartViews` on dataset change. Done when opening 10 datasets leaves only keys for live charts. (`src/lib/store.ts:327`)

### Persistence & hydration

- [ ] **#319** **[P2] [perf]** Persist via a store subscription, not a React component — HydrateStore destructures the whole store, re-rendering on every change, and writes synchronously on each slice change; use `useLoomStore.subscribe` with per-slice equality and a 300 ms debounced writer. Done when HydrateStore renders once and rapid query-history edits produce one write. (`src/components/HydrateStore.tsx:68`)

### Live buffers & polling (web)

- [ ] **#320** **[P2] [perf]** Add exponential backoff — failing feeds retry at their normal cadence forever (load-once feeds every 60 s), hammering the Worker and upstream during outages; back off ×2 with jitter up to 10× `pollMs`, reset on success, and expose `next_retry_at` in status. Done when 5 consecutive failures stretch the interval and a success restores it. (`src/lib/webStreams.ts:1089`)

### Discover stories

- [ ] **#321** **[P2] [perf]** Batch progressive discover updates — `pushMany` re-sorts and copies the entire collection for every story and Onboarding calls `setStories` on each (Onboarding.tsx:129), i.e. ~700 sorts + React renders during one scan; push per-source batches and throttle `onStory` to one call per animation frame. Done when a full scan triggers ≤ 40 `setStories` calls. (`src/lib/discoverStories.ts:996`)
- [ ] **#322** **[P2] [perf]** Make discover probes cheap — each probe runs `recommendSourceStory`, which calls full `recommend()` + `expandRecommendationsWithExtras` + `mergeStoryCharts` (up to 96 charts) on the main thread for 35 feeds at startup, to keep 20 variants; cache by (kind, schema signature) and build only the curated + top variants needed. Done when the scan's total main-thread scripting drops by half in a Performance trace. (`src/lib/discoverStories.ts:868`)

### Rust: DuckDB connection, startup, and query layer

- [ ] **#323** **[P2] [perf]** Run DuckDB work off the async runtime — `scan_folder`, `query_file`, `inspect_file`, `source_*` and the poll loop's `write_rows` call blocking std-`Mutex` DuckDB code directly inside `async fn` / `tokio::spawn`, pinning Tokio workers for the duration of full-file scans. Wrap them in `tokio::task::spawn_blocking`; done when a long `inspect_file` doesn't stall concurrent `source_status` calls. (`src-tauri/src/commands.rs:51`)
- [ ] **#324** **[P2] [perf]** Stop serializing everything on one `Mutex<Connection>` — UI queries, 34 poll writers and the SSE inserter all contend for a single connection, so a slow file scan freezes live feeds. Give each command/task its own `conn.try_clone()` (same in-memory database) and keep the mutex only for temp-view state; done when a 1M-row inspect and a USGS write proceed concurrently. (`src-tauri/src/db.rs:94`)
- [ ] **#325** **[P2] [perf]** Don't hold the global DB lock and full-scan every file during `scan_folder` — it runs `SELECT COUNT(*)` over every CSV/JSON/XLSX (full parse) while holding the connection lock for the whole recursive walk. Return entries with size/metadata immediately, use Parquet metadata counts, and compute CSV counts lazily or in background; done when mounting `.loom-data` with `spool-mega` returns in <1 s. (`src-tauri/src/db.rs:106`)
- [ ] **#326** **[P2] [perf]** Compute column stats in one pass — `column_stats_inner` runs one query per column over a view of `read_csv_auto(...)`, which re-parses the entire file once per column (50 columns = 50 full CSV scans). Use DuckDB `SUMMARIZE` or a single SELECT with all aggregates (or materialize into a temp table first); done when stats for a 50-column file issue one scan. (`src-tauri/src/db.rs:283`)

### Rust: other IPC commands

- [ ] **#327** **[P2] [perf]** Cap and stream the download in `save_csv_to_folder` — `.bytes().await` buffers the whole response in memory with no size limit or timeout, so a multi-GB portal file can OOM the app. Stream `bytes_stream()` to disk with a max size (e.g. 500 MB) and a timeout; done when an oversized download aborts with a clear error. (`src-tauri/src/commands.rs:159`)
- [ ] **#328** **[P2] [perf]** Bound the Data.gov pagination loop — it can issue up to 25 sequential 100-row requests per search with no overall deadline. Add a total time budget and stop early; done when a search with few CSV hits returns within ~10 s. (`src-tauri/src/commands.rs:500`)
- [ ] **#329** **[P2] [perf]** Send binary exports as raw IPC bytes — `writeBinaryFile` sends `Array.from(bytes)` (a JSON array of numbers, ~4× size) for files up to 80 MB. Accept `tauri::ipc::Request` with a raw `InvokeBody::Raw` body in `write_binary_file`; done when an 80 MB export no longer builds a giant JSON array. (`src-tauri/src/commands.rs:194`)

### Rust: poll sources (sources.rs)

- [ ] **#330** **[P2] [perf]** Back off on repeated poll failures — failing kinds retry at their normal cadence (OpenSky/ISS/MBTA every 15–30 s) indefinitely; only OpenSky/CoinGecko have a primary backoff. Apply exponential backoff with jitter (cap ~10× poll_secs) after consecutive failures, honoring `Retry-After` on 429; done when a 429-ing upstream is polled progressively less often. (`src-tauri/src/sources.rs:3122`)
- [ ] **#331** **[P2] [perf]** Make upsert writes set-based — `WriteMode::Upsert` runs SELECT COUNT + DELETE + INSERT per row (meteo is ~864 rows × 3 statements every 5 min) under the global lock. Append into a temp staging table, then `DELETE … USING staging` + `INSERT SELECT` (or a PRIMARY KEY with `INSERT OR REPLACE`), counting new keys with an anti-join; done when a meteo poll is ≤4 statements. (`src-tauri/src/sources.rs:794`)

### Cloudflare Worker: /api/fetch-csv and catalog

- [ ] **#332** **[P2] [perf]** Stream `/api/fetch-csv` instead of buffering — it collects up to 32 MB of chunks and then copies them into a second 32 MB array (≈64 MB peak against the 128 MB isolate limit). Pipe the body through a byte-counting `TransformStream` that truncates at the cap and sniffs the first bytes for the xlsx signature; done when peak memory no longer scales with 2× file size. (`workers/catalog-proxy.ts:170`)
- [ ] **#333** **[P2] [perf]** Cache and time-limit `/api/catalog/*` — every search re-paginates Data.gov sequentially (no `signal`, no cache), amplifying each user request into up to 40 upstream calls. Cache by normalized query for ~10 min and add per-call timeouts plus an overall deadline; done when repeat searches are cache hits and a hung page can't exceed ~15 s. (`workers/catalog-proxy.ts:972`)

### Cloudflare Worker: /api/source caching and correctness

- [ ] **#334** **[P2] [perf]** Serve stale-while-revalidate and coalesce refreshes — after the TTL every request blocks on the upstream, and concurrent requests all refetch (no single-flight), which also burns rate-limited upstreams (MBTA ~20/min, ADSB ~1/s). Return the expired cached copy immediately and refresh in `ctx.waitUntil` behind a short lock (KV/DO or a cache "refreshing" marker); done when a request after TTL expiry returns in <100 ms with `X-Loom-Cache: STALE-REVALIDATING`. (`workers/catalog-proxy.ts:675`)
- [ ] **#335** **[P2] [perf]** Put a total deadline on the aircraft fetcher — OpenSky (6 s) then up to 5 points × (8 s timeout + 1.2 s spacing) for ADSB.lol and again for adsb.fi can take ~100 s, far beyond what the browser waits. Add an overall budget (e.g. 20 s) and return what arrived; done when a worst-case cold miss answers within the budget. (`workers/catalog-proxy.ts:384`)

### Build, release, and observability

- [ ] **#336** **[P2] [perf]** Add a release profile — `Cargo.toml` has no `[profile.release]`, so the bundled DuckDB + arrow binary ships without LTO or stripping. Add `lto = "thin"`, `codegen-units = 1`, `strip = true`, `opt-level = 3` (keep `panic = "unwind"` for Tauri); done when the `.app` size is measured before/after and noted in README. (`src-tauri/Cargo.toml:15`)

### Bundle and code splitting

- [ ] **#337** **[P2] [perf]** Lazy-load the "odd charts" renderer — `oddCharts.ts` (110 kB source, 2,744 lines) is statically imported for rarely used kinds; dynamic-import it on first `isOddChartKind(kind)` render and cache the module; done when its code is in a separate chunk and a test still renders an odd kind. (`src/components/ChartView.tsx:39,2405`)
- [ ] **#338** **[P2] [perf]** Lazy-load the data cube and GPU scene CPU paths — `dataCube.ts` (41 kB) and `gpuScenes.ts` (43 kB) are only needed for `dataCube`/`scatter3d`/`firefly`/`globe` kinds; split them behind dynamic imports keyed on chart kind; done when page chunk raw size drops ≥60 kB. (`src/components/ChartView.tsx:47-50`)
- [ ] **#339** **[P2] [perf]** Mount first-run and occasional overlays on demand — `Onboarding` (27 kB src), `WhatsNew` + `changelog.ts` (21 kB of release-note strings), `ShareSheet` (22 kB), `VizSwipeDeck` (15 kB), `FeedbackNotes`, `PromptDialog` are always mounted in `Home`; render them via `next/dynamic({ ssr:false })` gated on their store flag (e.g. `shareSheetOpen`), and have `WhatsNew` `import("@/lib/changelog")` only when `requestWhatsNew()` fires or a new release id is unseen. (`src/app/page.tsx:28-34,394-411`)
- [ ] **#340** **[P2] [perf]** Lazy-load `DetailPanel` on phones — it is 4,645 lines (201 kB source) and is closed by default on mobile (`page.tsx:499-510`); use `next/dynamic` and preload it on first `togglePanel()`/`setPanelTab()`; done when a 390-px cold load does not fetch DetailPanel code until the sheet is opened. (`src/app/page.tsx:17,843`)
- [ ] **#341** **[P2] [perf]** Split DetailPanel tabs into per-tab modules — Stats, Chart (encoding/Visual), Export, Smart, Dashboards, Settings all live in one 4,645-line file; move each tab component to `src/components/detail/<Tab>.tsx` and dynamic-import inactive tabs; done when switching tabs triggers a chunk fetch only the first time. (`src/components/DetailPanel.tsx:110`)
- [ ] **#342** **[P2] [perf]** Lazy-load `PublicCatalogSections` — Socrata/TidyTuesday UI is only shown after expanding Data & sources; dynamic-import it inside Sidebar. (`src/components/Sidebar.tsx:20`)
- [ ] **#343** **[P2] [perf]** Add a bundle budget check — no guard stops regressions; add `scripts/check-bundle.mjs` that parses `out/index.html` script tags, gzips each, and fails when total > a committed budget (start at 545 kB, ratchet down after the splits above); run it in CI after `npm run build`. (`package.json:7`)

### Core Web Vitals and runtime responsiveness

- [ ] **#344** **[P2] [perf]** Make the prerendered web shell web-appropriate — static HTML currently says "Choose folder / No data files found / Mount a folder… / idle DuckDB" (desktop copy) before JS swaps to the web state; render the "Find something fun to chart" call-to-action as the first, LCP-friendly element and hide desktop-only cards behind `isTauri()` after mount. (`out/index.html`, `src/components/Sidebar.tsx:64`)
- [ ] **#345** **[P2] [perf]** Instrument real-user Web Vitals — none exist; add `useReportWebVitals` (built into `next/web-vitals`, no new dep) in a small client component that `navigator.sendBeacon`s LCP/CLS/INP to a new Worker route `/api/vitals` logged via Workers observability; done when the Cloudflare dashboard shows p75 LCP/INP for loom.ibm.io. (`src/app/layout.tsx:41`, `workers/catalog-proxy.ts:964`)

### Fonts and CSS

- [ ] **#346** **[P2] [perf]** Self-host the default fonts with `next/font/google` — gives `size-adjust` fallback metrics (no CLS on swap), removes the third-party request (also makes the Tauri app work offline), and resolves the `@next/next/no-page-custom-font` lint warning; expose them as `--font-sans`/`--font-mono` variables. (`src/app/layout.tsx:34-39`)

### Delivery: Workers static assets, caching, headers

- [ ] **#347** **[P2] [perf]** Serve real 404s for missing static files — `not_found_handling: "single-page-application"` returns `index.html` (200) for any typo, including stale `/_next/static/chunks/*.js` after a deploy, which then fails with a JS parse error instead of a clean chunk-load retry; exclude `/_next/*` from SPA fallback (route them through the Worker returning 404) or switch to `"404-page"` since the app is a single route. (`wrangler.jsonc:11`)

## P2 · Accessibility (45)


### Accessibility

- [ ] **#348** **[P2] [a11y]** Offer a data-table view of the chart — every renderer already registers hit targets with `summary` rows; expose a "Data" toggle (and a visually hidden table) built from `canvas2DHitRef.current.targets` so screen-reader and keyboard users get the aggregated values. Done when each bar/line/pie chart has a table whose rows match its tooltips. (`src/components/ChartView.tsx:2441`)
- [ ] **#349** **[P2] [a11y]** Let keyboard users step through marks — the only keyboard support is scatter pan/zoom; tooltips are pointer-only. When the stage has focus, make ←/→ cycle through the registered hit targets, show the tooltip at that mark, and announce it via an `aria-live="polite"` region; Esc dismisses. Done when every value of a bar chart can be read without a mouse. (`src/components/ChartView.tsx:3197`)
- [ ] **#350** **[P2] [a11y]** Raise contrast of light-theme chart colours — `THEME_CHART.light` uses `#c49200` (and `#4a8fc0`) on `#f0efeb`, both near 2–3:1. Darken them; done when the contrast test above passes for `light`, `paper` and `glass`. (`src/lib/chartPalettes.ts:84`)
- [ ] **#351** **[P2] [a11y]** Theme and colourblind-proof the smart overlays — anomaly rings (`#ff6b6b`), trend (`rgba(0,214,143)`), forecast (yellow) and reference lines (`#00d68f`/`#6c5ce7`/`#74b9ff`/`#e77c5c`) are hard-coded hex (against the AGENTS.md theming rule), red/green on the same chart, invisible on light themes, and never in the legend. Pull them from `VIZ_SEMANTIC`/theme tokens, vary dash pattern per overlay, and add legend entries; done when overlays read in light, dark and colourblind modes and appear in the legend. (`src/components/ChartView.tsx:3886`)
- [ ] **#352** **[P2] [a11y]** Raise the minimum canvas text size — several labels are drawn at fixed 9px (`drawColorRamp` labels, bubble size key ChartView.tsx:5805, Pareto "80%" 6972, arc labels 6859, corr axis labels 7056, grouped-bar data labels 4659), which is unreadable on phones and in 1080px social exports. Set an 11px floor (scaled by frame) shared through `axisFont`; done when a recording-context test (as in `creativeRenderers.test.ts`) finds no font under 10px for the core kinds. (`src/lib/chartLooks.ts:627`)
- [ ] **#353** **[P2] [a11y]** Make chart-title editing reachable by keyboard — on desktop the edit button only appears after a 1-second mouse hover, and the title span is double-click-only, so keyboard users can't rename a chart. Render the edit button whenever the title row has `:focus-within`, or always as a visually quiet icon; done when Tab reaches "Edit chart title" on desktop. (`src/components/ChartView.tsx:2895`)
- [ ] **#354** **[P2] [a11y]** Make "Why?" readable without hover — the recommendation reason lives only in a `title` attribute on a non-focusable span (and is hidden on mobile), so keyboard, touch and screen-reader users never get it. Use a focusable disclosure/popover button; done when "Why?" opens with Enter/tap and is announced. (`src/components/ChartView.tsx:2947`)
- [ ] **#355** **[P2] [a11y]** Respect reduced motion in chart animations — `animateEntrance` and the firefly pulse clock ignore both `prefers-reduced-motion` and `appSettings.reducedMotion` (only the cube pivot checks them at ChartView.tsx:643). Gate both behind one `useReducedMotion()` hook; done when reduced motion yields a static first frame for all three. (`src/components/ChartView.tsx:2526`)

### Root layout & document

- [ ] **#356** **[P2] [a11y]** Let the page reflow at high zoom — `body overflow-hidden` (also forced in globals.css:696) means content cut off at 200–400% zoom can't be scrolled to (WCAG 1.4.10). Keep overflow clipping on the h-dvh shell only, and let the body scroll below a minimum height. Done when every panel is reachable at 400% zoom in a 1280px window. (`src/app/layout.tsx:41`)

### App shell (page.tsx)

- [ ] **#357** **[P2] [a11y]** Manage focus in the Help dialog — it has `aria-modal` but doesn't move focus in, trap it, or restore it on close, so Tab walks into the page behind. Build a shared Dialog primitive (initial focus, trap, restore, Escape, aria-labelledby) and use it here first. Done when Tab cycles only inside Help and focus returns to the `?` button on close. (`src/app/page.tsx:650`)
- [ ] **#358** **[P2] [a11y]** Label the Help feedback fields — the title input and textarea rely on placeholder text only. Add visible or sr-only `<label>`s. Done when axe reports no unlabeled form fields in Help. (`src/app/page.tsx:721`)
- [ ] **#359** **[P2] [a11y]** Name the dashboard preview images — snapshot `<img alt="">` is the only content of the "Open live view" button and the focused view, so they're announced without a name. Use `alt={label}` (or aria-label on the button). Done when a screen reader announces the chart name on each card. (`src/app/page.tsx:256`)
- [ ] **#360** **[P2] [a11y]** Add error boundaries for each region — ErrorBoundary wraps only HomeContent, so WhatsNew, Onboarding, ShareSheet, VizSwipeDeck and PromptDialog crash the whole app, and a DetailPanel throw also takes down TopBar and Sidebar. Wrap the sidebar, main view, DetailPanel and each overlay separately. Done when a forced throw in DetailPanel leaves TopBar usable. (`src/app/page.tsx:397`)

### TopBar

- [ ] **#361** **[P2] [a11y]** Use one state attribute on the view switcher — each button sets both `aria-pressed` and `aria-current="page"`, which announce conflicting roles. Use aria-current inside the nav only (or a proper tablist). Done when NVDA announces "Chart, current page" once. (`src/components/TopBar.tsx:136`)
- [ ] **#362** **[P2] [a11y]** Give the drawer toggles expanded state — the sidebar toggle has no `aria-expanded`/`aria-controls`, and the panel toggle uses `aria-pressed` (TopBar.tsx:272). Expose `aria-expanded` bound to sidebarOpen/panelOpen and point aria-controls at the aside ids. Done when screen readers report expanded or collapsed. (`src/components/TopBar.tsx:117`)

### Sidebar

- [ ] **#363** **[P2] [a11y]** Make visual order match DOM order in Data & sources — sections are reordered with inline CSS `order` (0/3/4/5/1/2/8), so on web the visual order, Tab order and screen-reader order disagree (Open files is 2nd in the DOM but 4th on screen). Render the sections from an ordered array per environment. Done when tab order follows what's on screen. (`src/components/Sidebar.tsx:1489`)
- [ ] **#364** **[P2] [a11y]** Associate the catalog toolbar labels — "Search catalog", "Sort", "Max results" and "Filter this page" labels have no htmlFor/id, so the controls are unnamed. Wire them up with `useId`. Done when axe reports no unlabeled controls in Data & sources. (`src/components/Sidebar.tsx:1239`)
- [ ] **#365** **[P2] [a11y]** Rebuild DatasetPreviewModal on the shared Dialog — it has no Escape or focus management, uses a hard-coded `bg-black/60` scrim instead of `loom-overlay`, uses `max-h-[85vh]` instead of dvh, and its heading is the generic "Preview" while the dataset title is a `<p>`. Use the shared Dialog and make the title the h2. Done when Escape closes it and the h2 is the dataset name. (`src/components/Sidebar.tsx:540`)

### DetailPanel — Dashboards tab

- [ ] **#366** **[P2] [a11y]** Show the hover-only remove buttons on keyboard focus — the remove and reorder controls are `opacity-0 group-hover:opacity-100` (:595, :651, :688), so keyboard focus lands on invisible buttons. Add `focus-visible:opacity-100` and `group-focus-within:opacity-100`. Done when a tabbed-to remove button is visible. (`src/components/DetailPanel.tsx:595`)
- [ ] **#367** **[P2] [a11y]** Give AddViewDropdown menu behaviour — it's a click-only popover with no Escape, no menu or listbox roles, no focus moved into the list, and an invisible z-10 overlay. Add these semantics, or use a native `<select>`. Done when the dropdown works from the keyboard alone. (`src/components/DetailPanel.tsx:704`)

### DetailPanel — Settings tab

- [ ] **#368** **[P2] [a11y]** Expose which setting is selected — theme, chrome, faces and UI-scale buttons show selection only by border colour and lack `aria-pressed` or radiogroup semantics. The faces buttons also show raw ids (`{f}`, :895), and the double-click-to-cycle gesture (:832) is undiscoverable and fires a click first. Use radio groups with labels and drop the double-click. Done when screen readers announce "selected" for the current theme. (`src/components/DetailPanel.tsx:828`)

### DetailPanel — Stats / Export / Smart

- [ ] **#369** **[P2] [a11y]** Associate the Smart tab labels — `<label>`s sit beside their selects and number inputs without htmlFor (:2296, 2309, 2322, 2358, 2369, 2408, 2417, 2455), so the controls are unnamed. Wire them up with `useId`. Done when axe reports no unlabeled controls in Smart. (`src/components/DetailPanel.tsx:2296`)

### DetailPanel — Chart encoding & visual controls

- [ ] **#370** **[P2] [a11y]** Name the Visual tab sliders and inputs — about 16 range, select and number inputs have `<label>`s with no htmlFor (:4186, 4240, 4252, 4289, 4301, 4327, 4383, 4407, 4420, 4445, 4471, 4483, 4522, 4545, 4569, 4625), and the value text isn't tied to the slider. Associate the labels and add `aria-valuetext`. Done when every slider announces its name and value. (`src/components/DetailPanel.tsx:4240`)
- [ ] **#371** **[P2] [a11y]** Add aria-pressed to the chip toggles — lock chips (:3260, :3889), bar layout (:3363), split (:3417), time window (:3508), tooltip fields (:3672), colour-scale kind (:3927) and the palette list (:4016) show selection by colour or border only. Add `aria-pressed`. Done when screen readers report each chip's state. (`src/components/DetailPanel.tsx:3260`)
- [ ] **#372** **[P2] [a11y]** Give disclosure toggles expanded state — "More channels" (:3597), "Tooltip" (:3653), "Active chart" (:3729) and "Vega-Lite spec" (:3796) have no `aria-expanded`/`aria-controls`, and their ▼/▶ glyphs are read aloud. Add the attributes and `aria-hidden` on the glyphs. Done when the toggles announce expanded or collapsed. (`src/components/DetailPanel.tsx:3597`)
- [ ] **#373** **[P2] [a11y]** Make "Why this chart?" show its answer — the button's only content is a `title` tooltip, so clicking, tapping or a screen reader gets nothing. Turn it into a disclosure that reveals the reason text inline. Done when tapping it shows the reason on a phone. (`src/components/DetailPanel.tsx:3741`)

### Overlays & small shell components

- [ ] **#374** **[P2] [a11y]** Manage focus in WhatsNew — there's no initial focus, trap or restore, and its window-level Escape listener also fires page.tsx's global Escape handler. Use the shared Dialog. Done when focus starts on the primary button and returns to "What's new" on close. (`src/components/WhatsNew.tsx:114`)
- [ ] **#375** **[P2] [a11y]** Make PromptDialog a proper dialog — there's no `aria-labelledby` to the h3, the input has no label, Escape only works while focus is in the input (:73), Tab escapes to the page, and focus isn't restored. Use the shared Dialog with a labelled input. Done when Escape works from the OK button and focus returns to the trigger. (`src/components/PromptDialog.tsx:52`)
- [ ] **#376** **[P2] [a11y]** Keep the toast live region mounted — the `role="status"` element is created already containing text, which many screen readers don't announce. Always render an empty live region and swap the text in. Done when VoiceOver reads every toast. (`src/components/Toast.tsx:20`)
- [ ] **#377** **[P2] [a11y]** Give toasts enough time and an action — every toast auto-dismisses after a fixed 3s regardless of length (some are over 100 chars, page.tsx:616) and doesn't pause on hover or focus (WCAG 2.2.1). Scale duration with length, pause on hover/focus, and support an optional action button (needed for Undo). Done when a long toast stays at least 6s and pauses on hover. (`src/components/Toast.tsx:16`)
- [ ] **#378** **[P2] [a11y]** Make the FeedbackNotes form keyboard-usable — the file input is `className="hidden"` (display:none), so "Attach screenshot" can't be reached by keyboard (use `sr-only` like page.tsx:741). The kind buttons also lack aria-pressed (:200), there's no Escape, and the fields have placeholders only (:213-227). Done when the whole form works from the keyboard and every field has a label. (`src/components/FeedbackNotes.tsx:233`)

### Design tokens & CSS (globals.css / tailwind.config.ts)

- [ ] **#379** **[P2] [a11y]** Fix status colours used as text — light warning `#b87a00` (3.45:1) and success `#008f62` (3.93:1), NES warning `#c9a800` (2.16:1) and brutal warning `#cc8800` (2.96:1) are below AA, yet `text-loom-warning` is used for error text (Sidebar.tsx:1590). Darken them or add `-text` variants. Done when status text passes 4.5:1 in every light theme. (`src/styles/globals.css:126`)
- [ ] **#380** **[P2] [a11y]** Give form fields a visible border — the border tokens are 1.47:1 (dark) and 1.68:1 (light) and are the only boundary of `.loom-input`, below WCAG 1.4.11 for form controls. Add `--loom-border-strong` (at least 3:1) for inputs and selects. Done when every input border is at least 3:1 against its background. (`src/styles/globals.css:160`)
- [ ] **#381** **[P2] [a11y]** Add Windows High Contrast fallbacks — there are no `@media (forced-colors: active)` rules, `.loom-input:focus` relies only on box-shadow, and selected `.loom-seg-item` relies only on background (:884), so both disappear in forced colors. Add outline and border fallbacks. Done when focus and selection are visible in Windows HC. (`src/styles/globals.css:848`)

### Explorer data table

- [ ] **#382** **[P2] [a11y]** Fix grid semantics — `role="grid"` sits on a scroll `div` wrapping a native `<table>`, `aria-rowcount={displayRows.length}` ignores the 1–2 header rows, and body rows use `aria-rowindex={ri + 1}` (collides with header row 1). Put `role="grid"` on the table, add `aria-colcount`, offset rowindex by header count, `role="gridcell"` on tds; done when axe reports no grid/rowindex violations. (`src/components/ExplorerView.tsx:813`)
- [ ] **#383** **[P2] [a11y]** Add cell-level keyboard navigation and copy — only rows are navigable; add ArrowLeft/Right cell focus, Home/End/PageUp/PageDown, Enter to open profile and Cmd/Ctrl+C to copy the focused cell; done when a keyboard-only user can copy any cell value. (`src/components/ExplorerView.tsx:818`)
- [ ] **#384** **[P2] [a11y]** Make "remove saved view" reachable — the × button is `opacity-0 group-hover:opacity-100`, invisible on touch and to sighted keyboard users who tab onto it. Show it always (or on focus-within); done when it is visible when focused and on phones. (`src/components/ExplorerView.tsx:734`)

### SQL query view

- [ ] **#385** **[P2] [a11y]** Announce query completion — the row-count summary appears silently and the skeleton has no `role="status"`, so screen-reader users don't know a query finished. Add an `aria-live="polite"` "42 rows returned" message; done when VoiceOver reads the outcome after Execute. (`src/components/QueryView.tsx:436`)

### Dive builder & engine

- [ ] **#386** **[P2] [a11y]** Make the sidebar resize handle keyboard-accessible — the `role="separator"` div has no `tabIndex`, `aria-valuenow/min/max` or arrow-key handling, and ignores `pointercancel`. Done when Tab focuses it and ←/→ resize by 16 px with values announced. (`src/components/DiveView.tsx:771`)

### Dive time series & chip input

- [ ] **#387** **[P2] [a11y]** Make the time series usable without a mouse — the SVG is `role="img"` with pointer-only crosshair, pin and brush. Make it focusable with ←/→ to move the crosshair, Enter to pin, and an `aria-live` readout of bucket + top values; done when a keyboard user can read every bucket's values. (`src/components/DiveTimeSeries.tsx:385`)
- [ ] **#388** **[P2] [a11y]** Wire the chip input combobox fully — options have no `id`, the input has no `aria-activedescendant`, and `aria-controls` points at a listbox that is unmounted when closed. Add option ids, `aria-activedescendant={open ? optionId(hi) : undefined}`, and keep the listbox in the DOM (hidden); done when screen readers announce the highlighted suggestion while arrowing. (`src/components/DiveChipInput.tsx:123`)

### Data cube pivot

- [ ] **#389** **[P2] [a11y]** Link pivot cells for keyboard and touch — cube highlighting only comes from `onMouseEnter` on tds, header cells have no `scope`, and empty cells render "·" with no text alternative. Make cells focusable (roving tabindex) with `onFocus` → `onHover`, add `scope="col"/"row"`, and `aria-label="no data"` on blanks; done when tabbing through the table highlights voxels. (`src/components/DataCubePivot.tsx:264`)

### Swipe discovery deck

- [ ] **#390** **[P2] [a11y]** Trap and restore focus in the deep-scan dialog — it is `role="dialog" aria-modal` but focus stays on the trigger behind it, Tab walks the background, and focus isn't restored on close. Focus "Keep" (or the heading) on open, trap Tab, restore on close; done when Tab cycles only Skip/Keep/Done. (`src/components/VizSwipeDeck.tsx:186`)
- [ ] **#391** **[P2] [a11y]** Announce swipe outcomes — the only screen-reader text is static `sr-only` instructions; keep/skip and the next card's title aren't announced. Add an `aria-live` region ("Kept: Bar of sales by region. 4 of 16."); done when VoiceOver reads each decision. (`src/components/VizSwipeDeck.tsx:362`)

### Share sheet & capture

- [ ] **#392** **[P2] [a11y]** Manage focus in the share sheet — no initial focus, no Tab trap, and no focus return to the Share button on close (Escape is handled). Done when opening focuses the dialog title or primary action and closing returns focus. (`src/components/ShareSheet.tsx:381`)

## P2 · Mobile & touch (phone loop) (26)


### WebGPU rendering correctness

- [ ] **#393** **[P2] [mobile]** Clamp `requiredLimits` to `adapter.limits` — `requestDevice` asks for 256 MB storage/buffer limits, which many mobile adapters don't offer; `requestDevice` then rejects and phones silently drop to Canvas. Request `Math.min(256MB, adapter.limits.max…)`; done when WebGPU initialises on an iPhone/Android device whose adapter reports 128 MB. (`src/lib/webgpu.ts:93`)

### Mobile & touch

- [ ] **#394** **[P2] [mobile]** Dismiss touch tooltips — `onPointerLeave` ignores touch pointers, so after a tap the `fixed` tooltip stays on screen (even over the suggestion rail while scrolling) until another tap inside the plot. Clear on tap outside the stage, on scroll, and after a timeout; done when a tooltip disappears after tapping elsewhere on a phone. (`src/components/ChartView.tsx:3301`)
- [ ] **#395** **[P2] [mobile]** Anchor pinned tooltips to the chart, not the viewport — pins store `clientX/clientY` and render `position: fixed`, so they drift away from their point after a resize, panel toggle, rotation or zoom. Store data coordinates and project them through the current scales; done when a pinned tooltip follows its point after rotating the phone. (`src/components/ChartView.tsx:3380`)
- [ ] **#396** **[P2] [mobile]** Add pinch-zoom to orbit scenes, globes and the cube — zoom for these kinds exists only on the wheel event, so phones can rotate but never zoom. Track two active pointers in the stage handlers and scale `sceneOrbit.zoom`; done when pinching a globe on iOS zooms it. (`src/components/ChartView.tsx:3081`)
- [ ] **#397** **[P2] [mobile]** Provide a touch selection mode — brush requires Shift-drag and Lasso is hidden on mobile, so phone users can't select points at all. Add a "Select" mode button that turns one-finger drag into a brush; done when a phone user can select points and see them in the table. (`src/components/ChartView.tsx:2964`)
- [ ] **#398** **[P2] [mobile]** Keep the chart-type picker above the on-screen keyboard — popover height uses `window.innerHeight - top - 110`, which ignores the visual viewport, so on iOS the list sits behind the keyboard once the search box is focused. Size from `visualViewport.height` and listen to its `resize`; done when the list stays visible while typing on an iPhone. (`src/components/ChartKindPicker.tsx:112`)
- [ ] **#399** **[P2] [mobile]** Use per-side margins to reclaim plot area on phones — renderers take one uniform `pad` from `resolveChartPad`, which takes the max side, so on a 360px stage the right gutter is as wide as the left tick gutter (≈40px wasted). Pass `resolveChartMargins` as a `PlotRect` (the chartLooks helpers already accept one); done when the plot area on a 360px bar chart grows by ≥10% width. (`src/lib/chartLayout.ts:163`)

### Root layout & document

- [ ] **#400** **[P2] [mobile]** Keep sheet inputs above the on-screen keyboard — the viewport export has no `interactiveWidget: "resizes-content"`, so the phone keyboard covers inputs in bottom sheets (PromptDialog, FeedbackNotes). Add it, then check the sheets on iOS and Android. Done when the PromptDialog input stays visible while typing on a phone. (`src/app/layout.tsx:16`)

### App shell (page.tsx)

- [ ] **#401** **[P2] [mobile]** Make fixed dashboard layouts responsive — the 2x1, 2x2, 3x2, 1+2 and stream layouts hard-code 2–3 columns with no breakpoint, so phones get ~100px cards. Collapse to one column below `sm`. Done when a 3x2 dashboard shows one card per row at 375px. (`src/app/page.tsx:153`)

### Sidebar

- [ ] **#402** **[P2] [mobile]** Give the phone drawer dialog behaviour — it has a backdrop button but no Escape-to-close, no focus moved in, no focus restore and no `role="dialog"`/`aria-modal`. Add these through the shared Sheet primitive. Done when Escape closes the drawer and focus returns to the toggle. (`src/components/Sidebar.tsx:430`)

### DetailPanel — mobile sheet & tabs

- [ ] **#403** **[P2] [mobile]** Make the panel bottom sheet behave like a sheet — the phone sheet has no Escape, no focus move or restore, a decorative-only drag handle (no swipe-down to dismiss), and a 36px close button (:141). Build a shared Sheet primitive (also for the Sidebar drawer and ShareSheet) with a 44px close, swipe-to-dismiss and focus handling. Done when swiping down or pressing Escape closes it and focus returns. (`src/components/DetailPanel.tsx:118`)

### Overlays & small shell components

- [ ] **#404** **[P2] [mobile]** Offer a non-drag way to use Schema tokens — they only support HTML5 mouse drag, which doesn't work with touch or keyboard. Add tap or Enter → "Use as X / Y / Color" on each token. Done when a phone user can assign a column from Schema. (`src/components/PreviewFooter.tsx:131`)

### Design tokens & CSS (globals.css / tailwind.config.ts)

- [ ] **#405** **[P2] [mobile]** Meet the 44px touch target on phones — the mobile min-height for `.loom-input`, `.loom-btn-*` and `.loom-seg-item` is 2.25rem (36px). Use 2.75rem under `(pointer: coarse)`. Done when primary controls measure at least 44px on a phone. (`src/styles/globals.css:991`)

### Explorer data table

- [ ] **#406** **[P2] [mobile]** Add a touch path to copy cells — copy lives only in `onContextMenu`, which iOS Safari doesn't fire on long-press of a table cell, so phone users can't copy values. Add long-press (or tap-to-select + action bar) on cells; done when a cell can be copied on iOS Safari. (`src/components/ExplorerView.tsx:471`)

### SQL query view

- [ ] **#407** **[P2] [mobile]** Show the schema on phones — the schema panel is `hidden sm:block`, so phone users have no column list or table name while writing SQL. Add a collapsible chip row of columns above the editor on small screens; done when tapping a column on a phone inserts it. (`src/components/QueryView.tsx:360`)

### Dive builder & engine

- [ ] **#408** **[P2] [mobile]** Give touch users an "exclude" action — drill-down excludes only with ⌥-click (`e.altKey`), which is impossible on phones, and the hint lives in a `title`. Add a long-press / ⋯ menu on group and sample values with "Only this" / "Exclude"; done when a value can be excluded on iOS. (`src/components/DiveView.tsx:1085`)
- [ ] **#409** **[P2] [mobile]** Make the narrow builder collapsible — below 720 px the query builder takes a fixed `max-h-[42%]` of the screen, leaving phones a short results area. Collapse it into a summary bar ("count · by country · last 24h") that expands as a sheet; done when results get at least 75% of the height on a 390×844 phone by default. (`src/components/DiveView.tsx:402`)
- [ ] **#410** **[P2] [mobile]** Share dive links natively — "Copy link" only writes to the clipboard and, for uploaded files, links won't open for recipients. Use `navigator.share({url})` on phones and warn before sharing a link whose source isn't portable; done when the iOS share sheet opens from Dive. (`src/components/DiveView.tsx:300`)

### Dive time series & chip input

- [ ] **#411** **[P2] [mobile]** Add zoom for touch — brush-zoom starts only for `pointerType === "mouse"` and zoom-out is `onDoubleClick`, so phones can scrub but never zoom in or out. Add a long-press-then-drag brush (or two-finger pinch) and a visible "Zoom out" button; done when a phone user can zoom into a spike and back. (`src/components/DiveTimeSeries.tsx:281`)

### Share sheet & capture

- [ ] **#412** **[P2] [mobile]** Open NeoSpace before awaiting the publish — `window.open` runs after `await publishStory()`, so Safari/iOS popup blocking returns null and the fallback `location.assign` navigates away from Loom, losing the in-memory session. Open a blank window synchronously in the tap and set its URL after publishing; done when Post to NeoSpace on iOS keeps Loom open. (`src/components/ShareSheet.tsx:292`)
- [ ] **#413** **[P2] [mobile]** Keep clipboard writes inside the tap on iOS — after "Get link", `copyTextToClipboard` runs after network awaits, which iOS rejects (no user activation), so the link is rarely auto-copied. Use `navigator.clipboard.write([new ClipboardItem({"text/plain": promiseOfBlob})])` started in the click; done when Get link auto-copies on iOS Safari. (`src/components/ShareSheet.tsx:248`)

### CSV / ZIP export

- [ ] **#414** **[P2] [mobile]** Use the share sheet for CSV on iOS — `a.download` with blob URLs is unreliable in iOS Safari (opens a preview tab or does nothing). Reuse `shareOrDownloadFile` from `socialExport.ts` for CSV too; done when "Export CSV" on iPhone offers Save to Files. (`src/lib/csvExport.ts:27`)

### Formatting & time utilities

- [ ] **#415** **[P2] [mobile]** Don't flash the desktop layout on phones — `useMediaQuery` starts `false` and only corrects after an effect, so phones render the desktop table toolbar, sparkline work and Dive layout for a frame (layout jump). Use `useSyncExternalStore` with `matchMedia` on the client and `false` as the server snapshot; done when the first client render on a 390 px viewport is the mobile layout. (`src/lib/useMediaQuery.ts:11`)

### Live buffers & polling (web)

- [ ] **#416** **[P2] [mobile]** Handle offline explicitly — there is no `navigator.onLine` / `online`/`offline` handling, so offline polls surface generic "Failed to fetch" errors and keep retrying; pause on `offline`, set `last_error` to "Offline — showing data from HH:MM", resume on `online`. Done when toggling offline in DevTools pauses requests and shows the offline message. (`src/lib/webStreams.ts:1089`)

### Source registry & duplicated logic

- [ ] **#417** **[P2] [mobile]** Add a mobile cadence for aggressive feeds — ISS polls every 15 s and OpenSky/MBTA every 30 s regardless of device or connection; add `mobilePollMs` (or multiply cadence when `navigator.connection.saveData` / `effectiveType` is 2g–3g or viewport is phone). Done when ISS polls ≥60 s on a phone profile. (`src/lib/sourceRegistry.ts:336`)

### Viz preferences, Ollama, IPC bridge, changelog

- [ ] **#418** **[P2] [mobile]** Delay object-URL revocation after downloads — `exportDashboardMicrosite` and `saveBinaryAndReveal` call `URL.revokeObjectURL` synchronously right after `a.click()`, which can cancel the download on iOS Safari; revoke in a `setTimeout(…, 30_000)`. Done when a microsite export downloads on iOS Safari. (`src/lib/tauri.ts:359`)

## P2 · Desktop app (Tauri / Rust) (22)


### Rust: DuckDB connection, startup, and query layer

- [ ] **#419** **[P2] [bug]** Replace `.expect()` in `setup` with a user-visible error — a DuckDB init failure currently panics the whole app with no dialog. Return the error from `setup` after showing a `tauri_plugin_dialog` message (or start in a degraded mode); done when a forced init failure shows a message instead of an abort. (`src-tauri/src/lib.rs:28`)
- [ ] **#420** **[P2] [bug]** Recover from mutex poisoning on `LoomDb.conn` — every access does `lock().map_err(|e| e.to_string())?`, so one panic while holding the lock (e.g. inside a DuckDB call in a poll task) makes every later command fail with "PoisonError" until restart. Use `parking_lot::Mutex` or `lock().unwrap_or_else(|e| e.into_inner())`; done when a test that panics while holding the lock is followed by a successful query. (`src-tauri/src/db.rs:49`)
- [ ] **#421** **[P2] [bug]** Bound the recursive glob in `scan_folder` — `**/*.csv` follows symlinks with no depth or count limit and descends into `node_modules`, `.git`, etc., so mounting `~` can run for minutes or loop. Use `walkdir` with `max_depth`, `follow_links(false)`, a skip list and a file cap; done when mounting a folder with a symlink cycle terminates. (`src-tauri/src/db.rs:107`)
- [ ] **#422** **[P2] [bug]** Fix trailing-LIMIT handling — `strip_trailing_limit` only recognises `" LIMIT <digits>"`, so `LIMIT 10 OFFSET 5`, `limit\n10` or a trailing comment get a second `LIMIT` appended and fail; `stream_query`/`source_query` don't strip at all and always break on user `LIMIT`. Wrap user SQL as a subquery with an outer LIMIT in one shared helper; done when tests cover OFFSET, newline and lowercase variants in all three entry points. (`src-tauri/src/db.rs:343`)
- [ ] **#423** **[P2] [bug]** Serialize 64-bit integers losslessly — `BigInt`/`UBigInt` are emitted as JSON numbers and `HugeInt` as f64, so IDs and sums above 2^53 silently lose precision in JS. Emit them as strings when `|v| > 2^53` (and mark the column type); done when a test round-trips `9007199254740993`. (`src-tauri/src/db.rs:446`)
- [ ] **#424** **[P2] [bug]** Convert nested/other DuckDB types to real JSON — the `_ =>` arm formats `List`, `Struct`, `Map`, `Blob`, `Time`, `Interval`, `TimestampTz`, `Enum` with `{:?}` (e.g. `"List([Int(1)])"`), which leaks Rust debug syntax into tables and tooltips. Add explicit arms (arrays/objects/ISO strings/base64); done when a JSON-file column of arrays renders as `[1,2]`. (`src-tauri/src/db.rs:471`)

### Rust: other IPC commands

- [ ] **#425** **[P2] [bug]** Add timeouts to every reqwest client outside `sources.rs` — `save_csv_to_folder`, `fetch_data_gov_recent_csv`, `fetch_uk_data_recent_csv`, `create_github_issue` and the SSE client build clients without `.timeout`/`.connect_timeout`, so a hung upstream leaves the UI spinner forever. Share one managed `reqwest::Client` with connect/read timeouts; done when all HTTP paths use it. (`src-tauri/src/commands.rs:492`)
- [ ] **#426** **[P2] [bug]** Fix the desktop feedback screenshot argument name — `tauri.ts` invokes `create_github_issue` with `image_base64`, but Tauri 2 maps command args to camelCase (`imageBase64`), so the screenshot is always `None`. Pass `imageBase64` (or add `#[tauri::command(rename_all = "snake_case")]`); done when a desktop issue includes the screenshot. (`src-tauri/src/commands.rs:701`)
- [ ] **#427** **[P2] [bug]** Stop inlining screenshots as `data:` URLs in GitHub issue bodies — GitHub doesn't render `data:` images and rejects bodies over 65,536 chars, so any real screenshot makes the API return 422. Upload the image elsewhere (repo contents API / gist / R2) and link it, or drop it with a note; done when feedback with a 200 KB screenshot creates an issue. (`src-tauri/src/commands.rs:707`)

### Rust: Wikipedia SSE stream

- [ ] **#428** **[P2] [bug]** Decode UTF-8 after line assembly — `String::from_utf8_lossy(&bytes)` on raw chunks corrupts multi-byte characters split between chunks (titles from ja/zh/ru wikis become U+FFFD). Accumulate bytes and decode complete lines only; done when a test with a split 3-byte character keeps it intact. (`src-tauri/src/stream.rs:319`)
- [ ] **#429** **[P2] [bug]** Reconnect the SSE stream with backoff — any stream error or EOF (`Some(Err(_)) | None => break`) ends ingestion permanently and the UI just sees `running: false`. Loop with exponential backoff and send `Last-Event-ID` to resume; done when killing the connection resumes within seconds. (`src-tauri/src/stream.rs:340`)
- [ ] **#430** **[P2] [bug]** Report connect failures from `stream_start` — the connect happens inside the spawned task and errors only flip `running` to false, so `stream_start` returns `Ok(())` even when offline. Await the initial response (with timeout) before spawning, or store a `last_error` exposed in `StreamStatus`; done when starting offline shows an error toast. (`src-tauri/src/stream.rs:299`)
- [ ] **#431** **[P2] [bug]** Make stream start/stop race-free — `start_stream` checks `running.load` then stores `true` (two concurrent starts both spawn tasks, the first task's cancel sender is overwritten and it can never be stopped), and a stopped task's final `running.store(false)` can clobber a newly started stream. Use `compare_exchange` plus a run generation id (or keep the `JoinHandle` and `abort()` it); done when a stress test of start/stop/start leaves exactly one task. (`src-tauri/src/stream.rs:267`)
- [ ] **#432** **[P2] [bug]** Create `wiki_stream` at startup — the table is only created in `start_stream`, so `stream_snapshot`/`stream_query` before the first start fail with "Table wiki_stream does not exist". Call `ensure_stream_table` from `setup` next to `sources::ensure_tables`; done when `stream_snapshot` on a fresh launch returns an empty result. (`src-tauri/src/stream.rs:135`)

### Rust: poll sources (sources.rs)

- [ ] **#433** **[P2] [bug]** Make `source_stop` cancel in-flight polls — the cancel signal is only checked during the sleep, so a poll mid-fetch (up to 60 s timeout plus ADSB 1.2 s spacing) still writes rows after Stop, and its final `running.store(false)` can clobber a restarted instance, letting a third loop start. Keep the `JoinHandle` and `abort()` it, or use a generation counter checked before `write_rows`; done when stop→start within 1 s never yields two loops or post-stop writes. (`src-tauri/src/sources.rs:3145`)
- [ ] **#434** **[P2] [ops]** Expose poll health in `SourceStatus` — errors only go to `eprintln!`, so the UI can't tell "upstream failing for 2 hours" from "no new data". Add `last_ok_at`, `last_error`, `consecutive_failures`, `next_poll_at`; done when the sidebar card can show a stale/failing badge. (`src-tauri/src/sources.rs:3117`)

### Rust ↔ Worker source parity

- [ ] **#435** **[P2] [bug]** Align Citi Bike semantics — desktop `pct_full` is uncapped, `ebikes_available` ignores GBFS `vehicle_types_available`, `ts` is the feed's `last_updated`, and null-coordinate stations are kept; the Worker caps at 100, derives e-bikes from vehicle types, uses per-station `last_reported`, and drops null coords. Port the Worker rules to `citibike_rows`; done when both produce identical rows for the `gbfs_*` fixtures. (`src-tauri/src/sources.rs:1570`)
- [ ] **#436** **[P2] [bug]** Move desktop FX to the current Frankfurter host — Rust calls `api.frankfurter.app/{date}..` while the Worker uses `api.frankfurter.dev/v1/…`; the legacy domain is a redirect/compat host that can disappear. Use the same base URL in both; done when `fx_url` matches the Worker. (`src-tauri/src/sources.rs:2198`)
- [ ] **#437** **[P2] [bug]** Add the previous-year fallback for NOAA climate on desktop — the Worker retries `1880-(year-1)` when the current-year URL fails (common in January), desktop just errors and retries every 60 s forever. Mirror the fallback in `fetch_rows`; done when a 404 for the current year falls back. (`src-tauri/src/sources.rs:2985`)
- [ ] **#438** **[P2] [bug]** Stop hard-coding the World Bank range to 2000:2023 — both desktop and Worker request `date=2000:2023`, so 2024+ values never appear even after the Bank publishes them. Compute the end year as `currentYear - 1` (and keep `per_page` above entities × years); done when the range advances automatically. (`src-tauri/src/sources.rs:2366`)

### Build, release, and observability

- [ ] **#439** **[P2] [ops]** Gate releases on tests and sign/notarize — the release workflow builds and publishes straight from a tag with no tests, no code signing and no notarization (users are told to "Open Anyway"). Run `make check test` first and pass `APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` secrets to `tauri-action`; done when a release DMG passes `spctl -a -vv`. (`.github/workflows/release-tauri.yml:38`)
- [ ] **#440** **[P2] [ops]** Persist desktop logs — all Rust diagnostics use `eprintln!`, which goes nowhere for a Finder-launched `.app`, so poll/stream failures are invisible in bug reports. Add `tauri-plugin-log` (file target in the app log dir) and replace `eprintln!` with `log::warn!/error!` including kind and URL; done when a failing source writes to `~/Library/Logs/com.loom.storyteller/`. (`src-tauri/src/sources.rs:3118`)

## P2 · Worker & MCP backend (11)


### Cloudflare Worker: /api/fetch-csv and catalog

- [ ] **#441** **[P2] [bug]** Add timeouts to `/api/fetch-csv` upstream calls — the HEAD and GET use no `signal`, so a slow-drip server holds the request until the platform limit. Use `AbortSignal.timeout` (e.g. 10 s HEAD, 30 s GET); done when a hanging upstream returns 504 quickly. (`workers/catalog-proxy.ts:150`)
- [ ] **#442** **[P2] [bug]** Clamp and validate catalog query params — `optsFromUrl` passes `Number("abc") = NaN` to `clampRows`, which returns `NaN`, so `collected.length < rows` never stops and the Worker walks all 25–40 Data.gov pages (40 subrequests) per request. Default non-finite values to 40 and integer-clamp; done when `?rows=abc` returns ≤40 rows after one or two upstream calls. (`workers/catalog-proxy.ts:111`)

### Cloudflare Worker: /api/source caching and correctness

- [ ] **#443** **[P2] [bug]** Don't cache empty or degraded payloads over good ones — `handleSource` caches whatever the fetcher returns, so a FIRMS CSV with no rows, a GDACS response with zero features, or a 1-point ADSB fallback replaces a good snapshot for the full TTL+stale window. Validate per kind (non-empty rows/features) and treat empties as upstream errors (serve stale); done when an empty upstream keeps the previous cache entry. (`workers/catalog-proxy.ts:692`)
- [ ] **#444** **[P2] [bug]** Version the source cache key — the key is `https://loom-source.internal/source/<kind>`, so after a deploy that changes a transform's shape (columns, columnar vs legacy) the old payload is served for up to TTL + stale (2 days for daily feeds) to the new parser. Include a `SOURCE_SCHEMA_VERSION` (or a hash of the column list) in the key; done when a deploy that bumps it misses the cache. (`workers/catalog-proxy.ts:682`)
- [ ] **#445** **[P2] [ops]** Log fallbacks and upstream failures — `spaceDevsText`, `opensky`, `crypto` and `climate` swallow primary errors in bare `catch {}`, and `handleSource` logs nothing, so Workers Observability can't show which upstreams are failing or how often STALE is served. Emit one structured `console.log({kind, cache, upstream, status, ms, fallback})` per request; done when a dashboard query can chart failures per kind. (`workers/catalog-proxy.ts:307`)
- [ ] **#446** **[P2] [bug]** Return JSON 404 for unknown `/api/*` routes — `run_worker_first` sends `/api/*` to the Worker, but unmatched paths (e.g. `GET /api/feedback`, `/api/typo`) fall through to `ASSETS.fetch` with SPA fallback and return `index.html` with 200, which clients then fail to parse as JSON. Add a final `/api/` → `json({error:"Not found"}, 404)` (and 405 for wrong methods); done when `GET /api/nope` is a JSON 404. (`workers/catalog-proxy.ts:1002`)

### Cloudflare Worker: stories (/s/*), feedback, and abuse controls

- [ ] **#447** **[P2] [ops]** Shorten story cache lifetime and add a takedown path — `/s/*` sends `Cache-Control: public, max-age=604800` from read time (so copies outlive the 7-day KV TTL by up to 7 more days) and there is no way to delete an abusive story. Use a short browser max-age with `s-maxage` purgeable at the edge, and add an authenticated `DELETE /api/stories/<id>` (secret header) that removes all three KV keys; done when a deleted story 404s within minutes. (`workers/catalog-proxy.ts:944`)
- [ ] **#448** **[P2] [bug]** Fix web feedback with screenshots — `handleFeedback` allows a 50,000-char body plus a ≤400 KB `data:` image inline, but GitHub caps issue bodies at 65,536 chars and doesn't render `data:` images, so any screenshot makes the API return 422. Store the image in KV/R2 and link `https://loom.ibm.io/s/<id>.img`, or drop it; done when feedback with a screenshot creates an issue showing the image. (`workers/catalog-proxy.ts:772`)

### Cloudflare Worker: config and headers

- [ ] **#449** **[P2] [ops]** Disable or redirect the workers.dev and preview hosts — `workers_dev: true` and `preview_urls: true` expose the same API on hosts where (per the Worker's own comment) the Cache API is a no-op, so every `/api/source` hit there goes to the upstream and can burn rate limits for loom.ibm.io. Set `workers_dev: false` (or 301 to the custom domain) and keep previews private; done when workers.dev requests don't reach upstreams. (`wrangler.jsonc:24`)

### MCP / ChatGPT plugin Worker

- [ ] **#450** **[P2] [bug]** Fix quoted-field CSV parsing in the MCP profiler — `parseCsv`'s first pass drops every `"` while splitting lines, so `splitLine` never sees quotes and `a,"b,c",d` becomes four cells, shifting all later columns. Keep quotes in the line pass (or do one-pass field parsing); done when a test with quoted commas and escaped `""` profiles the right column count. (`mcp/src/profile.ts:42`)
- [ ] **#451** **[P2] [bug]** Don't truncate JSON input before parsing — `profilePayload` slices JSON text at 400,000 chars and then `JSON.parse`s it, which always throws for larger inputs instead of returning a truncated profile. Parse first (with a hard byte cap rejecting with a clear message) then slice the array to `MAX_ROWS`; done when a 500 KB JSON array returns `truncated: true`. (`mcp/src/profile.ts:142`)

## P2 · Web delivery, SEO & PWA (8)


### Meta tags, share cards and SEO

- [ ] **#452** **[P2] [seo]** Add a canonical URL — the app is served at both `loom.ibm.io` and `*.workers.dev` (`workers_dev: true`, `preview_urls: true`); add `alternates: { canonical: "/" }` with `metadataBase`, so previews don't compete in search/unfurls. (`wrangler.jsonc:24-25`, `src/app/layout.tsx:11`)
- [ ] **#453** **[P2] [seo]** Ship `robots.txt` and `sitemap.xml` — both currently return `index.html` via SPA fallback; add `src/app/robots.ts` and `src/app/sitemap.ts` (static-export compatible) with `Disallow: /api/` and `/s/` (7-day shares). (`wrangler.jsonc:11`)
- [ ] **#454** **[P2] [seo]** Write a share-oriented title/description — "Loom — Data Storyteller" / "Local-first data storytelling…" describes the desktop app; for phone shares use e.g. "Loom — turn live data into a shareable chart" and mention live quakes/flights/crypto; keep ≤60/≤155 chars. (`src/app/layout.tsx:12-13`)
- [ ] **#455** **[P2] [seo]** Disable iOS telephone/number auto-linking — data tables and chart labels with long digit strings can be turned into `tel:` links by Safari; add `formatDetection: { telephone: false, address: false, email: false }` to metadata. (`src/app/layout.tsx:11`)

### PWA and offline

- [ ] **#456** **[P2] [pwa]** Add a Web App Manifest — add `src/app/manifest.ts` (`name`, `short_name: "Loom"`, `start_url: "/"`, `display: "standalone"`, `background_color`/`theme_color` `#0a0a0c`, icons 192/512 + maskable); done when Chrome DevTools > Application shows an installable manifest. (`src/app/layout.tsx:11`)
- [ ] **#457** **[P2] [pwa]** Register a Web Share Target — let phone users share a CSV/JSON from Files/Drive straight into Loom: add `share_target: { action: "/share-target", method: "POST", enctype: "multipart/form-data", params: { files: [{ name: "file", accept: ["text/csv", ".csv", "application/json"] }] } }` and handle it in the service worker (stash in Cache, redirect to `/#ingest=…`). This directly serves "find data → viz → share". (`src/app/layout.tsx:11`)
- [ ] **#458** **[P2] [pwa]** Add a minimal service worker for the app shell — cache `index.html` (network-first) and `/_next/static/*` (cache-first, immutable) so repeat visits on flaky mobile networks start instantly and demo files work offline; write it by hand in `public/sw.js` (no Workbox dependency) and register from a client component only when `!isTauri()`. (`src/app/page.tsx:390`)
- [ ] **#459** **[P2] [pwa]** Cache the last `/api/source/<kind>` snapshot for offline/slow starts — store the last successful JSON per kind in the SW cache (stale-while-revalidate) so "What's interesting right now" renders immediately on reopen. (`src/lib/webStreams.ts:1082`)

## P2 · Build, CI & tooling (16)


### Tests and CI

- [ ] **#460** **[P2] [ops]** Run `cargo test` in `make test` — `make test` only runs Vitest, so the Rust registry-parity test (`specs_match_typescript_registry`) and all parser tests don't run in the standard loop. Add `cd src-tauri && cargo test --lib`; done when `make test` fails on a Rust test failure. (`Makefile:208`)
- [ ] **#461** **[P2] [ops]** Stop swallowing clippy failures — `cargo clippy --all-targets 2>/dev/null || true` hides both output and failures, so `make check` passes with clippy errors. Run `cargo clippy --all-targets -- -D warnings` (skip only if clippy is not installed); done when a clippy error fails `make check`. (`Makefile:222`)

### Security

- [ ] **#462** **[P2] [deps]** Upgrade `next` to ≥15.5.24 — `npm audit --omit=dev` flags 1 critical + 9 high advisories for 15.5.12 (most target server features unused by static export, but the build toolchain and `next dev` rewrites with `LOOM_DEV_API` are affected); done when `npm audit --omit=dev` shows no `next` entry. (`package.json:31`)
- [ ] **#463** **[P2] [deps]** Upgrade `vega-lite` to ^6.4.3 — fixes the high-severity `vega-expression` XSS advisory (<5.2.1) and the invalid peer (`vega-lite@5` wants `vega ^5.24`, `vega@6.2.0` installed), removing duplicate `vega-util` 1.17.4/2.1.0 and `vega-expression` 5.1.2/6.1.0; done when `npm ls vega` shows no "invalid". (`package.json:36`)

### Dependencies

- [ ] **#464** **[P2] [deps]** Align `eslint-config-next` with `next` — `eslint-config-next@16.2.1` + `next@15.5.12` triggers "The Next.js plugin was not detected in your ESLint configuration" during `next build`; pin `eslint-config-next@15.5.x` or upgrade Next to 16 together. (`package.json` devDependencies `eslint-config-next`)
- [ ] **#465** **[P2] [deps]** Upgrade `vitest` 2.1.9 → 3.x (or 4.x) — audit flags critical `tinypool` RCE gadget and high `vite` path traversal via vitest's toolchain. (`package.json` devDependencies `vitest`)
- [ ] **#466** **[P2] [deps]** Upgrade `postcss` to ≥8.5.23 and `tailwindcss` to latest 3.4.x — audit flags `postcss` (XSS in stringify, arbitrary file read) and `tailwindcss` via `chokidar/fast-glob/micromatch`. (`package.json` devDependencies `postcss`, `tailwindcss`)
- [ ] **#467** **[P2] [deps]** Upgrade `wrangler` to latest 4.x in root and `mcp/` — audit flags `miniflare` (via `undici`, `sharp`); `mcp/` also has 7 high. (`package.json` devDependencies `wrangler`, `mcp/package.json`)

### Build configuration and tooling

- [ ] **#468** **[P2] [build]** Pin the workspace root — `next build` warns it inferred `/Users/powerox` as root because of a stray `~/package-lock.json`; add `outputFileTracingRoot: import.meta.dirname` and `turbopack: { root: import.meta.dirname, ... }` in `next.config.mjs`; done when the warning is gone. (`next.config.mjs:7`)
- [ ] **#469** **[P2] [build]** Migrate off `next lint` — it is deprecated (removed in Next 16) and is what `npm run lint`/`make check-ts` call; change the script to `eslint . --max-warnings=63` (ratchet down) and run `npx @next/codemod next-lint-to-eslint-cli .`. (`package.json:9`, `Makefile:243-247`)
- [ ] **#470** **[P2] [build]** Type-check the Worker — `tsconfig.json` excludes `workers/`, and wrangler's esbuild does not type-check, so the 1,004-line `catalog-proxy.ts` is never checked; run `wrangler types` to generate `worker-configuration.d.ts`, add `workers/tsconfig.json` (`lib: ["es2022"]`, `types: ["./worker-configuration.d.ts"]`), and add `"check:worker": "tsc -p workers"`; current trial shows only 3 errors (`caches.default`, `KVNamespace`). (`tsconfig.json:41-46`)
- [ ] **#471** **[P2] [build]** Fix the MCP Worker's 107 type errors and 1.38 MB bundle — `mcp/src/index.ts` imports `src/lib/recommendations.ts`, which drags in DOM/canvas modules (`oddCharts`, `socialExport`, `geoMaps`, `chartLooks`, `store` with `requestAnimationFrame`); split a pure `recommendCore.ts` (no DOM, no store) used by both; done when `cd mcp && npx tsc --noEmit` has 0 errors and dry-run bundle < 300 KiB. (`mcp/src/index.ts:11`, `src/lib/recommendations.ts:60`)

### CI

- [ ] **#472** **[P2] [ci]** Add a `worker` CI job — `npx wrangler types --check` (or generate) → `npx tsc -p workers` → `npx wrangler deploy --dry-run --outdir dist-worker` and fail if gzip > 100 KiB. (`wrangler.jsonc:6`)
- [ ] **#473** **[P2] [ci]** Add an `mcp` CI job — `cd mcp && npm ci && npx tsc --noEmit && npx wrangler deploy --dry-run`; today it has 107 type errors that nobody sees. (`mcp/package.json:6-10`)
- [ ] **#474** **[P2] [ci]** Add a `rust` CI job on `macos-14` with `Swatinem/rust-cache@v2`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (52 tests) in `src-tauri/`. (`src-tauri/Cargo.toml:1`)
- [ ] **#475** **[P2] [ci]** Add an `e2e` CI job — `npx playwright install --with-deps chromium webkit` → build → serve `out/` + `wrangler dev` → `npx playwright test`; upload the HTML report and screenshot diffs as artifacts. (`docs/screenshots/README.md:13`)

## P2 · Tests (30)


### Tests

- [ ] **#476** **[P2] [test]** Add `chartTooltip.test.ts` — no tests cover `pickHitTarget`/`hitDistance` (arc wrap-around across −π/2, thin-rect slop, circle vs rect priority), `rowForHitTarget` with `allowed`, or `buildBarFacetGrid` ordering (ordered keys vs ranked). Done when those cases are covered, including a pie slice that crosses the 12 o'clock seam. (`src/lib/chartTooltip.ts:119`)
- [ ] **#477** **[P2] [test]** Add a regression test for anomaly index space — assert that `anomalyZScore`, `anomalyIQR` and `anomalyMAD` return the same real row indices for data with leading nulls/strings, and that MAD=0 returns []. Done when the test fails on the current code and passes after the fix. (`src/lib/__tests__/smartAnalytics.test.ts:31`)
- [ ] **#478** **[P2] [test]** Add a palette contrast test — assert every `THEME_CHART[theme]` colour has ≥3:1 contrast against `THEME_UI[theme].bg` and that the unified ink helper reaches ≥4.5:1 on every palette stop. Done when the test exists and guards both the default palettes and colourblind (`okabe`, `cividis`) stops. (`src/lib/chartPalettes.ts:65`)
- [ ] **#479** **[P2] [test]** Unit-test the Canvas renderers with the recording context from `creativeRenderers.test.ts` — after extracting the `renderFull*` functions, cover: log-scale tick placement, compare-previous x-offset, shared facet scales, empty-state messages, and "every kind registers ≥1 hit target". Done when the core kinds (bar, line, area, scatter, pie, heatmap, box) have render tests. (`src/lib/__tests__/creativeRenderers.test.ts:15`)

### DetailPanel — Stats / Export / Smart

- [ ] **#480** **[P2] [test]** Move the correlation matrix into smartAnalytics — the Pearson math runs inline in onClick, is cast `as never`, uses hard-coded `rgba(108,92,231,…)` heat colours (:2528) and silently keeps only the first 8 columns. Move it to smartAnalytics.ts with unit tests, type it in SmartResults, and colour cells with `color-mix(var(--loom-accent))`. Done when the tests cover r=±1 and NaN columns. (`src/components/DetailPanel.tsx:2482`)

### Design tokens & CSS (globals.css / tailwind.config.ts)

- [ ] **#481** **[P2] [test]** Test theme token contrast — add `src/lib/__tests__/themeContrast.test.ts` that parses the theme blocks in globals.css and asserts text, muted, label, accent and warning are at least 4.5:1 and borders/chart series at least 3:1 on bg, surface and elevated for each theme. Done when the test fails on today's dark accent and passes after the fix. (`src/styles/globals.css:149`)

### Shared primitives & tests

- [ ] **#482** **[P2] [test]** Set up component tests — vitest runs in `environment: "node"` with coverage limited to `src/lib`, and no component tests exist. Add jsdom and @testing-library/react, then tests for PromptDialog (Enter, Escape, async confirm), the Toast timer, the Onboarding timeout, and HomeContent shortcuts. Done when `make test` runs `.test.tsx` files. (`vitest.config.ts:7`)
- [ ] **#483** **[P2] [test]** Add eslint-plugin-jsx-a11y — the flat ESLint config has no jsx-a11y plugin, which is why unassociated labels, click handlers on non-interactive elements and missing alt slipped through. Add it, fix or justify violations, and run it in `make check`. Done when lint catches an unlabeled `<label>` regression. (`eslint.config.mjs:1`)

### Tests

- [ ] **#484** **[P2] [test]** Add unit tests for CSV export — there is no test for `csvExport.ts`; cover quotes, embedded CR/LF, null/undefined, formula-injection prefixes, BOM and header-only results. Done when `src/lib/__tests__/csvExport.test.ts` covers each case. (`src/lib/csvExport.ts:18`)
- [ ] **#485** **[P2] [test]** Add tests for `validateQuery` — cover parens inside strings/comments, FROM-first, DESCRIBE/SUMMARIZE and empty input so the P1 validator fix can't regress. Done when `queryValidate.test.ts` exists and passes. (`src/lib/queryValidate.ts:11`)
- [ ] **#486** **[P2] [test]** Add time-zone tests for `dateFormat` and Dive bucketing — run `formatDateCell`, `bucketFloor`/weekly buckets and `formatBucket` under `TZ=America/New_York` and `Pacific/Auckland` (vitest `process.env.TZ` per file), including a DST-crossing series. Done when the day-shift and Thursday-week bugs fail before the fix and pass after. (`src/lib/dateFormat.ts:23`)
- [ ] **#487** **[P2] [test]** Add escaping tests for share/microsite HTML — feed `<script>`, `"` and `'` through `dashboardName`, slot labels, `sourceLabel`, caption and `openUrl` of both builders and assert no raw markup; this would have caught the unescaped footer. Done when `dashboardMicrosite.test.ts` covers every interpolated field. (`src/lib/dashboardMicrosite.ts:59`)

### Tests & tooling

- [ ] **#488** **[P2] [test]** Add persist.ts unit tests — nothing covers corrupt JSON → defaults, `setItem` throwing (quota), slice caps, or chart-view round-trips (incl. the missing `querySql`); add `persist.test.ts` with an in-memory localStorage stub. Done when every get/set pair has a round-trip and a corrupt-input test. (`src/lib/persist.ts:53`)
- [ ] **#489** **[P2] [test]** Cover store actions beyond setters — store.test.ts only checks simple setters; add tests for `swipeViz`, `startDeepScan` (fake timers), `applyChartView`, `applyTableView`, `undoTable`/`redoTable`, `addRecentFile` field merge, `removeDashboard`, `moveDashboardSlot`, and `createStoryDashboard`'s failure path. Done when each listed action has ≥1 behavioral assertion. (`src/lib/store.ts:1223`)
- [ ] **#490** **[P2] [test]** Test the web stream lifecycle — webStreamsResilience.test.ts has one case; add tests for `webStreamStart` with a stub EventSource, `parseWikiEvent`, rate after clear, start/stop race, `seenIds` bound after trim, and overlapping slow polls. Done when those six scenarios run in CI. (`src/lib/webStreams.ts:1037`)
- [ ] **#491** **[P2] [test]** Add value-level fixtures for older parsers — parseUsgs, parseNws, parseMeteo/openMeteoUtc, parseAq, parseIss, parseOpensky, parseCountries, parseSpacex, parseNyc311, parseCovid, parseFema, parseHn, parseLobsters, parseCrypto, parseWorldBank and `isoOrNull` are only covered by the "rows as wide as registry columns" check; record small upstream samples under `__fixtures__/` and assert cell values/types. Done when each parser has a fixture test asserting at least ids, timestamps and one numeric. (`src/lib/webStreams.ts:195`)
- [ ] **#492** **[P2] [test]** Test discover hooks — discoverStories.test.ts (20 lines) only checks constants; export `hookFor` (or the HOOKS map) and test each feed with a fixture sample, including empty samples, NaN cells, Kp 4.67, and SpaceX upcoming flights. Done when every DiscoverKind has a hook test. (`src/lib/discoverStories.ts:127`)
- [ ] **#493** **[P2] [test]** Fill CSV parser gaps — no tests cover `sniffCsvDelimiter` (TSV/semicolon), complete files without a trailing newline, leading-zero codes, duplicate/blank headers, null tokens, `statsFromData` text min/max, or `mockInspect` on an unknown path. Done when each case has a test in mock-data.test.ts. (`src/lib/mock-data.ts:131`)
- [ ] **#494** **[P2] [test]** Add recommendation-quality regression tests — nothing asserts that `recommend()` avoids "Sum of year", id columns as measures, log axes on signed columns, or `candidate` as time; add 3 fixture schemas (gov CSV, OWID-style, sales) with a seeded RNG and snapshot the top-10 titles plus explicit negative assertions. Done when the suite fails if any of those anti-patterns reappears. (`src/lib/recommendations.ts:1125`)
- [ ] **#495** **[P2] [test]** Enable DOM tests for hydration — vitest runs `environment: "node"` only, so HydrateStore's effect-order bugs (defaults persisted on first visit, double writes) can't be tested; add happy-dom via `// @vitest-environment happy-dom` per file and a HydrateStore test asserting saved settings win and defaults aren't written on first visit. Done when that test exists and runs in `make test`. (`vitest.config.ts:7`)

### MCP / ChatGPT plugin Worker

- [ ] **#496** **[P2] [test]** Add tests for the MCP profiler and widget document — `mcp/` has no tests, and `vitest.config.ts` only includes `src/**`. Add `mcp/src/__tests__/profile.test.ts` (quoted CSV, truncation, JSON caps) and a `widgetDocument` escaping test, and include `mcp/**/*.test.ts` in Vitest; done when `make test` runs them. (`vitest.config.ts:7`)

### Tests and CI

- [ ] **#497** **[P2] [test]** Add parser fixtures/tests for FIRMS, NWIS, Starlink and Lobsters on desktop — `sources_tests.rs` covers 30 kinds but has no `firms_rows`, `nwis_rows`, `starlink_rows` or `lobsters_rows` test, and no fixtures exist for them. Add fixtures and assertions (including NWIS offset timestamps); done when each parser has a test. (`src-tauri/src/sources_tests.rs:219`)
- [ ] **#498** **[P2] [test]** Cover the newest Worker transforms — `sourceTransforms.test.ts` has no cases for `firmsViirsCsv`, `nwisIvWide` or `starlinkGp`. Add tests that reuse the Rust fixtures so both sides are checked against the same inputs; done when all three are tested. (`src/lib/__tests__/sourceTransforms.test.ts:223`)
- [ ] **#499** **[P2] [test]** Test the Worker request handlers — nothing tests `handleFetchCsv` (SSRF blocks, truncation, xlsx sniff), `handleSource` (HIT/MISS/STALE, unknown kind), or `handlePublishStory`/`handleGetStory` (origin check, id regex, size caps). Add Vitest tests with a mocked `fetch`, `caches.default` and KV (or `@cloudflare/vitest-pool-workers`); done when each handler branch has a test. (`workers/catalog-proxy.ts:127`)
- [ ] **#500** **[P2] [test]** Assert every registry kind has a Worker fetcher and TTL — `SOURCE_FETCHERS`/`SOURCE_TTL_SECS` are maintained by hand, and a new registry kind without a fetcher only fails at runtime with "Unknown source". Export the maps and add a test against `SOURCE_DEFS` (and TTL ≤ pollMs); done when removing a fetcher fails `make test`. (`workers/catalog-proxy.ts:315`)
- [ ] **#501** **[P2] [test]** Add unit tests for `stream.rs` — there are no tests for `parse_sse_event`, chunk reassembly, `trim_buffer` or `query_stream`. Extract the line-assembly logic into a pure function and test split events, comments/heartbeats and the 50k trim; done when `cargo test` covers the stream module. (`src-tauri/src/stream.rs:158`)

### Testing

- [ ] **#502** **[P2] [test]** Turn the manual screenshot procedure into visual regression — `docs/screenshots/README.md` already specifies 6 reproducible `#chart=`/`#dive=` captures with playwright-core; script it as `e2e/visual.spec.ts` with `toHaveScreenshot()` against demo files (not live feeds) at 1440×900 and 390×844. (`docs/screenshots/README.md:13`)
- [ ] **#503** **[P2] [test]** Add component tests with a DOM environment — 0 of 30 components are tested; add `environmentMatchGlobs: [["src/components/**", "jsdom"]]` + `@testing-library/react`, starting with `ShareSheet` (native share vs copy fallback), `ChartLinkSync` (hash → store), `ErrorBoundary`, and `Toast`. (`vitest.config.ts:6`)
- [ ] **#504** **[P2] [test]** Enable coverage with thresholds — install `@vitest/coverage-v8`, extend `coverage.include` to `workers/**/*.ts`, and set `thresholds: { lines: <current>, functions: <current> }` as a ratchet so new lib code arrives with tests. (`vitest.config.ts:8-13`)
- [ ] **#505** **[P2] [test]** Add a test for `isGeoRegionField`/atlas joins before moving them (the split above) — protect ISO2/ISO3/FIPS join behaviour in `geoMaps.test.ts` against the async atlas refactor. (`src/lib/__tests__/geoMaps.test.ts:1`)

## P2 · Docs & agent DX (15)


### MCP / ChatGPT plugin Worker

- [ ] **#506** **[P2] [docs]** Reconcile the privacy policy with request logging — `privacy.html` says data "is not stored, logged", but `/demo/chat` sends recommendations (derived from user data) in the `/preview?seed=` URL, and `observability.enabled` records request URLs. Move the seed to `postMessage`/POST or disable URL logging, and update the policy; done when no user-derived data appears in Worker logs. (`mcp/wrangler.jsonc:13`)

### Docker, Makefile, scripts

- [ ] **#507** **[P2] [docs]** Document (or fix) that the Docker image has no `/api` backend — `serve out -s` only serves static files, so live sources, catalog search, `/api/fetch-csv`, feedback and share links all fail (the SPA fallback returns `index.html` for `/api/*`). Either run the Worker with `wrangler dev --local` in the container or state the limitation in the Dockerfile header and README; done when one of the two is in place. (`Dockerfile:34`)

### Core Web Vitals and runtime responsiveness

- [ ] **#508** **[P2] [dx]** Report client crashes — `ErrorBoundary.componentDidCatch` only calls an optional prop; POST `{message, stack, viewMode, ua}` to a Worker `/api/client-error` route (rate-limited) and add `window.onerror`/`unhandledrejection` hooks; done when a thrown test error shows in `wrangler tail`. (`src/components/ErrorBoundary.tsx:27`)

### Delivery: Workers static assets, caching, headers

- [ ] **#509** **[P2] [dx]** Upload Worker source maps — add `"upload_source_maps": true` so Workers observability stack traces map to `workers/catalog-proxy.ts` lines. (`wrangler.jsonc:26-28`)

### Makefile and scripts

- [ ] **#510** **[P2] [dx]** Make `make check` include tests and the Worker — it runs `check-ts` + `check-rust` only; add `check: check-ts check-worker check-rust test` so "all checks passed" is true. (`Makefile:231-233`)
- [ ] **#511** **[P2] [dx]** Use a portable shell — `SHELL := /bin/zsh` makes every target fail on ubuntu CI runners and Linux contributors; switch to `/bin/bash` (no zsh-specific syntax is used). (`Makefile:19`)
- [ ] **#512** **[P2] [dx]** Run checks before deploying — `make loft` → `npm run deploy` builds and deploys with no tests/typecheck; make `loft: check-ts test` a prerequisite. (`Makefile:206-210`, `package.json:21`)

### Documentation accuracy

- [ ] **#513** **[P2] [docs]** Regenerate the README project tree — it lists ~20 files while `src/` has 30 components and 55 lib modules (missing e.g. `ChartCard`, `DiveView`, `ShareSheet`, `webStreams`, `sourceRegistry`, `geoAtlas`, `geoMaps`, `oddCharts`, `chartLink`, and shaders `cube/globe/scenes.wgsl`); either generate it with a script or replace with a pointer to DOCS.md. (`README.md:240-320`)
- [ ] **#514** **[P2] [docs]** Correct the rendering pipeline claim — DOCS says "Canvas 2D or Vega for bar/line/area/arc", but Vega is only used for SVG export (`ChartView.tsx:1314`); all on-screen charts are Canvas/WebGPU. (`DOCS.md:23`)
- [ ] **#515** **[P2] [docs]** Update the Testing section — DOCS lists 4 test files; there are 35 (768 tests) including `sourceRegistry`, `webStreamsParsers`, `chartLink`, `geoMaps`, `settingsPressure`; replace the list with categories and the `make test` command. (`DOCS.md:209-218`)

### Repo hygiene and agent DX

- [ ] **#516** **[P2] [dx]** Commit `src-tauri/Cargo.lock` — it is gitignored, so release builds (`release-tauri.yml`) resolve fresh crate versions each tag (duckdb, reqwest, tauri), making desktop releases non-reproducible; remove it from `.gitignore` and commit. (`.gitignore:16`)
- [ ] **#517** **[P2] [dx]** Ignore Claude worktrees — untracked `.claude/` contains a full repo copy (`.claude/worktrees/brave-herschel-b9cefe`, 195 TS files + its own `tsconfig.tsbuildinfo`) and a `launch.json` with an absolute `/private/tmp/...` path; add `.claude/worktrees/` to `.gitignore` and either commit a portable `.claude/launch.json` (ports 3137/3138/8799) or ignore it. (`.gitignore:1`, `.claude/launch.json:41-46`)
- [ ] **#518** **[P2] [dx]** Rewrite the Cursor rule's false constraints — `loom-stack.mdc` says "NEVER render charts with Vega's built-in SVG/Canvas renderer. Always pipe specs to WebGPU" (Canvas 2D is the main renderer), "All data stays on the user's machine" (web goes through the Worker), "Use MLX", "Zero-Copy Arrow → GPU", "M3: Google Cloud Run" (deploy is Cloudflare), and "Components select only the slices they need" (23 violations); agents follow these literally. (`.cursor/rules/loom-stack.mdc:12-16,19-22,108-111,120`)
- [ ] **#519** **[P2] [dx]** Update the Cursor rule's code map — it lists 6 components and 7 lib modules and only `scatter.wgsl`; replace with a pointer to AGENTS.md/DOCS.md to avoid two drifting maps. (`.cursor/rules/loom-stack.mdc:28-70`)
- [ ] **#520** **[P2] [dx]** Add a "Performance rules" section to AGENTS.md — e.g. "never statically import `geoAtlas`, `webgpu*`, `oddCharts`, `vega*` from components; always use selectors with `useLoomStore`; keep First Load JS under the CI budget"; agents currently have no guidance and AGENTS.md's checklist has no perf/test step. (`AGENTS.md:62-70`)

---

# Phase 3 — P3: polish


## P3 · Security & privacy (11)


### Share pages & social export

- [ ] **#521** **[P3] [security]** Harden generated HTML — `escapeHtml` doesn't escape `'`, theme tokens from `getComputedStyle` go into `<style>` unvalidated, and neither page has a CSP. Escape `'`, check tokens against a colour regex, and add `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'">`; done when a crafted `--loom-bg` value can't break out of the style block. (`src/lib/dashboardMicrosite.ts:25`)

### Public catalogs & remote CSV

- [ ] **#522** **[P3] [security]** Validate Socrata permalinks — `permalink: str(r.permalink) ?? …` trusts the API value, which becomes an `href` on "Portal". Accept only `https:` URLs on the dataset's own `domain`, else use the built `https://${domain}/d/${id}`; done when a `javascript:` or off-domain permalink falls back. (`src/lib/publicCatalogs.ts:146`)
- [ ] **#523** **[P3] [security]** Match provenance hosts exactly — `guessHomepageFromDataUrl` uses `hostname.includes("github.com")`, `includes("data.gov")` etc., so `github.com.evil.example` gets a GitHub homepage link. Compare `hostname === h || hostname.endsWith("." + h)`; done when look-alike hosts fall through to their own origin. (`src/lib/dataProvenance.ts:56`)

### Rust: poll sources (sources.rs)

- [ ] **#524** **[P3] [security]** Cap upstream response size in `get_json`/`get_text` — bodies are read fully with no limit, so a misbehaving upstream (or captive portal) can exhaust memory. Check `content_length()` and stream with a per-kind max (e.g. 20 MB); done when an oversized body errors. (`src-tauri/src/sources.rs:1060`)

### Cloudflare Worker: /api/fetch-csv and catalog

- [ ] **#525** **[P3] [security]** Add `X-Content-Type-Options: nosniff` to proxied CSV and story data responses — arbitrary upstream bytes are returned as `text/csv` from the app origin; nosniff prevents browsers from sniffing them as HTML. Done when `/api/fetch-csv` and `/s/*.data` responses carry the header. (`workers/catalog-proxy.ts:213`)

### Cloudflare Worker: /api/source caching and correctness

- [ ] **#526** **[P3] [security]** Restrict CORS on `/api/source/*` to Loom origins — `Access-Control-Allow-Origin: *` lets any site use loom.ibm.io as a free cached gateway to 34 upstreams, consuming their per-IP quotas on Cloudflare's egress. Echo only allowed origins (loom.ibm.io, workers.dev, localhost); done when a third-party origin gets no ACAO header. (`workers/catalog-proxy.ts:58`)
- [ ] **#527** **[P3] [security]** Stop echoing internal error messages — the top-level `catch` returns `e.message` with status 502 for every failure (including bad input), leaking upstream URLs and internals and mislabeling client errors. Map known errors to 4xx and return a generic message plus a request id; done when malformed input yields 400. (`workers/catalog-proxy.ts:997`)

### Cloudflare Worker: stories (/s/*), feedback, and abuse controls

- [ ] **#528** **[P3] [security]** Increase story id entropy — `storyId()` keeps only 12 base36 chars (≈48 bits) and ids are the only protection for shared data snapshots (`/s/<id>.data`). Use 16+ bytes (`crypto.randomUUID()` without dashes) and widen the id regex; done when ids carry ≥96 bits. (`workers/catalog-proxy.ts:809`)
- [ ] **#529** **[P3] [security]** Neutralize Markdown in feedback metadata — `kind` and `href` are interpolated raw into the issue body, so a caller can inject links, images or `@mentions` that ping people. Wrap them in backticks / escape `@` and `[`; done when an `@user` in `kind` doesn't create a mention. (`workers/catalog-proxy.ts:762`)
- [ ] **#530** **[P3] [security]** Validate the og image bytes — the `ogImage` regex checks only the `data:image/png|jpeg` prefix, and the decoded bytes are stored and served as an image without checking PNG/JPEG magic numbers. Verify the signature after `atob` and reject mismatches; done when a non-image payload labeled `image/png` is rejected. (`workers/catalog-proxy.ts:874`)

### Security

- [ ] **#531** **[P3] [security]** Add `npm audit --omit=dev --audit-level=high` as a non-blocking CI job and a weekly Dependabot config (`.github/dependabot.yml` for npm root, `/mcp`, and cargo `/src-tauri`). (`.github/workflows/release-tauri.yml:1`)

## P3 · Charts — correctness & UX (16)


### Canvas chart correctness

- [ ] **#532** **[P3] [bug]** Flag negative aggregates in treemap and force-bubble instead of hiding the sign — both use `Math.abs(aggregateValues(...))`, so a −500 loss renders as a +500 tile with no hint. Drop or hatch negative entries and say so in the tooltip; done when a negative category is visibly marked or excluded with a note. (`src/components/ChartView.tsx:6321`)
- [ ] **#533** **[P3] [bug]** Make mark jitter deterministic and bounded — `jitter()` caches `Math.random()` offsets in a module-level `Map` keyed by point index that grows forever and is shared across charts and sessions, so exports aren't reproducible. Derive jitter from a hash of `(rowIndex, seed)`; done when two exports with jitter on are byte-identical and the map is gone. (`src/components/ChartView.tsx:3728`)
- [ ] **#534** **[P3] [bug]** Format crosshair and ruler readouts with the axis formatter — they use `toPrecision(4)`, so a time x axis reads `(1.728e+12, 42.00)`. Reuse `formatAxisValue`/time formatting from the active x model; done when crosshair over a timestamp axis shows a date. (`src/components/ChartView.tsx:3367`)

### Tooltips & hit testing

- [ ] **#535** **[P3] [bug]** Use `currentTarget` for the scatter hover rect — `handleScatterPointer` measures `(e.target as HTMLDivElement).getBoundingClientRect()`, which is wrong whenever the event targets a child (pinned tooltip, reset button). Use `e.currentTarget`/`overlayRef`; done when hover over a pinned tooltip edge doesn't pick a far-away point. (`src/components/ChartView.tsx:1366`)

### Empty, loading & error states

- [ ] **#536** **[P3] [ux]** Indicate dropped facet panels — `partitionRowsByFacet` keeps the 8 largest groups and silently drops the rest. Draw a "+N more groups" note in the facet title band; done when a 12-group facet shows "+4 more". (`src/lib/chartFacets.ts:43`)
- [ ] **#537** **[P3] [ux]** Tell users when line/area series are dropped — line keeps the 10 largest series and area the 8 largest without any note. Add "+N series hidden" to the legend; done when a 15-series line legend shows "+5 more". (`src/components/ChartView.tsx:4897`)
- [ ] **#538** **[P3] [ux]** Make Sankey flow bands hoverable — only the node rectangles push hit targets, so hovering a ribbon (the main mark) shows nothing. Register each band as a hit (polygon via `isPointInPath`) with source → target and value; done when hovering a ribbon shows its flow value. (`src/components/ChartView.tsx:6674`)
- [ ] **#539** **[P3] [ux]** Drop the node-id legend on network and arc diagrams — `setLegend` lists the first 8 node ids with arbitrary colours, which duplicates the on-canvas labels and implies a categorical encoding that doesn't exist. Show a legend only when Color encodes a real attribute; done when a plain network has no legend box. (`src/components/ChartView.tsx:6811`)
- [ ] **#540** **[P3] [ux]** Rename the status-bar "Vega-Lite spec: {kind}" label — the visible chart is drawn by Canvas/WebGPU, not Vega-Lite, so the label misleads users and contributors. Show the friendly kind name and the encoding; done when the status bar reads e.g. "Bar · region × revenue". (`src/components/ChartView.tsx:3469`)
- [ ] **#541** **[P3] [ux]** Replace the "GPU"/"Canvas" badge with something user-facing or hide it behind a debug setting — the renderer name is developer jargon and the "Canvas look" hint duplicates it. Done when the toolbar shows no renderer jargon by default. (`src/components/ChartView.tsx:3024`)

### Maintainability

- [ ] **#542** **[P3] [code]** Remove dead code in the scatter renderer and friends — the no-op `else if (opts?.residualOverlay === false && fit)` (ChartView.tsx:4155), the empty `if (opts?.residualOverlay && !fit) {}` (4212), `void fontFamily` in Sankey (6733), `void xi; void yi` in radar (5947) and the unused minimap `vx1/vy1` (3401). Done when `eslint --rule no-unused-vars` and a manual pass show none left. (`src/components/ChartView.tsx:4155`)
- [ ] **#543** **[P3] [code]** Delete the unused `vega.ts` — nothing imports `generateScatterSpec`/`autoSpec`; it hard-codes dark-theme hex colours and claims "rendering is handled by WebGPU". Done when the file is removed and `tsc` passes. (`src/lib/vega.ts:33`)
- [ ] **#544** **[P3] [code]** Type `ChartRenderOpts` with unions — `markShape`, `gridStyle`, `legendPosition`, `blendMode`, `axisStyle`, `titleLayout` are `string`, forcing casts like `opts.blendMode as GlobalCompositeOperation` and silent typos. Reuse `ChartAxisStyle`/`ChartBackgroundStyle` and add `LegendPosition`/`MarkShape` unions; done when the casts are gone. (`src/components/ChartView.tsx:3514`)
- [ ] **#545** **[P3] [code]** Stop reading refs during render — `useWebGpuScene/Globe/Cube` read `sceneRendererRef.current`/`cubeRendererRef.current` in the render body, the crosshair overlay reads `containerRef.current.getBoundingClientRect()` in JSX, and the mini-map reads `scatterDataRef.current`; these show stale values and break under React Compiler. Mirror readiness in state and measure in effects; done when no `ref.current` is read in the render path. (`src/components/ChartView.tsx:570`)
- [ ] **#546** **[P3] [code]** Route renderer fallback colours through theme ink — dozens of renderer fallbacks hard-code dark-theme hex (`"#111114"`, `"#e8e8ec"`, `"#6b6b78"`, `drawLegend` defaults at ChartView.tsx:3748), against the AGENTS.md "no hard-coded hex" rule; when an opt is missing, light themes get dark-theme ink. Use `resolveChartInk(opts)` as oddCharts does; done when `grep '#[0-9a-f]{6}'` in the renderers returns only palette definitions. (`src/components/ChartView.tsx:3748`)
- [ ] **#547** **[P3] [code]** Fix stale `applyWorkingChart` and `pivotTable` memo deps — `applyWorkingChart` calls `recommend(stats, sampleRows, …)` without `sampleRows` in its deps, and `pivotTable` reads `chartSampleRows` but depends on `sampleRows` (ChartView.tsx:623), so the docked pivot table keeps showing pre-time-window numbers. Fix both dependency arrays; done when changing the time window updates the pivot table immediately. (`src/components/ChartView.tsx:498`)

## P3 · Data ingest & live feeds (2)


### Source registry & duplicated logic

- [ ] **#548** **[P3] [code]** Derive the kind list from the definitions — `SOURCE_KINDS` duplicates the kinds in `SOURCE_DEFS`, kept aligned only by a test; declare defs as `{ … } satisfies Record<SourceKind, …>` or derive kinds from defs so a missing entry is a compile error. Done when deleting a def fails `tsc`. (`src/lib/sourceRegistry.ts:15`)
- [ ] **#549** **[P3] [code]** Type source stories and snippets by SourceKind — `recommendSourceStory(kind: string)` and `SOURCE_SQL_SNIPPETS: Record<string, …>` mean a new feed without curated charts/snippets compiles fine and silently falls back to `${kind} data`; type as `SourceKind` / `Record<SourceKind, …>`. Done when removing a kind's snippets fails `tsc`. (`src/lib/recommendations.ts:3298`)

## P3 · State & persistence (4)


### Store architecture & selectors

- [ ] **#550** **[P3] [code]** Extract the table-undo snapshot — `pushTableUndo`, `undoTable`, `redoTable` repeat the same 200-char snapshot expression, and `setTableColumnFilters` (bulk) doesn't push undo while `setTableColumnFilter` callers sometimes do; add `snapshotTable(s)` and push undo inside the mutating actions. Done when the expression appears once and bulk filter changes are undoable. (`src/lib/store.ts:827`)
- [ ] **#551** **[P3] [code]** Narrow `reset()` — it is only called from tests yet restores `initialState` wholesale, which would wipe `appSettings`, `vizPreferences`, `recentFiles`, saved views and the export handlers ChartView registered; split into `resetDataset()` (used by #2) and a test-only helper. Done when no runtime path can clear user prefs via `reset`. (`src/lib/store.ts:1325`)
- [ ] **#552** **[P3] [code]** Split the 300-field LoomState into slices — persisted prefs, dataset, chart encoding, pointer interaction, export/share, live status and saved views all live in one `create()` call; use slice creators under `src/lib/store/` composed into `useLoomStore`. Done when store.ts is <400 lines and each slice has its own test file. (`src/lib/store.ts:289`)

### Persistence & hydration

- [ ] **#553** **[P3] [code]** Delete dead persist helpers — `persist.addRecentFile` and `persist.appendQueryHistory` duplicate the store actions and are unused, and Sidebar.tsx:15 reads persisted recents directly, bypassing the store; remove them and read from the store. Done when persist.ts exports only get/set pairs used by HydrateStore. (`src/lib/persist.ts:92`)

## P3 · Recommendations & discover (2)


### Recommendation quality

- [ ] **#554** **[P3] [ux]** Share one lat/lon detector — `recommend()`'s `hasLonLat` requires exact names (`lat|latitude`) while `isLatLonPair` accepts any name containing "latitude", so `start_lat` / `Latitude (deg)` get a lat×lon scatter but no maps; use one detector (token-based) for both. Done when a `start_lat,start_lng` fixture gets geo recs. (`src/lib/recommendations.ts:1941`)
- [ ] **#555** **[P3] [ux]** Stop hard-coding dark hex into Vega specs — `DARK_AXIS`/`baseConfig` bake `#6b6b78`/`#e8e8ec` into every spec, so SVG export on light themes is dark-styled and AGENTS.md's "no hard-coded hex" rule is broken; inject theme tokens at export time. Done when an SVG export under the light theme uses light-theme label colors. (`src/lib/recommendations.ts:64`)

## P3 · Explorer, Query, Dive & Cube (20)


### Explorer data table

- [ ] **#556** **[P3] [ux]** Confirm copy actions — `copyCell`/`copyRow` fire `navigator.clipboard.writeText` with `void` and no toast or failure handling (it rejects on insecure origins). Await it, toast "Copied" or "Couldn't copy"; done when both outcomes show feedback. (`src/components/ExplorerView.tsx:364`)
- [ ] **#557** **[P3] [bug]** Don't group-separate year/id-like integers — `cell.toLocaleString()` turns 2024 into "2,024" and IDs into "1,234,567". Skip separators for columns named like year/id or integer columns whose values are 4-digit years; done when a `year` column shows 2024. (`src/components/ExplorerView.tsx:485`)
- [ ] **#558** **[P3] [ux]** Keep a stable row number after sorting — the "#" column shows `ri + 1` (display index), so sorting renumbers rows and "#" can't identify a row. Show `originalIdx + 1`; done when a row keeps its number after sorting. (`src/components/ExplorerView.tsx:1004`)
- [ ] **#559** **[P3] [ux]** Make the filter row sticky with the header — header cells are `sticky top-0` but the filter-row `th`s aren't, so filters scroll under the header on long tables. Give them `sticky` with a top offset equal to the header height; done when filters stay visible while scrolling. (`src/components/ExplorerView.tsx:933`)
- [ ] **#560** **[P3] [bug]** Fix the stale closure in header long-press — the timeout calls `setProfilingCol(profilingCol === col ? null : col)` with `profilingCol` captured at touch-start; use the functional updater. Done when quick long-presses on two headers toggle correctly. (`src/components/ExplorerView.tsx:884`)

### SQL query view

- [ ] **#561** **[P3] [ux]** Point at the error location — DuckDB errors are shown raw; parse `LINE n:` / caret output and highlight the line in the editor. Done when a syntax error highlights the offending line. (`src/components/QueryView.tsx:397`)
- [ ] **#562** **[P3] [ux]** Make history useful — only successful queries are saved, the dropdown shows 15 of 50 truncated to 50 chars, and history isn't tied to a dataset. Save failures too (flagged), store the source path, and add a searchable history list; done when a query from another file is labelled as such. (`src/components/QueryView.tsx:180`)
- [ ] **#563** **[P3] [bug]** Key result headers safely — `key={col}` collides for duplicate column names (`SELECT 1 AS a, 2 AS a` is legal in DuckDB), causing React key warnings and mis-rendered headers. Key by index; done when duplicate names render without warnings. (`src/components/QueryView.tsx:487`)
- [ ] **#564** **[P3] [ux]** Let users resize the editor — the textarea is fixed `h-24 resize-none`, so 20-line CTEs can't be seen. Allow vertical resize (or auto-grow up to 40vh); done when a long query is fully visible without scrolling the box. (`src/components/QueryView.tsx:350`)
- [ ] **#565** **[P3] [ux]** Add sorting to the results grid — query results can't be sorted or column-resized, unlike Explorer. Reuse the Explorer header/sort component; done when clicking a result header sorts the page. (`src/components/QueryView.tsx:486`)

### Dive builder & engine

- [ ] **#566** **[P3] [bug]** Type derived columns properly — derived columns are given type `"VARCHAR"`, so numeric expressions like `bytes / 1024` reach the cube/charts as text. Infer NUMBER/TIMESTAMP from the first non-null results; done when a numeric derived column can be a cube size field. (`src/components/DiveView.tsx:174`)
- [ ] **#567** **[P3] [ux]** Show where an expression error is — `ExprError` carries `pos`, but `DerivedRow` prints only the message. Render a caret under the offending character; done when "Unknown column foo" underlines `foo`. (`src/components/DiveView.tsx:967`)
- [ ] **#568** **[P3] [bug]** Key filter rows by a stable id — filters render with `key={i}`, so removing filter #1 hands its `DiveChipInput` draft text to the next filter. Add an id to `DiveFilter` (or a WeakMap key); done when deleting a middle filter keeps the others' typed text. (`src/components/DiveView.tsx:542`)
- [ ] **#569** **[P3] [bug]** Make the Samples header actually sticky — `thead sticky top-0` sits inside a height-less `overflow-auto` wrapper while the outer pane scrolls, so it never sticks. Drop the inner overflow or give it a height; done when the header stays visible while scrolling 200 samples. (`src/components/DiveView.tsx:1259`)

### Dive time series & chip input

- [ ] **#570** **[P3] [ux]** Stop repeating series colours — `color(i)` cycles `--chart-1…8`, so with "top 10/25" groups lines 9+ reuse colours and the legend becomes ambiguous. Cap plotted series at 8 with "+N other", or add dash patterns past 8; done when no two visible lines share colour and dash. (`src/components/DiveTimeSeries.tsx:16`)
- [ ] **#571** **[P3] [bug]** Don't split pasted values on every comma — `onPaste` splits on `[,\n\t]`, so pasting one value like "Washington, D.C." makes two chips. Split on newlines/tabs first and only on commas when there are no newlines (or honour CSV quotes); done when that city pastes as one chip. (`src/components/DiveChipInput.tsx:79`)
- [ ] **#572** **[P3] [ux]** Keep the tooltip on-screen on phones — it uses `size.w - 250` for a `max-w-[260px]` box, which overflows on 240–320 px plots and covers the pinned point. Flip side based on hover x and clamp to the container; done when the tooltip never leaves a 320 px-wide plot. (`src/components/DiveTimeSeries.tsx:458`)

### Data cube pivot

- [ ] **#573** **[P3] [code]** Merge duplicate number formatters — `formatCubeNumber` and `formatDiveNumber` are near copies with different rules (cube keeps 4-digit ints literal; dive groups them) and share the tiny-value → "0" bug. Move one formatter into `format.ts`; done when both import it and its tests cover 0.0004, 2024 and 12,345. (`src/lib/dataCube.ts:79`)
- [ ] **#574** **[P3] [ux]** Let the pivot table be copied or exported — the slice table has totals but no copy/CSV action. Add "Copy as TSV" in its header; done when the slice pastes into a spreadsheet with row/column headers. (`src/components/DataCubePivot.tsx:225`)

### Swipe discovery deck

- [ ] **#575** **[P3] [ux]** Make the end of the scan useful — "Scan complete" only offers "Back to chart". List kept charts as tappable thumbnails (apply/share); done when a kept chart can be opened from the summary. (`src/components/VizSwipeDeck.tsx:252`)

## P3 · Share & export (7)


### Share sheet & capture

- [ ] **#576** **[P3] [ux]** Number carousel files by kept slide and report skips — failed slides are skipped silently but filenames and captions use `i + 1`, leaving gaps (01, 03…) while README says "N slides". Number by `slides.length + 1` and toast "2 slides failed: …"; done when files are numbered without gaps. (`src/lib/exportStoryCarousel.ts:74`)

### Share pages & social export

- [ ] **#577** **[P3] [bug]** Put a time zone on exported times — "Updated" and the capture time use the exporter's `toLocaleString()`/`toLocaleTimeString()` with no zone, so viewers elsewhere misread them. Include `timeZoneName: "short"` or an ISO UTC string in a `<time datetime>`; done when the page shows e.g. "Oct 7, 14:05 PDT". (`src/lib/dashboardMicrosite.ts:132`)
- [ ] **#578** **[P3] [bug]** Keep non-ASCII titles in filenames — `slugifyFilename` uses `[^\w\-]`, so "Évolution des prix" becomes "volution_des_prix" and CJK titles become "loom-export". Normalize NFKD, strip diacritics, keep Unicode letters (`\p{L}\p{N}`); done when "Évolution" → "Evolution" and "東京" is kept. (`src/lib/socialExport.ts:264`)
- [ ] **#579** **[P3] [bug]** Fall back when the async clipboard API is missing — `copyTextToClipboard` returns false on insecure origins and older WebViews (Tauri on some Linux builds). Add a hidden-textarea `execCommand("copy")` fallback; done when caption copy works over http on a LAN IP. (`src/lib/socialExport.ts:251`)
- [ ] **#580** **[P3] [ux]** Don't squash long burn-in footers — `fillText(line, …, w - pad * 2)` compresses long source + handle text horizontally. Measure and truncate with an ellipsis (or wrap to two lines); done when a 120-char source credit stays legible on 1080×1080. (`src/lib/socialExport.ts:208`)

### CSV / ZIP export

- [ ] **#581** **[P3] [bug]** Write valid ZIP metadata — local and central headers write general-purpose flag 0 (no UTF-8 name bit 11) and DOS time/date 0, so entries show as 1980-01-01 and non-ASCII names garble. Set bit 0x0800 and the real DOS timestamp; done when unzip lists today's date. (`src/lib/zipStore.ts:64`)
- [ ] **#582** **[P3] [code]** Merge the duplicate download helpers — `downloadCsv` (`csvExport.ts`) and `downloadBlob` (`zipStore.ts`) are the same function with the same revoke bug. Keep one in a `download.ts`; done when both callers import it. (`src/lib/zipStore.ts:116`)

## P3 · Catalogs, sessions & formatting (5)


### Public catalogs & remote CSV

- [ ] **#583** **[P3] [bug]** Decode HTML entities in descriptions fully — `plainDescription` decodes only `&nbsp;` and `&amp;`, so `&quot;`, `&#39;` and `&lt;` show literally in cards. Use a small entity map (or `DOMParser` in the browser); done when `&quot;Parks&quot;` renders as "Parks" with quotes. (`src/lib/publicCatalogs.ts:97`)

### Session resume, hydration & persistence

- [ ] **#584** **[P3] [bug]** Sync persisted views across tabs — two open tabs each write their full `tableViews`/`chartViews`/`dashboards` arrays, so the last writer deletes views saved in the other tab. Listen for `storage` events and merge by id; done when a view saved in tab A appears in tab B without loss. (`src/components/HydrateStore.tsx:258`)
- [ ] **#585** **[P3] [ux]** Show progress while opening shared stories and streams — `openSharedStory` and the stream resume (up to 6×800 ms polling) run with no visible loading state, so recipients see an empty shell for seconds. Set a "Opening shared chart…" status in the store; done when a cold `#story=` link shows a spinner until the chart appears. (`src/components/WebSessionResume.tsx:212`)

### Formatting & time utilities

- [ ] **#586** **[P3] [bug]** Fix `formatNumber` edge cases — 999,950 becomes "1000.0K", negatives are never abbreviated (-5,000,000 → "-5,000,000"), and whole values show "2.0K". Use `Intl.NumberFormat({notation:"compact"})` on `Math.abs`; done when tests cover 999,950 → "1M", -5e6 → "-5M" and 2000 → "2K". (`src/lib/format.ts:15`)
- [ ] **#587** **[P3] [bug]** Render empty date cells as blank, not the string "null" — `formatDateCell` returns `"null"` for null/empty, which then shows as text (and goes into copy) rather than Explorer's italic null marker. Return `""` and let the caller style nulls; done when copying a null date cell copies an empty string. (`src/lib/dateFormat.ts:25`)

## P3 · App shell, panels & NeoSpace handoff (8)


### NeoSpace handoff

- [ ] **#588** **[P3] [bug]** Validate `preferred.kind` before using it — `msg.preferred.kind as ChartKind` is cast without a check and passed to createChartRec. Check it against the known chart kinds and fall back to `recs[0]` when it is unknown. Done when a bogus kind still opens the top recommendation. (`src/components/NeoSpaceIngest.tsx:144`)
- [ ] **#589** **[P3] [ux]** Accept a second handoff in the same tab — `handledRef` stays true after the first ingest, so a later "Open in Loom" from NeoSpace into the same tab is silently ignored. Reset the flag after ingest finishes, or dedupe on a message id. Done when two consecutive handoffs both load. (`src/components/NeoSpaceIngest.tsx:86`)

### TopBar

- [ ] **#590** **[P3] [ux]** Explain why Share is disabled — the button is disabled with only a `title` tooltip, which phones never show. When there's no data, keep it tappable and toast "Open data first", or open StartHere. Done when tapping Share with no data gives guidance. (`src/components/TopBar.tsx:230`)

### Sidebar

- [ ] **#591** **[P3] [bug]** Surface Stop/Clear failures — stream and source Stop/Clear handlers swallow errors in `catch { /* ignore */ }` (Sidebar.tsx:666, :711, :1008), leaving the UI out of sync with no feedback. Toast the failure. Done when a failed Stop shows an error. (`src/components/Sidebar.tsx:1016`)
- [ ] **#592** **[P3] [ux]** Let users remove recent files — Recent has no per-item remove or "Clear recents", and dead entries are only pruned after a failed tap. Add an × per row and a clear action. Done when a recent entry can be removed without opening it. (`src/components/Sidebar.tsx:1997`)

### DetailPanel — Chart encoding & visual controls

- [ ] **#593** **[P3] [ux]** Use plain labels and correct icons — colour scale is "Cat/Seq/Div/Spec/Sem" (:3917), blend modes show raw canvas names like "source-over" (:4551), mark shapes are lowercase ids (:4258), and footnote alignment reuses bar-chart icons (Ico.plain/viz/deep) for left/center/right (:4140). Use readable labels and alignment icons. Done when no raw ids are visible. (`src/components/DetailPanel.tsx:4140`)
- [ ] **#594** **[P3] [code]** Move the hard-coded colours out of the panel — the axis swatches hard-code hexes (:4375-4379, :4437-4441) and the swatch border is `border-black/20` (:1151), against the token rule. Move the swatch sets into chartPalettes constants and use a token border. Done when DetailPanel has no hex literals. (`src/components/DetailPanel.tsx:4375`)

### Overlays & small shell components

- [ ] **#595** **[P3] [ux]** Improve the ErrorBoundary fallback — it shows raw `error.message` in mono, has no `role="alert"`, and "Try again" re-renders the same state that crashed. Add resetKeys (viewMode, selectedFile, activeChart id), an alert role, and a "Report this" action that opens FeedbackNotes prefilled. Done when Try again after a bad chart lands on a working view. (`src/components/ErrorBoundary.tsx:37`)

## P3 · Speed & performance (22)


### Tooltips & hit testing

- [ ] **#596** **[P3] [perf]** Index hit targets spatially — `handleScatterPointer` scans every point per mousemove, `rowForHitTarget` string-compares every row, and `allowedRowIndices` rebuilds a Set over all rows on every move while a tooltip link is active (ChartView.tsx:1467). Bucket targets into a uniform grid at paint time and cache the allowed set per link; done when hover cost stays under 1ms at 20k points. (`src/components/ChartView.tsx:1379`)

### Interaction (scatter, orbit, keyboard)

- [ ] **#597** **[P3] [perf]** Stop re-subscribing the keydown listener on every hover — the effect depends on `scatterTooltip`/`chartTooltip`, so it removes and re-adds the window listener on every pointer move. Read them from refs; done when the effect deps no longer include tooltip state. (`src/components/ChartView.tsx:1081`)

### Performance — React & bundle

- [ ] **#598** **[P3] [perf]** Remove unused draw-effect dependencies — `selectedFile` (and `sampleRows` in the overlay effect) are listed in deps but not read, so file metadata updates force full repaints. Trim deps (and re-enable `react-hooks/exhaustive-deps` for this effect); done when the dependency array only lists values read in the body. (`src/components/ChartView.tsx:2543`)
- [ ] **#599** **[P3] [perf]** Replace O(rows × k) lookups in renderers — area does `series.indexOf(...)` per row, the pie "Other" hit does `rows.findIndex(r => e.other.includes(...))` per slice, and Sankey's `srcColor` does `sortedSources.indexOf` per flow. Use Maps/Sets; done when these loops are O(rows). (`src/components/ChartView.tsx:5417`)

### Explorer data table

- [ ] **#600** **[P3] [perf]** Memoize the column profiling card — the IIFE recomputes sort, histogram and frequency over all rows on every render (including hover). Move it into a `useMemo` keyed on `profilingCol`/`rawRows`; done when hovering rows doesn't rerun the profile. (`src/components/ExplorerView.tsx:757`)

### Data cube pivot

- [ ] **#601** **[P3] [perf]** Avoid `Math.min(...arr)` on row-sized arrays — `buildCubeAxis` and `buildPivotTable` spread arrays of every row's value (up to 20k from Dive, more from charts); engines throw RangeError past ~100k arguments. Use a loop; done when a 200k-row axis builds without error. (`src/lib/dataCube.ts:171`)

### Formatting & time utilities

- [ ] **#602** **[P3] [perf]** Throttle `useViewportWidth` — it calls `setW` on every `resize` event, and mobile browsers fire many as the URL bar shows and hides, re-rendering subscribers continuously. Batch with `requestAnimationFrame` (or `useSyncExternalStore`); done when scrolling on iOS triggers at most one update per frame. (`src/lib/useMediaQuery.ts:35`)

### Rust: DuckDB connection, startup, and query layer

- [ ] **#603** **[P3] [perf]** Drop the extra `DESCRIBE (<sql>)` round trip — `query_inner`, `query_stream` and `source_query` plan every query twice (once to DESCRIBE, once to run), which re-sniffs CSVs. Read column names/types from the executed statement (`stmt.column_names()`, arrow schema); done when each query is prepared once. (`src-tauri/src/db.rs:385`)

### Rust: Wikipedia SSE stream

- [ ] **#604** **[P3] [perf]** Insert stream batches with the DuckDB Appender — `batch_insert` executes one prepared INSERT per event while holding the global lock. Use `conn.appender("wiki_stream")` (ts as a computed timestamp) inside one transaction; done when a 50-event batch is a single append. (`src-tauri/src/stream.rs:214`)
- [ ] **#605** **[P3] [perf]** Add an idle/read timeout to the SSE client — without one a silently stalled TCP connection keeps `running: true` with 0 eps forever. Wrap `bytes_stream().next()` in `tokio::time::timeout` (e.g. 60 s) and reconnect on expiry; done when a stalled connection is detected. (`src-tauri/src/stream.rs:316`)

### Rust: poll sources (sources.rs)

- [ ] **#606** **[P3] [perf]** Use the DuckDB Appender for Replace/Append writes — rows are inserted one `execute` at a time with `TRY_CAST(? AS …)`. Append into an all-VARCHAR staging table and `INSERT … SELECT TRY_CAST(...)`; done when a 2,500-row Starlink write is one append + one insert. (`src-tauri/src/sources.rs:787`)
- [ ] **#607** **[P3] [perf]** Share one HTTP client across sources — `build_client()` is called on every `source_start`, so up to 34 separate connection pools/TLS sessions exist. Store one `reqwest::Client` in managed state and clone it into `PollCtx`; done when only one client is built per app run. (`src-tauri/src/sources.rs:3086`)

### Cloudflare Worker: /api/fetch-csv and catalog

- [ ] **#608** **[P3] [perf]** Skip the extra HEAD round trip — every CSV load does HEAD then GET (two upstream hits, extra latency) only to decide on a Range header. Send the GET directly and truncate while streaming (the cap logic already handles servers that ignore Range); done when one upstream request is made per load. (`workers/catalog-proxy.ts:150`)
- [ ] **#609** **[P3] [perf]** Cache `/api/fetch-csv` responses — identical TidyTuesday/Socrata/catalog CSVs are refetched from origin on every open. Put successful, non-truncated responses in `caches.default` keyed by URL for ~1 h; done when a second load returns `X-Loom-Cache: HIT`. (`workers/catalog-proxy.ts:211`)

### Cloudflare Worker: /api/source caching and correctness

- [ ] **#610** **[P3] [perf]** Let browsers/edge reuse source responses — `sourceResponse` sets no `Cache-Control`, so every client poll invokes the Worker even when the payload is a HIT. Send `Cache-Control: public, max-age=<remaining ttl>, stale-while-revalidate=<stale>`; done when repeated polls within TTL are served without a Worker invocation. (`workers/catalog-proxy.ts:663`)

### Build, release, and observability

- [ ] **#611** **[P3] [perf]** Remove unused dependencies — `arrow` and `thiserror` are never referenced in `src-tauri/src`, `opener` duplicates the shell plugin, and `tokio` pulls `features = ["full"]`. Drop the unused crates and narrow tokio to `rt-multi-thread, macros, time, sync`; done when `cargo machete`/`cargo udeps` reports nothing. (`src-tauri/Cargo.toml:24`)

### Bundle and code splitting

- [ ] **#612** **[P3] [perf]** Lazy-load Ollama client on web — `suggestChartFromOllama` targets `localhost:11434` (desktop feature) but `ollama.ts` ships to every phone; `await import("@/lib/ollama")` inside the click handler. (`src/components/ChartView.tsx:105,893`)
- [ ] **#613** **[P3] [perf]** Prefetch vega on Export tab open instead of on click — SVG export downloads 267 kB gz (vega + vega-lite) at click time on phones; kick off `import("vega")`/`import("vega-lite")` when the Export tab mounts so the share action is instant. (`src/components/ChartView.tsx:1314-1315`)
- [ ] **#614** **[P3] [perf]** Silence the `canvas` resolution warning at the bundler — add `config.resolve.alias.canvas = false` (webpack) and `turbopack.resolveAlias: { canvas: { browser: "./src/lib/empty.ts" } }` so `vega-canvas.node.js` is not traced; done when `npm run build` prints no "Can't resolve 'canvas'". (`next.config.mjs:33-38`)
- [ ] **#615** **[P3] [perf]** Lazy-load the Tauri-only bridge on web — `tauri.ts` already dynamic-imports plugins; also make `NeoSpaceIngest` (new, untracked) and `WebSessionResume` dynamic since they only act on specific URL hashes; done when they are not in the page chunk. (`src/app/page.tsx:35-36`)
- [ ] **#616** **[P3] [perf]** Set an explicit modern `browserslist` (`"browserslist": ["chrome 111", "safari 16.4", "firefox 115", "edge 111"]`) — WebGPU/`color-mix()` already require these; it lets SWC skip transforms in the 1.12 MB page chunk; done when page chunk raw size shrinks and app still runs on iOS 16.4+. (`package.json:1`)

### Core Web Vitals and runtime responsiveness

- [ ] **#617** **[P3] [perf]** Fix the 27 `react-hooks/exhaustive-deps` warnings that hide stale closures/extra renders — notably `DetailPanel.tsx:2214,2220` and `ExplorerView.tsx:175,177` where `x || []` fallbacks create a new array every render and bust 10 memo/callbacks; wrap the fallbacks in `useMemo` or a module-level `EMPTY` constant. (`src/components/DetailPanel.tsx:2214`)

## P3 · Accessibility (18)


### Accessibility

- [ ] **#618** **[P3] [a11y]** Announce render issues — the `renderIssue` overlay appears without `role="alert"` or focus management, so screen-reader users don't learn that the chart can't draw. Add `role="alertdialog"`/`aria-live` and move focus to "Pick a working suggestion"; done when VoiceOver announces the issue title. (`src/components/ChartView.tsx:3169`)
- [ ] **#619** **[P3] [a11y]** Label the icon-only "×" buttons — the ruler clear and pinned-tooltip close buttons render a bare "×" with no `aria-label`. Done when both have "Clear ruler" / "Unpin tooltip" labels and ≥24px hit areas. (`src/components/ChartView.tsx:3392`)
- [ ] **#620** **[P3] [a11y]** Show a focus ring on the scatter overlay — the overlay is `tabIndex={0}` with keyboard shortcuts but no `focus-visible` style, so keyboard users can't tell it's focused. Add a `focus-visible:ring-2 ring-loom-accent` inset ring; done when tabbing into the scatter shows a visible outline. (`src/components/ChartView.tsx:3200`)
- [ ] **#621** **[P3] [a11y]** Fix ChartKindPicker listbox semantics — group headers are plain `div`s inside `role="listbox"` (invalid children), and `aria-selected` marks the current kind instead of the active option. Wrap groups in `role="group" aria-labelledby` and set `aria-selected` on the active option; done when axe reports no listbox violations. (`src/components/ChartKindPicker.tsx:234`)

### Root layout & document

- [ ] **#622** **[P3] [a11y]** Add an h1 and a skip link — the app has no `<h1>`; the sidebar brand is a `<span>` (Sidebar.tsx:453) and `<main>` has no id. Add a visually hidden h1 and a skip link to `<main id="main">`. Done when axe reports no missing-h1 or bypass-blocks issues. (`src/app/page.tsx:786`)

### Sidebar

- [ ] **#623** **[P3] [a11y]** Add text to the live-feed status dot — running vs stopped is shown only by dot colour and pulse. Add sr-only "Live"/"Stopped" text. Done when screen readers announce each feed's state. (`src/components/Sidebar.tsx:1022`)
- [ ] **#624** **[P3] [a11y]** Raise contrast on attribution captions — the source captions use `text-loom-muted/70` and `/80` at 11px, which drops below 4.5:1 on the dark surface. Use the `loom-label` token. Done when the contrast check passes. (`src/components/Sidebar.tsx:1072`)

### Overlays & small shell components

- [ ] **#625** **[P3] [a11y]** Fix SuiteMenu semantics and contrast — `aria-haspopup="true"` (menu) is set on a disclosure region (:118), Escape doesn't return focus to the button (:78), and the resting opacity of 0.42 plus 9–10px group labels (:128, :147) fail contrast. Done when the waffle meets 3:1 at rest and Escape refocuses it. (`src/components/SuiteMenu.tsx:99`)

### Design tokens & CSS (globals.css / tailwind.config.ts)

- [ ] **#626** **[P3] [a11y]** Stop using px font sizes that ignore UI scale — arbitrary sizes like `text-[9px]`/`text-[10px]`/`text-[11px]`/`text-[13px]` and SuiteMenu's inline `fontSize: 11` don't scale with `--app-font-scale` (Onboarding.tsx:596, DetailPanel.tsx:4116, SuiteMenu.tsx:95). Replace them with rem tokens and ban `text-[Npx]` in lint. Done when UI scale 115% enlarges all shell text. (`src/components/SuiteMenu.tsx:95`)

### Explorer data table

- [ ] **#627** **[P3] [a11y]** Give the cell context menu real menu behaviour — `role="menu"` but focus never moves into it, no Escape handler, no arrow-key navigation and no keyboard way to open it. Focus first item on open, close on Escape/blur, return focus to the cell; done when it passes the APG menu pattern. (`src/components/ExplorerView.tsx:511`)
- [ ] **#628** **[P3] [a11y]** Offer a non-drag column reorder — header reorder is HTML5 drag-and-drop only, which doesn't work on touch or keyboard. Add move left/right actions in the profile card or Columns popover; done when columns can be reordered on a phone. (`src/components/ExplorerView.tsx:864`)

### SQL query view

- [ ] **#629** **[P3] [a11y]** Tie the live validation message to the editor — the warning under the textarea isn't referenced by `aria-describedby`/`aria-invalid` and flickers on every keystroke (e.g. while typing "("). Validate on pause/Execute and link it; done when screen readers read the error on focus. (`src/components/QueryView.tsx:355`)

### Dive builder & engine

- [ ] **#630** **[P3] [a11y]** Announce Dive results and errors — the "N of M rows · ms" summary and the load error `<p>` aren't live regions, so filter changes are silent for screen readers. Add `aria-live="polite"` to the summary and `role="alert"` to errors; done when VoiceOver reads the new match count after a drill. (`src/components/DiveView.tsx:808`)
- [ ] **#631** **[P3] [a11y]** Use tab semantics for Time series / Table / Samples — they're `aria-pressed` buttons in a `<nav>`. Use `role="tablist"`/`tab`/`tabpanel` with arrow-key switching; done when the view switcher passes the APG tabs pattern. (`src/components/DiveView.tsx:792`)

### Data cube pivot

- [ ] **#632** **[P3] [a11y]** Expose axis-chip selection state — click-to-swap sets `picked` but the chip has no `aria-pressed`, and the `[`, `]`, Esc shortcuts appear only in `title`. Add `aria-pressed`, a visible "Pick another axis to swap" hint, and `aria-keyshortcuts`; done when screen readers announce the picked axis. (`src/components/DataCubePivot.tsx:102`)

### Share sheet & capture

- [ ] **#633** **[P3] [a11y]** Finish the format radiogroup — buttons have `role="radio"` but no arrow-key movement or roving tabindex, and five formats in `grid-cols-4` leave "Link" alone on a second row. Add arrow keys and use `grid-cols-5` (or 3+2); done when arrows move the selection and the grid is balanced. (`src/components/ShareSheet.tsx:438`)
- [ ] **#634** **[P3] [a11y]** Describe the preview image — `alt="Share preview"` says nothing about the chart. Use `alt={`${chartTitle} — ${preset.label} preview`}`; done when screen readers read the chart title. (`src/components/ShareSheet.tsx:417`)

### Public catalogs & remote CSV

- [ ] **#635** **[P3] [a11y]** Stop double announcements — `role="alert"` error paragraphs sit inside an `aria-live="polite"` container, so screen readers announce errors twice; the result count also isn't announced. Use one live region with "30 datasets found" / error text; done when VoiceOver reads each outcome once. (`src/components/PublicCatalogSections.tsx:219`)

## P3 · Mobile & touch (phone loop) (6)


### Mobile & touch

- [ ] **#636** **[P3] [mobile]** Close the kind picker on outside touch reliably — outside-close listens to `mousedown` only; use `pointerdown` so touch, pen and mouse behave the same and the close doesn't wait for synthetic mouse events. Done when a tap outside closes the popover without a delay on Android. (`src/components/ChartKindPicker.tsx:96`)
- [ ] **#637** **[P3] [mobile]** Expose "Save view" on phones — the button is `hidden sm:inline-flex`, so on phones a chart can't be saved to dashboards from Chart view. Move it into the mobile overflow/share sheet; done when a 375px viewport can save a chart view. (`src/components/ChartView.tsx:3018`)

### NeoSpace handoff

- [ ] **#638** **[P3] [mobile]** Close the drawers after a handoff on phones — ingest sets the chart view but leaves the sidebar and panel drawers open, unlike `leaveSourcesShowChart` (Sidebar.tsx:44). Reuse that helper. Done when a phone handoff shows the chart full-screen. (`src/components/NeoSpaceIngest.tsx:164`)

### App shell (page.tsx)

- [ ] **#639** **[P3] [mobile]** Close drawers on phones only on first mount — the matchMedia `change` listener closes the drawers every time the viewport crosses 767px (for example when rotating a tablet), closing a sidebar the user opened. Apply only on initial mount. Done when rotating an iPad keeps the open sidebar. (`src/app/page.tsx:500`)

### Dive time series & chip input

- [ ] **#640** **[P3] [mobile]** Enlarge chip remove targets — the chip × button is `px-0.5` text-2xs (~10×14 px), far below 44 px. Pad the hit area (e.g. `min-w-6 min-h-6` + negative margin); done when the target is at least 24 px. (`src/components/DiveChipInput.tsx:95`)

### Share pages & social export

- [ ] **#641** **[P3] [mobile]** Prefer MP4 where WebM can't be shared — `recordCanvasVideo` tries WebM first; iOS Photos/Instagram won't take WebM. Prefer `video/mp4` when `isTypeSupported` and the device is iOS/macOS Safari; done when an iPhone recording saves to Photos. (`src/lib/socialExport.ts:305`)

## P3 · Desktop app (Tauri / Rust) (11)


### Rust: DuckDB connection, startup, and query layer

- [ ] **#642** **[P3] [bug]** Match data-file extensions case-insensitively — the glob patterns only match lower-case `.csv/.parquet/...`, so `SALES.CSV` or `x.Parquet` are invisible. Use `glob::MatchOptions { case_sensitive: false }` or a walk + lowercase extension check; done when a test finds `DATA.CSV`. (`src-tauri/src/db.rs:98`)
- [ ] **#643** **[P3] [bug]** Surface row-conversion errors instead of dropping rows — `query_inner` (`if let Ok(r)`), `query_stream` and `source_query` (`rows.flatten()`) silently skip rows that fail to convert, and `total_rows` is just the returned count. Return the first error (or a `skipped` count) and rename/document `total_rows`; done when a forced conversion failure is visible in the result. (`src-tauri/src/db.rs:421`)
- [ ] **#644** **[P3] [code]** Deduplicate the three query/stats implementations — `db.rs::query_inner`, `stream.rs::query_stream` and `sources.rs::source_query` (plus three copies of the per-column stats loop) are near-identical and already diverge on LIMIT handling. Extract `run_query(conn, view_sql, user_sql, limit)` and `column_stats(conn, table_expr)`; done when the three modules call one helper. (`src-tauri/src/sources.rs:3154`)

### Rust: poll sources (sources.rs)

- [ ] **#645** **[P3] [code]** Drop or justify the schema-drift migration — `ensure_tables` drops and recreates drifted tables, but the database is `open_in_memory()` so tables never survive a restart; it also re-runs for all 34 tables on every `source_start`. Either persist DuckDB to the app data dir (making the migration meaningful) or remove the per-start call and the migration; done when the choice is documented in DOCS.md. (`src-tauri/src/sources.rs:597`)
- [ ] **#646** **[P3] [bug]** Normalize NWIS and FIRMS timestamps through `parse_iso_utc` — `nwis_rows` stores raw `dateTime` strings with `-04:00` offsets and `firms_rows` builds `…Z` strings, both relying on DuckDB's implicit `TRY_CAST` offset handling, unlike every other parser (and unlike the Worker's `utcIso`). Route both through `parse_iso_utc`; done when fixtures assert UTC `ts` values. (`src-tauri/src/sources.rs:2039`)
- [ ] **#647** **[P3] [bug]** Avoid flagging non-debris Starlink names — `name.to_uppercase().contains("DEB")` drops any name containing "DEB" as a substring, while the Worker uses `/\bDEB\b/`. Use a word-boundary check to match; done when both sides filter the same fixture identically. (`src-tauri/src/sources.rs:2072`)

### Rust ↔ Worker source parity

- [ ] **#648** **[P3] [bug]** Align aircraft fallback behaviour — desktop uses Atlanta and only ADSB.lol with `MAX_AIRCRAFT = 1500` and a single poll-time `ts`, while the Worker uses Denver, adds an adsb.fi fallback, caps at 2000 and derives per-aircraft times from `seen`. Share the point list/caps and port the adsb.fi fallback + `seen` timing; done when both take the same points and cap. (`src-tauri/src/sources.rs:1439`)
- [ ] **#649** **[P3] [bug]** Tolerate partial failures the same way on both sides — Worker `countries` and `world_bank` use `Promise.all`, so one indicator or the population call failing fails the whole feed, while desktop skips failed indicators / empty population. Use `Promise.allSettled` in the Worker; done when one failing World Bank indicator still returns rows. (`workers/catalog-proxy.ts:501`)

### Build, release, and observability

- [ ] **#650** **[P3] [ops]** Build a universal macOS binary and pin the action — CI runs on `macos-14` (Apple Silicon only) with `tauri-action@v0` floating. Pass `args: --target universal-apple-darwin` (add the x86_64 target) and pin the action to a SHA; done when the release attaches a universal DMG. (`.github/workflows/release-tauri.yml:20`)
- [ ] **#651** **[P3] [ops]** Wire the Tauri updater — there is no `tauri-plugin-updater` or `plugins.updater` config, so desktop users never learn about fixes (including the security items above). Add the updater with a signed `latest.json` published by the release workflow; done when an older build offers the update. (`src-tauri/tauri.conf.json:39`)

### Docs drift

- [ ] **#652** **[P3] [code]** Remove the empty `src/app/api/data-gov` directory — it is a leftover from a pre-static-export API route (`output: "export"` forbids API routes) and suggests a backend that doesn't exist. Delete it; done when `src/app/api` is gone. (`src/app/api/data-gov`)

## P3 · Worker & MCP backend (6)


### Cloudflare Worker: stories (/s/*), feedback, and abuse controls

- [ ] **#653** **[P3] [bug]** Measure story size limits in bytes — `MAX_STORY_HTML_BYTES` and `MAX_STORY_DATA_BYTES` are compared to JS string `.length` (UTF-16 units), so non-ASCII payloads can be up to 3× larger than intended. Compare `new TextEncoder().encode(x).byteLength`; done when the 900 KB data cap is enforced in bytes. (`workers/catalog-proxy.ts:864`)

### Cloudflare Worker: config and headers

- [ ] **#654** **[P3] [code]** Centralize allowed origins — the origin list (`loom.ibm.io`, `loom-storyteller.mhsenkow.workers.dev`, `localhost`, `127.0.0.1`) is duplicated in `handleFeedback` and `handlePublishStory`. Move it to a `vars.ALLOWED_ORIGINS` entry in `wrangler.jsonc` read from `env`; done when one place defines it. (`workers/catalog-proxy.ts:719`)

### MCP / ChatGPT plugin Worker

- [ ] **#655** **[P3] [bug]** Return structured tool errors — `JSON.parse` and the "Provide csv, json, or columns" `throw` escape the tool handlers, so clients get a generic protocol error. Catch in `resolveProfile` and return `{ isError: true, content: [{type:"text", text}] }`; done when malformed JSON yields a readable tool error. (`mcp/src/index.ts:95`)
- [ ] **#656** **[P3] [bug]** Drop a partial last row when CSV is truncated — slicing CSV text at `MAX_BYTES` cuts mid-row, producing a malformed final row that skews types and distinct counts. Trim back to the last newline after slicing; done when a truncated CSV's last row has full width. (`mcp/src/profile.ts:133`)
- [ ] **#657** **[P3] [bug]** Tighten DATE detection — `detectType` counts any `Date.parse`-able value as a date, and V8 accepts many free-text strings (e.g. `"Beta 2"`), so label columns can be typed DATE. Require ISO-like patterns only and add INTEGER/BOOLEAN detection; done when a test shows `["Alpha 1","Beta 2"]` stays VARCHAR. (`mcp/src/profile.ts:27`)
- [ ] **#658** **[P3] [ops]** Add basic abuse limits to the authless MCP endpoint — `/mcp` is open with `origin: "*"` and no rate limit while `recommend()` over 500 rows is CPU-heavy. Add a Rate Limiting binding per IP and `limits.cpu_ms`; done when bursts above the limit get 429. (`mcp/src/index.ts:382`)

## P3 · Web delivery, SEO & PWA (2)


### PWA and offline

- [ ] **#659** **[P3] [pwa]** Bundle demo CSVs as static assets — make the built-in demo files fetchable from `public/demo/*.csv` (precached by the SW) instead of in-JS generation, so first chart works offline. (`src/lib/mock-data.ts:1`)
- [ ] **#660** **[P3] [pwa]** Add an update prompt — when the SW detects a new build (`registration.waiting`), show the existing `Toast` with "New version — reload", tying into `WhatsNew`. (`src/components/Toast.tsx:1`)

## P3 · Build, CI & tooling (10)


### Docker, Makefile, scripts

- [ ] **#661** **[P3] [ops]** Modernize the Docker build — `npm ci --production=false` is a deprecated flag (use `--include=dev`), Node 22 in Docker differs from Node 20 in CI, `serve@14` is installed unpinned at build time, and there's no `HEALTHCHECK`. Align Node versions, pin `serve` in a lockfile, add a healthcheck; done when the image builds without npm warnings. (`Dockerfile:18`)

### Fonts and CSS

- [ ] **#662** **[P3] [build]** Update `theme-color` with the active theme — the two static `<meta name="theme-color">` tags follow OS scheme only, so a "paper" or "nes" theme shows a mismatched browser bar on phones; set `document.querySelector('meta[name=theme-color]')` from `ThemeApplicator` using `getThemeUiColors(theme).bg`. (`src/app/layout.tsx:20-23`, `src/components/ThemeApplicator.tsx:41`)

### Dependencies

- [ ] **#663** **[P3] [deps]** Pin the Node version — release CI uses Node 20, Dockerfile uses `node:22-alpine`, no `.nvmrc`/`engines`; add `.nvmrc` (`22`) and `"engines": { "node": ">=20.18 <23" }` and use `node-version-file: .nvmrc` in workflows. (`package.json:1`, `Dockerfile:13`, `.github/workflows/release-tauri.yml:27`)
- [ ] **#664** **[P3] [deps]** Replace `raw-loader` (webpack-4-era, unmaintained) for Turbopack dev — Turbopack in Next 15.5 supports `rules: { "*.wgsl": { type: "raw" } }`; delete `raw-loader` and keep webpack `asset/source`; done when `npm run dev` still renders WebGPU scatter. (`next.config.mjs:25-31`)
- [ ] **#665** **[P3] [deps]** Add `prettier` as a devDependency (pinned) or remove the `fmt` script — `npm run fmt` and `make fmt` call `prettier` which is not installed (`make fmt` hides the failure with `|| true`). (`package.json:18`, `Makefile:263-266`)

### Build configuration and tooling

- [ ] **#666** **[P3] [build]** Make WGSL loading identical in dev and prod — dev (Turbopack) uses `raw-loader`, build (webpack) uses `asset/source`, Vitest has no `.wgsl` handling at all (so `webgpu*.ts` can't be imported in tests); add a tiny Vite plugin in `vitest.config.ts` that returns `export default ${JSON.stringify(code)}` for `.wgsl`. (`next.config.mjs:25-38`, `vitest.config.ts:1`)
- [ ] **#667** **[P3] [build]** Fix the 7 `no-unused-expressions` warnings — `a && b()` statement patterns at `ChartCard.tsx:1301,1340,1380` and `ChartView.tsx:3647,3657,6019,6065` should be `if` statements (they read as bugs to reviewers and agents). (`src/components/ChartView.tsx:3647`)
- [ ] **#668** **[P3] [build]** Remove the 23 unused variables flagged by ESLint (e.g. `ChartView.tsx:202,205,3401-3402,3940-3941`, `QueryView.tsx:30-31,303`, `recommendations.ts:587,3048`) and configure `argsIgnorePattern: "^_"` so the five `_` catch params in `HydrateStore.tsx:268-336` stop warning. (`eslint.config.mjs:14-25`)

### CI

- [ ] **#669** **[P3] [ci]** Pin third-party actions by SHA and cache Rust — `tauri-apps/tauri-action@v0` and `dtolnay/rust-toolchain@stable` float; pin commits and add `Swatinem/rust-cache@v2` (release builds of duckdb `bundled` take many minutes uncached). (`.github/workflows/release-tauri.yml:30,36`)
- [ ] **#670** **[P3] [ci]** Add a deploy workflow — `make loft` deploys from a laptop with no checks; add `deploy.yml` on push to `main` (after `ci.yml` passes) running `wrangler deploy` with `CLOUDFLARE_API_TOKEN` secret, plus `wrangler versions upload` preview URLs commented on PRs. (`Makefile:206-210`)

## P3 · Tests (18)


### Tests

- [ ] **#671** **[P3] [test]** Test GPU renderer buffer lifecycle with a fake `GPUDevice` — record `createBuffer`/`destroy` calls and assert `uploadData` twice leaves one live data buffer, and `destroy()` destroys the device. Done when it covers `LoomRenderer`, `LoomSceneRenderer` and `LoomCubeRenderer`. (`src/lib/webgpu.ts:181`)
- [ ] **#672** **[P3] [test]** Fuzz `decodeChartLink` with hostile `vo` payloads — oversized numbers, negative padding, very long strings and unknown keys — and assert they're clamped or dropped once validation lands. Done when `chartLink.test.ts` has these cases. (`src/lib/chartLink.ts:322`)
- [ ] **#673** **[P3] [test]** Enable component tests for the chart UI — `vitest.config` runs in `node` only, so ChartKindPicker keyboard flows, ChartCard selection and ChartView tooltip dismissal are untested. Add a `jsdom` environment for `*.test.tsx` plus Testing Library; done when ChartKindPicker has tests for type-to-search, ↑/↓ skipping disabled kinds, Enter and Esc. (`src/components/ChartKindPicker.tsx:145`)
- [ ] **#674** **[P3] [test]** Cover `parseChartTime` edge cases — epoch-ms values between 1e9 and 1e12 (dates before Sept 2001) are treated as seconds, and `Date.parse` treats "2024-03-01" as UTC but "2024-03-01 10:00" as local time. Add tests that pin the intended behaviour; done when both cases are asserted. (`src/lib/chartTime.ts:52`)
- [ ] **#675** **[P3] [test]** Test `drawChartTicks` label collision and rotation — rotated x labels skip the collision check that flat labels use, so they overlap on dense axes. Add a recording-ctx test and apply the same `lastRight` guard to rotated labels; done when 50 rotated ticks on a 300px axis draw without overlapping boxes. (`src/lib/chartLooks.ts:424`)
- [ ] **#676** **[P3] [test]** Test malformed `#dive=` links — add `decodeDiveLink` + `sanitizeDiveQuery` cases for missing `groupBy`/`filters`, string `limit`, unknown `agg` and bad base64. Done when each returns a valid query or null without throwing. (`src/lib/dive.ts:990`)
- [ ] **#677** **[P3] [test]** Cover the remote-CSV fallback logic — mock `fetch` to check `fetchCsvTextWeb`/`fetchJsonDatasets` origin fallback (404 → fallback, 500 → no double download, xlsx guard). Done when `openDataCatalog.test.ts` asserts request counts. (`src/lib/openDataCatalog.ts:395`)
- [ ] **#678** **[P3] [test]** Add component tests for Explorer table behaviour — with Testing Library, cover sort via keyboard, filter debounce, hidden+reordered columns keeping correct sparkline data, and clearing selection on file change. Done when `ExplorerView.test.tsx` covers these four. (`src/components/ExplorerView.tsx:164`)
- [ ] **#679** **[P3] [test]** Test ZIP output round-trips — the existing zipStore test only checks local headers; unzip the result with a reference reader (e.g. `fflate.unzipSync` in tests) and check CRCs, the UTF-8 name flag and entry count. Done when a two-file archive round-trips byte-for-byte. (`src/lib/zipStore.ts:52`)

### Tests & tooling

- [ ] **#680** **[P3] [test]** Export and test pure helpers that are untested — `extractJson`/`parseSuggestion` (ollama.ts:86–121: code fences, trailing prose, camelCase kinds) and `normalizePath` (tauri.ts:40: `file:///`, `%20`, Windows drive letters). Done when both have table-driven tests. (`src/lib/ollama.ts:96`)

### Rust ↔ Worker source parity

- [ ] **#681** **[P3] [test]** Add a parity test for shared constants — city lists (`CITIES` vs `WORLD_CITIES`, different order), ADSB points, upstream URLs and caps are duplicated by hand in Rust and TS with nothing checking them (unlike the registry columns). Extend `sources_tests.rs` to parse `sourceTransforms.ts`/`catalog-proxy.ts` constants (as it does `sourceRegistry.ts`); done when changing a city in one place fails the test. (`src-tauri/src/sources_tests.rs:82`)

### Tests and CI

- [ ] **#682** **[P3] [test]** Add tests for `commands.rs` helpers — `normalize_folder_path`, `sanitize_ckan_q`, `is_csv_distribution`, `is_usable_catalog_distribution` and the filename sanitizer in `save_csv_to_folder` are untested. Add a `#[cfg(test)]` module with representative DCAT fixtures; done when each helper has a test. (`src-tauri/src/commands.rs:108`)

### Docker, Makefile, scripts

- [ ] **#683** **[P3] [test]** Make sample data reproducible — `generate_data.py` never seeds `random`, so every `make spool` produces different files and screenshots/tests can't rely on values. Add `--seed` (default 42) and `random.seed(args.seed)`; done when two runs produce identical files. (`scripts/generate_data.py:131`)

### Build configuration and tooling

- [ ] **#684** **[P3] [test]** Validate shaders in CI — compile-check all 4 WGSL files with `naga` (`cargo install naga-cli && naga src/shaders/*.wgsl`) so a shader typo fails CI instead of silently falling back to Canvas at runtime. (`src/shaders/scatter.wgsl:1`)

### Testing

- [ ] **#685** **[P3] [test]** Cover the cheap untested pure modules — `queryValidate.ts` (30 lines), `csvExport.ts` (35), `dateFormat.ts` (43), `vega.ts` (152, spec builders), `openDataCatalog.ts` (426), `chartLooks.ts` (815); done when each has a `__tests__/<name>.test.ts`. (`src/lib/queryValidate.ts:1`)
- [ ] **#686** **[P3] [test]** Add an SSR/static-export smoke test — assert `out/index.html` contains `og:image`, `manifest`, the CTA text, and no "Choose folder" copy, run after `npm run build` in CI. (`out/index.html`)
- [ ] **#687** **[P3] [test]** Add a Lighthouse CI job (`treosh/lighthouse-ci-action`) against `out/` served locally with mobile preset and budgets (LCP < 2.5 s, CLS < 0.1, TBT < 300 ms, JS < 545 kB). (`.github/workflows/release-tauri.yml:1`)
- [ ] **#688** **[P3] [test]** Make `npm test` non-watch in CI contexts — `"test": "vitest"` starts watch mode; agents/CI that run `npm test` hang; change to `"test": "vitest run"` and add `"test:watch": "vitest"`. (`package.json:19-20`)

## P3 · Docs & agent DX (12)


### Docs

- [ ] **#689** **[P3] [docs]** Correct stale renderer comments — ChartView's header says "WebGPU for scatter, Canvas 2D for others" (scenes, globes and the cube also use WebGPU), `webgpu.ts` advertises "1M+ points" while ChartView subsamples to 4,500, and `vega.ts` says rendering is WebGPU. Update them to describe the current GPU-eligibility rules and subsampling budgets; done when the headers match the code. (`src/components/ChartView.tsx:1`)

### NeoSpace handoff

- [ ] **#690** **[P3] [docs]** Document and test the handoff — move isAllowedOrigin/safeName into `src/lib/neospace.ts` with unit tests (allowed origin, preview subdomain, `evil.pages.dev`, prod localhost), and add the flow to DOCS.md plus a changelog item as the AGENTS.md checklist requires. Done when the tests pass and the docs mention it. (`src/components/NeoSpaceIngest.tsx:37`)

### Live buffers & polling (web)

- [ ] **#691** **[P3] [docs]** Move per-parser caps into the registry — FEMA 200, SpaceX last 120, OpenSky 800 and `SOURCE_MAX_ROWS` live in webStreams while descriptions promise other numbers (SpaceX "most recent 100 launches", sourceRegistry.ts:359); add `maxRows`/`upstreamCap` to SourceDef and generate the copy from them. Done when the SpaceX description and parser agree via one constant. (`src/lib/webStreams.ts:563`)

### Viz preferences, Ollama, IPC bridge, changelog

- [ ] **#692** **[P3] [docs]** Keep What's new copy user-facing — recent entries contain developer jargon ("Socrata’s zone-less created_date", "the stronger label token at 11px") despite AGENTS.md's "write for users"; add a changelog test that flags snake_case identifiers, `px` units and code tokens in `detail`. Done when the test passes and the 2026-10-06c entry is reworded. (`src/lib/changelog.ts:47`)

### Build, release, and observability

- [ ] **#693** **[P3] [docs]** Fill in package metadata — `authors = ["you"]` and the description say "for macOS" while `bundle.targets` is `"all"`. Set real authors/license/repository and decide targets explicitly; done when `cargo metadata` shows real values. (`src-tauri/Cargo.toml:5`)

### Docker, Makefile, scripts

- [ ] **#694** **[P3] [docs]** Fix sample-data docs and dead import — AGENTS.md says the script makes "sample CSV/Parquet" and the Makefile says "10K, 100K, 1M rows", but it writes only CSV with 100k/50k/200k rows, and `import struct` is unused. Either add a Parquet writer (pyarrow optional) or correct the docs, and remove the import; done when docs match output. (`scripts/generate_data.py:19`)

### Docs drift

- [ ] **#695** **[P3] [docs]** Update DOCS.md's source count and backend description — it says "30 feeds" (the registry and AGENTS.md have 34) and "Static export — Data.gov and other backend work live in Tauri commands", ignoring the Worker routes `/api/catalog/*`, `/api/fetch-csv`, `/api/source/*`, `/api/stories`, `/s/*`. Correct the count and add a Worker section listing routes, caching and limits; done when DOCS.md matches `catalog-proxy.ts`. (`DOCS.md:26`)

### Makefile and scripts

- [ ] **#696** **[P3] [dx]** Fix `npm start` — `"start": "next start"` errors with `output: "export"`; replace with `"preview": "npx serve out -s -l 3000"` or `wrangler dev` (which also serves `/api/*`). (`package.json:8`)
- [ ] **#697** **[P3] [dx]** Add `make ci` mirroring the workflow exactly (tsc, eslint, vitest, build, budget, worker check) so agents can reproduce CI locally with one command; have `make tidy`/`unravel` also remove `tsconfig.tsbuildinfo`. (`Makefile:276-286`)

### Documentation accuracy

- [ ] **#698** **[P3] [docs]** Document web performance budgets and the phone-first goal in DOCS (target LCP/INP/JS budget, which modules must stay lazy), so contributors know not to statically import atlases/renderers. (`DOCS.md:1`)

### Repo hygiene and agent DX

- [ ] **#699** **[P3] [dx]** Add a "Verify" step to the AGENTS.md feature checklist — "run `make ci` (tsc, eslint, vitest, build, budget) and add a test under `src/lib/__tests__/`"; today the 5-step checklist ends at docs/changelog. (`AGENTS.md:62-70`)
- [ ] **#700** **[P3] [dx]** Compress README screenshots — 6 PNGs total 1.84 MB (`loom-explorer.png` 424 kB); run `oxipng -o4 --strip safe` or convert to WebP (GitHub renders it) and note it in `docs/screenshots/README.md` step 3. (`docs/screenshots/loom-explorer.png`)
