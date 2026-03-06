# Loom — Codebase documentation

For contributors and AI: where things live and how they connect.

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
5. **Data.gov** — Only in Tauri. Data & sources view calls `fetchDataGovRecentCsv()` → Rust `fetch_data_gov_recent_csv` (reqwest to catalog.data.gov). User can “Save to folder” → `saveCsvToFolder(folder_path, url, filename)` → Rust downloads CSV and writes under the mounted folder.

---

## State (Zustand)

`src/lib/store.ts` holds:

- **Folder / files**: `mountedFolder`, `files`, `isScanning`
- **Selection**: `selectedFile`, `columnStats`, `sampleRows`
- **View**: `viewMode` (explorer | chart | query), `panelTab` (stats | chart | export), `suggestionsExpanded`
- **Chart**: `vegaSpec`, `activeChart`, `encodingOverrides`, `chartTitleOverrides`, `aiSuggestionReason`
- **Export**: `pngExportHandler`, `svgExportHandler` (set by `ChartView`)

Components subscribe to slices; avoid putting derived data that changes often in the store.

---

## IPC (Tauri)

All Rust commands are in `src-tauri/src/commands.rs`. Frontend wrappers in `src/lib/tauri.ts`:

- Use `isTauri()` to branch; in browser, many calls fall back to `mock-data.ts`.
- Never call `invoke()` directly from UI code; use the typed functions from `tauri.ts`.

Adding a new command:

1. Add `#[tauri::command] pub async fn ...` in `commands.rs`.
2. Register it in `lib.rs` in `tauri::generate_handler!`.
3. Add a wrapper in `tauri.ts` and, if needed, mock in `mock-data.ts`.

---

## Chart pipeline

- **Spec generation** — `src/lib/vega.ts`: `buildScatterSpec`, `buildBarSpec`, `buildLineSpec`, etc. They take column names, types, and options and return Vega-Lite JSON.
- **Recommendations** — `src/lib/recommendations.ts`: from `columnStats` and optional `vegaSpec`, returns `ChartRecommendation[]` with `spec`, `label`, `reason`. Used for the suggestion grid and for “Suggest with AI” (Ollama can override choice).
- **Rendering** — `ChartView.tsx`:
  - Chooses WebGPU path for point marks when available, else Canvas 2D scatter.
  - Bar/line/area/arc are drawn with Canvas 2D or Vega headless in JS.
  - Export: PNG from canvas; SVG by compiling current Vega-Lite spec with Vega and exporting SVG.

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
| `src/components/ChartView.tsx` | Main chart area, suggestion grid, title edit, export handler registration. |
| `src/components/DetailPanel.tsx` | Right panel: Stats, Chart (encoding controls), Export (PNG/SVG). |
| `src/components/PreviewFooter.tsx` | Collapsible preview table + Schema with draggable column tokens. |
| `src/components/Sidebar.tsx` | File list, Data & sources (Data.gov + Save to folder), folder picker. |

---

## Conventions

- **Static export** — No `getServerSideProps` or runtime API routes; Data.gov and other backend work live in Tauri commands.
- **Paths** — Normalize `file://` and `file:///` to a plain path before sending to Rust (see `normalizePath` in `tauri.ts` and `normalize_folder_path` in `commands.rs`).
- **Errors** — Rust commands return `Result<T, String>`; frontend shows errors via toast or inline message where appropriate.
