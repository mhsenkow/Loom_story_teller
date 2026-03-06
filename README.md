# Loom — Data Storyteller

**Local-first data storytelling for macOS.** Mount a folder, query millions of rows via DuckDB, and build charts with Vega-Lite and WebGPU. Discover data with heuristic and AI suggestions, tweak encodings in the panel, and export as PNG or SVG.

---

## What it does

- **Mount a folder** — Point at a directory of CSV/Parquet files; Loom scans and exposes them in the sidebar.
- **Chart view** — Pick a file, get instant chart suggestions (bar, line, scatter, area, pie, etc.). Click a suggestion or use **Suggest with AI** (Ollama) for a recommendation.
- **Encode your way** — Drag columns from the schema footer into X, Y, Color, Size, Row; or use dropdowns. Change mark type (point, line, bar, area, arc).
- **Export** — Copy chart as PNG or SVG from the Export tab in the right panel. Edit the chart title (double-click or hover → edit).
- **Data discovery** — In **Data & sources**, browse **Recent CSV datasets** from Data.gov (Tauri only) and **Save to folder** to download into your mounted folder.

---

## Screenshots

| Main view | Data & sources |
|-----------|----------------|
| [![Main view](docs/screenshots/loom-main-view.png)](docs/screenshots/loom-main-view.png) | [![Data sources](docs/screenshots/loom-data-sources.png)](docs/screenshots/loom-data-sources.png) |

*Add your own screenshots to `docs/screenshots/` — see [docs/screenshots/README.md](docs/screenshots/README.md) for suggested filenames and how to capture.*

---

## Quick start

### Prerequisites

- **macOS 14+** (Sonoma) with Apple Silicon recommended
- **Rust** 1.75+ (`rustup`)
- **Node.js** 20+ (e.g. `nvm`)
- **Tauri CLI**: `cargo install tauri-cli`
- **Docker** (optional, for containerized web UI)

### First time

```bash
make setup    # install npm + cargo deps
make spool    # generate sample data in .loom-data
make spin     # launch Loom (Tauri + Next.js + optional Ollama)
```

Then **Choose folder** → pick `.loom-data` (or any folder with CSV/Parquet), select a file, and switch to **Chart** to see suggestions.

---

## Command reference (the Loom)

Run `make` (or `make help`) to list all commands. Every target uses a weaving metaphor.

### Develop

| Command | Description |
|--------|-------------|
| `make spin` | Full dev: Tauri + Next.js hot reload; starts Ollama in background if available |
| `make thread` | Frontend-only dev (no Rust) — good for UI work and web-only testing |
| `make warp` | Rust backend type-check only (`cargo check`) |
| `make setup` | First-time: install npm deps and fetch Rust deps |

### Build

| Command | Description |
|--------|-------------|
| `make weave` | Production build → `.app` bundle |
| `make weave-web` | Static web export only (output in `./out`) |
| `make weave-rust` | Rust release binary only |

### Data

| Command | Description |
|--------|-------------|
| `make spool` | Generate sample datasets (10K–1M rows) in `.loom-data` |
| `make spool-small` | Small test set (1K rows) |
| `make spool-mega` | Stress test (5M rows, ~500MB) |

### Docker

| Command | Description |
|--------|-------------|
| `make shuttle` | Build and run web UI in Docker |
| `make shuttle-build` | Build Docker image only |
| `make shuttle-down` | Stop containers |
| `make shuttle-shell` | Shell into running container |

### Quality

| Command | Description |
|--------|-------------|
| `make check` | Run all checks (TypeScript + Rust) |
| `make check-ts` | TypeScript type-check + lint |
| `make check-rust` | Rust check + clippy |
| `make fmt` | Format code (Prettier + rustfmt) |

### Cleanup

| Command | Description |
|--------|-------------|
| `make unspool` | Remove generated `.loom-data` |
| `make unravel` | Deep clean (node_modules, .next, out, targets, data) |
| `make tidy` | Light clean (build caches only) |

All of these are also exposed as npm scripts: `npm run spin`, `npm run weave`, `npm run spool`, etc.

---

## Ollama (optional) — AI chart suggestions

To use **Suggest with AI** in the Chart view:

1. Run Ollama and pull a model:
   ```bash
   ollama serve
   ollama pull llama3.2
   ```
2. Optional env (`.env.local` or shell):
   - `NEXT_PUBLIC_OLLAMA_URL` — default `http://localhost:11434`
   - `NEXT_PUBLIC_OLLAMA_MODEL` — default: first available or `llama3.2`
3. If the app can’t reach Ollama (e.g. CORS), allow origins:
   ```bash
   OLLAMA_ORIGINS="*" ollama serve
   ```
   Or set `OLLAMA_ORIGINS` to your dev URL (e.g. `http://localhost:1420`).

Hover **Why?** on a suggestion to see the reason (heuristic or AI).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Tauri Shell (Rust)                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │  tauri-fs     │  │  DuckDB      │  │  reqwest (Data.gov,     │ │
│  │  (folder I/O) │  │  (analytics) │  │   save CSV to folder)   │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬─────────────┘ │
│         │  IPC (invoke)   │                        │              │
├─────────┼─────────────────┼────────────────────────┼──────────────┤
│  Frontend (Next.js + TypeScript)                                 │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌─────────────┴───────────┐ │
│  │  Zustand     │  │  Vega-Lite   │  │  WebGPU / Canvas 2D       │ │
│  │  (state)     │  │  (spec gen)  │  │  (scatter + bar/line/…)  │ │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

- **Vega-Lite (brain)** — Declares *what* to draw as portable JSON specs; used for export and for non-WebGPU marks.
- **WebGPU / Canvas (muscle)** — Renders scatter at scale; other mark types use Canvas 2D or Vega headless where appropriate.

---

## Project structure

```
Loom_story_teller/
├── src-tauri/                  # Rust backend
│   ├── Cargo.toml               # DuckDB, Tauri, reqwest, etc.
│   ├── tauri.conf.json          # Window, plugins, CSP
│   ├── capabilities/            # Tauri v2 permissions
│   └── src/
│       ├── lib.rs               # Plugin init, command registration
│       ├── main.rs              # Binary entry
│       ├── db.rs                # DuckDB: scan, query, column stats
│       └── commands.rs          # IPC: scan_folder, query_file, inspect_file,
│                                #      save_csv_to_folder, fetch_data_gov_recent_csv
│
├── src/                         # Next.js frontend
│   ├── app/
│   │   ├── layout.tsx           # Root layout, fonts, globals
│   │   └── page.tsx             # Three-panel layout (Sidebar | Main | DetailPanel)
│   ├── components/
│   │   ├── Sidebar.tsx          # Files list, Data & sources, folder picker
│   │   ├── TopBar.tsx           # View tabs (Explorer / Chart / Query)
│   │   ├── DetailPanel.tsx      # Right panel: Stats, Chart (encoding), Export
│   │   ├── ChartView.tsx       # Chart canvas, suggestions, title edit, export handlers
│   │   ├── ChartCard.tsx        # Thumbnail + “Try” for suggestions
│   │   ├── ExplorerView.tsx    # Full-width data table
│   │   ├── QueryView.tsx       # SQL editor + results
│   │   └── PreviewFooter.tsx   # Collapsible preview + Schema (drag tokens)
│   ├── lib/
│   │   ├── store.ts             # Zustand state
│   │   ├── tauri.ts             # Typed IPC bridge (invoke wrappers)
│   │   ├── vega.ts              # Vega-Lite spec builders
│   │   ├── webgpu.ts            # WebGPU pipeline (scatter)
│   │   ├── recommendations.ts  # Heuristic chart suggestions
│   │   ├── ollama.ts            # Ollama API for AI suggestions
│   │   ├── mock-data.ts         # Browser fallbacks when not in Tauri
│   │   ├── format.ts            # Number/byte formatting
│   │   └── chartPalettes.ts     # Chart color palettes
│   ├── shaders/
│   │   └── scatter.wgsl         # Compute + vertex + fragment
│   └── styles/
│       └── globals.css          # Design tokens, theme
│
├── scripts/
│   └── generate_data.py         # Sample data (scatter, sales, timeseries)
├── docs/
│   └── screenshots/            # Screenshots for README
├── Makefile                     # Command Loom (run `make` for help)
├── Dockerfile                   # Web UI container
├── docker-compose.yml
├── next.config.mjs              # Static export for Tauri
├── tailwind.config.ts          # Token-linked theme
└── package.json
```

See [DOCS.md](DOCS.md) for a deeper codebase map and conventions.

---

## Design system

Visual design is token-based in `src/styles/globals.css`:

| Token | Dark default | Purpose |
|-------|--------------|---------|
| `--loom-bg` | `#0a0a0c` | Page background |
| `--loom-surface` | `#111114` | Cards, panels |
| `--loom-elevated` | `#1a1a1f` | Hover, inputs |
| `--loom-border` | `#2a2a30` | Borders |
| `--loom-text` | `#e8e8ec` | Primary text |
| `--loom-muted` | `#6b6b78` | Secondary text |
| `--loom-accent` | `#6c5ce7` | Accent (purple) |
| `--chart-1` … `--chart-8` | (palette) | Chart colors |

Component classes: `.loom-panel`, `.loom-card`, `.loom-btn-primary`, `.loom-btn-ghost`, `.loom-input`, `.loom-badge`. To reskin the app, change token values in `globals.css`.

---

## IPC command reference

Frontend calls go through `src/lib/tauri.ts`; do not use raw `invoke()`.

| Command | Args | Returns |
|---------|------|--------|
| `scan_folder` | `{ folderPath: string }` | `FileEntry[]` |
| `query_file` | `{ filePath, sql, limit? }` | `QueryResult` |
| `get_column_stats` | `{ filePath: string }` | `ColumnInfo[]` |
| `get_sample_rows` | `{ filePath, limit? }` | `QueryResult` |
| `inspect_file` | `{ filePath, limit? }` | `InspectResult` (stats + sample) |
| `save_csv_to_folder` | `{ folder_path, url, filename }` | `string` (saved path) |
| `fetch_data_gov_recent_csv` | `{ rows?: number }` | `DataGovDataset[]` |

---

## WebGPU pipeline (scatter)

```
CPU: Float32Array (x, y, category)
  → upload to GPU storage buffer
  → compute_positions (workgroups)
  → screen-space coords + color
  → vertex_main (instanced quads)
  → fragment_main (circle + soft edge)
  → framebuffer
```

Shaders: `src/shaders/scatter.wgsl`. Palette aligns with `--chart-*` in CSS.

---

## Milestones

- **M1 (Core)** — Folder → DuckDB → WebGPU scatter. Target: 1M+ points at 60fps.
- **M2 (Skin)** — WebGPU texture → MLX sidecar for AI-styled charts (Apple Silicon).
- **M3 (Share)** — Bundle spec + assets for governed story sharing.

---

## Key decisions

1. **Static export** — Tauri expects a static frontend; `next.config.mjs` uses `output: "export"`. No server-side API routes at runtime.
2. **In-process DB** — DuckDB runs inside the Rust process; no separate database server.
3. **Vega-Lite as spec** — Charts are declarative JSON, so they’re auditable and LLM-friendly; used for export (SVG) and for non-WebGPU marks.
4. **WebGPU for scatter** — High-density scatter uses compute shaders; other marks use Canvas 2D or Vega as needed.
5. **Zustand** — Single store for UI and cached results; avoids Context re-render chains.
6. **Data.gov in Rust** — Data.gov “recent CSV” is fetched by a Tauri command (reqwest) so it works without a Next.js API route.
