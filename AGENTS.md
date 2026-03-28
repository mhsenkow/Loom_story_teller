# Loom — guide for AI coding agents

Use this file plus [DOCS.md](DOCS.md) (architecture) and [README.md](README.md) (product + commands). Repo rules also live in `.cursor/rules/loom-stack.mdc`.

---

## What to read first

| Priority | File | Why |
|----------|------|-----|
| 1 | `DOCS.md` | Data flow, Zustand slices, chart pipeline, IPC add-new-command recipe |
| 2 | `src/lib/tauri.ts` | Every Tauri `invoke` wrapper; **single bridge** from UI to Rust |
| 3 | `src/lib/store.ts` | All shared client state; subscribe to slices, do not duplicate |
| 4 | `src-tauri/src/lib.rs` | Command registration (`generate_handler!`) and managed state (`LoomDb`, stream, sources) |

---

## Directory map (quick)

| Path | Role |
|------|------|
| `src/app/` | Next.js App Router: `layout.tsx`, `page.tsx` (shell + three-panel layout) |
| `src/components/` | One main React component per file (PascalCase) |
| `src/lib/` | TypeScript **without** React: store, IPC, Vega, WebGPU, recommendations, analytics |
| `src/shaders/` | WGSL for WebGPU scatter |
| `src/styles/globals.css` | Design tokens (`--loom-*`, `--chart-*`); reskin here only |
| `src-tauri/src/` | Rust: `lib.rs`, `commands.rs`, `db.rs`, `stream.rs`, `sources.rs` |
| `scripts/` | `generate_data.py` — sample CSV/Parquet for `.loom-data` |

---

## Conventions (do not break these)

- **IPC:** Add Rust `#[tauri::command]` → register in `lib.rs` → add typed wrapper in `tauri.ts`. UI components must not call `invoke()` directly.
- **State:** Zustand only (`store.ts`). No parallel global state for the same concern.
- **Charts:** Vega-Lite specs are the portable “brain”; WebGPU is for high-density **scatter** only when rules in `ChartView` allow (see README WebGPU section). Stream/source story recs often use `spec: {}` with `xField`/`yField`; `extractScatterData` falls back to those fields when `spec.encoding` is absent.
- **Theming:** Use CSS variables / Tailwind tokens from `globals.css`; avoid hard-coded hex in new UI.
- **Static export:** `next.config.mjs` uses `output: "export"` — no runtime Next.js API routes.

---

## Live and polled data (Tauri)

- **Wikipedia SSE:** `stream_*` commands → DuckDB table `wiki_stream`. Frontend: `Sidebar` live card, `QueryView` `stream://wiki`, `recommendStreamStory`, `STREAM_SQL_SNIPPETS`.
- **Poll sources:** `source_*` commands → tables `usgs_quakes`, `meteo_weather`, `nws_alerts`, `world_bank` (see `sources.rs`). Frontend: `Sidebar` source cards, `QueryView` `stream://usgs|meteo|nws|world_bank`, `recommendSourceStory`, `SOURCE_SQL_SNIPPETS`.

Rust implementation: `src-tauri/src/stream.rs`, `src-tauri/src/sources.rs`.

---

## Quality commands

```bash
make check      # tsc + eslint + cargo check (+ clippy if available)
make test       # Vitest
npm run build   # Next production build (static export)
```

`eslint.config.mjs` uses flat config; some React Compiler ESLint rules are relaxed so the existing large components stay lint-clean without a full rewrite.

---

## Adding a feature (checklist)

1. **Data in Rust:** Extend `db.rs` / new module; expose via `commands.rs` + `lib.rs`.
2. **Types + invoke:** Mirror types and wrappers in `tauri.ts`; add browser mocks in `mock-data.ts` if needed.
3. **UI state:** Add minimal fields/actions in `store.ts`; wire in the smallest set of components.
4. **Docs:** Update `DOCS.md` (internal) and, if user-visible, `README.md`.

---

## Naming

- **React components:** `PascalCase.tsx` in `src/components/`.
- **Lib modules:** `camelCase.ts` in `src/lib/`.
- **Rust:** `snake_case` for files and functions.
