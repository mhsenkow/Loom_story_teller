# Loom — Codebase documentation

For contributors and AI: where things live and how they connect. For a shorter agent-oriented map, see [AGENTS.md](AGENTS.md).

---

## Entry points

| Entry | Role |
|-------|------|
| `src-tauri/src/main.rs` | Tauri binary; initializes app and runs the webview. |
| `src-tauri/src/lib.rs` | Registers plugins (fs, dialog, shell), creates `LoomDb` state, registers all IPC commands. |
| `src/app/page.tsx` | Root page: composes `TopBar`, `Sidebar`, main area (`ExplorerView` / `ChartView` / `QueryView`), `DetailPanel`, `PreviewFooter`. |
| `src/app/layout.tsx` | HTML shell, fonts, global CSS. |

---

## Data flow

1. **Folder selection** — User picks a folder (Tauri dialog or, on web, file input). Frontend calls `scanFolder(folderPath)` → Rust `scan_folder` → DuckDB scans directory, returns `FileEntry[]`. Store: `mountedFolder`, `files`, `isScanning`.
2. **File selection** — User clicks a file. Frontend calls `inspectFile(filePath)` → Rust `inspect_file` → DuckDB returns column stats + sample rows. Store: `selectedFile`, `columnStats`, `sampleRows`, and a Vega-Lite spec is derived (or built from recommendations).
3. **Chart suggestions** — `recommendations.ts` builds candidate specs from column types and names; optional Ollama call suggests one. User clicks a suggestion or encoding; store updates `activeChart`, `vegaSpec`, and optional `encodingOverrides`.
4. **Rendering** — `ChartView` uses `vegaSpec` + `sampleRows`: WebGPU for point marks, Canvas 2D or Vega for bar/line/area/arc. Export handlers (PNG/SVG) read from a ref that’s updated with the current spec and canvas.
5. **Open data catalogs** — Data & sources searches Data.gov / data.gov.uk (Tauri IPC or browser via Worker `/api/catalog/*` + `/api/fetch-csv`). Web Explore parses CSV in `mock-data.ts` (`parseCsvToInspectResult`: quoted newlines, thousands separators, trim incomplete trailing records, reject xlsx). Recommendations prefer mean for rate/% fields and boost lat×lon scatters.
6. **Wikipedia live stream** — `stream_start` / `stream_stop` / `stream_snapshot` / `stream_query` (Rust `stream.rs`) append to DuckDB `wiki_stream`. Sidebar starts the stream; chart stories use `recommendStreamStory`; Query view uses `STREAM_SQL_SNIPPETS` and routes SQL for `stream://wiki`.
7. **Poll-based sources** — 30 feeds registered in `src/lib/sourceRegistry.ts` (USGS quakes, NASA EONET events, GDACS disaster alerts, NWS alerts, weather + air quality for 12 cities, UK grid carbon, NOAA global temperature since 1880, NOAA ocean buoys, live aircraft, Citi Bike docks, MBTA vehicles, NYC 311, ISS, launches, SpaceX, NOAA space weather, NOAA aurora forecast, JPL asteroid close approaches, Hacker News, Wikipedia most-read, Steam top games, crypto, Bitcoin blocks, FX history, US national debt, FEMA, COVID, countries, World Bank). Columnar feeds (the newer eight) come from the Worker as `{ columns, rows }` and parse by column name (`parseColumnar`); `SOURCE_MAX_ROWS` raises the 8k buffer cap per kind (debt keeps all ~8.4k days). Desktop: `source_start` / `source_stop` / `source_snapshot` / `source_query` (Rust `sources.rs`) fill one DuckDB table per kind. Web: the Worker's `/api/source/<kind>` proxies + caches each upstream (Cache API, per-kind TTL, stale-on-error, fetch timeouts; fallbacks: CoinGecko → CoinPaprika, OpenSky → ADSB.lol) and `webStreams.ts` parses into in-memory buffers (≤8k rows). Explore loads the whole buffer (`SOURCE_EXPLORE_ROWS`). Sidebar cards are grouped by `SourceDef.group`; `recommendSourceStory` + `SOURCE_SQL_SNIPPETS` give each feed its opening charts and SQL; `discoverStories.ts` writes the headline hook.
8. **Curated packs + web CSV** — Sidebar `CURATED_OPEN_PACKS` are complete CSVs (OWID per-indicator grapher files, Keeling curve, NASA exoplanets, WRI power plants, US cities) fetched via `/api/fetch-csv`. `parseCsvToInspectResult` keeps rows up to a cell budget (`WEB_CSV_CELL_BUDGET` 1.5M cells, ≤60k rows) and charts every kept row; demo files chart all rows.
9. **Socrata + TidyTuesday** — `PublicCatalogSections.tsx` (rendered by Sidebar's Data & sources after the curated packs) over pure helpers in `src/lib/publicCatalogs.ts`. Both upstreams send CORS `*`, so search runs straight from the browser / Tauri webview (no Worker route). *City & state open data*: Socrata Discovery API (`api.us.socrata.com/api/catalog/v1?only=dataset`, optional `domains=` / `order=`); `parseSocrataSearch` keeps tabular datasets only (drops maps, filtered views, attached files). Explore loads SODA CSV `https://<domain>/resource/<id>.csv?$limit=N` where `socrataRowLimit` sizes N to `SOCRATA_CELL_TARGET` (1M cells, ≤50k rows) from the column count; the toast says "first N rows (the portal has more)" when the cap is hit. Don't add `$order` — sorting a big table server-side takes minutes. *TidyTuesday*: `static/tt_data_type.csv` → `parseTidyTuesdayIndex` (csv/tsv only; files at `data/<year column>/<date>/<file>`), week titles lazily from each year's `data/<year>/readme.md` table. `parseCsvToInspectResult` sniffs the delimiter from the header (`sniffCsvDelimiter`: comma / tab / semicolon), so TSV and `;` files parse. Web loads go through `handleLoadRemoteCsv` (`/api/fetch-csv`); desktop uses Save to folder.

---

## State (Zustand)

`src/lib/store.ts` holds:

- **Folder / files**: `mountedFolder`, `files`, `isScanning`
- **Selection**: `selectedFile`, `columnStats`, `sampleRows`, `selectedRowIndices`
- **View**: `viewMode` (explorer | chart | query | dive), `panelTab` (stats | chart | export | smart | settings), `suggestionsExpanded`
- **App settings**: `appSettings` (theme, uiChrome, font, faces, fontScale, reducedMotion, colorblindCharts, `chartAspect`, `chartDevice`). **Onboarding**: `onboardingDismissed`. Chart framing: `src/lib/chartViewport.ts` (social aspects + mobile/tablet/desktop width); TopBar picks presets; ChartView fits a centered stage.
- **Chart**: `vegaSpec`, `activeChart`, `chartVisualOverrides`, `chartTitleOverrides`, `aiSuggestionReason`, `chartAnnotations`. Encoding: `glowField`, `outlineField`, `opacityField`, `rowField` (small-multiples facet on bar/line/area/scatter), `topN`, `y2Field`, `comparePrevious`. **Interaction**: `chartInteractionMode` (pan | crosshair | lasso), `crosshairPos`, `rulerPins`, `lassoPoints`, `pinnedTooltips`, `customRefLines`. **Options**: `barStackMode` (grouped | stacked | percent), `connectScatterTrail`, `showMarginals`. **Shared link**: `chartLink` (pending `#chart=` link until its dataset opens; see Mobile shell & sharing).
- **Linked highlight**: `hoveredRowIndex` — table ↔ chart hover sync.
- **Table**: `tableViewState` (column order, visibility, filters, sort), `tableViewHistory` for undo/redo, `tableViews` (saved named views). **Profiling**: `profilingCol` (column key or null).
- **Query**: `queryResult`, `querySnapshots` (for diff), `nlQueryInput`.
- **Smart**: `smartResults` (anomaly, forecast, trend, referenceLines, clusters, correlation). ChartView and DetailPanel read/write.
- **Export**: `pngExportHandler`, `svgExportHandler` (set by `ChartView`). **Toast**: `toastMessage`.

Components subscribe to slices; avoid putting derived data that changes often in the store.

---

## IPC (Tauri)

All Rust commands are in `src-tauri/src/commands.rs`. Ingestion helpers live in `stream.rs` (SSE) and `sources.rs` (HTTP polls). Frontend wrappers in `src/lib/tauri.ts`:

- Use `isTauri()` to branch; in browser, many calls fall back to `mock-data.ts`.
- Never call `invoke()` directly from UI code; use the typed functions from `tauri.ts`.

Adding a new command:

1. Add `#[tauri::command] pub async fn ...` in `commands.rs`.
2. Register it in `lib.rs` in `tauri::generate_handler!`.
3. Add a wrapper in `tauri.ts` and, if needed, mock in `mock-data.ts`.

---

## Chart pipeline

- **Spec generation** — `src/lib/vega.ts`: `buildScatterSpec`, `buildBarSpec`, `buildLineSpec`, etc. They take column names, types, and options and return Vega-Lite JSON.
- **Recommendations** — `src/lib/recommendations.ts`: `ChartKind` covers 24 canvas kinds (scatter → sankey, plus dumbbell / ridgeline / hexbin / funnel / parallel), 20 odd Canvas kinds (`oddCharts.ts`), and 6 GPU/3D scene kinds (`gpuScenes.ts`: `scatter3d`, `trailRibbon`, `quakeTerrain`, `firefly`, `loomWeave`, `dataCube`) with optional `zField` / `timeField` / `trailId`. `recommend()` for arbitrary files; `recommendStorySequence()` for multi-chart dashboards; `recommendStreamStory()` / `recommendSourceStory()` for `wiki_stream` and poll-source schemas (often `spec: {}` with `xField`/`yField` — WebGPU scatter reads those when `spec.encoding` is missing). `STREAM_SQL_SNIPPETS` and `SOURCE_SQL_SNIPPETS` feed the Query view. Returns `ChartRecommendation[]` with encoding fields used by `ChartView`. Capabilities / honesty labels live in `chartSupport.ts`. Before diversify, `recommend()` applies local **viz preference boosts** from swipe feedback (`src/lib/vizPreferences.ts` + cached model hydrated from `loom-viz-preferences`).
- **Deep scan + swipe deck** — `src/lib/deepScan.ts` builds a `DatasetProfile` (pairwise Pearson, nominal contingency, skew/entropy) then `deepRecommend()` expands/re-ranks candidates into a ~12–20 chart deck. Mobile **✦ Swipe ideas** (suggestions header) / desktop **Deep scan** (ChartView) opens `VizSwipeDeck`: swipe right = Keep (apply chart + like), left = Skip (dislike). Preferences stay on-device; they re-rank future `recommend()` and deep scans. No cloud learning in v1.
- **Rendering** — `ChartView.tsx`:
  - Chooses WebGPU for scatter only when mark is circle and no stroke/jitter/glow and no glow/outline/opacity encoding; otherwise Canvas 2D scatter so mark shape, outline, jitter, glow, and size scale all apply.
  - Bar/line/area/arc/strip are drawn with Canvas 2D. Visual overrides (fonts, grid, axes, padding, legend, data labels, background, blend, entrance animation) come from `chartVisualOverrides`.
  - **Smart overlays** — If `smartResults` is set: anomaly rings, trend line, forecast line/points, reference lines, clustering. **Custom ref lines** and **annotations** from store. **Responsive**: `chartRenderOpts` (padding, font size, grid, legend) adapt to container width (compact &lt;400px, medium &lt;600px).
  - **Interactivity** — Pan/zoom (drag + wheel), brush (Shift+drag), lasso (freeform polygon), crosshair + ruler pins. Tooltip on hover; click to **pin** tooltip. **Mini-map** when scatter zoom &gt; 1.5×. Linked highlight from `hoveredRowIndex`.
  - Export: PNG from the active canvas; SVG from Vega-Lite spec. Canvas sizing and every draw pass use `stageDpr()` (the capture's `socialExportTarget.pixelRatio`, else screen DPR) so a platform export lays out identically on every device.
  - **Axes** — `src/lib/chartAxes.ts` is the shared axis math: `niceTicks` / `niceZeroScale` (1·2·2.5·5×10ⁿ steps), `formatAxisValue(v, step)` / `formatDataValue`, `classifyKeys` + `buildXModel` (numbers and ISO dates are ordered and positioned by value; other keys are bands), `timeTicks` (calendar-aligned UTC), `histogramBins` (round edges), `aggregateAxisTitle` ("Sum of revenue"). `chartLooks.ts` draws with it: `drawChartGrid(…, {x, y})` puts rules on the tick values (`null` = categorical axis, no rules), `drawChartTicks(…, {x?, y?, xFormat?, yFormat?})`, `drawBandAxisX` (ordered → thinned flat labels; nominal → flat → ellipsized → −40°), `drawBandAxisY`, `drawPositionedLabelsX` (time), `drawColorRamp`. All accept a `PlotRect` instead of `pad` for charts with a category gutter. Never hard-truncate labels — use `fitTextEllipsis` with a measured width.
  - **Frames** — `FRAMED_KINDS` get the shared L-frame + axis titles from the dispatch; `OWN_FRAME_KINDS` (strip, lollipop, dumbbell, ridgeline, heatmap) shift their plot right of a measured label gutter and draw their own frame; odd / geo / GPU kinds draw any axes themselves.
  - **Type switches** — `fitEncodingToKind` (recommendations.ts) runs before `createChartRec` when the chart-type picker changes kind: category-X kinds get a 2–40-value category (promoting the color field if it's the best one), glyph kinds an identity column, strip / ridgeline a category Y, ordered kinds (line, area, bump, stream, horizon, spiral) a time column, flows a second category; Color is dropped when it has >12 groups or isn't per-mark (lollipop, funnel, pie…). Choropleth is only offered with a country/state column, and numeric values join map regions only from a code-like column (`fips`, `iso…`, `…code`).
  - **Time bucketing** — line / area roll >90 time points up to day / week / month / year by span (`timeBuckets`); tooltips name the unit and hit targets point at the bucket's first row.
  - **Reference lines, trails, marginals** — renderers publish `opts.scales` ({x, y, valueAxis, rect}); the dispatch draws `customRefLines` on the value axis (X for horizontal bars / lollipop / strip / dumbbell / ridgeline). Scatter draws `connectScatterTrail` paths and `showMarginals` edge histograms; any of these forces the Canvas scatter over WebGPU.
  - **Bars** — `computeBarModel` keeps numeric/date keys in order (≤40) and ranks categories by value (top 20). `barsShouldBeHorizontal` flips to labeled horizontal bands when the stage is portrait or the names can't sit flat under their bars. One color unless Color encodes something.
  - **Hover targets** — renderers push `HitTarget`s (rect / circle / arc + `match` column values or `rowIndex`, plus an aggregated `summary`) into `ChartRenderOpts.hits` while painting; `Canvas2DHitContext.targets` makes the tooltip pick exactly what was drawn and show the mark's value (bar total, slice share, bin range). Kinds without targets fall back to `pickCanvasTooltipRowIndex` geometry.
  - **Legend** — renderers report the series they colored via `setLegend` (`ChartRenderOpts.legend`); the dispatch draws it. `legendPosition` defaults to `"auto"`: shown only when a color field is encoded, in the plot corner with the least ink (sampled from the canvas). Density ramps go through `densityStops` so the high end contrasts with the theme background.
  - **Titles over maps** — geo and GPU-scene renderers fill the whole canvas, so ChartView draws the title block after them. Flat-map projections fit with the full pad on top only (`fitProjection` in `geoMaps.ts`).
- **Smart analytics** — `src/lib/smartAnalytics.ts`: `runAnomaly`, `runForecast`, `runTrend`, `runReferenceLines`, `runClustering`. **Correlation matrix** (Pearson) computed in DetailPanel. Smart tab runs cards and sets `smartResults`; ChartView draws overlays.

---

## Visual layer

Chart look and feel is controlled by `chartVisualOverrides` in the store and applied in `ChartView.tsx` via `chartRenderOpts`. Grouped as:

- **Color** — `src/lib/chartPalettes.ts` is the system of record (system + research palettes). Kinds: categorical, sequential, diverging, spectrum, semantic, reference. `colorPalette: "auto"` (default) picks scale from chart kind / color field (heatmap → sequential blue, waterfall → semantic, else categorical). `resolveChartColors` + `sampleContinuous` drive canvas/WebGPU; heatmaps interpolate sequential stops. Settings → colorblind charts forces Okabe–Ito / Cividis unless a palette is locked. Chart → Visual → Color shows swatch grid + reverse. Shuffle look respects per-section locks (Color / Design / Marks / …).
- **Typography** — `fontFamily`, `titleFontWeight`, `titleItalic`, `tickRotation`; applied to title and axis labels.
- **Marks** — `markShape` (circle, square, diamond, triangle, cross, star, …), `markStroke` / `markStrokeWidth`, `markJitter`, `sizeScale` (for size encoding), `barCornerRadius`, `lineStrokeStyle`, `lineCurveSmooth`.
- **Axes & grid** — `axisLineColor`, `axisLineWidth`, `gridStyle`, `gridOpacity`, `tickCount`, `axisLabelColor`.
- **Layout** — `chartPadding`, `legendPosition`, `showDataLabels`.
- **Atmosphere** — `backgroundStyle`, `blendMode`, `glowEnabled`, `animateEntrance`.
- **Look spectrum** (wordcount-inspired) — `chartDetail` (plain/viz/deep), `markMotif`, `axisStyle`, `emphasisStyle`, `ghostEnabled` / weight / place, `titleLayout`, `chartFrame`. Presets in `src/lib/lookSystem.ts` **replace** the override bundle (Tufte, Bauhaus, Newspaper, Military, Clarity, … + Shuffle).

Encoding can also drive **glow**, **outline**, and **opacity** per point (scatter/strip) via `activeChart.glowField`, `outlineField`, `opacityField`; these require Canvas 2D. WebGPU scatter is used only when the chart is circle-only, has no stroke/jitter/glow or data-driven glow/outline/opacity, and has no Smart overlays (so anomaly rings, trend line, etc. can be drawn on the same canvas). **GPU scenes** (`scatter3d`, `firefly`) use `LoomSceneRenderer` + `scenes.wgsl` with orbit/zoom; `trailRibbon`, `quakeTerrain`, and `loomWeave` render on Canvas (capture-safe) via `renderGpuSceneCanvas`. **Data cube** (`dataCube`): `xField` = rows, `yField` = columns, `zField` = depth, `sizeField` = value measure with `yAggregate` (none → row count). `dataCube.ts` bins each axis (`buildCubeAxis`: categories top-N + Other, low-card numerics as ordered slots, wide numerics / dates as equal-width ranges, ≤12 bins), aggregates cells (`buildDataCube`), and owns the camera (`cubeView` / `projectCube`, column-major WebGPU clip space) so GPU voxels, Canvas fallback, labels, and hover picking (`pickDataCubeCell`) agree. Live: back walls on the 2D canvas → voxels on WebGPU (`LoomCubeRenderer` + `cube.wgsl`, transparent clear, instances sorted far→near) → labels/legend/hover outline on the axes overlay. Capture, thumbnails, and PNG export use `renderDataCubeCanvas`. Color ramp is sequential (auto palette treats `dataCube` like heatmap). Encoding panel shows **Depth** (`caps.zChannel`, also Z for `scatter3d`) and **Value** + Aggregate. `recommend()` adds one cube when `pickDataCubeEncoding` finds three usable dimensions. **Pivoting** — `DataCubePivot.tsx` overlays axis chips (swap / rotate / drop-a-column-to-replace → `createChartRec` so Encoding stays in sync), a depth slice stepper, and a docked pivot table (`buildPivotTable`: one slice or rolled up, totals re-aggregated from raw rows via the shared `binRows`/`Acc`). ChartView keeps `cubeSlice` / `cubeTableOpen` local; pivots animate voxels between layouts by matching `cubeCellKey` (field=label, axis-independent) and passing `centerOf` through `CubeCellStyle` to Canvas, WebGPU, and picking. Ghosted out-of-slice voxels are unpickable; `CubeCamera.offsetY` lifts the cube above the table. Clicking a voxel slices to its layer; `[` `]` step, Esc clears. **Geography** (`choropleth`, `geoPoints`, `geoBubbles`, `geoHex`, `globe`, `globeTrail`, `arcMap`) uses `geoAtlas` (world-atlas / us-atlas TopoJSON) + `geoMaps` Canvas renderers — capture always Canvas. Live `globe` can use WebGPU sphere sprites via `globe.wgsl`. Joins: ISO2/ISO3/`cca3`/`country_code` → world countries; US state names/FIPS/abbr → `us-atlas` states. UI shows a **Canvas look** hint when Visual options force Canvas.

---

## Mobile shell & sharing

- **Start here** — `StartHere.tsx` is the shared empty state (Explorer / Chart / Query / Dive): discover scan (`requestDiscoverScan`) first, then `openDataSources()`. Opening a discover story sets the story hook as the chart title override.
- **Shell** — phones (<768px): TopBar shows view tabs + **Share** (chart view); Edit / ✦ Swipe ideas live in the suggestions header; Settings is a panel tab. `useMobileLiveEdit()` (`useMediaQuery.ts`): Chart view + Chart/Smart panel tab → the panel is an undimmed `MOBILE_LIVE_EDIT_SHEET`-tall sheet, `<main>` pads its bottom by the same height, and the suggestions rail hides so the chart re-fits above the editor. `<main>` only collapses for Data & sources while the sidebar is actually open (closing the drawer also clears `dataSourcesExpanded`). Toasts sit at the top on phones; the note button hides under drawers/sheets. Touch-only CSS in `globals.css`: 16px form fields (no iOS focus zoom), hover-only controls revealed under `(hover: none)`.
- **Share sheet** — `ShareSheet.tsx` (store `shareSheetOpen`) pre-renders via `capturePlatformPng` on open / format / headline change so `navigator.share({ files })` runs inside the tap (iOS drops share after slow async work). Captures are serialized (overlapping runs would restore each other's forced stage) and lay out at ~450 CSS px × ~2.4 pixel ratio so type reads at feed size. **Get link** builds `buildChartSharePageHtml` (JPEG) and POSTs `/api/stories`; the Worker hosts the og image at `/s/{id}.img` and rewrites `og:image` / `twitter:image` so links unfurl. The Export tab keeps the long tail (SVG, carousel, video, bundle).
- **Chart links** — `src/lib/chartLink.ts` (pure): `chartLinkFromState` → `encodeChartLink` / `decodeChartLink` (`#chart=` base64url JSON, `v: 1`, short keys, defaults/undefined omitted, no rows or spec). Carries `src` (stream / `mock://` / `web://` path; local files only as `file:<name>`), `u` (catalog CSV URL for `web://`), the rec's kind + every encoding (`x y c s z t tr r g o op a tf tk`) + title/subtitle, headline override (`h`), primitive `chartVisualOverrides` (`vo`), `barStackMode`, trail/marginals, `chartAspect` / `chartDevice`. Data-cube slice / pivot-table toggles are ChartView-local and not shared (the pivoted axes are, via the encodings). `ChartLinkSync.tsx` (rendered by `WebSessionResume`) mirrors the setup into the hash while in Chart view (debounced `replaceState`; clears `#chart=` when leaving Chart, never touches `#dive=`), and applies a pending store `chartLink` once its dataset is open (`chartLinkMatchesFile`): `restoreChartRec` prefers an identical rail rec, else `createChartRec` (so Encoding stays in sync), else a field-only rec; then overrides, headline, stack mode, framing, Chart view. `WebSessionResume` reads `#chart=` on load like `#dive=`: streams and `mock://` open themselves, `web://` refetches `u`, local files toast and wait for the recipient to open a file with the same name. Onboarding skips the first-visit discover modal when a shared link is in the hash. Share sheet: **🔗 Copy chart link** (web only; built synchronously from the store so the clipboard write stays in the tap) and **Get link** pages whose CTA is *Open this chart in Loom* (`openUrl` in `buildChartSharePageHtml`).

- **What's new** — `src/lib/changelog.ts` (`CHANGELOG`, newest first; ids must sort) feeds `WhatsNew.tsx`. On load, a returning visitor whose `loom-whats-new-seen` is older than the newest id sees the unseen releases (store `whatsNewOpen`; Onboarding renders nothing while it's up but keeps scanning, then hands off). First visits are detected from a module-load storage snapshot and skip straight to discover. `requestWhatsNew()` reopens it in browse mode (sidebar header, Settings, Help).

---

## Smart analytics

`src/lib/smartAnalytics.ts` provides pure functions over sample rows; no backend. The **Smart** tab in the right panel runs them and writes results into `smartResults`. ChartView reads `smartResults` and draws overlays on the same canvas.

| Card | Function | Params | Visualization |
|------|----------|--------|----------------|
| Anomaly | `runAnomaly` | column, method (z-score / IQR / MAD), threshold | Red dashed rings around anomalous points |
| Forecast | `runForecast` | horizon, method (linear / moving-avg) | Yellow dashed line + points beyond last data |
| Trend | `runTrend` | — | Green dashed regression line (scatter only) |
| Reference lines | `runReferenceLines` | column, axis (x/y), types (mean, median, Q1, Q3) | Horizontal or vertical dashed lines |
| Clustering | `runClustering` | k (2–8) | Scatter points colored by cluster |

**Clear all overlays** sets `smartResults` to `null`. **Correlation matrix** is computed in the Smart tab (pairwise Pearson); result is shown as a heatmap table in DetailPanel.

---

## Dive (Scuba-style explore)

`src/components/DiveView.tsx` (+ `DiveTimeSeries.tsx`, `DiveChipInput.tsx`), view mode `dive` (TopBar **Dive**, key **4**). Feature parity target: [ezyang/scubaduck](https://github.com/ezyang/scubaduck) (Scuba's query UI over DuckDB).

- **Engine** — `src/lib/dive.ts` is pure: `profileDiveColumns` (time / number / category), `defaultDiveQuery`, `sanitizeDiveQuery` (keeps a query valid when columns change and upgrades older links, e.g. single `value` filters → `values[]`), `runDive` (filters → time window anchored at the newest row, or a custom `start`/`end` via `parseDiveTime` → group-by + metrics incl. percentiles via linear `quantile` → top-N ranking (`orderDir`) → compare window → per-group, per-metric bucketed series with `fill` → newest samples), `diveToSql` (equivalent DuckDB SQL for the current view; derived columns become a `WITH src AS (…)` CTE), `encodeDiveLink` / `decodeDiveLink` (`#dive=` base64url JSON with `src` dataset path). Filters: `values[]` OR'd for positive ops / excluded for negated ops; ops include `~` / `!~` (regex) and `like`; `opsForKind` picks the menu per column kind. Metrics on time columns (min / max / avg) return epoch ms and are flagged in `result.metricKinds`. Naive timestamps are local time throughout (parsing, local-midnight day buckets, display).
- **Derived columns** — `src/lib/diveExpr.ts`: tokenizer + precedence-climbing parser + evaluator for a DuckDB-compatible expression subset (operators, `CASE`, `IN`, `LIKE`, `BETWEEN`, `IS NULL`, `CAST` / `::`, ~60 functions in `DIVE_EXPR_FUNCTIONS`). `applyDerivedColumns` appends enabled columns to rows *before* profiling, so the rest of Dive sees them as ordinary columns; broken expressions are skipped and reported per column.
- **Chart** — `DiveTimeSeries.tsx`: small multiples (one panel per metric, ranking metric first), calendar-aware ticks (`timeTicks` / `formatTick`), nearest-series highlight, click-to-pin crosshair, mouse drag → `onZoom(start, end)` (DiveView keeps a zoom stack; double-click pops it).
- **History** — the hash is `pushState`d for deliberate changes (edits within ~1.2 s collapse via `replaceState`); a `popstate` listener reapplies `#dive=` for the open dataset.
- **Rows** — `src/lib/diveSource.ts` `loadDiveDataset`: desktop pulls up to 30k rows through DuckDB (`USING SAMPLE` for files, newest-first for `wiki_stream`, whole source tables); web uses the stream/source JS buffers (8k), full mock data for demo files, else the in-store sample. Live paths (`stream://…`) re-pull every 5 s web / 10 s desktop while **Live** is on.
- **State** — `diveQuery` `{ src, query }` in the store (query is tied to the dataset path it was built for); `diveLink` holds a shared link until its dataset opens. `WebSessionResume` reads `#dive=` on load, opens stream / `mock://` sources itself, and lands in Dive. DiveView mirrors the query into the hash (see History). The builder width is a per-viewer `localStorage` convenience (`loom-dive-sidebar`).
- **Handoffs** — **Open as cube** replaces `sampleRows` with the matched rows (≤20k) and builds a `dataCube` rec (2 group-bys + time, or 3 group-bys). **SQL → Open in Query** (desktop) sets `querySql`.

---

## Explorer (table)

`src/components/ExplorerView.tsx`:

- **Virtualized table** — Renders visible rows only; sort, column reorder (drag header), show/hide columns. Per-column **filters** (text, numeric/date range). Sparklines, value bars, heat tint, trend cues, null % in headers. Date formatting via `src/lib/dateFormat.ts`.
- **Selection** — Checkboxes, keyboard (↑/↓ + Space). Export selected to CSV. `selectedRowIndices` synced with chart brush/lasso.
- **Saved views** — `tableViews` in store; save/load column visibility, order, filters. **Undo/Redo** over `tableViewHistory`.
- **Column profiling** — Right-click header → `setProfilingCol`; inline card shows null %, unique, min/max/median, histogram or top values.
- **Linked highlight** — Row hover sets `hoveredRowIndex`; ChartView dims non-hovered points.

---

## Query

`src/components/QueryView.tsx`:

- **Editor** — Schema browser (Tables + Columns), click-to-insert. **Validation** (`src/lib/queryValidate.ts`): parentheses, SELECT/WITH before run.
- **Results** — Paginated grid, copy cell/row, export CSV. **History** and **snippets** (save/load named SQL).
- **Snapshots** — Save current result to `querySnapshots`; **Diff** dropdown to compare row count and columns vs a snapshot.
- **NL-to-SQL** — `nlQueryInput`; Enter scaffolds a query with schema context (Ollama for full generation when available).

---

## Theming and tokens

- **Catalog** — `src/lib/lookSystem.ts`: 10 themes, 8 chrome faces, app fonts, faces source; Visual presets.
- **Tokens** — `src/styles/globals.css`: `data-theme` / `data-ui` / `data-font` / `data-faces` / `data-a11y` on `<html>`. Semantic `--color-*` with `--loom-*` aliases for Tailwind (`bg-loom-bg`, …). Per-theme `--chart-1`…`8`.
- **Apply** — `ThemeApplicator` sets attributes + legacy class aliases; syncs `ibm.tools.shared` when same-origin.
- **Components** — Use `.loom-panel`, `.loom-card`, `.loom-btn-primary`, `.loom-btn-ghost`, `.loom-input`, `.loom-badge`. Reskin by changing theme blocks in `globals.css` or Settings.

---

## Important files (short)

| File | Purpose |
|------|---------|
| `src-tauri/src/db.rs` | DuckDB connection, `scan_folder`, `query_file`, `get_column_stats`, `inspect_file`. Table name for the active file is `loom_active`. |
| `src/lib/vega.ts` | Vega-Lite spec builders; used by ChartView and recommendations. |
| `src/lib/recommendations.ts` | Heuristic chart suggestions from schema. |
| `src/lib/ollama.ts` | Ollama API for “Suggest with AI”. |
| `src/lib/webgpu.ts` | WebGPU device, pipeline, buffer upload, draw for scatter. |
| `src/components/ChartView.tsx` | Main chart area, suggestion grid, Smart overlays (anomaly/trend/forecast/ref lines/clusters), title edit, export handler registration. |
| `src/components/ChartKindPicker.tsx` | Searchable chart type picker in Encoding (grouped Classic / Creative / 3D & GPU / Maps; ↑/↓ Enter Esc; type-to-search from the closed trigger; “Fits this table” filter). Ranking + synonyms in `src/lib/chartKindSearch.ts`. |
| `src/components/DetailPanel.tsx` | Right panel: Stats, Chart (Encoding \| Visual secondary header; encoding channels, Facet / Split / Top N / Compare Y, Visual, bar stack, ref lines, trail, marginals), Export, Smart (anomaly, forecast, trend, ref lines, clustering, correlation matrix). |
| `src/lib/smartAnalytics.ts` | Anomaly, forecast, trend, reference lines, clustering; pure functions over rows/columns. |
| `src/components/ExplorerView.tsx` | Virtualized data table, filters, saved views, undo/redo, column profiling, linked highlight. |
| `src/components/QueryView.tsx` | SQL editor, schema browser, validation, paginated results, snippets, snapshots, diff, NL-to-SQL input. |
| `src/components/PreviewFooter.tsx` | Collapsible preview table + Schema with draggable column tokens. |
| `src/components/Sidebar.tsx` | File list, Data & sources (portals + save CSV), Wikipedia stream + USGS/Meteo/NWS/World Bank cards, folder picker. |
| `src/lib/dateFormat.ts` | Date column formatting for table and charts. |
| `src/lib/queryValidate.ts` | Basic SQL validation (parentheses, SELECT/WITH). |
| `src/lib/persist.ts` | Persist `tableViews` (and optional state) to storage. |
| `src-tauri/src/stream.rs` | Wikimedia SSE → `wiki_stream` table; stream IPC helpers. |
| `src-tauri/src/sources.rs` | Every poll source → DuckDB tables (same tables/columns as `sourceRegistry.ts`); source IPC helpers. |
| `src/lib/sourceRegistry.ts` | Single definition of every live/poll source: copy, table + schema, cadence, ordering, sidebar group. |
| `src/lib/lookSystem.ts` | Theme / chrome / font catalog + Visual presets + ibm.tools.shared sync. |
| `src/lib/dashboardMicrosite.ts` | Single-file HTML export for dashboard layouts. |
| `src/lib/captureStoryPreviews.ts` | PNG thumbnails for story-dashboard chart slots. |

---

## Testing

Unit tests live under `src/lib/__tests__/` and are run with **Vitest** (`npm run test` or `npm run test:run`; `make test`). They cover:

- **format.test.ts** — `formatBytes`, `formatNumber`, `truncate`, `extensionIcon`
- **smartAnalytics.test.ts** — `runAnomaly`, `runForecast`, `runTrend`, `runReferenceLines`, `runClustering`, and low-level anomaly helpers
- **store.test.ts** — Zustand store: initial state, `setPanelTab`, `setSmartResults`, `setActiveChart`, `setChartVisualOverrides`, `reset`, etc.
- **recommendations.test.ts** — `createChartRec`, `createScatterRec`, `CHART_KIND_OPTIONS`, `getRecommendationReason`

Run `make test` or `npm run test:run` to confirm everything passes.

---

## Conventions

- **Static export** — No `getServerSideProps` or runtime API routes; Data.gov and other backend work live in Tauri commands.
- **Paths** — Normalize `file://` and `file:///` to a plain path before sending to Rust (see `normalizePath` in `tauri.ts` and `normalize_folder_path` in `commands.rs`).
- **Errors** — Rust commands return `Result<T, String>`; frontend shows errors via toast or inline message where appropriate.
