# Screenshots

Add app screenshots here for the main README. Suggested filenames:

- **`loom-explorer.png`** — Explorer view: sidebar (file list), data table with columns (sort/filter), compact header and toolbar. Optional: column profiling card open, or a saved view selected.
- **`loom-main-view.png`** — Chart view: sidebar, main chart (e.g. scatter or bar), right panel (Stats/Chart/Export/Smart). Optional: a suggestion or encoding visible, or Smart overlay (trend/anomaly).
- **`loom-query.png`** — Query view: SQL editor, schema browser, results grid (paginated). Optional: a snippet or snapshot/diff visible.
- **`loom-data-sources.png`** — Data & sources panel: “Choose folder”, “Recent CSV datasets” from Data.gov, Save to folder.

## How to capture

1. Run `make spin` (or `make thread` for web-only) and open a folder (e.g. `.loom-data` after `make spool`).
2. **Explorer**: In Explorer view, pick a file so the table loads. Optionally right-click a column for profiling, or use filters/saved views. Capture full window or main area → save as `loom-explorer.png`.
3. **Chart**: Switch to Chart, select a file, pick a chart suggestion. Optionally enable Smart overlay or interaction (crosshair, lasso). Capture → `loom-main-view.png`.
4. **Query**: Switch to Query, run a query, optionally save a snippet or snapshot. Capture → `loom-query.png`.
5. **Data & sources**: Open Data & sources in the sidebar; wait for Data.gov list if in Tauri. Capture → `loom-data-sources.png`.

Use PNG for clarity. The main [README](../../README.md) references these paths in the Screenshots section.
