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
5. **Data.gov** — Only in Tauri. Data & sources view calls `fetchDataGovRecentCsv()` / `fetchUkDataRecentCsv()` (reqwest). User can “Save to folder” → `saveCsvToFolder` writes under the mounted folder.
6. **Wikipedia live stream** — `stream_start` / `stream_stop` / `stream_snapshot` / `stream_query` (Rust `stream.rs`) append to DuckDB `wiki_stream`. Sidebar starts the stream; chart stories use `recommendStreamStory`; Query view uses `STREAM_SQL_SNIPPETS` and routes SQL for `stream://wiki`.
7. **Poll-based sources** — `source_start` / `source_stop` / `source_snapshot` / `source_query` (Rust `sources.rs`) fill `usgs_quakes`, `meteo_weather`, `nws_alerts`, `world_bank`. Sidebar cards per kind; `recommendSourceStory` + `SOURCE_SQL_SNIPPETS`; Query routes `stream://usgs`, `stream://meteo`, `stream://nws`, `stream://world_bank`.

---

## State (Zustand)

`src/lib/store.ts` holds:

- **Folder / files**: `mountedFolder`, `files`, `isScanning`
- **Selection**: `selectedFile`, `columnStats`, `sampleRows`, `selectedRowIndices`
- **View**: `viewMode` (explorer | chart | query), `panelTab` (stats | chart | export | smart | settings), `suggestionsExpanded`
- **App settings**: `appSettings` (theme, fontScale, reducedMotion). **Onboarding**: `onboardingDismissed`.
- **Chart**: `vegaSpec`, `activeChart`, `chartVisualOverrides`, `chartTitleOverrides`, `aiSuggestionReason`, `chartAnnotations`. Encoding: `glowField`, `outlineField`, `opacityField`. **Interaction**: `chartInteractionMode` (pan | crosshair | lasso), `crosshairPos`, `rulerPins`, `lassoPoints`, `pinnedTooltips`, `customRefLines`. **Options**: `barStackMode` (grouped | stacked | percent), `connectScatterTrail`, `showMarginals`.
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
- **Recommendations** — `src/lib/recommendations.ts`: `recommend()` for arbitrary files; `recommendStorySequence()` for multi-chart dashboards; `recommendStreamStory()` / `recommendSourceStory()` for `wiki_stream` and poll-source schemas (often `spec: {}` with `xField`/`yField` — WebGPU scatter reads those when `spec.encoding` is missing). `STREAM_SQL_SNIPPETS` and `SOURCE_SQL_SNIPPETS` feed the Query view. Returns `ChartRecommendation[]` with encoding fields used by `ChartView`.
- **Rendering** — `ChartView.tsx`:
  - Chooses WebGPU for scatter only when mark is circle and no stroke/jitter/glow and no glow/outline/opacity encoding; otherwise Canvas 2D scatter so mark shape, outline, jitter, glow, and size scale all apply.
  - Bar/line/area/arc/strip are drawn with Canvas 2D. Visual overrides (fonts, grid, axes, padding, legend, data labels, background, blend, entrance animation) come from `chartVisualOverrides`.
  - **Smart overlays** — If `smartResults` is set: anomaly rings, trend line, forecast line/points, reference lines, clustering. **Custom ref lines** and **annotations** from store. **Responsive**: `chartRenderOpts` (padding, font size, grid, legend) adapt to container width (compact &lt;400px, medium &lt;600px).
  - **Interactivity** — Pan/zoom (drag + wheel), brush (Shift+drag), lasso (freeform polygon), crosshair + ruler pins. Tooltip on hover; click to **pin** tooltip. **Mini-map** when scatter zoom &gt; 1.5×. Linked highlight from `hoveredRowIndex`.
  - Export: PNG from the active canvas; SVG from Vega-Lite spec.
- **Smart analytics** — `src/lib/smartAnalytics.ts`: `runAnomaly`, `runForecast`, `runTrend`, `runReferenceLines`, `runClustering`. **Correlation matrix** (Pearson) computed in DetailPanel. Smart tab runs cards and sets `smartResults`; ChartView draws overlays.

---

## Visual layer

Chart look and feel is controlled by `chartVisualOverrides` in the store and applied in `ChartView.tsx` via `chartRenderOpts`. Grouped as:

- **Typography** — `fontFamily`, `titleFontWeight`, `titleItalic`, `tickRotation`; applied to title and axis labels.
- **Marks** — `markShape` (circle, square, diamond, triangle, cross, star, …), `markStroke` / `markStrokeWidth`, `markJitter`, `sizeScale` (for size encoding), `barCornerRadius`, `lineStrokeStyle`, `lineCurveSmooth`.
- **Axes & grid** — `axisLineColor`, `axisLineWidth`, `gridStyle`, `gridOpacity`, `tickCount`, `axisLabelColor`.
- **Layout** — `chartPadding`, `legendPosition`, `showDataLabels`.
- **Atmosphere** — `backgroundStyle`, `blendMode`, `glowEnabled`, `animateEntrance`.

Encoding can also drive **glow**, **outline**, and **opacity** per point (scatter/strip) via `activeChart.glowField`, `outlineField`, `opacityField`; these require Canvas 2D. WebGPU scatter is used only when the chart is circle-only, has no stroke/jitter/glow or data-driven glow/outline/opacity, and has no Smart overlays (so anomaly rings, trend line, etc. can be drawn on the same canvas).

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

- **Tokens** — `src/styles/globals.css`: `--loom-*` and `--chart-*`. Tailwind is wired to these in `tailwind.config.ts` (e.g. `bg-loom-bg`, `text-loom-muted`).
- **Components** — Use `.loom-panel`, `.loom-card`, `.loom-btn-primary`, `.loom-btn-ghost`, `.loom-input`, `.loom-badge` for consistency. New UI should use tokens and these classes.

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
| `src/components/DetailPanel.tsx` | Right panel: Stats, Chart (encoding, Visual, bar stack, ref lines, trail, marginals), Export, Smart (anomaly, forecast, trend, ref lines, clustering, correlation matrix). |
| `src/lib/smartAnalytics.ts` | Anomaly, forecast, trend, reference lines, clustering; pure functions over rows/columns. |
| `src/components/ExplorerView.tsx` | Virtualized data table, filters, saved views, undo/redo, column profiling, linked highlight. |
| `src/components/QueryView.tsx` | SQL editor, schema browser, validation, paginated results, snippets, snapshots, diff, NL-to-SQL input. |
| `src/components/PreviewFooter.tsx` | Collapsible preview table + Schema with draggable column tokens. |
| `src/components/Sidebar.tsx` | File list, Data & sources (portals + save CSV), Wikipedia stream + USGS/Meteo/NWS/World Bank cards, folder picker. |
| `src/lib/dateFormat.ts` | Date column formatting for table and charts. |
| `src/lib/queryValidate.ts` | Basic SQL validation (parentheses, SELECT/WITH). |
| `src/lib/persist.ts` | Persist `tableViews` (and optional state) to storage. |
| `src-tauri/src/stream.rs` | Wikimedia SSE → `wiki_stream` table; stream IPC helpers. |
| `src-tauri/src/sources.rs` | USGS, Open-Meteo, NWS, World Bank → DuckDB tables; source IPC helpers. |
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
