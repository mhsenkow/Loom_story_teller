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
| 5 | `mcp/` | Remote MCP / ChatGPT plugin Worker (chart recommend tools) — see `mcp/README.md` |

---

## Directory map (quick)

| Path | Role |
|------|------|
| `src/app/` | Next.js App Router: `layout.tsx`, `page.tsx` (shell + three-panel layout; views: explorer / chart / query / dive) |
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
- **Poll sources (60):** defined once in `src/lib/sourceRegistry.ts` (kind, label, DuckDB/buffer table, columns + types, poll cadence, ORDER BY, sidebar group). Sidebar cards, Query (`stream://<kind>`), Dive, discover, and web buffers all read it. Web fetches `/api/source/<kind>` from the Worker (cached per kind, with upstream fallbacks) and parses in `webStreams.ts`; desktop fetches upstreams in `sources.rs` into the same tables. `src/lib/__tests__/sourceRegistry.test.ts` fails if a default chart or SQL snippet names a column the table doesn't have.
- **Adding a source:** registry entry → Worker route in `workers/catalog-proxy.ts` → parser in `webStreams.ts` → Rust fetch/insert + table in `sources.rs` (same columns) → `recommendSourceStory` charts + `SOURCE_SQL_SNIPPETS` (recommendations.ts) → a discover hook in `discoverStories.ts`.

Rust implementation: `src-tauri/src/stream.rs`, `src-tauri/src/sources.rs`.

---

## Quality commands

```bash
make ci            # full PR gate (preflight, tsc, Worker, MCP, tests, build, cargo check)
make check         # tsc + Worker + cargo check + Vitest
make test          # Vitest
npm run build      # Next production build (static export)
make loft          # Deploy static web UI to Cloudflare Workers (wrangler.jsonc)
make tablet        # iOS sim/device dev (web-parity; DuckDB stays desktop)
make tablet-weave  # App Store IPA → TestFlight
make tablet-xcode  # Open Xcode to Archive / Distribute
```

**iOS:** Bundle `com.loom.storyteller`, team `WC44W2QVE4`. Mobile Rust is `src-tauri/src/mobile.rs` (no DuckDB). Frontend: `isDesktop()` for DuckDB IPC; iPad/iPhone Tauri uses the web data path. Re-auth Apple ID in Xcode → Settings → Accounts before the first IPA build. Shell strategy: [docs/MOBILE_IOS.md](docs/MOBILE_IOS.md). Release checklist: [docs/MOBILE_ACCEPTANCE.md](docs/MOBILE_ACCEPTANCE.md).

**Clean checkout (LOOM-089):** Tag releases and `make ci` assume a fresh `git clone` + `npm ci` — no reliance on untracked local files. Before tagging, run `make ci` from a clean tree (or CI on the PR) so missing assets or config surface before App Store / Worker deploy.

`eslint.config.mjs` uses flat config; some React Compiler ESLint rules are relaxed so the existing large components stay lint-clean without a full rewrite.

---

## Adding a feature (checklist)

1. **Acceptance:** Name the user-visible outcome and which runtime(s) change (desktop / web / iOS / Worker).
2. **Data in Rust:** Extend `db.rs` / new module; expose via `commands.rs` + `lib.rs` when desktop-only.
3. **Types + invoke:** Mirror types and wrappers in `tauri.ts`; add browser mocks in `mock-data.ts` if needed.
4. **UI state:** Add minimal fields/actions in `store.ts`; wire in the smallest set of components.
5. **Verification:** Pure logic → focused Vitest; Worker route → `check:worker` + handler fixture; native → `cargo test`; UI journey → DOM/e2e when behavior crosses components. Run `make check` locally; `make ci` before release.
6. **Docs:** Update `DOCS.md` (internal) and, if user-visible, `README.md`. Platform limits → [docs/CAPABILITY_MATRIX.md](docs/CAPABILITY_MATRIX.md).
7. **What's new:** If people will notice it, add an item to the top release in `src/lib/changelog.ts`. Write for users, not developers.
8. **Performance:** If the journey touches parse/render hot paths, note impact against [docs/PERFORMANCE_BUDGETS.md](docs/PERFORMANCE_BUDGETS.md).

---

## Naming

- **React components:** `PascalCase.tsx` in `src/components/`.
- **Lib modules:** `camelCase.ts` in `src/lib/`.
- **Rust:** `snake_case` for files and functions.
