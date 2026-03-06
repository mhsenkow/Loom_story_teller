# Loom — Data Storyteller

**Local-first data storytelling for macOS.** Mount a folder, query millions of rows via DuckDB, and render high-density visualizations with WebGPU compute shaders.

---

## Quick Start

### Prerequisites

- **macOS 14+** (Sonoma) with Apple Silicon
- **Rust** (via `rustup`) — 1.75+
- **Node.js** 20+ (via `nvm`)
- **Tauri CLI**: `cargo install tauri-cli`
- **Docker** (optional, for containerized web UI)

### First Time

```bash
make setup    # installs npm + cargo dependencies
make spool    # generates sample data to explore
make spin     # launches Loom in dev mode
```

---

## The Command Loom

Every command has a weaving name. Run `make` to see them all.

### Develop

| Command          | What it does                              |
|------------------|-------------------------------------------|
| `make spin`      | Full dev mode (Tauri + Next.js hot reload)|
| `make thread`    | Frontend-only dev (no Rust, faster start) |
| `make warp`      | Rust backend type-check only              |
| `make setup`     | First-time dependency install             |

### Build

| Command          | What it does                              |
|------------------|-------------------------------------------|
| `make weave`     | Production .app bundle                    |
| `make weave-web` | Static web export (no Tauri shell)        |
| `make weave-rust`| Rust release binary only                  |

### Data

| Command           | What it does                             |
|-------------------|------------------------------------------|
| `make spool`      | Generate sample datasets (10K–1M rows)   |
| `make spool-small`| Small test data (1K rows)                |
| `make spool-mega` | Stress-test data (5M rows, ~500MB)       |

### Docker

| Command              | What it does                          |
|----------------------|---------------------------------------|
| `make shuttle`       | Build & run web UI in Docker          |
| `make shuttle-build` | Build Docker image only               |
| `make shuttle-down`  | Stop containers                       |
| `make shuttle-shell` | Shell into running container          |

### Quality

| Command          | What it does                              |
|------------------|-------------------------------------------|
| `make check`     | Run all checks (TypeScript + Rust)        |
| `make check-ts`  | TypeScript type-check + lint              |
| `make check-rust`| Rust check + clippy                       |
| `make fmt`       | Format all code (Prettier + rustfmt)      |

### Cleanup

| Command          | What it does                              |
|------------------|-------------------------------------------|
| `make unspool`   | Remove generated sample data              |
| `make unravel`   | Deep clean (node_modules, targets, data)  |
| `make tidy`      | Light clean (build caches only)           |

All commands are also available as npm scripts: `npm run spin`, `npm run weave`, `npm run spool`, etc.

### Ollama (optional) — AI chart suggestions

To use **Suggest with AI** (local models for chart recommendations):

1. **Run Ollama** and pull a model:
   ```bash
   ollama serve    # if not already running
   ollama pull llama3.2
   ```
2. **Optional env** (in `.env.local` or shell):
   - `NEXT_PUBLIC_OLLAMA_URL` — default `http://localhost:11434`
   - `NEXT_PUBLIC_OLLAMA_MODEL` — default: first available model or `llama3.2`
3. **Tauri / CORS**: If the app can’t reach Ollama, allow the app origin:
   ```bash
   OLLAMA_ORIGINS="*" ollama serve
   ```
   Or set `OLLAMA_ORIGINS` to your dev URL (e.g. `http://localhost:1420`).

In the Chart view, click **Suggest with AI** to get a recommendation from your local model. Hover **Why?** to see the reason (heuristic or AI).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Tauri Shell (Rust)                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │  tauri-fs     │    │  DuckDB      │    │  MLX Sidecar      │  │
│  │  (folder I/O) │    │  (analytics) │    │  (AI skinning)    │  │
│  └──────┬───────┘    └──────┬───────┘    └───────┬───────────┘  │
│         │  IPC (invoke)     │                     │              │
├─────────┼───────────────────┼─────────────────────┼──────────────┤
│  Frontend (Next.js + TypeScript)                                 │
│  ┌──────┴───────┐    ┌──────┴───────┐    ┌───────┴───────────┐  │
│  │  Zustand      │    │  Vega-Lite   │    │  WebGPU Engine    │  │
│  │  (state)      │    │  (spec gen)  │    │  (WGSL shaders)   │  │
│  └──────────────┘    └──────────────┘    └───────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

**The Brain & Muscle pattern:**
- **Vega-Lite** (brain) declares *what* to draw as portable JSON specs.
- **WebGPU** (muscle) renders *how* via compute shaders, targeting 1M+ points at 60fps.

---

## Project Structure

```
Loom_story_teller/
├── src-tauri/                  # Rust backend
│   ├── Cargo.toml              # Rust dependencies (DuckDB, Tauri, Arrow)
│   ├── tauri.conf.json         # App config (window, plugins, CSP)
│   ├── build.rs                # Tauri build script
│   └── src/
│       ├── main.rs             # Binary entry point
│       ├── lib.rs              # Plugin init, state management, command registration
│       ├── db.rs               # DuckDB: folder scan, SQL queries, column stats
│       └── commands.rs         # IPC command handlers (scan_folder, query_file, etc.)
│
├── src/                        # Next.js frontend
│   ├── app/
│   │   ├── layout.tsx          # Root HTML, fonts, global CSS
│   │   └── page.tsx            # Three-panel layout compositor
│   ├── components/
│   │   ├── Sidebar.tsx         # File explorer + folder picker
│   │   ├── TopBar.tsx          # View mode tabs (Explorer/Chart/Query)
│   │   ├── DetailPanel.tsx     # Right panel: schema, stats, preview
│   │   ├── ExplorerView.tsx    # Full-width data table
│   │   ├── ChartView.tsx       # WebGPU canvas + Vega-Lite integration
│   │   └── QueryView.tsx       # SQL editor + results grid
│   ├── lib/
│   │   ├── store.ts            # Zustand state (files, selection, view mode)
│   │   ├── tauri.ts            # Typed IPC bridge to Rust commands
│   │   ├── vega.ts             # Vega-Lite spec generators (scatter, bar, histogram)
│   │   ├── webgpu.ts           # GPU pipeline: init, upload, compute, render
│   │   ├── format.ts           # Number/byte formatting helpers
│   │   └── wgsl.d.ts           # TypeScript declarations for WGSL imports
│   ├── shaders/
│   │   └── scatter.wgsl        # Compute + vertex + fragment shaders
│   └── styles/
│       └── globals.css         # Design tokens, themes, component utilities
│
├── scripts/
│   └── generate_data.py        # Sample data generator (scatter, sales, timeseries)
├── .cursor/rules/
│   └── loom-stack.mdc          # AI development rules for this project
├── Makefile                    # 🧵 The Command Loom (run `make` for help)
├── Dockerfile                  # Web UI container (static export + serve)
├── docker-compose.yml          # Docker Compose for web UI
├── .dockerignore               # Docker build exclusions
├── next.config.mjs             # Static export for Tauri
├── tailwind.config.ts          # Token-linked Tailwind theme
├── tsconfig.json               # TypeScript config
├── postcss.config.mjs          # PostCSS plugins
└── package.json                # JS dependencies and scripts
```

---

## Design System

All visual decisions are token-based, defined in `src/styles/globals.css`.

| Token                | Dark Default   | Purpose                |
|----------------------|----------------|------------------------|
| `--loom-bg`          | `#0a0a0c`      | Page background        |
| `--loom-surface`     | `#111114`      | Cards, panels          |
| `--loom-elevated`    | `#1a1a1f`      | Hover states, inputs   |
| `--loom-border`      | `#2a2a30`      | Borders, dividers      |
| `--loom-text`        | `#e8e8ec`      | Primary text           |
| `--loom-muted`       | `#6b6b78`      | Secondary text         |
| `--loom-accent`      | `#6c5ce7`      | Accent (purple)        |
| `--chart-1..8`       | (8 colors)     | Visualization palette  |

**To re-skin the entire product:** change only `globals.css` token values.

Component classes: `.loom-panel`, `.loom-card`, `.loom-btn-primary`, `.loom-btn-ghost`, `.loom-input`, `.loom-badge`.

---

## IPC Command Reference

| Command            | Args                              | Returns           |
|--------------------|-----------------------------------|--------------------|
| `scan_folder`      | `{ folderPath: string }`          | `FileEntry[]`      |
| `query_file`       | `{ filePath, sql, limit? }`       | `QueryResult`      |
| `get_column_stats` | `{ filePath: string }`            | `ColumnInfo[]`     |
| `get_sample_rows`  | `{ filePath, limit? }`            | `QueryResult`      |

All IPC calls are typed in `src/lib/tauri.ts`. Never use `invoke()` directly.

---

## WebGPU Pipeline

```
CPU: Float32Array (x, y, category)
  ↓ upload
GPU Storage Buffer
  ↓ compute_positions (256 threads/workgroup)
Screen Buffer (NDC coords + color)
  ↓ vertex_main (instanced quads)
  ↓ fragment_main (circle + soft edge)
Framebuffer
```

Shaders live in `src/shaders/scatter.wgsl`. The color palette matches the CSS `--chart-*` tokens for visual consistency.

---

## Milestones

- **M1 (Core):** Folder → DuckDB → WebGPU skeleton. Target: 1M+ points at 60fps.
- **M2 (Skin):** WebGPU texture → MLX sidecar → AI-styled charts. Leverages UMA on Apple Silicon.
- **M3 (Share):** Bundle spec + assets → Google Cloud Run for governed story sharing.

---

## Key Decisions

1. **Static Export** — Tauri requires SSG, not SSR. `next.config.mjs` sets `output: "export"`.
2. **In-Process DB** — DuckDB runs in the Rust process. No external database server.
3. **Vega-Lite as Spec** — Charts are defined declaratively, making them LLM-friendly and auditable.
4. **WebGPU over Canvas** — Compute shaders handle data transformation on the GPU for 100x throughput.
5. **Zustand over Context** — Simpler than Redux, avoids Context re-render cascade.
