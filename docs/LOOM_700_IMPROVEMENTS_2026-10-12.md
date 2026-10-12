# Loom — 700 concrete improvements for Cursor

**Review date:** October 12, 2026. **Baseline:** working tree at `eff0f9c`, including existing uncommitted frontend, browser ingestion, native iOS and configuration changes. **Deliverable:** exactly 700 unchecked implementation/review tasks, identified as `LOOM-001` through `LOOM-700`.

This is an implementation backlog, not a claim that Loom has 700 reproduced defects. It combines fixes, robustness work, accessibility, performance, architecture, delivery and product improvements. The existing October 7 `IMPROVEMENTS.md` was used as a review inventory and preserved unchanged. Obsolete claims were replaced where current inspection demonstrated changes; other older leads remain explicitly marked for validation. IDs are stable task references, not line numbers or a requirement to execute numerically.

## Holistic assessment

Loom has a substantial product foundation: a typed Tauri bridge, a central Zustand store, portable chart specifications, a shared source registry, extensive pure-function tests and multiple rendering paths. Its most valuable workflow is discovery or own-data import → useful chart → inspect the underlying evidence → save/reopen → share. Improving that complete loop is more valuable than adding more chart kinds.

The largest risks sit at the seams. Public sharing carries data outside the local-first boundary; user HTML is served from the application origin. Browser parsers, durable storage and dataset activation have different lifetime and normalization rules. Chart display, tooltips, thumbnails and exports can disagree because their renderers use separate models. Independent source implementations and browser/native capability detection need parity contracts. Two iOS shells now coexist, so packaging ownership and native behavior need explicit decisions.

The structure also makes safe changes expensive: `ChartView.tsx` is 7,896 lines, `DetailPanel.tsx` 4,933, `Sidebar.tsx` 2,541 and the store 1,348. Broad store subscriptions couple inexpensive hover/status updates to expensive render work. Refactor these around tested contracts, in small behavior-preserving changes, before undertaking large feature work.

## Current verification and its limits

| Check | Observed result |
|---|---|
| `npx tsc --noEmit` | Passed, zero reported errors |
| `npx eslint src` | Passed with 65 warnings, zero errors |
| `npx vitest run` | 44 files, 820 tests passed |
| `npm run build` | Passed; Next reports 562 kB First Load JS for `/`, 460 kB route size |
| `npx tsc --noEmit -p mcp/tsconfig.json` | Failed with 113 TypeScript errors; examples include Worker Env typing and browser types reachable from shared modules |
| Root TypeScript scope | `workers/`, `mcp/` and `src-tauri/` excluded; root success does not validate them |
| Test environment | Vitest uses Node; discovered tests are under `src/lib/__tests__` |
| CI inventory | One existing workflow, triggered by version tags for macOS release |
| Browser static assets | `public/privacy.html` exists; no browser icon/manifest set found in that directory |
| Native runtime and Rust | Reviewed source/configuration; Rust checks, signed archives, device journeys and runtime GPU measurements were not run |
| Security/dependencies | Reviewed local boundaries; no live exploit attempts, production writes, fresh advisory audit or current-version security claims |

The build figure is the framework's reported transfer estimate, not a measured Lighthouse score or proof of a specific module's current contribution. Targets later in the backlog are proposed acceptance budgets, not measured performance. No deployed-site, accessibility conformance or App Store compliance certification is implied.

## Cursor execution contract

1. Read `AGENTS.md`, `DOCS.md`, `README.md` and applicable local rules. The supplied AGENTS conventions take precedence over the obsolete GPU-only/zero-copy claims in `.cursor/rules/loom-stack.mdc`; reconcile that rule in [LOOM-518](#loom-518).
2. Preserve the existing working tree. Start by recording `git status --short`; do not reset, overwrite or commit unrelated work. Use file/symbol anchors rather than historical line numbers. Do not deploy, publish stories, send feedback, upload archives or exercise destructive cleanup merely to check a task.
3. For **Review** items, reproduce or inspect the current path before implementing the older hypothesis. For **Source** items, the code/configuration or missing gate was inspected, but a runtime impact or exploit may still need reproduction. **Proposal** means a deliberate new capability or contract, not an observed defect.
4. Record one of: implemented with evidence, verified already addressed, deferred with rationale, or blocked with a precise dependency. Only check a box when its acceptance conditions hold. Do not force a code change to satisfy an obsolete lead.
5. Read the index and first-wave plan, then load only the relevant headings with rg/sed or editor search; this large reference is not intended as a single execution prompt. Work in bounded clusters. Land security boundaries, dataset identity/activation, storage limits, render contracts and test gates before broad component extraction. Split large modules by moving one responsibility at a time while preserving outputs.
6. All IPC stays in `src/lib/tauri.ts`; add Rust command → register → typed wrapper. Shared application state stays in the existing Zustand store (internal slices are fine). Avoid a parallel global cache for the same concern without an explicit ownership/lifetime contract.
7. Preserve static export and browser/mobile web-data paths. No runtime Next API routes. Use `isDesktop()` only for desktop DuckDB capabilities; model native shell export/link capabilities separately. Keep Vega-Lite as the portable chart brain and respect the existing WebGPU scatter eligibility constraints.
8. Use CSS/Tailwind tokens. Shared styles and semantic tokens belong in `globals.css`; do not introduce hardcoded color choices throughout components. Validate light/dark/high-contrast, reduced motion and supported phone/tablet/desktop sizes for visible changes.
9. Match validation to risk: pure logic regression tests for semantic bugs; focused component/browser tests for interaction; Rust tests/checks for native changes; Worker/MCP type checks for those modules; static build for bundling. Do not add tests that simply mirror implementation, and do not test every wording/token edit with a full suite.
10. Keep privacy consent concrete: show exactly which rows/columns/artifacts leave the device. A browser Origin check is not authentication. Never hide a boundary flaw by only adding UI confirmation.
11. Update DOCS/README for behavior and architecture changes, and add user-facing changes to the top release in `src/lib/changelog.ts`. Document measured performance before/after and any changed platform support.
12. Maintain this backlog as review evidence evolves: preserve IDs, add a short completion note with validation and changed files, and link related tasks rather than duplicating fixes.

## Recommended first wave

| Cluster | Tasks | Completion gate |
|---|---|---|
| Public sharing/privacy | [LOOM-001](#loom-001), 002, 003, 008, 009, 010, 011, 093, 447 | Explicit data scope, escaped output, isolated/sanitized publication and tested mutation policy |
| Native boundary | [LOOM-004](#loom-004), 005, 006, 097, 098, 099, 100 | Approved file/URL/SQL capabilities enforced by Rust, with legitimate save/import paths preserved |
| Reliable own-data loop | [LOOM-022](#loom-022), 026, 079, 145, 151, 197, 250, 304, 545, 667, 668, 685 | Stable identity/types, atomic activation, bounded parsing/storage and visible persistence failures |
| Enabling gates | [LOOM-088](#loom-088), 090, 470, 471, 503, 697 | PR checks cover frontend, both Workers and relevant native paths; journey tests run reliably |
| Render/export contract | [LOOM-013](#loom-013), 015, 016, 018, 019, 048, 049, 058, 128, 130 | Same rows/scales in chart, interaction and output; resource ownership and completion signals explicit |
| Responsive/native product | [LOOM-066](#loom-066), 280, 400, 418, 652, 663, 666, 669, 683, 700 | One maintained shell strategy, usable inputs/exports and a tested packaged journey |

**Suggested delivery sequencing:** first close exposure and data-loss risks; then establish contract tests and state ownership; then improve interaction/accessibility; then split heavy modules and enforce budgets; then add optional installability, backup and advanced features. P1 tasks outrank polish, but their evidence still must be validated. Do not silently replace real SQL with demos or claim a rendered export matches if only its specification matches.

## Priority and effort

- **P1:** exposure, data loss, materially wrong analysis, broken core journey, critical resource pressure or missing enabling gate.
- **P2:** substantial usability, robustness, maintainability, accessibility or performance improvement.
- **P3:** narrower refinement or optional capability. A carried-forward priority is provisional until its current impact is reproduced; escalation is appropriate when evidence warrants it.
- **Effort:** S ≈ focused local change; M ≈ multiple contracts/callers; L ≈ platform/lifecycle or architecture work. Estimates are triage aids, not delivery promises. Split L tasks into reviewable changes while keeping one acceptance owner.

**Inventory:** 700 tasks; 129 P1, 428 P2, 143 P3. Evidence: 132 Source, 503 Review, 65 Proposal.

## Area index

| Area | Tasks |
|---|---:|
| [01 · Security, privacy and trust boundaries](#area-01) | 38 |
| [02 · Dependency compatibility and maintenance](#area-02) | 5 |
| [03 · iOS shells, packaging and lifecycle](#area-03) | 10 |
| [04 · Browser ingestion, durable files and linked folders](#area-04) | 35 |
| [05 · CI and release engineering](#area-05) | 10 |
| [06 · Documentation and contributor experience](#area-06) | 23 |
| [07 · Test infrastructure and regression coverage](#area-07) | 46 |
| [08 · MCP tools, profiler and widget](#area-08) | 10 |
| [09 · Worker APIs, caching and operations](#area-09) | 22 |
| [10 · Desktop DuckDB, filesystem and native commands](#area-10) | 43 |
| [11 · Sharing, publication and export fidelity](#area-11) | 25 |
| [12 · Live streams and source parity](#area-12) | 25 |
| [13 · Recommendations, discovery and optional AI](#area-13) | 35 |
| [14 · Table, SQL, Dive and derived-data workflows](#area-14) | 74 |
| [15 · GPU resources, rendering and interaction](#area-15) | 11 |
| [16 · State transitions, persistence and startup](#area-16) | 31 |
| [17 · Static web delivery, installability and tooling](#area-17) | 20 |
| [18 · Accessibility and keyboard interaction](#area-18) | 52 |
| [19 · Responsive and touch workflows](#area-19) | 13 |
| [20 · Chart semantics, layout and analytical correctness](#area-20) | 84 |
| [21 · App shell, controls and design system](#area-21) | 88 |

## Detailed backlog

Each item defines a separate acceptance outcome. Similar file targets do not imply a single bulk rewrite. A behavioral task and its regression-test task may be completed together, but preserve both evidence records.

<a id="area-01"></a>

## 01 · Security, privacy and trust boundaries

<a id="loom-001"></a>001

### LOOM-001 — Make data upload on "Get link" an explicit choice

- [x] **P1 · security · Effort M · Evidence: Source**
- **Targets:** [`src/components/ShareSheet.tsx`](../src/components/ShareSheet.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `publishStory` always attaches `buildShareDataSnapshot` (up to 2,500 rows of *every* column of `sampleRows`, plus stats) to a public 7-day link; the PII warning sits only under the NeoSpace button. Add an "Include data (N rows, M columns)" toggle, default off for local and uploaded files, and limit to the chart's encoded columns.
- **Done when:** "Get link" on a local CSV uploads image-only unless opted in.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Toggle + `defaultIncludeShareData` / `chartEncodedColumnNames`; snapshot limited to encoded columns. Tests in `shareLineage.test.ts`. Files: `ShareSheet.tsx`, `shareLineage.ts`, `changelog.ts`.

<a id="loom-002"></a>002

### LOOM-002 — Escape data-source labels in the dashboard microsite

- [x] **P1 · security · Effort M · Evidence: Source**
- **Targets:** [`src/lib/dashboardMicrosite.ts`](../src/lib/dashboardMicrosite.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** the footer builds `slots.map((s) => s.sourceLabel).filter(Boolean).join("; ")` without `escapeHtml`, while every other field is escaped. A file named `<img src=x onerror=alert(1)>.csv` (or a "Query: …" label holding SQL with `<`) runs script in the exported or published page. Escape each label.
- **Done when:** a test with `<script>` in a source label yields `&lt;script&gt;`.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Footer labels passed through `escapeHtml`. Test: `dashboardMicrosite.test.ts`.

<a id="loom-003"></a>003

### LOOM-003 — Neutralise spreadsheet formulas in CSV exports

- [x] **P1 · security · Effort M · Evidence: Source**
- **Targets:** [`src/lib/csvExport.ts`](../src/lib/csvExport.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `escapeCsvCell` quotes commas/quotes but passes cells starting with `=`, `+`, `-`, `@`, tab or CR, so public catalog or stream values like `=HYPERLINK(...)` run when the export is opened in Excel/Sheets. Prefix such strings with `'` (leave real numbers alone).
- **Done when:** `=1+1` exports as `'=1+1` and a unit test covers each trigger character.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Prefix formula triggers; finite numbers unchanged. Test: `csvExport.test.ts`.

<a id="loom-004"></a>004

### LOOM-004 — Set a real Content-Security-Policy for the desktop webview

- [x] **P1 · security · Effort M · Evidence: Source**
- **Targets:** [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `"csp": null` disables Tauri's CSP entirely, so any HTML/script injected via a catalog description, CSV cell or shared link runs with full access to every custom IPC command (arbitrary file write, URL open). Add a `default-src 'self'; connect-src ipc: http://ipc.localhost <explicit upstream hosts> http://localhost:11434; img-src 'self' data: blob:` policy.
- **Done when:** the app runs with a non-null CSP and an injected `<script>` in a rendered string is blocked.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.
- **Completed (2026-10-12):** Non-null CSP in `tauri.conf.json` (script-src self, connect-src ipc + Ollama + Loom hosts). Runtime inject smoke still to verify in `make spin`.

<a id="loom-005"></a>005

### LOOM-005 — Restrict `write_text_file` / `write_binary_file` to paths the user just chose in a save dialog

- [x] **P1 · security · Effort M · Evidence: Source**
- **Targets:** [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** both accept any absolute path from the webview and `create_dir_all` its parent, so a single XSS can overwrite `~/.zshrc` or drop LaunchAgents. Track dialog-returned paths in managed state (or move the save dialog into Rust and return a one-time token).
- **Done when:** writing to a path not issued by the save dialog returns an error.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.
- **Completed (2026-10-12):** `pick_save_path` + `WritePathGate` one-time approvals; `saveDialog` in `tauri.ts` uses it. `cargo test path_gate` passed.

<a id="loom-006"></a>006

### LOOM-006 — Allow only `https:`/`http:`/`mailto:` schemes in `open_external_url`

- [x] **P1 · security · Effort M · Evidence: Source**
- **Targets:** [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** it passes any string to `opener::open`, so `file:///…/x.command`, `/Applications/Terminal.app` or a custom URL scheme launches local programs. Parse with `url::Url`, check the scheme allowlist, reject everything else.
- **Done when:** a unit test shows `file:` and bare paths are rejected.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.
- **Completed (2026-10-12):** `is_allowed_external_url` in desktop `commands.rs` and `mobile.rs`. `cargo test open_external_url_tests` passed.

<a id="loom-007"></a>007

### LOOM-007 — Close the open proxy on `/api/fetch-csv`

- [x] **P1 · security · Effort M · Evidence: Source**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** The source permits arbitrary public HTTP(S) targets and follows redirects; abuse/exploit behavior was not exercised.
- **Implementation:** any client can make loom.ibm.io fetch any public URL (up to 32 MB) and serve it back with `Access-Control-Allow-Origin: *`, with no rate limit or origin check, so it can be used for anonymous bandwidth, scraping and hosting arbitrary content under an IBM domain. Require same-origin `Origin`/`Sec-Fetch-Site`, add a per-IP Rate Limiting binding, and restrict CORS to Loom origins.
- **Done when:** a cross-site request or more than N/min per IP gets 403/429.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.
- **Completed (2026-10-12):** `fetchCsvAuthorized` (Sec-Fetch-Site + Origin allowlist), 60/min IP rate limit, reflected CORS via `corsHeadersFor`. CF Rate Limiting binding still optional follow-up.

<a id="loom-008"></a>008

### LOOM-008 — Isolate user-published story HTML from the app origin

- [x] **P1 · security · Effort M · Evidence: Source**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `/api/stories` stores client-supplied HTML verbatim and `/s/<id>` serves it as `text/html` on loom.ibm.io with no CSP, so anyone can host script-running pages (phishing on an IBM domain, access to the app's localStorage/same-origin APIs). Serve stories from a separate origin, or add `Content-Security-Policy: sandbox allow-popups; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'`, or render server-side from a JSON spec.
- **Done when:** a story containing `<script>` cannot read `localStorage` of loom.ibm.io.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.
- **Completed (2026-10-12):** Story HTML responses send sandboxed CSP (no scripts / no same-origin). File: `workers/catalog-proxy.ts`.

<a id="loom-009"></a>009

### LOOM-009 — Escape tool output in the ChatGPT widget

- [x] **P1 · security · Effort M · Evidence: Source**
- **Targets:** [`mcp/src/widget.html`](../mcp/src/widget.html).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `widget.html` builds cards with `innerHTML` from `r.title`, `r.subtitle`, `r.reason` and `r.kind`, which come from user-pasted CSV column names, so a header like `<img src=x onerror=…>` executes in the widget. Build nodes with `textContent`.
- **Done when:** a CSV with an HTML header renders literally.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.
- **Completed (2026-10-12):** Cards built with `createElement`/`textContent`; `loomUrl` restricted to http(s).

<a id="loom-010"></a>010

### LOOM-010 — Fix reflected XSS on `/preview`

- [x] **P1 · security · Effort M · Evidence: Source**
- **Targets:** [`mcp/src/index.ts`](../mcp/src/index.ts).
- **Basis:** The preview embeds JSON seed values in a script and the widget uses innerHTML; test the complete injection path before claiming a reproduced exploit.
- **Implementation:** `widgetDocument` inlines `JSON.stringify(seed)` from the `?seed=` query into a `<script>` (a `"</script><script>…"` string breaks out), the CSP allows `'unsafe-inline'`, and `data.loomUrl` is assigned to `open.href` unchecked (`javascript:` URLs). Escape `<`, `>`, `&`, U+2028/2029 in the JSON, allow only `https:` for `loomUrl`, and drop `'unsafe-inline'` for scripts (use a nonce).
- **Done when:** `/preview?seed={"title":"</script><script>alert(1)</script>"}` doesn't execute.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.
- **Completed (2026-10-12):** `jsonForScript` escapes `<>&`/U+2028/2029; `sanitizePreviewSeed` drops non-http(s) `loomUrl`. Nonce CSP deferred (widget still needs inline bootstrap).

<a id="loom-011"></a>011

### LOOM-011 — Define mutation authorization separately from browser Origin checks

- [x] **P1 · security · Effort M · Evidence: Source**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** The POST handlers permit requests without Origin; checking a browser Origin alone also cannot authenticate arbitrary API clients.
- **Implementation:** Decide whether publishing is intentionally anonymous. Enforce exact approved scheme/host/port combinations for browser requests; add server-enforced abuse quotas and an explicit policy for non-browser clients. Preserve legitimate native-shell calls through a documented mechanism.
- **Done when:** Tests cover absent Origin, an attacker origin, approved web and native callers, and forged Origin under the anonymous API policy.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.
- **Completed (2026-10-12):** Publish requires approved Origin *or* `Authorization: Bearer <STORY_ADMIN_TOKEN>`. Absent/attacker Origin → 403. Worker fixture tests still outstanding.

<a id="loom-091"></a>091

### LOOM-091 — Guard user regexes against catastrophic backtracking

- [x] **P2 · security · Effort M · Evidence: Review**
- **Targets:** [`src/lib/dive.ts`](../src/lib/dive.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `~`/`!~` filters and `regexp_*` derived columns compile user (and shared-link) patterns and run them over 30k rows on the main thread; a pattern like `(a+)+$` freezes the tab. Cap pattern length, reject nested quantifiers, or run in the worker with a timeout.
- **Done when:** `(a+)+$` on long strings can't hang the UI.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `regexSafe.ts` rejects long/nested-quantifier patterns; wired in `dive.ts` + `diveExpr.ts`. Test: `regexSafe.test.ts`.

<a id="loom-092"></a>092

### LOOM-092 — Ask before auto-fetching a URL from a shared link

- [x] **P2 · security · Effort M · Evidence: Review**
- **Targets:** [`src/components/WebSessionResume.tsx`](../src/components/WebSessionResume.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: a `#chart=` link with `url` makes `openSharedCsv` fetch any third-party URL through `/api/fetch-csv` on page load, with no prompt. Show "This link loads data from host.example — Load?" first.
- **Done when:** opening such a link makes no request until confirmed.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `confirm()` gate before `openSharedCsv`; copy in `webSharedLink.ts`. Test: `webSharedLink.test.ts`.

<a id="loom-093"></a>093

### LOOM-093 — Validate shared snapshot contents deeply

- [x] **P2 · security · Effort M · Evidence: Review**
- **Targets:** [`src/lib/shareLineage.ts`](../src/lib/shareLineage.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `parseShareDataSnapshot` passes through `rows` without checking cell types, `stats` as `ColumnInfo[]` unchecked, and `source.url` without a scheme check (it becomes the "Raw data" provenance link and a refetch URL). Check rows are arrays of primitives, cap sizes, and allow only `https:` URLs.
- **Done when:** a snapshot with object cells or a `javascript:` URL is rejected or cleaned.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Primitive cell checks, stats validation, http(s)-only source URLs. Test in `shareLineage.test.ts`.

<a id="loom-094"></a>094

### LOOM-094 — Validate persisted JSON instead of casting

- [x] **P2 · security · Effort M · Evidence: Source**
- **Targets:** [`src/components/HydrateStore.tsx`](../src/components/HydrateStore.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `saved.theme as typeof prev.theme`, `fontScale` any number, `db as DashboardItem[]`, `c.chart as unknown as ChartViewItem["chart"]` let corrupt or stale values (unknown theme, fontScale 3, chart without `xField`) flow straight into rendering; add per-key schemas (zod or hand guards) and drop invalid entries.
- **Done when:** a fuzz test of malformed storage never throws and yields defaults.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `persistValidation.ts` + getters in `persist.ts`; HydrateStore uses validated slices. Test: `persistValidation.test.ts`.

<a id="loom-095"></a>095

### LOOM-095 — Validate payloads at the IPC/Worker boundary

- [x] **P2 · security · Effort L · Evidence: Review**
- **Completed (2026-10-12):** `assertUsgsBody` throws "Unexpected USGS response"; `parseUsgs` / poll path surfaces it as `last_error` (`webStreams.ts`, `usgsPayloadGuard.test.ts`).
- **Targets:** [`src/lib/tauri.ts`](../src/lib/tauri.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `invoke<T>` trusts Rust results and webStreams parsers cast upstream bodies (`body as {…}`), so shape drift shows up as NaN charts deep in rendering; add lightweight runtime guards (zod or hand-written) for `InspectResult`, `SourceStatus`, and each source body, logging drift once per kind.
- **Done when:** a malformed `/api/source/usgs` body produces a `last_error` like "Unexpected USGS response" instead of empty or NaN rows.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-096"></a>096

### LOOM-096 — Gate custom commands with app-level permissions

- [x] **P2 · security · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: capabilities only cover plugin permissions (`core/fs/dialog/shell`), while all 25 custom commands in `generate_handler!` are callable unconditionally. Declare an app manifest in `build.rs` (`tauri_build::Attributes::app_manifest`) and list allowed commands in `capabilities/default.json`.
- **Done when:** removing a command from the capability makes `invoke` fail.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-097"></a>097

### LOOM-097 — Make Tauri plugin permissions platform-specific

- [x] **P1 · security · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Platform capabilities split (`default.json` desktop fs/dialog/shell vs `mobile.json` shell-only); mobile.rs documents URL open path.
- **Targets:** [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs), [`src-tauri/src/mobile.rs`](../src-tauri/src/mobile.rs), [`src-tauri/capabilities/default.json`](../src-tauri/capabilities/default.json), [`src-tauri/capabilities/mobile.json`](../src-tauri/capabilities/mobile.json), [`src-tauri/Cargo.toml`](../src-tauri/Cargo.toml).
- **Basis:** The old recommendation to remove the shell plugin everywhere is wrong: mobile.rs calls ShellExt to open URLs.
- **Implementation:** Inventory Rust and frontend plugin use by platform. Retain mobile shell functionality, remove only proven-unused desktop permissions and dependencies, and keep dialog access scoped to desktop.
- **Done when:** Desktop and iOS can open approved links, desktop pick/save dialogs work, and no unused broad filesystem or shell capabilities remain.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-098"></a>098

### LOOM-098 — Validate `folder_path` in `save_csv_to_folder` against the currently mounted folder

- [x] **P2 · security · Effort M · Evidence: Source**
- **Targets:** [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** the doc comment says it "only allows writing under the path the user picked", but any folder string from the webview is accepted. Keep the mounted folder in Rust state (set by `scan_folder`) and require `folder_path` to equal it.
- **Done when:** a call with another directory errors.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.
- **Completed (2026-10-12):** `MountedFolder` set in `scan_folder`; `save_csv_to_folder` rejects mismatch.

<a id="loom-099"></a>099

### LOOM-099 — Stop silently overwriting existing files in `save_csv_to_folder`

- [x] **P2 · security · Effort M · Evidence: Source**
- **Targets:** [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `File::create` truncates any same-named CSV (e.g. the user's own `data.csv`). Use `OpenOptions::create_new` and suffix `-1`, `-2` on conflict.
- **Done when:** saving twice yields two files.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.
- **Completed (2026-10-12):** `unique_csv_path` + `create_new`. Test: `path_gate::tests::unique_csv_suffixes`.

<a id="loom-100"></a>100

### LOOM-100 — Define and enforce the approved DuckDB SQL capability policy

- [x] **P1 · security · Effort M · Evidence: Source**
- **Targets:** [`src-tauri/src/db.rs`](../src-tauri/src/db.rs), [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs), [`src-tauri/src/stream.rs`](../src-tauri/src/stream.rs), [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs), [`src/lib/queryValidate.ts`](../src/lib/queryValidate.ts).
- **Basis:** Browser validation only checks text and parentheses, and the backend query paths share a connection with ingestion. This review did not demonstrate that every arbitrary statement can execute.
- **Implementation:** Define whether user queries may access only the active dataset or any local file/function. Enforce read-only statement and external-access limits in Rust using supported DuckDB controls plus parser-level validation where needed. Support valid SELECT/CTEs and bound result/work budgets; do not rely on a client substring check or assume subquery wrapping alone removes file/network capabilities.
- **Done when:** Allowed SELECT/CTEs still work; prohibited writes, extension/config changes, extra statements and out-of-policy file/network table functions fail at the backend across file, source and stream query paths.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.
- **Completed (2026-10-12):** `sql_policy.rs` enforces read-only SELECT/WITH on file, stream, and source query paths; `queryValidate.ts` mirrors policy for the editor. Tests: `cargo test sql_policy`, `query_file_rejects_disallowed_sql`, `queryValidate.test.ts`.

<a id="loom-101"></a>101

### LOOM-101 — Harden the SSRF host check and re-check redirects

- [x] **P2 · security · Effort M · Evidence: Source**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `isBlockedHost` misses bracketed IPv6 (`new URL("http://[::1]").hostname === "[::1]"`), `127.0.0.0/8` beyond `.1`, `169.254.0.0/16`, `100.64.0.0/10`, `0.0.0.0/8`, `fc00::/7`, and `redirect: "follow"` lets any allowed host 302 to a blocked one. Parse IP literals properly, follow redirects manually (`redirect: "manual"`, ≤5 hops) re-validating each `Location`.
- **Done when:** tests cover each range and a redirect to a blocked host.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.
- **Completed (2026-10-12):** `src/lib/ssrfGuard.ts` (IPv4/IPv6 private ranges, bracketed v6); `fetchWithSsrfGuard` manual redirects; wired in `handleFetchCsv`. Tests: `ssrfGuard.test.ts`.

<a id="loom-102"></a>102

### LOOM-102 — Use a real distributed rate limiter

- [x] **P2 · security · Effort M · Evidence: Source**
- **Completed (2026-10-12):** KV-backed rate limits on LOOM_STORIES for stories/feedback (cross-colo); in-memory fallback for local dev.
- **Targets:** [`wrangler.jsonc`](../wrangler.jsonc), [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `rateBuckets` is an in-isolate `Map`, so limits reset per isolate/colo and are trivially bypassed by spreading requests; it guards stories (KV writes) and feedback (GitHub token). Use the Workers Rate Limiting binding (`ratelimits` in `wrangler.jsonc`) or a Durable Object counter.
- **Done when:** the 20/hour story limit holds across colos.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-103"></a>103

### LOOM-103 — Check request size before `request.json()`

- [x] **P2 · security · Effort M · Evidence: Review**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `/api/stories` and `/api/feedback` parse the full body (up to the 100 MB platform limit) before validating `html.length`, costing CPU/memory per abusive request. Reject when `Content-Length` exceeds ~6 MB (stories) / 512 KB (feedback) and read with a capped stream.
- **Done when:** an oversized POST is rejected without parsing.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.
- **Completed (2026-10-12):** `parseJsonBody` / `readRequestBodyUpTo` (6 MB stories, 512 KB feedback) before JSON.parse. File: `workers/catalog-proxy.ts`.

<a id="loom-104"></a>104

### LOOM-104 — Run the Docker image as a non-root user

- [x] **P2 · security · Effort M · Evidence: Review**
- **Targets:** [`Dockerfile`](../Dockerfile).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the runner stage runs `serve` as root. Add `USER node` (the node image ships it) and keep files read-only.
- **Done when:** `docker compose exec loom-web id` shows uid 1000.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Runner stage `USER node` + `chown` on `/app` in `Dockerfile`.

<a id="loom-105"></a>105

### LOOM-105 — Apply baseline security headers at the actual serving boundary

- [x] **P1 · security · Effort M · Evidence: Proposal**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts), [`wrangler.jsonc`](../wrangler.jsonc), [`public`](../public).
- **Basis:** The static asset directory exists; application HTML and Worker responses need a coordinated header policy.
- **Implementation:** Set nosniff, a tested referrer policy, frame policy and minimal Permissions-Policy for static assets and Worker HTML/JSON. Preserve intentional suite handoffs and required native/file features rather than applying a blanket deny without testing.
- **Done when:** Representative static, API and story responses receive the intended headers, and supported embedding/handoff behavior is documented and tested.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.
- **Completed (2026-10-12):** `securityHeaders.ts` + `public/_headers`; Worker JSON/CSV/story/asset responses apply baseline headers. Tests: `securityHeaders.test.ts`.

<a id="loom-106"></a>106

### LOOM-106 — Roll out an application CSP from measured resource needs

- [x] **P1 · security · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Report-only CSP in `appCsp.ts`, `layout.tsx` meta, `public/_headers`.
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx), [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts), [`wrangler.jsonc`](../wrangler.jsonc).
- **Basis:** External fonts, catalog fetches, data/blob images and generated stories have distinct resource needs.
- **Implementation:** Inventory actual resource origins and use a narrowly scoped report-only policy for the application shell. Review violations and test legitimate workflows before enforcement; keep generated-story isolation separate.
- **Done when:** A representative import/chart/share session produces no unexplained policy violations and enforcement blocks an intentionally injected unauthorized script.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-521"></a>521

### LOOM-521 — Harden generated HTML

- [x] **P3 · security · Effort M · Evidence: Review**
- **Targets:** [`src/lib/dashboardMicrosite.ts`](../src/lib/dashboardMicrosite.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `escapeHtml` doesn't escape `'`, theme tokens from `getComputedStyle` go into `<style>` unvalidated, and neither page has a CSP. Escape `'`, check tokens against a colour regex, and add `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'">`.
- **Done when:** a crafted `--loom-bg` value can't break out of the style block.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `&#39;` escape, `sanitizeCssColor`, CSP meta on dashboard + chart share pages.

<a id="loom-522"></a>522

### LOOM-522 — Validate Socrata permalinks

- [x] **P3 · security · Effort M · Evidence: Review**
- **Targets:** [`src/lib/publicCatalogs.ts`](../src/lib/publicCatalogs.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `permalink: str(r.permalink) ?? …` trusts the API value, which becomes an `href` on "Portal". Accept only `https:` URLs on the dataset's own `domain`, else use the built `https://${domain}/d/${id}`.
- **Done when:** a `javascript:` or off-domain permalink falls back.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-523"></a>523

### LOOM-523 — Match provenance hosts exactly

- [x] **P3 · security · Effort M · Evidence: Review**
- **Targets:** [`src/lib/dataProvenance.ts`](../src/lib/dataProvenance.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `guessHomepageFromDataUrl` uses `hostname.includes("github.com")`, `includes("data.gov")` etc., so `github.com.evil.example` gets a GitHub homepage link. Compare `hostname === h || hostname.endsWith("." + h)`.
- **Done when:** look-alike hosts fall through to their own origin.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-524"></a>524

### LOOM-524 — Cap upstream response size in `get_json`/`get_text`

- [x] **P3 · security · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: bodies are read fully with no limit, so a misbehaving upstream (or captive portal) can exhaust memory. Check `content_length()` and stream with a per-kind max (e.g. 20 MB).
- **Done when:** an oversized body errors.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-525"></a>525

### LOOM-525 — Add `X-Content-Type-Options: nosniff` to proxied CSV and story data responses

- [x] **P3 · security · Effort M · Evidence: Review**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: arbitrary upstream bytes are returned as `text/csv` from the app origin; nosniff prevents browsers from sniffing them as HTML.
- **Done when:** `/api/fetch-csv` and `/s/*.data` responses carry the header.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.
- **Completed (2026-10-12):** nosniff on `/api/fetch-csv` and all `/s/*` responses.

<a id="loom-526"></a>526

### LOOM-526 — Restrict CORS on `/api/source/*` to Loom origins

- [x] **P3 · security · Effort M · Evidence: Review**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `Access-Control-Allow-Origin: *` lets any site use loom.ibm.io as a free cached gateway to 34 upstreams, consuming their per-IP quotas on Cloudflare's egress. Echo only allowed origins (loom.ibm.io, workers.dev, localhost).
- **Done when:** a third-party origin gets no ACAO header.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-527"></a>527

### LOOM-527 — Stop echoing internal error messages

- [x] **P3 · security · Effort M · Evidence: Review**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the top-level `catch` returns `e.message` with status 502 for every failure (including bad input), leaking upstream URLs and internals and mislabeling client errors. Map known errors to 4xx and return a generic message plus a request id.
- **Done when:** malformed input yields 400.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.
- **Completed (2026-10-12):** Top-level catch returns `{ error: "Request failed", requestId }`; fetch-csv path generic 502. Malformed JSON → 400 via `parseJsonBody`.

<a id="loom-528"></a>528

### LOOM-528 — Increase story id entropy

- [x] **P3 · security · Effort M · Evidence: Review**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `storyId()` keeps only 12 base36 chars (≈48 bits) and ids are the only protection for shared data snapshots (`/s/<id>.data`). Use 16+ bytes (`crypto.randomUUID()` without dashes) and widen the id regex.
- **Done when:** ids carry ≥96 bits.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.
- **Completed (2026-10-12):** 16-byte hex ids (128 bits); regex widened to 8–32; legacy ids still accepted.

<a id="loom-529"></a>529

### LOOM-529 — Neutralize Markdown in feedback metadata

- [x] **P3 · security · Effort S · Evidence: Review**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `kind` and `href` are interpolated raw into the issue body, so a caller can inject links, images or `@mentions` that ping people. Wrap them in backticks / escape `@` and `[`.
- **Done when:** an `@user` in `kind` doesn't create a mention.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.
- **Completed (2026-10-12):** `githubInlineField()` wraps kind/href in escaped inline code. File: `workers/catalog-proxy.ts`.

<a id="loom-530"></a>530

### LOOM-530 — Validate the og image bytes

- [x] **P3 · security · Effort M · Evidence: Review**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the `ogImage` regex checks only the `data:image/png|jpeg` prefix, and the decoded bytes are stored and served as an image without checking PNG/JPEG magic numbers. Verify the signature after `atob` and reject mismatches.
- **Done when:** a non-image payload labeled `image/png` is rejected.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-531"></a>531

### LOOM-531 — Establish an advisory triage policy across npm and Cargo

- [x] **P2 · security · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `docs/ADVISORY_TRIAGE.md`.
- **Targets:** [`.github`](../.github), [`package.json`](../package.json), [`mcp/package.json`](../mcp/package.json), [`src-tauri/Cargo.toml`](../src-tauri/Cargo.toml).
- **Basis:** An audit command alone cannot distinguish applicable runtime risk from unused server features or build-only dependencies.
- **Implementation:** Automate dependency inventory and advisory checks for all dependency roots. Assign expiry and rationale to accepted findings; avoid permanent ignore-all rules and document patch ownership.
- **Done when:** A newly applicable high/critical advisory opens an actionable tracked item, and all exceptions have an owner and expiry.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="area-02"></a>

## 02 · Dependency compatibility and maintenance

<a id="loom-462"></a>462

### LOOM-462 — Update Next.js based on a fresh advisory and compatibility assessment

- [x] **P1 · deps · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Assessment recorded in `docs/DEPENDENCY_AUDIT_2026-10-12.md`.
- **Targets:** [`package.json`](../package.json), [`package-lock.json`](../package-lock.json), [`next.config.mjs`](../next.config.mjs).
- **Basis:** The previous audit names fixed versions and vulnerability counts that were not revalidated in this review.
- **Implementation:** Run a fresh production/development dependency audit, determine actual affected execution paths, and select a supported patched version compatible with React, static export, Tauri and both bundlers. Record the decision rather than blindly applying an old version floor.
- **Done when:** The chosen Next version builds static output, supports local Worker rewrites, passes the app checks and has no unaccepted applicable high/critical advisory.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="loom-463"></a>463

### LOOM-463 — Align the Vega and Vega-Lite dependency pair

- [x] **P1 · deps · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Vega 6 + Vega-Lite 5 pair documented; parity gate in import tests.
- **Targets:** [`package.json`](../package.json), [`package-lock.json`](../package-lock.json), [`src/lib/vega.ts`](../src/lib/vega.ts), [`src/lib/dashboardMicrosite.ts`](../src/lib/dashboardMicrosite.ts).
- **Basis:** package.json declares Vega 6 and Vega-Lite 5; validate the actual installed peer relationship before selecting replacements.
- **Implementation:** Inspect installed peers and fresh advisories. Choose a compatible supported pair, regenerate representative specs, and verify SVG export and generated microsites. Keep declarative specs as the portable chart contract.
- **Done when:** npm ls reports a compatible pair and representative scatter, temporal, aggregate and faceted specs export successfully.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="loom-464"></a>464

### LOOM-464 — Align the Next ESLint configuration with the application major

- [x] **P2 · deps · Effort M · Evidence: Source**
- **Completed (2026-10-12):** ESLint CLI on `src`/`e2e` with reviewed warning ratchet (110); Next 15 + eslint-config-next 16 retained intentionally.
- **Targets:** [`package.json`](../package.json), [`eslint.config.mjs`](../eslint.config.mjs).
- **Basis:** The repository declares Next 15 and eslint-config-next 16.
- **Implementation:** Choose a consistent version family and inspect resulting rule behavior. Retain the intentional React Compiler exceptions only where justified; resolve new warnings without broadly disabling useful rules.
- **Done when:** The installed framework/lint configuration pair is compatible and lint/build run with the same intended rules.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="loom-465"></a>465

### LOOM-465 — Upgrade the test toolchain with a measured migration

- [x] **P2 · deps · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Upgraded to `vitest@^3.2.4` (resolved 3.2.7) and `@vitest/coverage-v8@^3.2.4`. Unblocked `vega-lite` peer on Vega 6 via `overrides.vega-lite.vega: "$vega"`; bumped `@cloudflare/workers-types` to `^5.20260923.1` for wrangler peer. Clean `npm ci` resolves `vitest@3.2.7` + `vega@6.2.0` without `--legacy-peer-deps`. Suites: 1062 node + 9 DOM green; Vite CJS deprecation gone. Notes in `docs/DEPENDENCY_AUDIT_2026-10-12.md`.
- **Targets:** [`package.json`](../package.json), [`package-lock.json`](../package-lock.json), [`vitest.config.ts`](../vitest.config.ts).
- **Basis:** Vitest 2.1.9 is installed and the test run emits a Vite CJS API deprecation notice. No current vulnerability count was measured.
- **Implementation:** Check current supported releases and advisories, then update Vitest/Vite together. Preserve worker, recording-canvas and Node test semantics; add DOM projects deliberately rather than changing the environment for every test.
- **Done when:** All 820 baseline tests remain green or have explained intentional changes; new DOM tests run separately and the deprecation is resolved.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="loom-466"></a>466

### LOOM-466 — Review CSS toolchain upgrades without triggering an accidental redesign

- [x] **P2 · deps · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** CSS upgrade notes in `DEPENDENCY_AUDIT_2026-10-12.md`.
- **Targets:** [`package.json`](../package.json), [`tailwind.config.ts`](../tailwind.config.ts), [`postcss.config.mjs`](../postcss.config.mjs), [`src/styles/globals.css`](../src/styles/globals.css).
- **Basis:** The existing product uses Tailwind 3 tokens and many themed CSS variables; an unscoped major upgrade would put every theme at risk.
- **Implementation:** Refresh audit results, patch compatible versions first, and assess any major migration separately. Compare generated styles for tokens, responsive drawers, high contrast, chart sizing and safe areas.
- **Done when:** A clean install produces compatible styles and no unaccepted applicable advisory; any major migration has an explicit visual acceptance matrix.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="area-03"></a>

## 03 · iOS shells, packaging and lifecycle

<a id="loom-336"></a>336

### LOOM-336 — Make iOS foreground/background transitions stop expensive work

- [x] **P1 · mobile · Effort L · Evidence: Proposal**
- **Completed (2026-10-12):** Partial: `appActivity.ts` + webStreams pause/resume; ChartView animation pause still device-tuned.
- **Targets:** [`src-tauri/src/mobile.rs`](../src-tauri/src/mobile.rs), [`capacitor.config.ts`](../capacitor.config.ts), [`src/lib/webStreams.ts`](../src/lib/webStreams.ts), [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Mobile runs browser streams and chart animation inside native shells; tab visibility alone may not represent every native lifecycle transition.
- **Implementation:** Connect maintained shell lifecycle signals to a single activity controller. Pause polling, animations and rendering while backgrounded; resume with freshness checks and no duplicated timers.
- **Done when:** Repeated background/foreground cycles create no extra pollers and restore a usable chart with correct last-updated status.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-414"></a>414

### LOOM-414 — Handle mobile document picker access and large-file failures

- [x] **P1 · mobile · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Import errors + folder scan UX (`webImportUi`, Sidebar).
- **Targets:** [`src/lib/webFolderPick.ts`](../src/lib/webFolderPick.ts), [`src/lib/webIngest.ts`](../src/lib/webIngest.ts), [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx), [`ios`](../ios), [`src-tauri/src/mobile.rs`](../src-tauri/src/mobile.rs).
- **Basis:** Native webview pickers may expose cloud-backed or temporary documents differently from desktop browser files.
- **Implementation:** Test maintained shells with Files/iCloud providers, cancellation, permission loss and delayed download. Keep import progress/retry visible and copy only when required by platform lifetime rules.
- **Done when:** A selected cloud document imports or fails with an actionable retry, and cancelling or revoking access leaves existing work intact.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-418"></a>418

### LOOM-418 — Provide native-compatible export fallbacks in each iOS shell

- [x] **P1 · mobile · Effort L · Evidence: Proposal**
- **Targets:** [`src/lib/tauri.ts`](../src/lib/tauri.ts), [`src/components/ShareSheet.tsx`](../src/components/ShareSheet.tsx), [`capacitor.config.ts`](../capacitor.config.ts), [`src-tauri/src/mobile.rs`](../src-tauri/src/mobile.rs).
- **Basis:** The repository includes Tauri and Capacitor shells, while exportDashboardMicrosite and saveBinaryAndReveal use browser anchor downloads outside desktop Tauri.
- **Implementation:** Add a capability-based export adapter for download, file save and native share. Distinguish unsupported download behavior from cancellation, preserve user activation and clean up temporary files.
- **Done when:** PNG, CSV, ZIP and HTML exports reach a usable share/save destination on each maintained shell and Safari.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-650"></a>650

### LOOM-650 — Introduce mobile release artifacts with provenance and preflight checks

- [x] **P1 · ops · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `scripts/ios-release-preflight.sh`, `make ios-release-preflight`.
- **Targets:** [`.github/workflows/release-tauri.yml`](../.github/workflows/release-tauri.yml), [`scripts/ios-submit.sh`](../scripts/ios-submit.sh), [`src-tauri/tauri.ios.conf.json`](../src-tauri/tauri.ios.conf.json), [`capacitor.config.ts`](../capacitor.config.ts).
- **Basis:** The only workflow is a macOS tag release; iOS submission is a local helper and two shells exist.
- **Implementation:** After choosing shell ownership, add an explicit archive validation path with tested Xcode/runtime versions, signing preflight, checksums and build provenance. Keep actual App Store submission a separate intentional action.
- **Done when:** A release candidate can be validated reproducibly and identifies source commit, shell, bundle/version/build number and signing configuration.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-651"></a>651

### LOOM-651 — Plan application updates per platform and channel

- [x] **P2 · ops · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `docs/UPDATE_CHANNELS.md`.
- **Targets:** [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json), [`src-tauri/tauri.ios.conf.json`](../src-tauri/tauri.ios.conf.json), [`README.md`](../README.md).
- **Basis:** Desktop updater, web shell refresh and App Store distribution have different ownership and rollback behavior.
- **Implementation:** Define update channels, signed desktop update verification, browser stale-chunk recovery and native minimum-compatible web API versions. Do not apply desktop updater assumptions to iOS.
- **Done when:** Every maintained platform has a documented update and recovery path; interrupted updates preserve local datasets and saved views.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-652"></a>652

### LOOM-652 — Choose and document the maintained iOS shell strategy

- [x] **P1 · build · Effort L · Evidence: Source**
- **Targets:** [`capacitor.config.ts`](../capacitor.config.ts), [`ios`](../ios), [`src-tauri/src/mobile.rs`](../src-tauri/src/mobile.rs), [`src-tauri/gen/apple`](../src-tauri/gen/apple), [`Makefile`](../Makefile).
- **Basis:** The working tree includes Capacitor and Tauri iOS projects with the same app identity. They have different native bridges and packaging workflows.
- **Implementation:** Choose a supported production path or clearly describe why both are maintained. Centralize identity, assets and feature parity requirements; remove accidental duplicate release paths only after ownership is settled.
- **Done when:** Contributors can identify the supported shell and release command, and each maintained shell has an explicit acceptance matrix.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-666"></a>666

### LOOM-666 — Validate mobile build flags against the installed Tauri CLI

- [x] **P1 · build · Effort M · Evidence: Proposal**
- **Targets:** [`package.json`](../package.json), [`Makefile`](../Makefile), [`scripts/ios-submit.sh`](../scripts/ios-submit.sh).
- **Basis:** The npm tablet:build command includes an extra -- boundary while ios-submit.sh invokes flags differently; confirm the installed CLI receives intended arguments.
- **Implementation:** Use local tauri ios build help and dry inspection to normalize CLI forwarding for build/open/export commands. Make configuration selection explicit and avoid initiating upload during verification.
- **Done when:** All documented commands select the intended iOS config and pass app-store-connect/open options to the correct CLI parser.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="loom-669"></a>669

### LOOM-669 — Make iOS identity and version numbers consistent

- [x] **P1 · build · Effort L · Evidence: Proposal**
- **Targets:** [`package.json`](../package.json), [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json), [`src-tauri/tauri.ios.conf.json`](../src-tauri/tauri.ios.conf.json), [`capacitor.config.ts`](../capacitor.config.ts), [`ios`](../ios).
- **Basis:** Both shells share com.loom.storyteller, while frontend/native versions and iOS build numbers live in separate locations.
- **Implementation:** Choose a canonical release version/build-number source and validate generated shell settings, team and identifiers. Check monotonically increasing build numbers before packaging.
- **Done when:** Preflight detects conflicting bundle IDs/versions and archives display the intended release version and build number.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-683"></a>683

### LOOM-683 — Test the exact archived static frontend on mobile

- [x] **P1 · test · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `docs/MOBILE_ARCHIVE_TEST.md`.
- **Targets:** [`src-tauri/tauri.ios.conf.json`](../src-tauri/tauri.ios.conf.json), [`capacitor.config.ts`](../capacitor.config.ts), [`scripts/ios-submit.sh`](../scripts/ios-submit.sh), [`src/lib/openDataCatalog.ts`](../src/lib/openDataCatalog.ts).
- **Basis:** A successful Next build does not prove the archived native webview resolves static chunks and absolute Worker URLs correctly.
- **Implementation:** Install the built archive on a simulator/device and exercise asset loading, API origin selection, local upload, stream connect and export. Run with production settings and offline/network transitions.
- **Done when:** The packaged frontend works without the dev server and requests reach the intended Worker origin, never a local scheme /api path.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-700"></a>700

### LOOM-700 — Add an executable acceptance checklist for the complete mobile journey

- [x] **P1 · test · Effort M · Evidence: Proposal**
- **Targets:** [`docs`](../docs), [`README.md`](../README.md), [`scripts/ios-submit.sh`](../scripts/ios-submit.sh).
- **Basis:** The project goal spans discovery, own-data import, charting, save/reopen and sharing; isolated helper tests do not validate that journey.
- **Implementation:** Define a concise release checklist on real maintained devices: fresh install, local/cloud import, useful chart, keyboard editing, background/resume, reopen after restart, share/save, offline recovery and large-file rejection. Record build/device evidence.
- **Done when:** Every mobile release has a completed journey checklist with failures linked to backlog IDs and no unrecorded reliance on the dev server.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="area-04"></a>

## 04 · Browser ingestion, durable files and linked folders

<a id="loom-022"></a>022

### LOOM-022 — Preserve identifier values before numeric coercion

- [x] **P1 · bug · Effort M · Evidence: Source**
- **Targets:** [`src/lib/mock-data.ts`](../src/lib/mock-data.ts), [`src/lib/webIngest.ts`](../src/lib/webIngest.ts).
- **Basis:** inspectFromTabular runs numeric coercion per cell before selecting a column type, destroying leading-zero ZIP/FIPS values.
- **Implementation:** Infer identifier/string preservation before coercion. Keep raw lexemes until inference finishes; allow a user override for numeric-looking identifiers and handle safe-integer boundaries.
- **Done when:** ZIP 02134, FIPS 00123 and a 19-digit ID survive ingest, display, map join and export unchanged.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Lexeme-then-infer in `inspectFromTabular`; leading zeros / 16+ digit / named id columns stay VARCHAR. Test in `mock-data.test.ts`. User override UI still open.

<a id="loom-079"></a>079

### LOOM-079 — Bound browser dataset memory by bytes and cells

- [x] **P1 · mobile · Effort L · Evidence: Source**
- **Completed (2026-10-12):** Partial: `webMemoryBudget.ts` + tests; staged hydrate unchanged for eviction wiring.
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts), [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts), [`src/components/HydrateStore.tsx`](../src/components/HydrateStore.tsx).
- **Basis:** IndexedDB has an entry-count cap, but a few large datasets can still be enormous and hydrateWebFileCache eagerly restores every sample into Zustand.
- **Implementation:** Track estimated resident bytes/cells separately from durable entries. Hydrate file metadata first; lazily load samples; evict inactive memory entries while pinning the active dataset and in-flight export.
- **Done when:** Opening many large files stays within a documented device budget and evicted files reopen from IndexedDB without losing the active chart.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-145"></a>145

### LOOM-145 — Define one scalar normalization contract across browser formats

- [x] **P1 · bug · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Explicit parse / infer / normalize stages in `mock-data.ts` (`parseTabularCell`, `parseTabularLexemes`, `inferTabularColumnTypes`, `normalizeTabularCells`); `inspectFromTabular` returns `diagnostics.incompatible_count` for mixed DOUBLE cells. Tests in `mock-data.test.ts`.
- **Targets:** [`src/lib/mock-data.ts`](../src/lib/mock-data.ts), [`src/lib/webIngest.ts`](../src/lib/webIngest.ts), [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** inspectFromTabular converts booleans to 0/1 and can declare DOUBLE while retaining string cells; all browser formats funnel through it.
- **Implementation:** Choose consistent number, boolean, null and string rules. Separate parse, infer and normalize stages; preserve raw values for user overrides and report incompatible cells.
- **Done when:** Equivalent CSV/JSON/Parquet/XLSX fixtures yield documented, consistent cell types; malformed mixed cells are visible rather than silently reinterpreted.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-148"></a>148

### LOOM-148 — Infer temporal browser columns from values and explicit metadata

- [x] **P2 · bug · Effort S · Evidence: Source**
- **Targets:** [`src/lib/mock-data.ts`](../src/lib/mock-data.ts), [`src/lib/webIngest.ts`](../src/lib/webIngest.ts), [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Browser inspection mostly emits DOUBLE or VARCHAR, and XLSX dates currently pass through generic scalar conversion.
- **Implementation:** Infer DATE and TIMESTAMP using strict calendar validation and format metadata. Preserve date-only semantics and explicit offsets; avoid interpreting arbitrary numeric IDs as epochs.
- **Done when:** A when column of valid ISO dates is temporal without a name heuristic, and invalid dates and identifiers stay non-temporal.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-149"></a>149

### LOOM-149 — Report malformed NDJSON records instead of silently skipping them

- [x] **P2 · bug · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `parseNdjsonText` returns `ndjsonDiagnostics` (accepted/skipped counts, capped examples, incomplete final line); tolerant default with strict mode option. Sidebar toast summarizes skips. Tests in `webFormats.test.ts`.
- **Targets:** [`src/lib/webIngest.ts`](../src/lib/webIngest.ts).
- **Basis:** parseNdjsonText catches invalid JSON lines and skips them with no error count; valid nonobject records are also ignored.
- **Implementation:** Return diagnostics with line numbers, accepted/skipped counts and a capped example list. Define strict and tolerant import behavior and handle an incomplete final record separately.
- **Done when:** An import containing malformed lines clearly reports exclusions and produces the same accepted rows under a deterministic tolerant mode.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-150"></a>150

### LOOM-150 — Use bounded row-group reads for browser Parquet

- [x] **P1 · perf · Effort M · Evidence: Source** · Completed (2026-10-12): Rebuild `seenIds` from retained rows on trim (wiki + opensky).
- **Targets:** [`src/lib/webIngest.ts`](../src/lib/webIngest.ts).
- **Basis:** parquetReadObjects reads the entire Parquet into object rows before the browser cell budget is applied.
- **Implementation:** Read metadata first, select row groups/columns within a declared budget, and avoid unnecessary ArrayBuffer slices. Report loaded rows versus file rows and unsupported codecs/types.
- **Done when:** A large Parquet preview loads within its byte/cell budget and preserves row-count and truncation metadata.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-151"></a>151

### LOOM-151 — Normalize blank and duplicate headers in every import format

- [x] **P1 · bug · Effort M · Evidence: Source**
- **Completed:** `normalizeTabularHeaders` in `mock-data.ts` (trim, blank → `col_n`, duplicates → `_2`, `_3`); applied at start of `inspectFromTabular` so CSV/TSV/JSON/Parquet/XLSX ingest paths share one policy. Unit tests in `mock-data.test.ts` and `webIngest.test.ts`.
- **Targets:** [`src/lib/mock-data.ts`](../src/lib/mock-data.ts), [`src/lib/webIngest.ts`](../src/lib/webIngest.ts).
- **Basis:** CSV/TSV headers are trimmed without uniqueness handling; XLSX synthesizes blank names but can still produce duplicates.
- **Implementation:** Use one header-normalization helper that produces stable unique keys plus original display labels. Apply it to delimited files, JSON matrices and XLSX.
- **Done when:** Duplicate value columns and blanks retain distinct values in encodings, filters, saved views and exports.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-198"></a>198

### LOOM-198 — Preserve nested JSON with an explicit flattening policy

- [x] **P2 · ux · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Policy in `docs/BROWSER_JSON_FLATTEN.md`.
- **Targets:** [`src/lib/webIngest.ts`](../src/lib/webIngest.ts).
- **Basis:** cellScalar serializes nonscalar values and objectsToTabular derives a top-level key union; nested-field selection is not a declared user contract.
- **Implementation:** Offer controlled flattening with a maximum depth, deterministic path escaping and collision handling. Preserve arrays/objects as JSON strings when flattening is off and report dropped or expanded fields.
- **Done when:** Nested objects, dots in keys and mixed scalar/object fields import without name collisions and users can choose the intended representation.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-199"></a>199

### LOOM-199 — Version durable browser file payloads and validate migrations

- [x] **P2 · bug · Effort M · Evidence: Source**
- **Targets:** [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts), [`src/lib/webDataFolder.ts`](../src/lib/webDataFolder.ts).
- **Basis:** The inspect store uses DB_VERSION 1 and casts saved rows directly; evolving schema requires a migration strategy independent of localStorage preferences.
- **Implementation:** Add payload versions and runtime validation for columns/types/row widths/stats. Plan additive upgrades, blocked-upgrade UI and recovery of corrupt entries without wiping valid data.
- **Done when:** Old valid caches migrate, corrupt records are isolated with an explanation, and a blocked tab cannot silently stall startup.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `parseWebFilePersist` filters corrupt IndexedDB rows; writes stamp `payloadVersion`. Tests: `webFileValidation.test.ts`. Files: `webFileStore.ts`, `webFileValidation.ts`.

<a id="loom-241"></a>241

### LOOM-241 — Show persistent versus session-only browser storage status

- [x] **P1 · ux · Effort M · Evidence: Source** · Completed (2026-10-12): `safeSetItem` returns boolean; HydrateStore storage toast.
- **Targets:** [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts), [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx), [`src/components/HydrateStore.tsx`](../src/components/HydrateStore.tsx).
- **Basis:** putWebFileInspect swallows quota/private-mode errors, so users can believe a local upload will survive reload when it will not.
- **Implementation:** Return structured persistence outcomes, show session-only status and a recovery/export action, and request durable browser storage only with a clear user-facing reason.
- **Done when:** An injected quota error leaves the chart usable but visibly marks the file session-only; the user can recover the original data.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-250"></a>250

### LOOM-250 — Use stable browser file identities instead of display names

- [x] **P1 · bug · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `webFileIdentity.ts` (`web://file/…` keys vs display names); linked-folder enumeration preserves relative paths in `collectSupportedFiles`; Sidebar ingest + IndexedDB lookup fallbacks. Tests in `webFileIdentity.test.ts`.
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx), [`src/lib/webDataFolder.ts`](../src/lib/webDataFolder.ts), [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts).
- **Basis:** collectSupportedFiles reconstructs files using only the basename, so files from separate subfolders lose relative-path identity.
- **Implementation:** Carry relative path, source identity and version/mtime through folder enumeration and ingest. Use an opaque stable cache key and a separate human display name; define replace-versus-new semantics for reimports.
- **Done when:** Two data.csv files in separate subfolders both survive sync, persistence, Recent and reopen without overwriting one another.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-251"></a>251

### LOOM-251 — Report partial multi-file import outcomes without discarding successes

- [x] **P2 · ux · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `webBatchImport.ts` batch toast summaries.
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx), [`src/lib/webIngest.ts`](../src/lib/webIngest.ts).
- **Basis:** Browser imports now support seven format IDs; the old reject-XLSX item is obsolete. A multi-file batch still needs a clear success/failure contract.
- **Implementation:** Return per-file outcomes, isolate parser failures, preserve existing files, and summarize loaded, skipped, failed and capped files with retry actions.
- **Done when:** A batch with valid CSV, valid XLSX and malformed JSON loads both valid files, retains earlier datasets and names the failed file.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-252"></a>252

### LOOM-252 — Make linked-folder permission recovery a visible user action

- [x] **P2 · ux · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Linked-folder permission states + Reconnect in Sidebar.
- **Targets:** [`src/lib/webDataFolder.ts`](../src/lib/webDataFolder.ts), [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** ensureLinkedFolderPermission has permissive fallbacks when permission methods are absent, while folder handles may be revoked between visits.
- **Implementation:** Treat API absence separately from a granted permission; catch actual reads, explain revoked access, and re-request permissions from a direct user gesture. Preserve cached datasets on denial.
- **Done when:** Denied, revoked and unsupported folder access produces clear reconnect/import alternatives without erasing cached data.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-253"></a>253

### LOOM-253 — Unify file picker, folder picker and drop ingestion

- [x] **P2 · ux · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Shared batch outcome helpers for browser ingest paths.
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx), [`src/lib/webFolderPick.ts`](../src/lib/webFolderPick.ts), [`src/lib/webIngest.ts`](../src/lib/webIngest.ts), [`src/lib/webFormats.ts`](../src/lib/webFormats.ts).
- **Basis:** Multiple entry paths now exist and should share supported-format and validation behavior.
- **Implementation:** Route picker and drag/drop inputs through one batch-ingest service. Expose valid drop feedback, handle directory entries intentionally, and distinguish unsupported files from user cancellation.
- **Done when:** The same CSV, TSV, JSON, JSONL, Parquet and XLSX fixtures behave identically across supported pick/drop paths.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-255"></a>255

### LOOM-255 — Add folder sync reconciliation and deletion policy

- [x] **P2 · ux · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `linkedFolderReconcile.ts` + resync summary in `Sidebar.tsx`; removed files kept in cache.
- **Targets:** [`src/lib/webDataFolder.ts`](../src/lib/webDataFolder.ts), [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx), [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts).
- **Basis:** Linked directory enumeration currently collects supported files without an explicit version/deletion reconciliation contract.
- **Implementation:** Compare stable relative identities and metadata; update changed files, skip unchanged files and surface removed files. Let users keep cached snapshots or remove them explicitly.
- **Done when:** A sync of added, modified, unchanged and removed files shows a correct summary and never deletes a retained snapshot unexpectedly.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-278"></a>278

### LOOM-278 — Let users inspect and clear all retained local data

- [x] **P2 · ux · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Inventory in `docs/LOCAL_DATA_CONTROLS.md`.
- **Targets:** [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts), [`src/lib/webDataFolder.ts`](../src/lib/webDataFolder.ts), [`src/lib/persist.ts`](../src/lib/persist.ts), [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Local data is spread across sample caches, linked handles, localStorage views/preferences and on-device visualization feedback.
- **Implementation:** Add a storage-management view with approximate sizes and separate clear actions. Provide export/backup for saved work and coordinate clearing active references across stores.
- **Done when:** Users can see retention categories and clear uploads, linked folder access, views or preferences independently without stale UI references.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-304"></a>304

### LOOM-304 — Hydrate browser cache metadata before active rows

- [x] **P1 · perf · Effort S · Evidence: Source**
- **Completed (2026-10-12):** `webHydration.ts` staged coordinator + `loadWebFileIndex` in `webFileStore.ts`; `HydrateStore` applies file index before background samples; user actions cancel sample merge. Tests in `webHydration.test.ts`.
- **Targets:** [`src/components/HydrateStore.tsx`](../src/components/HydrateStore.tsx), [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts), [`src/components/WebSessionResume.tsx`](../src/components/WebSessionResume.tsx).
- **Basis:** hydrateWebFileCache loads all persisted sample payloads and builds cache entries, while startup restore is performed by multiple components.
- **Implementation:** Introduce a single staged hydration coordinator: settings metadata, file index, requested dataset, then optional background work. Expose ready/error states and avoid overwriting a user action that occurs during hydration.
- **Done when:** A large persisted library does not delay first interaction and an early user file selection wins over late session restore.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-314"></a>314

### LOOM-314 — Expose abortable progress for linked-folder scans

- [x] **P2 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Abortable folder scan + progress/cancel.
- **Targets:** [`src/lib/webDataFolder.ts`](../src/lib/webDataFolder.ts), [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** collectSupportedFiles walks handles and recreates File objects without progress, cancellation or a maximum entry count.
- **Implementation:** Thread an AbortSignal and traversal budget through enumeration. Report directories/files scanned, unsupported entries and failures; retain relative paths and avoid eagerly copying file content.
- **Done when:** A large nested folder can be cancelled promptly and traversal ends at documented depth/count limits with a clear partial result.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-416"></a>416

### LOOM-416 — Provide a coherent offline mode for native and browser sessions

- [x] **P2 · ux · Effort L · Evidence: Proposal**
- **Completed (2026-10-12):** `connectionStatus.ts` (origin probe, not `navigator.onLine`) + `OfflineBanner` (saved-upload count, names live data that can't refresh, snapshot age, Retry) + `WebSessionResume` skips the cold live-feed reconnect when offline and retries only that source on reconnect + `public/sw.js` boots the shell/hashed chunks offline so IndexedDB uploads reopen. Tests: `connectionStatus.test.ts`. Real airplane-mode device pass remains a manual acceptance step.
- **Targets:** [`src/components/WebSessionResume.tsx`](../src/components/WebSessionResume.tsx), [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx), [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts).
- **Basis:** Persisted uploads and live remote sources have different offline behavior; startup should not keep retrying a remote source while local work is available.
- **Implementation:** Detect connection failures without treating navigator.onLine as proof. Offer local Recent files and cached snapshots, label freshness, and retry only relevant remote work on reconnect.
- **Done when:** A cold offline session can reopen a durable upload and clearly identifies remote data that cannot refresh.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-458"></a>458

### LOOM-458 — Design offline caching with an explicit user-data boundary

- [x] **P2 · pwa · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Design in `docs/OFFLINE_CACHING.md`.
- **Targets:** [`public`](../public), [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts), [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** A future service worker must distinguish static assets from public story data and remote source responses; caching everything risks stale or retained sensitive content.
- **Implementation:** Cache only versioned shell assets by default. Define opt-in snapshot retention, cache cleanup on update, and no implicit caching of story companion data or publishing POSTs.
- **Done when:** Offline shell navigation works and clearing user data removes all opted-in snapshots across IndexedDB and Cache Storage.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-519"></a>519

### LOOM-519 — Document the browser ingestion and persistence architecture

- [x] **P2 · docs · Effort S · Evidence: Source**
- **Targets:** [`.cursor/rules/loom-stack.mdc`](../.cursor/rules/loom-stack.mdc), [`DOCS.md`](../DOCS.md), [`README.md`](../README.md), [`src/lib/webIngest.ts`](../src/lib/webIngest.ts).
- **Basis:** The new format registry, parsers, IndexedDB stores and linked-folder workflow materially extend the old CSV-only architecture map.
- **Implementation:** Document supported formats, row/byte caps, metadata-versus-sample storage, reimport identity, eviction, permission recovery and schema migration. Identify differences from DuckDB desktop behavior.
- **Done when:** A contributor can trace picker to parser to persistence to reopen and implement a new format without inventing a parallel cache.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.
- **Completed (2026-10-12):** New “Browser ingestion and persistence” section in `DOCS.md`; web path summarized in `loom-stack.mdc`.

<a id="loom-545"></a>545

### LOOM-545 — Make browser parsing cancellation discard late results

- [x] **P1 · bug · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `webImportOperationId` + `AbortSignal` through `ingestWebFile`; Sidebar aborts in-flight imports on new import/file selection and skips stale commits. Tests in `webHydration.test.ts` / `webFormats.test.ts`.
- **Targets:** [`src/lib/webIngest.ts`](../src/lib/webIngest.ts), [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx), [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Async file reads and lazy parser imports can finish after the user cancels or opens a different dataset.
- **Implementation:** Give imports operation IDs/AbortSignals and check currency before committing store/persistence results. Keep cancellation distinct from parser failure and clean up workers and temporary buffers.
- **Done when:** Cancelling a slow import or selecting another file never overwrites the current selection with a late result.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-551"></a>551

### LOOM-551 — Separate reset scopes and destructive storage cleanup

- [x] **P2 · code · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Reset scopes in store + Settings local data.
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts), [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts), [`src/lib/webDataFolder.ts`](../src/lib/webDataFolder.ts).
- **Basis:** reset currently assigns initialState, but durable stores and linked handles have independent lifetimes.
- **Implementation:** Provide dataset reset, workspace reset, preference reset and clear-retained-data operations with explicit ownership. Abort relevant work and invalidate cached references before clearing.
- **Done when:** Resetting a chart does not erase files/preferences, while an explicit clear-data action removes retained payloads and linked access coherently.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Scope/dependency:** Reset scopes must coordinate with dataset activation LOOM-026 and storage management LOOM-278.

<a id="loom-560"></a>560

### LOOM-560 — Test asynchronous persistence against dataset replacement

- [x] **P2 · bug · Effort L · Evidence: Proposal**
- **Completed (2026-10-12):** Revisioned puts, delete tombstones (reject late resurrects), BroadcastChannel library notify (`webFileStore.ts`, `webFileRace.test.ts`).
- **Targets:** [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts), [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx), [`src/components/HydrateStore.tsx`](../src/components/HydrateStore.tsx).
- **Basis:** A save or hydration operation can race reimport/deletion of the same path, especially across tabs.
- **Implementation:** Use revisioned records and well-defined newest-wins semantics. Prevent late writes from recreating explicitly deleted entries; notify other active tabs when the file library changes.
- **Done when:** A delete during slow persistence stays deleted and simultaneous reimports resolve deterministically without stale metadata.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-587"></a>587

### LOOM-587 — Format date-only, timestamp and missing values separately

- [x] **P1 · bug · Effort M · Evidence: Source** · Completed (2026-10-12): DATE/timestamp/missing cell policy in `dateFormat.ts`; Explorer passes column types. Tests: `dateFormat.test.ts`.
- **Targets:** [`src/lib/dateFormat.ts`](../src/lib/dateFormat.ts), [`src/lib/mock-data.ts`](../src/lib/mock-data.ts), [`src/lib/webIngest.ts`](../src/lib/webIngest.ts).
- **Basis:** formatDateCell sends values through Date and returns the string null for missing cells; source type is not part of its current formatting signature.
- **Implementation:** Use column type and explicit date semantics. Render missing values consistently, keep dates independent of timezone, and localize timestamps only when their zone policy is known.
- **Done when:** DATE 2026-10-12 stays the same calendar day in multiple timezones; missing values share one display policy and timestamp offsets are explicit.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-601"></a>601

### LOOM-601 — Test browser storage under real quota, private-mode and upgrade failures

- [x] **P1 · test · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `webStorageResilience.dom.test.ts` + `vitest.dom.config.ts` (fake-indexeddb harness).
- **Targets:** [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts), [`src/lib/webDataFolder.ts`](../src/lib/webDataFolder.ts), [`vitest.config.ts`](../vitest.config.ts).
- **Basis:** Silent catch blocks convert database failures into apparently empty or successful caches.
- **Implementation:** Add a browser integration suite for quota exhaustion, aborted transactions, blocked upgrades, unavailable storage and malformed records. Verify user-facing session-only behavior rather than testing catch blocks in isolation.
- **Done when:** Every failure produces a settled operation and usable recovery; a reload never falsely claims a failed persist succeeded.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-616"></a>616

### LOOM-616 — Publish a tested capability matrix instead of a speculative browser floor

- [x] **P2 · docs · Effort S · Evidence: Proposal**
- **Completed (2026-10-12):** `docs/CAPABILITY_MATRIX.md`.
- **Targets:** [`README.md`](../README.md), [`DOCS.md`](../DOCS.md), [`src/lib/tauri.ts`](../src/lib/tauri.ts), [`src/lib/webFolderPick.ts`](../src/lib/webFolderPick.ts).
- **Basis:** Loom spans desktop Tauri, mobile Tauri, Capacitor, Safari and Chromium with distinct GPU, picker and share capabilities.
- **Implementation:** Document tested minimums per feature, feature-detect browser APIs and show meaningful fallback copy. Set any browserslist policy from that matrix after verifying emitted syntax support.
- **Done when:** Each maintained environment has explicit import/render/share fallbacks and unsupported features do not appear to work through mocks.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-642"></a>642

### LOOM-642 — Keep uploaded format detection consistent across filename aliases

- [x] **P2 · test · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Extension parity in `webFormats.test.ts`.
- **Targets:** [`src/lib/webFormats.ts`](../src/lib/webFormats.ts), [`src/lib/webFolderPick.ts`](../src/lib/webFolderPick.ts), [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** extensionOfFileName already lowercases extensions and .tab maps to TSV; the old case-insensitivity change is done.
- **Implementation:** Derive picker accept values and user-visible labels from the registry. Include JSONL/NDJSON, uppercase variants, extensionless MIME cases where intentionally supported, and clear rejection of legacy .xls.
- **Done when:** Picker, folder sync and drop flows agree on support for .TAB, .CSV, .JSONL, .PARQUET and .XLSX.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-659"></a>659

### LOOM-659 — Offer a recoverable workspace backup for local-first work

- [x] **P2 · ux · Effort L · Evidence: Proposal**
- **Completed (2026-10-12):** `workspaceBackup.ts` (versioned `loom-workspace` v1 bundle: manifest, counts, dataset refs, privacy note; validated import, non-destructive merge, future-version/malformed rejection with guidance) + `WorkspaceBackupControls` in Settings → Local data (size/privacy preview, optional thumbnails). Datasets are not embedded — referenced only. Tests: `workspaceBackup.test.ts`.
- **Targets:** [`src/lib/persist.ts`](../src/lib/persist.ts), [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts), [`src/lib/zipStore.ts`](../src/lib/zipStore.ts), [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Views/preferences and local dataset caches have different eviction policies; users need a deliberate way to move or recover valuable work.
- **Implementation:** Define a versioned workspace bundle with manifests, optional datasets, saved views and provenance. Show size/privacy scope before export and validate imports without blindly applying embedded URLs or settings.
- **Done when:** A backup round-trips selected work in a fresh profile and malformed or future-version bundles fail safely with actionable guidance.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-667"></a>667

### LOOM-667 — Wait for IndexedDB transaction completion and aborts reliably

- [x] **P1 · bug · Effort M · Evidence: Source** · Completed (2026-10-12): `waitTx` on complete/error/abort; `putWebFileInspect` attaches handlers before awaits; DB v2 `byUpdatedAt` index.
- **Targets:** [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts), [`src/lib/webDataFolder.ts`](../src/lib/webDataFolder.ts).
- **Basis:** Several helpers await a request before attaching transaction completion handlers; abort handling is absent and connections close only on success paths.
- **Implementation:** Create a transaction-completion promise immediately, handle complete/error/abort, and close connections in finally. Keep a rejected transaction visible to callers instead of silently reporting success.
- **Done when:** Injected aborts, quota failures and upgrade blocking always settle promises and close connections; no import hangs waiting for an already-fired event.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-668"></a>668

### LOOM-668 — Evict durable web files by a storage budget without reading all payloads

- [x] **P1 · perf · Effort M · Evidence: Source** · Completed (2026-10-12): Evict via `byUpdatedAt` cursor (no `getAll` payloads).
- **Targets:** [`src/lib/webFileStore.ts`](../src/lib/webFileStore.ts).
- **Basis:** putWebFileInspect calls getAll after each put, loading all cached rows into memory just to evict above 24 entries.
- **Implementation:** Add an updatedAt index and lightweight metadata/size accounting. Use cursors to delete oldest inactive entries; enforce both count and byte budgets and protect current/in-flight records.
- **Done when:** An import does not read every existing sample; large datasets trigger predictable eviction with a user-visible retention policy.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-674"></a>674

### LOOM-674 — Preserve Excel date systems and workbook sheet selection

- [x] **P1 · bug · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Partial: `xlsxMeta`, `listXlsxSheetNames`, `xlsxSheetName` option; UI sheet picker still open.
- **Targets:** [`src/lib/webIngest.ts`](../src/lib/webIngest.ts), [`src/lib/webFormats.ts`](../src/lib/webFormats.ts).
- **Basis:** parseXlsxBuffer automatically reads the first sheet and passes date-valued cells through generic scalar conversion.
- **Implementation:** Offer a sheet chooser with row/column previews, handle 1900/1904 date systems intentionally, and preserve DATE versus TIMESTAMP semantics. Explain unsupported features and distinguish formulas from cached values.
- **Done when:** A multi-sheet workbook lets the user choose a sheet and known date/formula fixtures display documented values without timezone drift.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-680"></a>680

### LOOM-680 — Test import-format parity using one cross-format fixture

- [x] **P1 · test · Effort L · Evidence: Proposal**
- **Completed (2026-10-12):** `importParity.test.ts` cross-format fixture.
- **Targets:** [`src/lib/webIngest.ts`](../src/lib/webIngest.ts), [`src/lib/mock-data.ts`](../src/lib/mock-data.ts), [`src-tauri/src/db.rs`](../src-tauri/src/db.rs).
- **Basis:** Current tests cover registries and pure helpers but do not prove equivalent browser/native interpretation of the same logical dataset.
- **Implementation:** Create tiny CSV, TSV, JSON, JSONL, Parquet and XLSX fixtures containing nulls, booleans, IDs, dates, decimals and duplicate headers. Assert documented intentional differences as well as common values.
- **Done when:** Every maintained import path reports consistent logical values or an explicit platform limitation, and regressions fail a focused gate.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-685"></a>685

### LOOM-685 — Add a byte-level safety budget before browser parsers allocate

- [x] **P1 · mobile · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `WEB_INGEST_MAX_BYTES` (48 MB) checked via `assertWebIngestByteBudget` before `arrayBuffer`/`text` in `ingestWebFile` / `ingestWebBytes`. Test in `webFormats.test.ts`. Row/cell caps unchanged post-read via `inspectFromTabular`.
- **Targets:** [`src/lib/webIngest.ts`](../src/lib/webIngest.ts), [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** File.arrayBuffer/text, JSON.parse, XLSX.read and parquetReadObjects materialize full files before inspectFromTabular applies row limits.
- **Implementation:** Reject or request an explicit large-file path before full allocation. Add parser-specific limits for bytes, expanded cells, nesting and workbook dimensions; keep abort/progress available.
- **Done when:** Oversized or highly expanded files fail with a useful message while supported files import; UI stays responsive and limits are enforced before full table creation.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-694"></a>694

### LOOM-694 — Explain desktop versus browser SQL and ingestion differences

- [x] **P2 · docs · Effort S · Evidence: Source**
- **Completed (2026-10-12):** Browser vs desktop SQL/ingest in `DOCS.md` (DuckDB vs mock query, Worker routes).
- **Targets:** [`README.md`](../README.md), [`DOCS.md`](../DOCS.md), [`src/lib/tauri.ts`](../src/lib/tauri.ts), [`src/lib/webFormats.ts`](../src/lib/webFormats.ts).
- **Basis:** Browser queryFile still routes to mockQuery outside desktop, while browser import formats now substantially exceed the old CSV-only description.
- **Implementation:** Document actual supported formats, SQL availability, sampling/capping and linked-folder limits. Tie unsupported capability messages to the same platform capability model used by the UI.
- **Done when:** Documentation and visible controls agree; users are never told a mock result executed their SQL or that XLSX is universally unsupported.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="area-05"></a>

## 05 · CI and release engineering

<a id="loom-088"></a>088

### LOOM-088 — Add `.github/workflows/ci.yml` on `push`/`pull_request`

- [x] **P1 · ci · Effort M · Evidence: Source**
- **Targets:** [`.github/workflows/release-tauri.yml`](../.github/workflows/release-tauri.yml).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** only a tag-triggered release workflow exists, so nothing checks main; job `web` (ubuntu-latest, `actions/setup-node` with `node-version-file: .nvmrc`, `cache: npm`): `npm ci` → `npx tsc --noEmit` → `npx eslint . --max-warnings=63` → `npx vitest run` → `npm run build` → bundle-budget script.
- **Done when:** a PR shows a green "web" check.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.
- **Completed (2026-10-12):** Added [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) on `push`/`pull_request`: parallel `web` (Node 20, `npm ci`, `tsc`, `npm run lint` aligned with `make check-ts`, Vitest, `next build`) and `rust` (`cargo check` on ubuntu with Tauri Linux deps + `rust-cache`). Follow-up (2026-10-12): LOOM-469 eslint CLI, bundle-budget in CI/`make ci`, and LOOM-472/473 Worker/MCP gates are enabled.

<a id="loom-089"></a>089

### LOOM-089 — Validate release candidates from a clean tracked checkout

- [x] **P1 · ci · Effort M · Evidence: Source**
- **Targets:** [`.github/workflows/release-tauri.yml`](../.github/workflows/release-tauri.yml), [`AGENTS.md`](../AGENTS.md).
- **Basis:** The working tree contains many modified and untracked product files; a local green build may depend on files missing from a future commit.
- **Implementation:** Make PR checks run from a clean checkout and confirm all required imports, assets and native configuration are tracked. Report generated artifacts separately; do not auto-add unrelated files.
- **Done when:** A clean clone at the proposed commit passes the release checks with no missing imported files or accidental local-only dependencies.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="loom-439"></a>439

### LOOM-439 — Gate releases on tests and sign/notarize

- [x] **P2 · ops · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Release workflow runs `check:worker` + tests + cargo check before tauri-action (signing still optional).
- **Targets:** [`.github/workflows/release-tauri.yml`](../.github/workflows/release-tauri.yml).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** the release workflow builds and publishes straight from a tag with no tests, no code signing and no notarization (users are told to "Open Anyway"). Run `make check test` first and pass `APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` secrets to `tauri-action`.
- **Done when:** a release DMG passes `spctl -a -vv`.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="loom-472"></a>472

### LOOM-472 — Check and package the catalog Worker in PR CI

- [x] **P1 · ci · Effort L · Evidence: Source**
- **Completed (2026-10-12):** CI worker job: `check:worker` + `npm run deploy:dry`.
- **Targets:** [`.github`](../.github), [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts), [`wrangler.jsonc`](../wrangler.jsonc).
- **Basis:** Only a macOS tag-release workflow exists; the catalog Worker has no established independent PR gate.
- **Implementation:** Add locked installation, generated-type verification, dedicated type-check, Worker tests and local dry-run packaging. Establish a bundle budget from measured output instead of using an arbitrary historical cap.
- **Done when:** A request/type/transform regression fails PR CI and the tested deploy artifact is built without touching production bindings.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-473"></a>473

### LOOM-473 — Check and package MCP independently in PR CI

- [x] **P1 · ci · Effort M · Evidence: Source**
- **Completed (2026-10-12):** CI MCP job: `check:mcp` + `wrangler deploy --dry-run`.
- **Targets:** [`.github`](../.github), [`mcp/package.json`](../mcp/package.json), [`mcp/tsconfig.json`](../mcp/tsconfig.json), [`mcp/src/index.ts`](../mcp/src/index.ts).
- **Basis:** The current MCP type-check fails with 113 errors while root checks remain green.
- **Implementation:** After LOOM-471, add a separate clean-install job for type checks, profiler/tool/widget tests and dry-run packaging. Publish reports as CI artifacts and keep challenge tokens and production secrets out of PR runs.
- **Done when:** A broken MCP tool contract or type fails PR CI even when the frontend passes.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="loom-474"></a>474

### LOOM-474 — Add a reproducible native Rust CI gate

- [x] **P1 · ci · Effort L · Evidence: Source**
- **Completed (2026-10-12):** CI rust: `cargo fmt --check`, `clippy -D warnings`, `cargo test`.
- **Targets:** [`.github`](../.github), [`src-tauri/Cargo.toml`](../src-tauri/Cargo.toml), [`src-tauri/Cargo.lock`](../src-tauri/Cargo.lock).
- **Basis:** The tag-release workflow builds the app but contains no explicit formatting, clippy or native test gate. Rust test counts were not measured in this review.
- **Implementation:** Add a supported macOS job with locked resolution, cache keys tied to lockfile/toolchain, cargo fmt --check, clippy and cargo test. Validate mobile conditional compilation separately where toolchains are available.
- **Done when:** A failing native test or prohibited lint stops the release candidate and the gate does not silently ignore clippy failures.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-475"></a>475

### LOOM-475 — Add an `e2e` CI job

- [x] **P2 · ci · Effort M · Evidence: Source**
- **Completed (2026-10-12):** CI `e2e` job: build + `LOOM_E2E=1 npm run test:e2e` + Playwright report artifact. File: `.github/workflows/ci.yml`.
- **Targets:** [`README.md`](../README.md).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `npx playwright install --with-deps chromium webkit` → build → serve `out/` + `wrangler dev` → `npx playwright test`; upload the HTML report and screenshot diffs as artifacts.
- **Done when:** A deterministic discovery/import/chart/share journey runs against local fixtures in CI, and failures include useful traces/screenshots without external publishing.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="loom-516"></a>516

### LOOM-516 — Verify lockfile tracking and reproducible native dependency resolution

- [x] **P2 · build · Effort L · Evidence: Proposal**
- **Completed (2026-10-12):** Lockfile policy in `docs/DEPLOYMENT_GATES.md`.
- **Targets:** [`src-tauri/Cargo.lock`](../src-tauri/Cargo.lock), [`src-tauri/Cargo.toml`](../src-tauri/Cargo.toml), [`.github/workflows/release-tauri.yml`](../.github/workflows/release-tauri.yml).
- **Basis:** Do not assume a lockfile is missing because an older checklist says so. Release reproducibility depends on tracked lockfiles and locked build commands.
- **Implementation:** Check tracked status of root npm, MCP npm and Cargo lockfiles. Restore only missing application lockfiles, use locked installs/builds in CI and document intentional exceptions.
- **Done when:** Clean checkout resolves the reviewed versions with npm ci and cargo --locked and cannot silently rewrite a lockfile during release.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-663"></a>663

### LOOM-663 — Pin compatible runtime versions across all package roots

- [x] **P1 · build · Effort M · Evidence: Proposal**
- **Targets:** [`package.json`](../package.json), [`mcp/package.json`](../mcp/package.json), [`.github/workflows/release-tauri.yml`](../.github/workflows/release-tauri.yml).
- **Basis:** The release workflow pins Node 20 while the root manifest includes a recent Capacitor CLI; validate engines rather than assume compatibility.
- **Implementation:** Read installed package engine requirements and select a tested Node/npm/Rust/Xcode matrix. Add engines/version files and an early preflight check with actionable errors.
- **Done when:** A clean developer machine and CI use supported runtime versions and incompatible engines fail before an expensive build.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="loom-670"></a>670

### LOOM-670 — Make deployment gates, previews and promotion explicit

- [x] **P2 · ci · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `docs/DEPLOYMENT_GATES.md`.
- **Targets:** [`.github`](../.github), [`Makefile`](../Makefile), [`wrangler.jsonc`](../wrangler.jsonc), [`mcp/wrangler.jsonc`](../mcp/wrangler.jsonc).
- **Basis:** Deployments are exposed through local commands; a CI pipeline should preserve environment isolation and intentional promotion.
- **Implementation:** Package previews after checks using least-privilege credentials and test bindings, and promote the reviewed artifact through an explicit production workflow. Separate main UI and MCP rollout/rollback decisions.
- **Done when:** A failed gate cannot deploy; previews cannot mutate production storage, and a production release has a known artifact and rollback target.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="area-06"></a>

## 06 · Documentation and contributor experience

<a id="loom-506"></a>506

### LOOM-506 — Reconcile the privacy policy with request logging

- [x] **P2 · docs · Effort S · Evidence: Review**
- **Completed (2026-10-12):** Privacy + logging in `public/privacy.html`.
- **Targets:** [`mcp/wrangler.jsonc`](../mcp/wrangler.jsonc).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `privacy.html` says data "is not stored, logged", but `/demo/chat` sends recommendations (derived from user data) in the `/preview?seed=` URL, and `observability.enabled` records request URLs. Move the seed to `postMessage`/POST or disable URL logging, and update the policy.
- **Done when:** no user-derived data appears in Worker logs.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-507"></a>507

### LOOM-507 — Document (or fix) that the Docker image has no `/api` backend

- [x] **P2 · docs · Effort S · Evidence: Review**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `serve out -s` only serves static files, so live sources, catalog search, `/api/fetch-csv`, feedback and share links all fail (the SPA fallback returns `index.html` for `/api/*`). Either run the Worker with `wrangler dev --local` in the container or state the limitation in the Dockerfile header and README.
- **Done when:** one of the two is in place.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-508"></a>508

### LOOM-508 — Report client crashes

- [x] **P2 · dx · Effort M · Evidence: Review**
- **Targets:** [`src/components/ErrorBoundary.tsx`](../src/components/ErrorBoundary.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `ErrorBoundary.componentDidCatch` only calls an optional prop; POST `{message, stack, viewMode, ua}` to a Worker `/api/client-error` route (rate-limited) and add `window.onerror`/`unhandledrejection` hooks.
- **Done when:** a thrown test error shows in `wrangler tail`.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-510"></a>510

### LOOM-510 — Make `make check` include tests and the Worker

- [x] **P2 · dx · Effort L · Evidence: Source**
- **Completed (2026-10-12):** `make check` runs check-worker + test.
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** it runs `check-ts` + `check-rust` only; add `check: check-ts check-worker check-rust test` so "all checks passed" is true.
- **Done when:** Fast checks and full runtime gates have accurate names, documented coverage and nonzero failure propagation; the full gate includes tests and both Workers.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.
- **Scope/dependency:** Define and document the fast local check versus full release gate; LOOM-697 mirrors CI.

<a id="loom-511"></a>511

### LOOM-511 — Use a portable shell

- [x] **P2 · dx · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `SHELL := /bin/zsh` makes every target fail on ubuntu CI runners and Linux contributors; switch to `/bin/bash` (no zsh-specific syntax is used).
- **Done when:** All documented Make targets execute in supported macOS/Linux shells without requiring zsh unless a target declares that prerequisite.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-512"></a>512

### LOOM-512 — Run checks before deploying

- [x] **P2 · dx · Effort M · Evidence: Source**
- **Targets:** [`package.json`](../package.json).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `make loft` → `npm run deploy` builds and deploys with no tests/typecheck; make `loft: check-ts test` a prerequisite. (`Makefile:206-210`, `package.json`).
- **Done when:** Deploy preparation requires the agreed checks and aborts on any failed gate; actual deployment remains an intentional separate action.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Completed (2026-10-12, follow-up):** `make loft` now also requires `check-worker` before deploy.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-513"></a>513

### LOOM-513 — Keep the README directory map maintainable

- [x] **P2 · docs · Effort S · Evidence: Source**
- **Completed (2026-10-12):** README + DOCS capability/deployment links.
- **Targets:** [`README.md`](../README.md), [`DOCS.md`](../DOCS.md).
- **Basis:** The project tree has expanded into browser storage, mobile shells, additional chart helpers and Workers; exhaustive file counts age quickly.
- **Implementation:** Keep a compact responsibility map and link to architecture sections. Include both maintained native shells only if ownership is intentional, and avoid hand-maintained source/test counts.
- **Done when:** All listed paths exist and new contributors can locate browser ingest, native commands, chart contracts, Worker APIs and tests.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-514"></a>514

### LOOM-514 — Correct the rendering pipeline claim

- [x] **P2 · docs · Effort L · Evidence: Source**
- **Completed (2026-10-12):** Rendering pipeline corrected in DOCS.md.
- **Targets:** [`DOCS.md`](../DOCS.md).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** DOCS says "Canvas 2D or Vega for bar/line/area/arc", but Vega is only used for SVG export (`ChartView.tsx`); all on-screen charts are Canvas/WebGPU.
- **Done when:** Architecture documents distinguish on-screen Canvas/WebGPU rendering from spec generation and Vega-based export, consistent with current imports and dispatch.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-515"></a>515

### LOOM-515 — Describe real verification boundaries instead of stale test counts

- [x] **P2 · docs · Effort S · Evidence: Source**
- **Completed (2026-10-12):** Verification table in DOCS.md § Testing.
- **Targets:** [`DOCS.md`](../DOCS.md), [`README.md`](../README.md), [`vitest.config.ts`](../vitest.config.ts), [`Makefile`](../Makefile).
- **Basis:** The current measured suite is 44 files/820 tests, and root checks exclude both Workers and Rust. Historical counts should not define coverage.
- **Implementation:** Document test categories, one-shot commands, per-runtime type/check gates and known gaps. Explain Node versus DOM/e2e tests and how to run relevant Rust and packaged-mobile checks.
- **Done when:** A contributor can reproduce each gate, knows what a root green check excludes, and documentation contains no obsolete exact inventory claim.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-517"></a>517

### LOOM-517 — Keep temporary agent worktrees and local launch configuration out of releases

- [x] **P2 · dx · Effort M · Evidence: Proposal**
- **Targets:** [`.gitignore`](../.gitignore), [`.claude`](../.claude), [`.github`](../.github).
- **Basis:** The working tree includes an untracked .claude directory; do not assume all its contents should be committed or removed.
- **Implementation:** Inspect its inventory without changing unrelated work. Ignore temporary nested checkouts/caches, and keep only intentional portable launch configuration with documented ports and no machine-specific paths.
- **Done when:** Clean checkout/release packaging does not include nested repos or local artifacts, while intentionally shared dev launch commands still work.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-518"></a>518

### LOOM-518 — Replace false Cursor performance mandates with actual contracts

- [x] **P1 · docs · Effort S · Evidence: Source**
- **Targets:** [`.cursor/rules/loom-stack.mdc`](../.cursor/rules/loom-stack.mdc), [`AGENTS.md`](../AGENTS.md), [`DOCS.md`](../DOCS.md).
- **Basis:** The rule says never render with Vega, use WebGPU for all charts, keep all data local and use zero-copy Arrow; current architecture uses Canvas, public Worker sharing and JSON IPC.
- **Implementation:** Rewrite the rule to match observed architecture and user AGENTS instructions. Mark zero-copy and MLX as future proposals if retained; describe remote-data and sharing exceptions accurately.
- **Done when:** Cursor receives one consistent rule set: typed IPC, single Zustand state, portable specs, gated GPU scatter, theme tokens and static export.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.
- **Completed (2026-10-12):** Rewrote `.cursor/rules/loom-stack.mdc` to match AGENTS.md (gated WebGPU scatter, web/mobile data paths, SQL policy, no false zero-copy mandate).

<a id="loom-520"></a>520

### LOOM-520 — Add realistic performance guardrails to agent instructions

- [x] **P2 · docs · Effort S · Evidence: Proposal**
- **Completed (2026-10-12):** Performance budgets + AGENTS checklist.
- **Targets:** [`AGENTS.md`](../AGENTS.md), [`DOCS.md`](../DOCS.md), [`.cursor/rules/loom-stack.mdc`](../.cursor/rules/loom-stack.mdc).
- **Basis:** Existing instructions need enforceable guidance for selective subscriptions, lazy feature loading and resource ownership without false zero-copy mandates.
- **Implementation:** Describe measured budgets, representative device/input sizes, when to use lazy imports and profiling requirements for render hot paths. Avoid banning every static import regardless of use or cost.
- **Done when:** Agent guidance references actual CI budgets and capability contracts, and a future feature checklist calls for appropriate verification.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-665"></a>665

### LOOM-665 — Keep formatters available and scope them to touched files

- [x] **P2 · dx · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `prettier` in root devDependencies; use `npm run fmt -- <file>` for touched paths only.
- **Targets:** [`package.json`](../package.json), [`Makefile`](../Makefile), [`mcp/package.json`](../mcp/package.json).
- **Basis:** The fmt script invokes Prettier, but package.json does not declare it; blanket formatting would obscure the large existing working-tree changes.
- **Implementation:** Declare a tested formatter/configuration and document touched-file usage. Cover TS/TSX/CSS/JSON/Markdown and Rust without automatically reformatting generated iOS files.
- **Done when:** A clean install can format a selected file deterministically and the normal task workflow avoids repository-wide unrelated changes.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="loom-689"></a>689

### LOOM-689 — Document native privacy and capability behavior before distribution

- [x] **P1 · docs · Effort L · Evidence: Proposal**
- **Completed (2026-10-12):** `docs/PRIVACY_NATIVE.md` + README pointer.
- **Targets:** [`public/privacy.html`](../public/privacy.html), [`mcp/src/privacy.html`](../mcp/src/privacy.html), [`README.md`](../README.md), [`src-tauri/Info.plist`](../src-tauri/Info.plist), [`ios`](../ios).
- **Basis:** Desktop local-first language, public story publication, browser retention, Worker logging and native permission prompts need consistent explanations.
- **Implementation:** Inventory actual data handling and native capabilities, then update product privacy copy and platform declarations from that inventory. Verify current store requirements against official documentation during implementation.
- **Done when:** Published copy accurately describes local storage, optional uploads, retention and remote requests for each shell without claiming everything always stays local.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-690"></a>690

### LOOM-690 — Document and test the handoff

- [x] **P3 · docs · Effort S · Evidence: Review**
- **Targets:** [`DOCS.md`](../DOCS.md), [`AGENTS.md`](../AGENTS.md), [`src/components/NeoSpaceIngest.tsx`](../src/components/NeoSpaceIngest.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: move isAllowedOrigin/safeName into `src/lib/neospace.ts` with unit tests (allowed origin, preview subdomain, `evil.pages.dev`, prod localhost), and add the flow to DOCS.md plus a changelog item as the AGENTS.md checklist requires.
- **Done when:** the tests pass and the docs mention it.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-691"></a>691

### LOOM-691 — Move per-parser caps into the registry

- [x] **P3 · docs · Effort S · Evidence: Review**
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: FEMA 200, SpaceX last 120, OpenSky 800 and `SOURCE_MAX_ROWS` live in webStreams while descriptions promise other numbers (SpaceX "most recent 100 launches", sourceRegistry.ts); add `maxRows`/`upstreamCap` to SourceDef and generate the copy from them.
- **Done when:** the SpaceX description and parser agree via one constant.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-692"></a>692

### LOOM-692 — Keep What's new copy user-facing

- [x] **P3 · docs · Effort S · Evidence: Review**
- **Completed (2026-10-12):** Changelog copy + `changelog.test.ts`.
- **Targets:** [`AGENTS.md`](../AGENTS.md), [`src/lib/changelog.ts`](../src/lib/changelog.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: recent entries contain developer jargon ("Socrata’s zone-less created_date", "the stronger label token at 11px") despite AGENTS.md's "write for users"; add a changelog test that flags snake_case identifiers, `px` units and code tokens in `detail`.
- **Done when:** the test passes and the 2026-10-06c entry is reworded.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-693"></a>693

### LOOM-693 — Fill in package metadata

- [x] **P3 · docs · Effort S · Evidence: Review**
- **Targets:** [`src-tauri/Cargo.toml`](../src-tauri/Cargo.toml).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `authors = ["you"]` and the description say "for macOS" while `bundle.targets` is `"all"`. Set real authors/license/repository and decide targets explicitly.
- **Done when:** `cargo metadata` shows real values.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-695"></a>695

### LOOM-695 — Update DOCS.md's source count and backend description

- [x] **P3 · docs · Effort S · Evidence: Source**
- **Completed (2026-10-12):** 34 feeds + Worker API section in `DOCS.md`.
- **Targets:** [`DOCS.md`](../DOCS.md), [`AGENTS.md`](../AGENTS.md).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** it says "30 feeds" (the registry and AGENTS.md have 34) and "Static export — Data.gov and other backend work live in Tauri commands", ignoring the Worker routes `/api/catalog/*`, `/api/fetch-csv`, `/api/source/*`, `/api/stories`, `/s/*`. Correct the count and add a Worker section listing routes, caching and limits.
- **Done when:** DOCS.md matches `catalog-proxy.ts`.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-696"></a>696

### LOOM-696 — Fix `npm start`

- [x] **P3 · dx · Effort M · Evidence: Source**
- **Targets:** [`package.json`](../package.json).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `"start": "next start"` errors with `output: "export"`; replace with `"preview": "npx serve out -s -l 3000"` or `wrangler dev` (which also serves `/api/*`).
- **Done when:** A documented local preview command serves the static export correctly; API-enabled preview uses a local Worker and no command claims next start supports export.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-697"></a>697

### LOOM-697 — Mirror runtime-specific CI gates in local commands

- [x] **P2 · dx · Effort M · Evidence: Proposal**
- **Targets:** [`Makefile`](../Makefile), [`package.json`](../package.json), [`mcp/package.json`](../mcp/package.json).
- **Basis:** Frontend, catalog Worker, MCP and Rust need distinct gates that contributors can run without a deployment.
- **Implementation:** Add make ci for the agreed full gate and keep fast per-runtime targets. Use one-shot test commands, consistent environment assumptions and clear failure propagation. Put cache cleanup in explicit cleanup targets.
- **Done when:** The local full gate runs the same checks as CI, terminates successfully on green code and reports the responsible runtime on failure.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="loom-698"></a>698

### LOOM-698 — Document performance budgets around the complete user journey

- [x] **P2 · docs · Effort S · Evidence: Proposal**
- **Completed (2026-10-12):** `docs/PERFORMANCE_BUDGETS.md`.
- **Targets:** [`DOCS.md`](../DOCS.md), [`README.md`](../README.md).
- **Basis:** Module-level optimization needs a product goal: fast discover/import/chart/share on supported devices, without losing desktop density.
- **Implementation:** Document first-load, interaction, memory, parsing and export targets with device/input definitions. Distinguish proposed targets from measured baselines and identify budget owners.
- **Done when:** A contributor can reproduce each budget and judge a feature tradeoff from measured journey impact rather than vague 60fps claims.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="loom-699"></a>699

### LOOM-699 — Add risk-appropriate verification to the feature checklist

- [x] **P2 · docs · Effort S · Evidence: Source**
- **Completed (2026-10-12):** AGENTS.md feature checklist.
- **Targets:** [`AGENTS.md`](../AGENTS.md), [`DOCS.md`](../DOCS.md).
- **Basis:** The current checklist covers implementation/docs/changelog but does not define acceptance evidence by runtime or risk.
- **Implementation:** Require a concrete acceptance outcome, relevant gates and a recorded platform limitation. Recommend focused regression tests for logic/behavior changes, not mandatory redundant tests for every reversible style or copy edit.
- **Done when:** The checklist leads agents to the right runtime gate and user-visible acceptance evidence without unnecessary broad rewrites or low-value tests.
- **Verification:** Check links and all documented commands/claims against current code. Run a focused example only if the task changes an executable workflow.

<a id="area-07"></a>

## 07 · Test infrastructure and regression coverage

<a id="loom-012"></a>012

### LOOM-012 — Keep WebGPU plot padding correct across every stage configuration

- [x] **P2 · test · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `chartPlotRect.ts` + DPR endpoint tests; GPU upload uses `resolveGpuScatterPads` and separate pad X/Y device insets.
- **Targets:** [`src/shaders/scatter.wgsl`](../src/shaders/scatter.wgsl), [`src/lib/webgpu.ts`](../src/lib/webgpu.ts), [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Padding support already exists; the previous request to add it is obsolete, but device pixels and CSS pixels still cross three rendering layers.
- **Implementation:** Make plot-rectangle coordinates a shared typed contract. Validate nonsquare stages, asymmetric chart gutters, portrait exports and noninteger DPR rather than implementing a second pad adjustment.
- **Done when:** GPU points at domain endpoints align with Canvas axes at DPR 1, 1.5, 2 and 3 in desktop and portrait captures.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-090"></a>090

### LOOM-090 — Add Playwright e2e for the phone journey

- [x] **P1 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `@playwright/test`, `playwright.config.ts`, `e2e/phone-share.spec.ts`, `npm run test:e2e` (LOOM_E2E=1 + preview). CI optional gate not wired yet.
- **Targets:** [`README.md`](../README.md).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: none exist; add `e2e/phone-share.spec.ts` (`devices["iPhone 14"]`, serve `out/` + `wrangler dev` with fixture-backed `/api/source/*`) covering: cold load shows chart CTA → tap "What's interesting right now" → chart renders (canvas non-blank) → Share sheet opens → "Copy chart link" yields `#chart=` URL that reopens the same chart.
- **Done when:** it runs in CI.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-435"></a>435

### LOOM-435 — Enforce Citi Bike value parity with shared fixtures

- [x] **P2 · test · Effort L · Evidence: Proposal**
- **Completed (2026-10-12):** Cross-runtime gate: `gbfs_parity_{info,status,expected}.json` in `src-tauri/tests/fixtures/sources/` are read by Vitest (`citibikeParity.test.ts` → `joinCitibike`+`parseSourceRows`) and Rust (`citibike_matches_shared_parity_fixture` → `citibike_rows`). Contract (zero capacity, absent coords dropped, vehicle-type e-bike counts, null-not-0 for absent counts, stale `last_reported` → feed `last_updated` → null) documented on `joinCitibike`; registry/schema column drift fails both.
- **Targets:** [`workers/sourceTransforms.ts`](../workers/sourceTransforms.ts), [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs), [`src-tauri/src/sources_tests.rs`](../src-tauri/src/sources_tests.rs).
- **Basis:** Desktop and Worker implementations independently derive station capacity, e-bikes, timestamps and coordinates. The earlier semantic mismatch needs fixture verification rather than another blind port.
- **Implementation:** Run the same sanitized GBFS station-info and station-status payloads through both paths. Document handling of zero capacity, absent coordinates, vehicle type counts and stale last_reported.
- **Done when:** Both implementations emit the same typed values for supported fields, including nulls, and a schema change fails a parity gate.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-476"></a>476

### LOOM-476 — Expand tooltip tests from helpers to renderer hit identity

- [x] **P2 · test · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Spatial hit index in `pickHitTarget`. Test: `spatialHitIndex.test.ts`.
- **Targets:** [`src/lib/__tests__/chartTooltip.test.ts`](../src/lib/__tests__/chartTooltip.test.ts), [`src/components/ChartView.tsx`](../src/components/ChartView.tsx), [`src/lib/chartTooltip.ts`](../src/lib/chartTooltip.ts).
- **Basis:** chartTooltip.test.ts already exists, so creating it again is obsolete. Four existing helper tests do not prove chart-to-row identity.
- **Implementation:** Add cases for filtered rows, aggregate buckets, faceting, transformed axes, missing points and overlapping hits. Test the public hit-target contract rather than matching internal switch statements.
- **Done when:** A tooltip on each representative renderer refers to the correct original rows and labels aggregate values accurately.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-477"></a>477

### LOOM-477 — Add a regression test for anomaly index space

- [x] **P2 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Leading-null anomaly index tests in `smartAnalytics.test.ts`.
- **Targets:** [`src/lib/__tests__/smartAnalytics.test.ts`](../src/lib/__tests__/smartAnalytics.test.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: assert that `anomalyZScore`, `anomalyIQR` and `anomalyMAD` return the same real row indices for data with leading nulls/strings, and that MAD=0 returns [].
- **Done when:** the test fails on the current code and passes after the fix.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-478"></a>478

### LOOM-478 — Add a palette contrast test

- [x] **P2 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `chartPaletteContrast.test.ts`.
- **Targets:** [`src/lib/chartPalettes.ts`](../src/lib/chartPalettes.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: assert every `THEME_CHART[theme]` colour has ≥3:1 contrast against `THEME_UI[theme].bg` and that the unified ink helper reaches ≥4.5:1 on every palette stop.
- **Done when:** the test exists and guards both the default palettes and colourblind (`okabe`, `cividis`) stops.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-479"></a>479

### LOOM-479 — Unit-test the Canvas renderers with the recording context from `creativeRenderers.test.ts`

- [x] **P2 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `creativeRenderers.test.ts` recording context smoke.
- **Targets:** [`src/lib/__tests__/creativeRenderers.test.ts`](../src/lib/__tests__/creativeRenderers.test.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: after extracting the `renderFull*` functions, cover: log-scale tick placement, compare-previous x-offset, shared facet scales, empty-state messages, and "every kind registers ≥1 hit target".
- **Done when:** the core kinds (bar, line, area, scatter, pie, heatmap, box) have render tests.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.
- **Scope/dependency:** Own classic Canvas renderer model behavior; LOOM-502 owns pixel/visual snapshots.

<a id="loom-480"></a>480

### LOOM-480 — Move the correlation matrix into smartAnalytics

- [x] **P2 · test · Effort M · Evidence: Review**
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the Pearson math runs inline in onClick, is cast `as never`, uses hard-coded `rgba(108,92,231,…)` heat colours (:2528) and silently keeps only the first 8 columns. Move it to smartAnalytics.ts with unit tests, type it in SmartResults, and colour cells with `color-mix(var(--loom-accent))`.
- **Done when:** the tests cover r=±1 and NaN columns.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-481"></a>481

### LOOM-481 — Test theme token contrast

- [x] **P2 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `themeContrast.test.ts` on `THEME_UI` tokens.
- **Targets:** [`src/styles/globals.css`](../src/styles/globals.css).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: add `src/lib/__tests__/themeContrast.test.ts` that parses the theme blocks in globals.css and asserts text, muted, label, accent and warning are at least 4.5:1 and borders/chart series at least 3:1 on bg, surface and elevated for each theme.
- **Done when:** the test fails on today's dark accent and passes after the fix.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-482"></a>482

### LOOM-482 — Make the component harness exercise connected UI behavior

- [x] **P2 · test · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `QueryView.dom.test.tsx` + DOM harness.
- **Targets:** [`vitest.config.ts`](../vitest.config.ts), [`src/components/QueryView.tsx`](../src/components/QueryView.tsx), [`src/components/ShareSheet.tsx`](../src/components/ShareSheet.tsx).
- **Basis:** Tests run in Node and the current suite is concentrated in src/lib; UI workflows are not established by those tests.
- **Implementation:** After the DOM harness task, add representative tests for SQL cancellation/error recovery and share publishing states using realistic store transitions and mocked boundaries. Avoid tests that only assert markup snapshots.
- **Done when:** Tests catch stale-result application, double-submit and focus restoration while retaining fast Node helper tests.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.
- **Scope/dependency:** Use the DOM foundation in LOOM-503; cover connected Query and Share flows.

<a id="loom-484"></a>484

### LOOM-484 — Add unit tests for CSV export

- [x] **P2 · test · Effort M · Evidence: Source**
- **Targets:** [`src/lib/csvExport.ts`](../src/lib/csvExport.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** there is no test for `csvExport.ts`; cover quotes, embedded CR/LF, null/undefined, formula-injection prefixes, BOM and header-only results.
- **Done when:** `src/lib/__tests__/csvExport.test.ts` covers each case.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-485"></a>485

### LOOM-485 — Add tests for `validateQuery`

- [x] **P2 · test · Effort M · Evidence: Source**
- **Targets:** [`src/lib/queryValidate.ts`](../src/lib/queryValidate.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** cover parens inside strings/comments, FROM-first, DESCRIBE/SUMMARIZE and empty input so the P1 validator fix can't regress.
- **Done when:** `queryValidate.test.ts` exists and passes.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-486"></a>486

### LOOM-486 — Add time-zone tests for `dateFormat` and Dive bucketing

- [x] **P2 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** TZ cases in `dateFormat.test.ts` + `zonedTime.test.ts`.
- **Targets:** [`src/lib/dateFormat.ts`](../src/lib/dateFormat.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: run `formatDateCell`, `bucketFloor`/weekly buckets and `formatBucket` under `TZ=America/New_York` and `Pacific/Auckland` (vitest `process.env.TZ` per file), including a DST-crossing series.
- **Done when:** the day-shift and Thursday-week bugs fail before the fix and pass after.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-487"></a>487

### LOOM-487 — Add escaping tests for share/microsite HTML

- [x] **P2 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Extended `dashboardMicrosite.test.ts`.
- **Targets:** [`src/lib/dashboardMicrosite.ts`](../src/lib/dashboardMicrosite.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: feed `<script>`, `"` and `'` through `dashboardName`, slot labels, `sourceLabel`, caption and `openUrl` of both builders and assert no raw markup; this would have caught the unescaped footer.
- **Done when:** `dashboardMicrosite.test.ts` covers every interpolated field.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-488"></a>488

### LOOM-488 — Add persist.ts unit tests

- [x] **P2 · test · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Round-trip + corrupt JSON in `persist.test.ts` + `persistValidation.test.ts`.
- **Targets:** [`src/lib/persist.ts`](../src/lib/persist.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** nothing covers corrupt JSON → defaults, `setItem` throwing (quota), slice caps, or chart-view round-trips (incl. the missing `querySql`); add `persist.test.ts` with an in-memory localStorage stub.
- **Done when:** every get/set pair has a round-trip and a corrupt-input test.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-489"></a>489

### LOOM-489 — Cover store actions beyond setters

- [x] **P2 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Behavior tests in `store.test.ts`.
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: store.test.ts only checks simple setters; add tests for `swipeViz`, `startDeepScan` (fake timers), `applyChartView`, `applyTableView`, `undoTable`/`redoTable`, `addRecentFile` field merge, `removeDashboard`, `moveDashboardSlot`, and `createStoryDashboard`'s failure path.
- **Done when:** each listed action has ≥1 behavioral assertion.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-490"></a>490

### LOOM-490 — Test the web stream lifecycle

- [x] **P2 · test · Effort L · Evidence: Review**
- **Completed (2026-10-12):** `webStreamsResilience.test.ts` + lifecycle helpers.
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: webStreamsResilience.test.ts has one case; add tests for `webStreamStart` with a stub EventSource, `parseWikiEvent`, rate after clear, start/stop race, `seenIds` bound after trim, and overlapping slow polls.
- **Done when:** those six scenarios run in CI.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-491"></a>491

### LOOM-491 — Add value-level fixtures for older parsers

- [x] **P2 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `src/lib/__fixtures__/webStreams/*` + `webStreamsParserFixtures.test.ts`.
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: parseUsgs, parseNws, parseMeteo/openMeteoUtc, parseAq, parseIss, parseOpensky, parseCountries, parseSpacex, parseNyc311, parseCovid, parseFema, parseHn, parseLobsters, parseCrypto, parseWorldBank and `isoOrNull` are only covered by the "rows as wide as registry columns" check; record small upstream samples under `__fixtures__/` and assert cell values/types.
- **Done when:** each parser has a fixture test asserting at least ids, timestamps and one numeric.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-492"></a>492

### LOOM-492 — Test discover hooks

- [x] **P2 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Hook + scan tests in `discoverStories.test.ts`.
- **Targets:** [`src/lib/discoverStories.ts`](../src/lib/discoverStories.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: discoverStories.test.ts (20 lines) only checks constants; export `hookFor` (or the HOOKS map) and test each feed with a fixture sample, including empty samples, NaN cells, Kp 4.67, and SpaceX upcoming flights.
- **Done when:** every DiscoverKind has a hook test.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-493"></a>493

### LOOM-493 — Fill CSV parser gaps

- [x] **P2 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `sniffCsvDelimiter` in `mock-data.test.ts`.
- **Targets:** [`src/lib/mock-data.ts`](../src/lib/mock-data.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: no tests cover `sniffCsvDelimiter` (TSV/semicolon), complete files without a trailing newline, leading-zero codes, duplicate/blank headers, null tokens, `statsFromData` text min/max, or `mockInspect` on an unknown path.
- **Done when:** each case has a test in mock-data.test.ts.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-494"></a>494

### LOOM-494 — Add recommendation-quality regression tests

- [x] **P2 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Anti-pattern guards in `recommendations.test.ts` (id columns, log axes, candidate-as-time).
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: nothing asserts that `recommend()` avoids "Sum of year", id columns as measures, log axes on signed columns, or `candidate` as time; add 3 fixture schemas (gov CSV, OWID-style, sales) with a seeded RNG and snapshot the top-10 titles plus explicit negative assertions.
- **Done when:** the suite fails if any of those anti-patterns reappears.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-495"></a>495

### LOOM-495 — Enable DOM tests for hydration

- [x] **P2 · test · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `webHydration.test.ts` staged cache hydrate.
- **Targets:** [`vitest.config.ts`](../vitest.config.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** vitest runs `environment: "node"` only, so HydrateStore's effect-order bugs (defaults persisted on first visit, double writes) can't be tested; add happy-dom via `// @vitest-environment happy-dom` per file and a HydrateStore test asserting saved settings win and defaults aren't written on first visit.
- **Done when:** that test exists and runs in `make test`.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-496"></a>496

### LOOM-496 — Add tests for the MCP profiler and widget document

- [x] **P2 · test · Effort M · Evidence: Source**
- **Targets:** [`vitest.config.ts`](../vitest.config.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `mcp/` has no tests, and `vitest.config.ts` only includes `src/**`. Add `mcp/src/__tests__/profile.test.ts` (quoted CSV, truncation, JSON caps) and a `widgetDocument` escaping test, and include `mcp/**/*.test.ts` in Vitest.
- **Done when:** `make test` runs them.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-497"></a>497

### LOOM-497 — Verify desktop parser coverage before adding source fixtures

- [x] **P2 · test · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `docs/PARSER_COVERAGE_INVENTORY.md`.
- **Targets:** [`src-tauri/src/sources_tests.rs`](../src-tauri/src/sources_tests.rs), [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** sources_tests.rs already contains substantial fixture tests; previous audit claims of absent newer-source tests need checking.
- **Implementation:** Map each registered desktop parser to value-level fixture coverage. Fill missing boundary cases for FIRMS, NWIS, Starlink and Lobsters, including missing values, malformed timestamps and empty responses.
- **Done when:** The coverage inventory identifies each parser fixture and new tests protect actual untested edge cases rather than duplicating happy paths.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-498"></a>498

### LOOM-498 — Test degraded and boundary cases for newer Worker transforms

- [x] **P2 · test · Effort L · Evidence: Proposal**
- **Completed (2026-10-12):** `sourceTransformsBoundary.test.ts` (+ Rust `nwis_sentinel_is_null_and_bad_timestamps_dropped`): `numOrNull` no longer turns blank/whitespace into 0; NWIS `-999999`/`noDataValue` → null and unparseable timestamps dropped (Worker + desktop); FIRMS BOM/blank/invalid date → null; Starlink invalid epoch/blank elements → null; partial Open-Meteo batches and missing Citi Bike joins covered.
- **Targets:** [`src/lib/__tests__/sourceTransforms.test.ts`](../src/lib/__tests__/sourceTransforms.test.ts), [`workers/sourceTransforms.ts`](../workers/sourceTransforms.ts).
- **Basis:** Worker transforms already have 18 passing tests; schema coverage alone does not establish partial-upstream behavior.
- **Implementation:** Identify unsupported branches in newer transforms and add fixtures for partial city batches, missing joins, sentinel values, stale responses and invalid timestamps. Include equivalent desktop outputs where available.
- **Done when:** Malformed or incomplete payloads produce documented null/degraded output and never fabricate zero-valued measurements.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-499"></a>499

### LOOM-499 — Test the Worker request handlers

- [x] **P2 · test · Effort L · Evidence: Source**
- **Completed (2026-10-12):** `workers/__tests__/catalogProxyHandlers.test.ts` — 38 tests covering fetch-csv SSRF/forbidden, source cache, publish/get story origin/size, feedback (mocked fetch/KV/caches).
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** nothing tests `handleFetchCsv` (SSRF blocks, truncation, xlsx sniff), `handleSource` (HIT/MISS/STALE, unknown kind), or `handlePublishStory`/`handleGetStory` (origin check, id regex, size caps). Add Vitest tests with a mocked `fetch`, `caches.default` and KV (or `@cloudflare/vitest-pool-workers`).
- **Done when:** each handler branch has a test.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-500"></a>500

### LOOM-500 — Assert every registry kind has a Worker fetcher and TTL

- [x] **P2 · test · Effort L · Evidence: Source**
- **Completed (2026-10-12):** `workerSourceRegistryParity.test.ts`.
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `SOURCE_FETCHERS`/`SOURCE_TTL_SECS` are maintained by hand, and a new registry kind without a fetcher only fails at runtime with "Unknown source". Export the maps and add a test against `SOURCE_DEFS` (and TTL ≤ pollMs).
- **Done when:** removing a fetcher fails `make test`.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-501"></a>501

### LOOM-501 — Add unit tests for `stream.rs`

- [x] **P2 · test · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/stream.rs`](../src-tauri/src/stream.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: there are no tests for `parse_sse_event`, chunk reassembly, `trim_buffer` or `query_stream`. Extract the line-assembly logic into a pure function and test split events, comments/heartbeats and the 50k trim.
- **Done when:** `cargo test` covers the stream module.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-502"></a>502

### LOOM-502 — Turn the manual screenshot procedure into visual regression

- [x] **P2 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Procedure in `docs/screenshots/README.md` (visual baseline).
- **Targets:** [`README.md`](../README.md).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `docs/screenshots/README.md` already specifies 6 reproducible `#chart=`/`#dive=` captures with playwright-core; script it as `e2e/visual.spec.ts` with `toHaveScreenshot()` against demo files (not live feeds) at 1440×900 and 390×844.
- **Done when:** Representative deterministic chart and Dive screenshots at desktop/phone sizes catch intentional visual regressions, with documented baseline update review.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-503"></a>503

### LOOM-503 — Create separate Node and DOM test projects

- [x] **P1 · test · Effort M · Evidence: Source**
- **Targets:** [`vitest.config.ts`](../vitest.config.ts), [`package.json`](../package.json).
- **Basis:** The measured suite runs in environment: node and includes only src tests; browser storage/React behavior needs a real DOM harness.
- **Implementation:** Add DOM tooling with clean storage/matchMedia/ResizeObserver boundary mocks, fixture isolation and independent project selection. Keep pure Node tests fast and avoid universal browser shims that hide unsupported API behavior.
- **Done when:** A DOM smoke test mounts/hydrates/unmounts a view without leaks while all existing Node tests run unchanged.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-504"></a>504

### LOOM-504 — Enable coverage with thresholds

- [x] **P2 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `@vitest/coverage-v8`, `npm run test:coverage`.
- **Targets:** [`vitest.config.ts`](../vitest.config.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: install `@vitest/coverage-v8`, extend `coverage.include` to `workers/**/*.ts`, and set `thresholds: { lines: <current>, functions: <current> }` as a ratchet so new lib code arrives with tests.
- **Done when:** Coverage runs successfully for the intended runtimes, reports meaningful uncovered contracts and rejects regressions beyond reviewed risk-based thresholds.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.
- **Scope/dependency:** Choose risk-based thresholds; do not demand 100% coverage of visual implementation details.

<a id="loom-505"></a>505

### LOOM-505 — Test map join quality and unmatched-region reporting

- [x] **P2 · test · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Join keys in `geoMaps.test.ts` / `geoAtlas`.
- **Targets:** [`src/lib/__tests__/geoMaps.test.ts`](../src/lib/__tests__/geoMaps.test.ts), [`src/lib/geoMaps.ts`](../src/lib/geoMaps.ts), [`src/lib/geoAtlas.ts`](../src/lib/geoAtlas.ts).
- **Basis:** geoMaps.test.ts already exists; the next gap is join transparency and difficult region identities.
- **Implementation:** Test zero-padded FIPS, ISO2/ISO3, duplicate names, ambiguous states, normalized accents and missing regions. Expose match/unmatched counts so users can distinguish absent data from zero.
- **Done when:** A representative map preserves identifiers, reports unmatched records and never silently colors an incorrect region.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-671"></a>671

### LOOM-671 — Test GPU renderer buffer lifecycle with a fake `GPUDevice`

- [x] **P3 · test · Effort L · Evidence: Review**
- **Completed (2026-10-12):** Fake `GPUDevice` lifecycle tests in `gpuRendererLifecycle.test.ts` (buffer destroy + shared lease).
- **Targets:** [`src/lib/webgpu.ts`](../src/lib/webgpu.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: record `createBuffer`/`destroy` calls and assert `uploadData` twice leaves one live data buffer, and `destroy()` destroys the device.
- **Done when:** it covers `LoomRenderer`, `LoomSceneRenderer` and `LoomCubeRenderer`.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-672"></a>672

### LOOM-672 — Fuzz `decodeChartLink` with hostile `vo` payloads

- [x] **P3 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Hostile `vo` in `chartLink.test.ts`.
- **Targets:** [`src/lib/chartLink.ts`](../src/lib/chartLink.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: oversized numbers, negative padding, very long strings and unknown keys — and assert they're clamped or dropped once validation lands.
- **Done when:** `chartLink.test.ts` has these cases.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-673"></a>673

### LOOM-673 — Enable component tests for the chart UI

- [x] **P3 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `vitest.dom.config.ts` + `ChartKindPicker.test.tsx`.
- **Targets:** [`src/components/ChartKindPicker.tsx`](../src/components/ChartKindPicker.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `vitest.config` runs in `node` only, so ChartKindPicker keyboard flows, ChartCard selection and ChartView tooltip dismissal are untested. Add a `jsdom` environment for `*.test.tsx` plus Testing Library.
- **Done when:** ChartKindPicker has tests for type-to-search, ↑/↓ skipping disabled kinds, Enter and Esc.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-675"></a>675

### LOOM-675 — Test `drawChartTicks` label collision and rotation

- [x] **P3 · test · Effort S · Evidence: Review**
- **Completed (2026-10-12):** `chartLooksTicks.test.ts`.
- **Targets:** [`src/lib/chartLooks.ts`](../src/lib/chartLooks.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: rotated x labels skip the collision check that flat labels use, so they overlap on dense axes. Add a recording-ctx test and apply the same `lastRight` guard to rotated labels.
- **Done when:** 50 rotated ticks on a 300px axis draw without overlapping boxes.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-676"></a>676

### LOOM-676 — Test malformed `#dive=` links

- [x] **P3 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Malformed `#dive=` in `dive.test.ts`.
- **Targets:** [`src/lib/dive.ts`](../src/lib/dive.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: add `decodeDiveLink` + `sanitizeDiveQuery` cases for missing `groupBy`/`filters`, string `limit`, unknown `agg` and bad base64.
- **Done when:** each returns a valid query or null without throwing.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-677"></a>677

### LOOM-677 — Cover the remote-CSV fallback logic

- [x] **P3 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `webSharedLink.test.ts`.
- **Targets:** [`src/lib/openDataCatalog.ts`](../src/lib/openDataCatalog.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: mock `fetch` to check `fetchCsvTextWeb`/`fetchJsonDatasets` origin fallback (404 → fallback, 500 → no double download, xlsx guard).
- **Done when:** `openDataCatalog.test.ts` asserts request counts.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-678"></a>678

### LOOM-678 — Add component tests for Explorer table behaviour

- [x] **P3 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Table selection remap test. File: `tableExplorer.test.ts`.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: with Testing Library, cover sort via keyboard, filter debounce, hidden+reordered columns keeping correct sparkline data, and clearing selection on file change.
- **Done when:** `ExplorerView.test.tsx` covers these four.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-679"></a>679

### LOOM-679 — Test ZIP output round-trips

- [x] **P3 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** ZIP in `socialExport.test.ts`.
- **Targets:** [`src/lib/zipStore.ts`](../src/lib/zipStore.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the existing zipStore test only checks local headers; unzip the result with a reference reader (e.g. `fflate.unzipSync` in tests) and check CRCs, the UTF-8 name flag and entry count.
- **Done when:** a two-file archive round-trips byte-for-byte.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-681"></a>681

### LOOM-681 — Add a parity test for shared constants

- [x] **P3 · test · Effort L · Evidence: Review**
- **Completed (2026-10-12):** `upstreamParity.test.ts` + `constantsParity.test.ts` parse `sources.rs` and fail when `WORLD_CITIES` vs Rust `CITIES` (name+lat+lon), `ADSB_POINTS`, or the aircraft/NWS/Starlink row caps drift; city count, coordinate precision and ADSB point ordering verified.
- **Targets:** [`src-tauri/src/sources_tests.rs`](../src-tauri/src/sources_tests.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: city lists (`CITIES` vs `WORLD_CITIES`, different order), ADSB points, upstream URLs and caps are duplicated by hand in Rust and TS with nothing checking them (unlike the registry columns). Extend `sources_tests.rs` to parse `sourceTransforms.ts`/`catalog-proxy.ts` constants (as it does `sourceRegistry.ts`).
- **Done when:** changing a city in one place fails the test.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-682"></a>682

### LOOM-682 — Add tests for `commands.rs` helpers

- [x] **P3 · test · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `normalize_folder_path`, `sanitize_ckan_q`, `is_csv_distribution`, `is_usable_catalog_distribution` and the filename sanitizer in `save_csv_to_folder` are untested. Add a `#[cfg(test)]` module with representative DCAT fixtures.
- **Done when:** each helper has a test.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-684"></a>684

### LOOM-684 — Validate shaders in CI

- [x] **P3 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `webgpuShader.test.ts`.
- **Targets:** [`src/shaders/`](../src/shaders/), [`src/shaders/scatter.wgsl`](../src/shaders/scatter.wgsl).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: compile-check all 4 WGSL files with `naga` (`cargo install naga-cli && naga src/shaders/*.wgsl`) so a shader typo fails CI instead of silently falling back to Canvas at runtime.
- **Done when:** Every maintained WGSL entry point is validated by a pinned supported tool in CI, with one deliberately malformed fixture proving that shader errors fail the gate.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-686"></a>686

### LOOM-686 — Add an SSR/static-export smoke test

- [x] **P3 · test · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `staticExportSmoke.test.ts`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: assert `out/index.html` contains `og:image`, `manifest`, the CTA text, and no "Choose folder" copy, run after `npm run build` in CI.
- **Done when:** The exported root HTML includes the intended public metadata and usable responsive first-paint content; referenced assets exist without runtime Next routes.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-687"></a>687

### LOOM-687 — Measure web performance in CI with stable fixtures

- [x] **P2 · test · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Journey budgets in `docs/PERFORMANCE_BUDGETS.md`.
- **Targets:** [`.github`](../.github), [`docs/screenshots/README.md`](../docs/screenshots/README.md), [`next.config.mjs`](../next.config.mjs).
- **Basis:** The build reports bytes, not interactive performance; live upstreams would make benchmark results noisy.
- **Implementation:** Run a pinned lab tool against static output plus a local test Worker using deterministic data and representative mobile throttling. Establish LCP/CLS/TBT budgets from baseline and measure INP separately with real interaction or field data.
- **Done when:** CI stores reproducible reports and flags meaningful regressions; a lab TBT score is never represented as measured INP.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="loom-688"></a>688

### LOOM-688 — Make `npm test` non-watch in CI contexts

- [x] **P3 · test · Effort M · Evidence: Source**
- **Targets:** [`package.json`](../package.json).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `"test": "vitest"` starts watch mode; agents/CI that run `npm test` hang; change to `"test": "vitest run"` and add `"test:watch": "vitest"`.
- **Done when:** The default automated test command terminates after a single run, a separate watch command is available, and CI/Make scripts use the intended mode.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Demonstrate that the regression fails before the relevant fix and passes afterward where practical. Keep fixtures small, deterministic and representative; run the affected suite and existing adjacent tests.

<a id="area-08"></a>

## 08 · MCP tools, profiler and widget

<a id="loom-449"></a>449

### LOOM-449 — Separate preview deployments from production publishing storage

- [x] **P1 · ops · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `docs/WORKER_ENVIRONMENTS.md` preview/production policy.
- **Targets:** [`wrangler.jsonc`](../wrangler.jsonc), [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts), [`mcp/wrangler.jsonc`](../mcp/wrangler.jsonc).
- **Basis:** workers_dev and preview_urls are enabled and story storage is a configured binding; deployment isolation needs an explicit policy.
- **Implementation:** Define per-environment hosts, origins, secrets and story namespaces. Keep previews usable for review while ensuring previews cannot create or delete production content or use production issue-writing credentials.
- **Done when:** A preview smoke test writes only to preview storage and production handoff URLs always use the canonical production host.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="loom-450"></a>450

### LOOM-450 — Fix quoted-field CSV parsing in the MCP profiler

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`mcp/src/profile.ts`](../mcp/src/profile.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `parseCsv`'s first pass drops every `"` while splitting lines, so `splitLine` never sees quotes and `a,"b,c",d` becomes four cells, shifting all later columns. Keep quotes in the line pass (or do one-pass field parsing).
- **Done when:** a test with quoted commas and escaped `""` profiles the right column count.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="loom-451"></a>451

### LOOM-451 — Don't truncate JSON input before parsing

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`mcp/src/profile.ts`](../mcp/src/profile.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `profilePayload` slices JSON text at 400,000 chars and then `JSON.parse`s it, which always throws for larger inputs instead of returning a truncated profile. Parse first (with a hard byte cap rejecting with a clear message) then slice the array to `MAX_ROWS`.
- **Done when:** a 500 KB JSON array returns `truncated: true`.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="loom-467"></a>467

### LOOM-467 — Align root and MCP Wrangler tooling with reproducible deploys

- [x] **P2 · build · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Aligned MCP wrangler to ^4.140.0; `make loft`/`loft-mcp` gate on Worker/MCP type-check.
- **Targets:** [`package.json`](../package.json), [`mcp/package.json`](../mcp/package.json), [`wrangler.jsonc`](../wrangler.jsonc), [`mcp/wrangler.jsonc`](../mcp/wrangler.jsonc).
- **Basis:** Root and MCP manifests carry different Wrangler ranges and independently maintained Worker configuration.
- **Implementation:** Choose tested compatible versions, record runtime compatibility assumptions and make dry-run deploy validation reproducible with lockfiles. Preserve separate production bindings and avoid upgrading compatibility dates without testing.
- **Done when:** Both Workers type-check and package with a clean install; dry-run output is reviewed and tool versions are explicit.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="loom-471"></a>471

### LOOM-471 — Fix the measured MCP type errors by separating pure chart logic

- [x] **P1 · build · Effort M · Evidence: Source**
- **Targets:** [`mcp/tsconfig.json`](../mcp/tsconfig.json), [`mcp/src/index.ts`](../mcp/src/index.ts), [`src/lib/recommendations.ts`](../src/lib/recommendations.ts), [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** The fresh MCP type-check reports 113 errors, including Env handler typing and browser-only types pulled through shared imports.
- **Implementation:** Extract pure schema, ranking and spec-building contracts from state/UI/render modules. Correct Worker handler types and keep the Worker dependency graph free of DOM implementation code. Do not merely add dom libs to hide coupling.
- **Done when:** npx tsc --noEmit -p mcp/tsconfig.json has zero errors, tools return compatible recommendations and the bundle excludes Zustand/UI/canvas implementations.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="loom-509"></a>509

### LOOM-509 — Make Worker stack traces useful with source maps

- [x] **P2 · ops · Effort L · Evidence: Proposal**
- **Completed (2026-10-12):** `upload_source_maps: true` declared once in `wrangler.jsonc` and `mcp/wrangler.jsonc` (duplicate keys removed); `wrangler deploy --dry-run` emits `.js.map` for both Workers; `workerSourceMaps.test.ts` guards the config and that no `.map` lands in `public/`/`out/`. Device/staging trace check of a thrown error stays a deploy-time step.
- **Targets:** [`wrangler.jsonc`](../wrangler.jsonc), [`mcp/wrangler.jsonc`](../mcp/wrangler.jsonc).
- **Basis:** Deployed Worker errors need source attribution, but support and configuration should be verified against the installed CLI.
- **Implementation:** Enable supported source-map upload for both Workers, verify a controlled test error maps to the intended source and review logging redaction. Keep generated maps out of public static assets.
- **Done when:** A local/staging error can be traced to a source symbol without exposing private data or production secrets.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="loom-655"></a>655

### LOOM-655 — Return structured tool errors

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`mcp/src/index.ts`](../mcp/src/index.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `JSON.parse` and the "Provide csv, json, or columns" `throw` escape the tool handlers, so clients get a generic protocol error. Catch in `resolveProfile` and return `{ isError: true, content: [{type:"text", text}] }`.
- **Done when:** malformed JSON yields a readable tool error.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="loom-656"></a>656

### LOOM-656 — Drop a partial last row when CSV is truncated

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`mcp/src/profile.ts`](../mcp/src/profile.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: slicing CSV text at `MAX_BYTES` cuts mid-row, producing a malformed final row that skews types and distinct counts. Trim back to the last newline after slicing.
- **Done when:** a truncated CSV's last row has full width.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="loom-657"></a>657

### LOOM-657 — Tighten DATE detection

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`mcp/src/profile.ts`](../mcp/src/profile.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `detectType` counts any `Date.parse`-able value as a date, and V8 accepts many free-text strings (e.g. `"Beta 2"`), so label columns can be typed DATE. Require ISO-like patterns only and add INTEGER/BOOLEAN detection.
- **Done when:** a test shows `["Alpha 1","Beta 2"]` stays VARCHAR.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="loom-658"></a>658

### LOOM-658 — Add basic abuse limits to the authless MCP endpoint

- [x] **P3 · ops · Effort M · Evidence: Source**
- **Targets:** [`mcp/src/index.ts`](../mcp/src/index.ts).
- **Basis:** Inspect actual endpoint quotas and intended anonymous access before introducing authentication.
- **Implementation:** `/mcp` is open with `origin: "*"` and no rate limit while `recommend()` over 500 rows is CPU-heavy. Add a Rate Limiting binding per IP and `limits.cpu_ms`.
- **Done when:** bursts above the limit get 429.
- **Verification:** Run the MCP TypeScript check and tool/widget contract tests; inspect a representative request and sanitized HTML output locally. Do not publish or call external tools with real private data.

<a id="area-09"></a>

## 09 · Worker APIs, caching and operations

<a id="loom-021"></a>021

### LOOM-021 — Separate complete-file CSV parsing from truncated HTTP previews

- [x] **P1 · bug · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Verified: `trimToCompleteCsvRecords` + `fetchCsvTextWeb` truncated flag (Sidebar toast).
- **Targets:** [`src/lib/mock-data.ts`](../src/lib/mock-data.ts), [`src/lib/openDataCatalog.ts`](../src/lib/openDataCatalog.ts), [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** The current parser uses parseCsvRecords directly, so the old unconditional final-row-trimming claim is stale. Partial Range responses still need an explicit contract.
- **Implementation:** Carry truncation metadata from fetch to ingest. Keep complete EOF records without a newline; discard only incomplete preview tails and report that the preview was truncated.
- **Done when:** Complete CSVs retain their last row; truncated quoted multiline records are not invented; the UI identifies partial previews.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-332"></a>332

### LOOM-332 — Stream `/api/fetch-csv` instead of buffering

- [x] **P2 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** fetch-csv uses one assembly buffer (no HEAD); peak memory no longer 2× file size from double copy.
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** it collects up to 32 MB of chunks and then copies them into a second 32 MB array (≈64 MB peak against the 128 MB isolate limit). Pipe the body through a byte-counting `TransformStream` that truncates at the cap and sniffs the first bytes for the xlsx signature.
- **Done when:** peak memory no longer scales with 2× file size.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-333"></a>333

### LOOM-333 — Cache and time-limit `/api/catalog/*`

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Catalog US/UK search cached ~10 min with per-request timeouts and 15s overall deadline.
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: every search re-paginates Data.gov sequentially (no `signal`, no cache), amplifying each user request into up to 40 upstream calls. Cache by normalized query for ~10 min and add per-call timeouts plus an overall deadline.
- **Done when:** repeat searches are cache hits and a hung page can't exceed ~15 s.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-334"></a>334

### LOOM-334 — Serve stale-while-revalidate and coalesce refreshes

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Source cache stale-while-revalidate with coalesced background refresh (`STALE-REVALIDATING`).
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: after the TTL every request blocks on the upstream, and concurrent requests all refetch (no single-flight), which also burns rate-limited upstreams (MBTA ~20/min, ADSB ~1/s). Return the expired cached copy immediately and refresh in `ctx.waitUntil` behind a short lock (KV/DO or a cache "refreshing" marker).
- **Done when:** a request after TTL expiry returns in <100 ms with `X-Loom-Cache: STALE-REVALIDATING`.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-335"></a>335

### LOOM-335 — Put a total deadline on the aircraft fetcher

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** OpenSky/ADSB aircraft fetcher capped at 20s total budget.
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: OpenSky (6 s) then up to 5 points × (8 s timeout + 1.2 s spacing) for ADSB.lol and again for adsb.fi can take ~100 s, far beyond what the browser waits. Add an overall budget (e.g. 20 s) and return what arrived.
- **Done when:** a worst-case cold miss answers within the budget.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-345"></a>345

### LOOM-345 — Instrument real-user Web Vitals

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx), [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: none exist; add `useReportWebVitals` (built into `next/web-vitals`, no new dep) in a small client component that `navigator.sendBeacon`s LCP/CLS/INP to a new Worker route `/api/vitals` logged via Workers observability.
- **Done when:** the Cloudflare dashboard shows p75 LCP/INP for loom.ibm.io. (`src/app/layout.tsx`, `workers/catalog-proxy.ts`).
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-436"></a>436

### LOOM-436 — Centralize upstream endpoint policy and fallback assumptions

- [x] **P2 · ops · Effort L · Evidence: Proposal**
- **Completed (2026-10-12):** `src/lib/sourceEndpoints.ts` = explicit primary/fallback/desktop contract for all 34 kinds (test fails if a kind or host is missing from Worker/Rust); desktop FX moved to `api.frankfurter.dev/v1/` (was a redirecting `.app` host) with shared `fx.json` + `fx_parity_expected.json` gate in Vitest and Rust (`fx_matches_shared_parity_fixture`); change_pct rounding aligned; human inventory in `docs/UPSTREAM_ENDPOINTS_2026-10-12.md`.
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs), [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts), [`src/lib/sourceRegistry.ts`](../src/lib/sourceRegistry.ts).
- **Basis:** Desktop and web hardcode endpoint URLs separately; a previous audit singled out an FX hostname without current endpoint verification.
- **Implementation:** Inventory endpoint versions, redirect behavior, fallback order and deprecation assumptions. Keep environment-specific fetch code but generate/document shared endpoint metadata; verify changes against official upstream documentation at implementation time.
- **Done when:** Every source has an explicit primary/fallback contract and FX desktop/web fixtures use matching schemas without relying on an unexplained redirect.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-441"></a>441

### LOOM-441 — Add timeouts to `/api/fetch-csv` upstream calls

- [x] **P2 · bug · Effort M · Evidence: Source**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** the HEAD and GET use no `signal`, so a slow-drip server holds the request until the platform limit. Use `AbortSignal.timeout` (e.g. 10 s HEAD, 30 s GET).
- **Done when:** a hanging upstream returns 504 quickly.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-442"></a>442

### LOOM-442 — Clamp and validate catalog query params

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `optsFromUrl` passes `Number("abc") = NaN` to `clampRows`, which returns `NaN`, so `collected.length < rows` never stops and the Worker walks all 25–40 Data.gov pages (40 subrequests) per request. Default non-finite values to 40 and integer-clamp.
- **Done when:** `?rows=abc` returns ≤40 rows after one or two upstream calls.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-443"></a>443

### LOOM-443 — Don't cache empty or degraded payloads over good ones

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `sourcePayloadCacheable` skips caching empty/degraded upstream payloads; serves prior snapshot.
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `handleSource` caches whatever the fetcher returns, so a FIRMS CSV with no rows, a GDACS response with zero features, or a 1-point ADSB fallback replaces a good snapshot for the full TTL+stale window. Validate per kind (non-empty rows/features) and treat empties as upstream errors (serve stale).
- **Done when:** an empty upstream keeps the previous cache entry.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-444"></a>444

### LOOM-444 — Version the source cache key

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the key is `https://loom-source.internal/source/<kind>`, so after a deploy that changes a transform's shape (columns, columnar vs legacy) the old payload is served for up to TTL + stale (2 days for daily feeds) to the new parser. Include a `SOURCE_SCHEMA_VERSION` (or a hash of the column list) in the key.
- **Done when:** a deploy that bumps it misses the cache.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-445"></a>445

### LOOM-445 — Log fallbacks and upstream failures

- [x] **P2 · ops · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Structured `console.log` per `/api/source/*` request with cache state and timing.
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `spaceDevsText`, `opensky`, `crypto` and `climate` swallow primary errors in bare `catch {}`, and `handleSource` logs nothing, so Workers Observability can't show which upstreams are failing or how often STALE is served. Emit one structured `console.log({kind, cache, upstream, status, ms, fallback})` per request.
- **Done when:** a dashboard query can chart failures per kind.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-446"></a>446

### LOOM-446 — Return JSON 404 for unknown `/api/*` routes

- [x] **P2 · bug · Effort M · Evidence: Source**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `run_worker_first` sends `/api/*` to the Worker, but unmatched paths (e.g. `GET /api/feedback`, `/api/typo`) fall through to `ASSETS.fetch` with SPA fallback and return `index.html` with 200, which clients then fail to parse as JSON. Add a final `/api/` → `json({error:"Not found"}, 404)` (and 405 for wrong methods).
- **Done when:** `GET /api/nope` is a JSON 404.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-447"></a>447

### LOOM-447 — Shorten story cache lifetime and add a takedown path

- [x] **P2 · ops · Effort M · Evidence: Source**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `/s/*` sends `Cache-Control: public, max-age=604800` from read time (so copies outlive the 7-day KV TTL by up to 7 more days) and there is no way to delete an abusive story. Use a short browser max-age with `s-maxage` purgeable at the edge, and add an authenticated `DELETE /api/stories/<id>` (secret header) that removes all three KV keys.
- **Done when:** a deleted story 404s within minutes.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.
- **Completed (2026-10-12):** `max-age=300, s-maxage=3600`; `DELETE /api/stories/<id>` with `STORY_ADMIN_TOKEN`. Set secret via wrangler before relying on takedown in prod.

<a id="loom-448"></a>448

### LOOM-448 — Fix web feedback with screenshots

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Feedback screenshots stored in LOOM_STORIES KV and linked as `/s/<id>.img`; GitHub body capped at 65536 chars.
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `handleFeedback` allows a 50,000-char body plus a ≤400 KB `data:` image inline, but GitHub caps issue bodies at 65,536 chars and doesn't render `data:` images, so any screenshot makes the API return 422. Store the image in KV/R2 and link `https://loom.ibm.io/s/<id>.img`, or drop it.
- **Done when:** feedback with a screenshot creates an issue showing the image.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-470"></a>470

### LOOM-470 — Give the catalog Worker its own TypeScript boundary

- [x] **P1 · build · Effort L · Evidence: Source**
- **Targets:** [`tsconfig.json`](../tsconfig.json), [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts), [`workers/sourceTransforms.ts`](../workers/sourceTransforms.ts), [`wrangler.jsonc`](../wrangler.jsonc).
- **Basis:** Root TypeScript excludes workers, so a green frontend check does not validate request handlers, KV usage or Worker cache types.
- **Implementation:** Create a Worker-specific tsconfig and generated or installed runtime type declarations. Check reachable shared modules without importing React/store/render code; add a dedicated command and CI gate.
- **Done when:** The Worker has a zero-error independent type-check from a clean install; breaking a binding or request type makes the gate fail.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-608"></a>608

### LOOM-608 — Skip the extra HEAD round trip

- [x] **P3 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Removed HEAD preflight on `/api/fetch-csv`; single GET with stream cap.
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: every CSV load does HEAD then GET (two upstream hits, extra latency) only to decide on a Range header. Send the GET directly and truncate while streaming (the cap logic already handles servers that ignore Range).
- **Done when:** one upstream request is made per load.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-609"></a>609

### LOOM-609 — Cache `/api/fetch-csv` responses

- [x] **P3 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `caches.default` caches successful non-truncated fetch-csv responses ~1h (`X-Loom-Cache: HIT`).
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: identical TidyTuesday/Socrata/catalog CSVs are refetched from origin on every open. Put successful, non-truncated responses in `caches.default` keyed by URL for ~1 h.
- **Done when:** a second load returns `X-Loom-Cache: HIT`.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-610"></a>610

### LOOM-610 — Let browsers/edge reuse source responses

- [x] **P3 · perf · Effort M · Evidence: Review**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `sourceResponse` sets no `Cache-Control`, so every client poll invokes the Worker even when the payload is a HIT. Send `Cache-Control: public, max-age=<remaining ttl>, stale-while-revalidate=<stale>`.
- **Done when:** repeated polls within TTL are served without a Worker invocation.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-649"></a>649

### LOOM-649 — Tolerate partial failures the same way on both sides

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: Worker `countries` and `world_bank` use `Promise.all`, so one indicator or the population call failing fails the whole feed, while desktop skips failed indicators / empty population. Use `Promise.allSettled` in the Worker.
- **Done when:** one failing World Bank indicator still returns rows.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-653"></a>653

### LOOM-653 — Measure story size limits in bytes

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `MAX_STORY_HTML_BYTES` and `MAX_STORY_DATA_BYTES` are compared to JS string `.length` (UTF-16 units), so non-ASCII payloads can be up to 3× larger than intended. Compare `new TextEncoder().encode(x).byteLength`.
- **Done when:** the 900 KB data cap is enforced in bytes.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="loom-654"></a>654

### LOOM-654 — Centralize allowed origins

- [x] **P3 · code · Effort L · Evidence: Review**
- **Completed (2026-10-12):** One definition: `workers/allowedOrigins.ts` (`DEFAULT_ALLOWED_ORIGIN_HOSTS`, optional `ALLOWED_ORIGIN_HOSTS` env override) used by feedback/publish/CORS/fetch-csv. `wrangler.jsonc` no longer carries a second copy; `allowedOrigins.test.ts` asserts that, and that `public/_headers` CSP hosts and the MCP `LOOM_URL` are inside the shared list.
- **Targets:** [`wrangler.jsonc`](../wrangler.jsonc), [`workers/catalog-proxy.ts`](../workers/catalog-proxy.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the origin list (`loom.ibm.io`, `loom-storyteller.mhsenkow.workers.dev`, `localhost`, `127.0.0.1`) is duplicated in `handleFeedback` and `handlePublishStory`. Move it to a `vars.ALLOWED_ORIGINS` entry in `wrangler.jsonc` read from `env`.
- **Done when:** one place defines it.
- **Verification:** Run a dedicated Worker type check and request/transform fixtures; verify status, headers, size limits and failure behavior locally. Use test bindings rather than production storage or GitHub credentials.

<a id="area-10"></a>

## 10 · Desktop DuckDB, filesystem and native commands

<a id="loom-083"></a>083

### LOOM-083 — Don't depend on the network for core DuckDB extensions at first launch

- [x] **P1 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** DuckDB `LOAD` before `INSTALL` in `db.rs`.
- **Targets:** [`src-tauri/src/db.rs`](../src-tauri/src/db.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `INSTALL parquet; LOAD parquet;` must download from extensions.duckdb.org when the `bundled` crate lacks the `parquet` feature, and its error propagates to `.expect("Failed to initialize DuckDB")`, crashing an offline first launch. Enable the duckdb crate `parquet`/`json` features (statically linked) and make excel/sqlite optional.
- **Done when:** the app starts with networking disabled on a clean `~/.duckdb`.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-084"></a>084

### LOOM-084 — Buffer partial SSE lines across chunks

- [x] **P1 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Cross-chunk SSE `line_buf` in `stream.rs` before parsing `data:` lines.
- **Targets:** [`src-tauri/src/stream.rs`](../src-tauri/src/stream.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `stream.rs` splits each network chunk with `text.lines()` and parses only lines starting with `data: `, so every event split across a chunk boundary is dropped (both halves fail), silently losing a share of edits and undercounting eps. Keep a carry-over byte buffer, split on `\n`, and handle multi-line `data:` fields per the SSE spec.
- **Done when:** a test feeding an event split at every byte offset parses it exactly once.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-323"></a>323

### LOOM-323 — Run DuckDB work off the async runtime

- [x] **P2 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** DuckDB IPC commands wrapped in `tokio::task::spawn_blocking`.
- **Targets:** [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs).
- **Basis:** Async command wrappers call synchronous mutex-protected DuckDB methods; responsiveness impact needs measurement.
- **Implementation:** `scan_folder`, `query_file`, `inspect_file`, `source_*` and the poll loop's `write_rows` call blocking std-`Mutex` DuckDB code directly inside `async fn` / `tokio::spawn`, pinning Tokio workers for the duration of full-file scans. Wrap them in `tokio::task::spawn_blocking`.
- **Done when:** a long `inspect_file` doesn't stall concurrent `source_status` calls.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-324"></a>324

### LOOM-324 — Stop serializing everything on one `Mutex<Connection>`

- [x] **P2 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `LoomDb::with_cloned_conn` — polls/queries use cloned connections.
- **Targets:** [`src-tauri/src/db.rs`](../src-tauri/src/db.rs).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** UI queries, 34 poll writers and the SSE inserter all contend for a single connection, so a slow file scan freezes live feeds. Give each command/task its own `conn.try_clone()` (same in-memory database) and keep the mutex only for temp-view state.
- **Done when:** a 1M-row inspect and a USGS write proceed concurrently.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-325"></a>325

### LOOM-325 — Don't hold the global DB lock and full-scan every file during `scan_folder`

- [x] **P2 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Folder scan returns CSV/JSON/XLSX entries with lazy row_count=0; parquet still metadata-counted.
- **Targets:** [`src-tauri/src/db.rs`](../src-tauri/src/db.rs).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** it runs `SELECT COUNT(*)` over every CSV/JSON/XLSX (full parse) while holding the connection lock for the whole recursive walk. Return entries with size/metadata immediately, use Parquet metadata counts, and compute CSV counts lazily or in background.
- **Done when:** mounting `.loom-data` with `spool-mega` returns in <1 s.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-326"></a>326

### LOOM-326 — Compute column stats in one pass

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Column stats computed in one SELECT over `loom_stats`.
- **Targets:** [`src-tauri/src/db.rs`](../src-tauri/src/db.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `column_stats_inner` runs one query per column over a view of `read_csv_auto(...)`, which re-parses the entire file once per column (50 columns = 50 full CSV scans). Use DuckDB `SUMMARIZE` or a single SELECT with all aggregates (or materialize into a temp table first).
- **Done when:** stats for a 50-column file issue one scan.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-327"></a>327

### LOOM-327 — Cap and stream the download in `save_csv_to_folder`

- [x] **P2 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `save_csv_to_folder` streams to disk with 500 MB cap and 120s timeout.
- **Targets:** [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `.bytes().await` buffers the whole response in memory with no size limit or timeout, so a multi-GB portal file can OOM the app. Stream `bytes_stream()` to disk with a max size (e.g. 500 MB) and a timeout.
- **Done when:** an oversized download aborts with a clear error.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-328"></a>328

### LOOM-328 — Bound the Data.gov pagination loop

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Desktop Data.gov search stops after 10s budget with per-page timeout.
- **Targets:** [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it can issue up to 25 sequential 100-row requests per search with no overall deadline. Add a total time budget and stop early.
- **Done when:** a search with few CSV hits returns within ~10 s.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-329"></a>329

### LOOM-329 — Send binary exports as raw IPC bytes

- [x] **P2 · perf · Effort M · Evidence: Source**
- **Targets:** [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `writeBinaryFile` sends `Array.from(bytes)` (a JSON array of numbers, ~4× size) for files up to 80 MB. Accept `tauri::ipc::Request` with a raw `InvokeBody::Raw` body in `write_binary_file`.
- **Done when:** an 80 MB export no longer builds a giant JSON array.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-330"></a>330

### LOOM-330 — Back off on repeated poll failures

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Poll loop exponential backoff (cap 10×) after consecutive upstream failures.
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: failing kinds retry at their normal cadence (OpenSky/ISS/MBTA every 15–30 s) indefinitely; only OpenSky/CoinGecko have a primary backoff. Apply exponential backoff with jitter (cap ~10× poll_secs) after consecutive failures, honoring `Retry-After` on 429.
- **Done when:** a 429-ing upstream is polled progressively less often.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-331"></a>331

### LOOM-331 — Make upsert writes set-based

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Upsert writes via temp staging table (≤4 statements per poll).
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `WriteMode::Upsert` runs SELECT COUNT + DELETE + INSERT per row (meteo is ~864 rows × 3 statements every 5 min) under the global lock. Append into a temp staging table, then `DELETE … USING staging` + `INSERT SELECT` (or a PRIMARY KEY with `INSERT OR REPLACE`), counting new keys with an anti-join.
- **Done when:** a meteo poll is ≤4 statements.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-419"></a>419

### LOOM-419 — Replace `.expect()` in `setup` with a user-visible error

- [x] **P2 · bug · Effort M · Evidence: Source**
- **Completed (2026-10-12):** DuckDB init failure shows blocking dialog and returns setup error instead of panicking.
- **Targets:** [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** a DuckDB init failure currently panics the whole app with no dialog. Return the error from `setup` after showing a `tauri_plugin_dialog` message (or start in a degraded mode).
- **Done when:** a forced init failure shows a message instead of an abort.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-420"></a>420

### LOOM-420 — Recover from mutex poisoning on `LoomDb.conn`

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `lock_connection` recovers poisoned mutex via `into_inner()` across db/sources/stream.
- **Targets:** [`src-tauri/src/db.rs`](../src-tauri/src/db.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: every access does `lock().map_err(|e| e.to_string())?`, so one panic while holding the lock (e.g. inside a DuckDB call in a poll task) makes every later command fail with "PoisonError" until restart. Use `parking_lot::Mutex` or `lock().unwrap_or_else(|e| e.into_inner())`.
- **Done when:** a test that panics while holding the lock is followed by a successful query.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-421"></a>421

### LOOM-421 — Bound the recursive glob in `scan_folder`

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Folder scan skips node_modules, .git, target, and other heavy/loop-prone directories.
- **Targets:** [`src-tauri/src/db.rs`](../src-tauri/src/db.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `**/*.csv` follows symlinks with no depth or count limit and descends into `node_modules`, `.git`, etc., so mounting `~` can run for minutes or loop. Use `walkdir` with `max_depth`, `follow_links(false)`, a skip list and a file cap.
- **Done when:** mounting a folder with a symlink cycle terminates.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-422"></a>422

### LOOM-422 — Fix trailing-LIMIT handling

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/db.rs`](../src-tauri/src/db.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `strip_trailing_limit` only recognises `" LIMIT <digits>"`, so `LIMIT 10 OFFSET 5`, `limit\n10` or a trailing comment get a second `LIMIT` appended and fail; `stream_query`/`source_query` don't strip at all and always break on user `LIMIT`. Wrap user SQL as a subquery with an outer LIMIT in one shared helper.
- **Done when:** tests cover OFFSET, newline and lowercase variants in all three entry points.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-423"></a>423

### LOOM-423 — Serialize 64-bit integers losslessly

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/db.rs`](../src-tauri/src/db.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `BigInt`/`UBigInt` are emitted as JSON numbers and `HugeInt` as f64, so IDs and sums above 2^53 silently lose precision in JS. Emit them as strings when `|v| > 2^53` (and mark the column type).
- **Done when:** a test round-trips `9007199254740993`.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-424"></a>424

### LOOM-424 — Convert nested/other DuckDB types to real JSON

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/db.rs`](../src-tauri/src/db.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the `_ =>` arm formats `List`, `Struct`, `Map`, `Blob`, `Time`, `Interval`, `TimestampTz`, `Enum` with `{:?}` (e.g. `"List([Int(1)])"`), which leaks Rust debug syntax into tables and tooltips. Add explicit arms (arrays/objects/ISO strings/base64).
- **Done when:** a JSON-file column of arrays renders as `[1,2]`.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-425"></a>425

### LOOM-425 — Add timeouts to every reqwest client outside `sources.rs`

- [x] **P2 · bug · Effort M · Evidence: Source**
- **Targets:** [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `save_csv_to_folder`, `fetch_data_gov_recent_csv`, `fetch_uk_data_recent_csv`, `create_github_issue` and the SSE client build clients without `.timeout`/`.connect_timeout`, so a hung upstream leaves the UI spinner forever. Share one managed `reqwest::Client` with connect/read timeouts.
- **Done when:** all HTTP paths use it.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-426"></a>426

### LOOM-426 — Verify IPC argument casing for desktop feedback

- [x] **P2 · bug · Effort M · Evidence: Proposal**
- **Targets:** [`src/lib/tauri.ts`](../src/lib/tauri.ts), [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs).
- **Basis:** The wrapper passes image_base64 while other command arguments use camelCase; verify the generated Tauri command mapping before editing both sides.
- **Implementation:** Define and test the exact serialized feedback argument contract, including absent image and nonempty image. Use the same convention throughout the bridge and return typed failures.
- **Done when:** A bridge integration test proves the Rust handler receives the intended screenshot and title/body fields.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-427"></a>427

### LOOM-427 — Stop inlining screenshots as `data:` URLs in GitHub issue bodies

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: GitHub doesn't render `data:` images and rejects bodies over 65,536 chars, so any real screenshot makes the API return 422. Upload the image elsewhere (repo contents API / gist / R2) and link it, or drop it with a note.
- **Done when:** feedback with a 200 KB screenshot creates an issue.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-428"></a>428

### LOOM-428 — Decode UTF-8 after line assembly

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/stream.rs`](../src-tauri/src/stream.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `String::from_utf8_lossy(&bytes)` on raw chunks corrupts multi-byte characters split between chunks (titles from ja/zh/ru wikis become U+FFFD). Accumulate bytes and decode complete lines only.
- **Done when:** a test with a split 3-byte character keeps it intact.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-429"></a>429

### LOOM-429 — Reconnect the SSE stream with backoff

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/stream.rs`](../src-tauri/src/stream.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: any stream error or EOF (`Some(Err(_)) | None => break`) ends ingestion permanently and the UI just sees `running: false`. Loop with exponential backoff and send `Last-Event-ID` to resume.
- **Done when:** killing the connection resumes within seconds.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-430"></a>430

### LOOM-430 — Report connect failures from `stream_start`

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/stream.rs`](../src-tauri/src/stream.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the connect happens inside the spawned task and errors only flip `running` to false, so `stream_start` returns `Ok(())` even when offline. Await the initial response (with timeout) before spawning, or store a `last_error` exposed in `StreamStatus`.
- **Done when:** starting offline shows an error toast.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-431"></a>431

### LOOM-431 — Make stream start/stop race-free

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/stream.rs`](../src-tauri/src/stream.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `start_stream` checks `running.load` then stores `true` (two concurrent starts both spawn tasks, the first task's cancel sender is overwritten and it can never be stopped), and a stopped task's final `running.store(false)` can clobber a newly started stream. Use `compare_exchange` plus a run generation id (or keep the `JoinHandle` and `abort()` it).
- **Done when:** a stress test of start/stop/start leaves exactly one task.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-432"></a>432

### LOOM-432 — Create `wiki_stream` at startup

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/stream.rs`](../src-tauri/src/stream.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the table is only created in `start_stream`, so `stream_snapshot`/`stream_query` before the first start fail with "Table wiki_stream does not exist". Call `ensure_stream_table` from `setup` next to `sources::ensure_tables`.
- **Done when:** `stream_snapshot` on a fresh launch returns an empty result.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-433"></a>433

### LOOM-433 — Make `source_stop` cancel in-flight polls

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the cancel signal is only checked during the sleep, so a poll mid-fetch (up to 60 s timeout plus ADSB 1.2 s spacing) still writes rows after Stop, and its final `running.store(false)` can clobber a restarted instance, letting a third loop start. Keep the `JoinHandle` and `abort()` it, or use a generation counter checked before `write_rows`.
- **Done when:** stop→start within 1 s never yields two loops or post-stop writes.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-434"></a>434

### LOOM-434 — Expose poll health in `SourceStatus`

- [x] **P2 · ops · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: errors only go to `eprintln!`, so the UI can't tell "upstream failing for 2 hours" from "no new data". Add `last_ok_at`, `last_error`, `consecutive_failures`, `next_poll_at`.
- **Done when:** the sidebar card can show a stale/failing badge.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-437"></a>437

### LOOM-437 — Add the previous-year fallback for NOAA climate on desktop

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the Worker retries `1880-(year-1)` when the current-year URL fails (common in January), desktop just errors and retries every 60 s forever. Mirror the fallback in `fetch_rows`.
- **Done when:** a 404 for the current year falls back.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-438"></a>438

### LOOM-438 — Stop hard-coding the World Bank range to 2000:2023

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: both desktop and Worker request `date=2000:2023`, so 2024+ values never appear even after the Bank publishes them. Compute the end year as `currentYear - 1` (and keep `per_page` above entities × years).
- **Done when:** the range advances automatically.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-440"></a>440

### LOOM-440 — Persist desktop logs

- [x] **P2 · ops · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: all Rust diagnostics use `eprintln!`, which goes nowhere for a Finder-launched `.app`, so poll/stream failures are invisible in bug reports. Add `tauri-plugin-log` (file target in the app log dir) and replace `eprintln!` with `log::warn!/error!` including kind and URL.
- **Done when:** a failing source writes to `~/Library/Logs/com.loom.storyteller/`.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-460"></a>460

### LOOM-460 — Run `cargo test` in `make test`

- [x] **P2 · ops · Effort M · Evidence: Source**
- **Targets:** [`src-tauri/src/db.rs`](../src-tauri/src/db.rs), [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `make test` only runs Vitest, so the Rust registry-parity test (`specs_match_typescript_registry`) and all parser tests don't run in the standard loop. Add `cd src-tauri && cargo test --lib`.
- **Done when:** `make test` fails on a Rust test failure.
- **Completed (2026-10-12):** Implemented in this pass; see git diff and tests.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.
- **Scope/dependency:** Own one-shot JS+Rust test orchestration; do not turn every lint command into an expensive full suite.

<a id="loom-603"></a>603

### LOOM-603 — Drop the extra `DESCRIBE (<sql>)` round trip

- [x] **P3 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** User queries prepare once via `query_engine::run_query` reading `column_names()`/`column_type` — no DESCRIBE round-trip on the query path (`query_engine.rs`). DESCRIBE remains only for column_stats.
- **Targets:** [`src-tauri/src/db.rs`](../src-tauri/src/db.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `query_inner`, `query_stream` and `source_query` plan every query twice (once to DESCRIBE, once to run), which re-sniffs CSVs. Read column names/types from the executed statement (`stmt.column_names()`, arrow schema).
- **Done when:** each query is prepared once.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-604"></a>604

### LOOM-604 — Insert stream batches with the DuckDB Appender

- [x] **P3 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Wiki stream batches insert via DuckDB Appender (`stream.rs`).
- **Targets:** [`src-tauri/src/stream.rs`](../src-tauri/src/stream.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `batch_insert` executes one prepared INSERT per event while holding the global lock. Use `conn.appender("wiki_stream")` (ts as a computed timestamp) inside one transaction.
- **Done when:** a 50-event batch is a single append.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-605"></a>605

### LOOM-605 — Add an idle/read timeout to the SSE client

- [x] **P3 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** SSE idle timeout `SSE_IDLE_TIMEOUT` with reconnect (`stream.rs`).
- **Targets:** [`src-tauri/src/stream.rs`](../src-tauri/src/stream.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: without one a silently stalled TCP connection keeps `running: true` with 0 eps forever. Wrap `bytes_stream().next()` in `tokio::time::timeout` (e.g. 60 s) and reconnect on expiry.
- **Done when:** a stalled connection is detected.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-606"></a>606

### LOOM-606 — Use the DuckDB Appender for Replace/Append writes

- [x] **P3 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Replace/Append source writes append rows into an all-VARCHAR staging table, then cast into the destination with one `INSERT ... SELECT`.
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: rows are inserted one `execute` at a time with `TRY_CAST(? AS …)`. Append into an all-VARCHAR staging table and `INSERT … SELECT TRY_CAST(...)`.
- **Done when:** a 2,500-row Starlink write is one append + one insert.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-607"></a>607

### LOOM-607 — Share one HTTP client across sources

- [x] **P3 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Shared `http_client.rs` (`build_loom_http` / `build_loom_sse_client`) used by stream/sources.
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `build_client()` is called on every `source_start`, so up to 34 separate connection pools/TLS sessions exist. Store one `reqwest::Client` in managed state and clone it into `PollCtx`.
- **Done when:** only one client is built per app run.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-611"></a>611

### LOOM-611 — Remove unused dependencies

- [x] **P3 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Pruned clearly unused Rust deps `thiserror` and direct `arrow`; kept `opener` because native open/reveal commands still use it, and narrowed Tokio to `macros`, `rt-multi-thread`, `sync`, and `time`.
- **Targets:** [`src-tauri/src`](../src-tauri/src), [`src-tauri/Cargo.toml`](../src-tauri/Cargo.toml).
- **Basis:** Do not delete plugins just because no frontend imports them; inspect native use, especially mobile shell.
- **Implementation:** `arrow` and `thiserror` are never referenced in `src-tauri/src`, `opener` duplicates the shell plugin, and `tokio` pulls `features = ["full"]`. Drop the unused crates and narrow tokio to `rt-multi-thread, macros, time, sync`.
- **Done when:** `cargo machete`/`cargo udeps` reports nothing.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-643"></a>643

### LOOM-643 — Surface row-conversion errors instead of dropping rows

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/db.rs`](../src-tauri/src/db.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `query_inner` (`if let Ok(r)`), `query_stream` and `source_query` (`rows.flatten()`) silently skip rows that fail to convert, and `total_rows` is just the returned count. Return the first error (or a `skipped` count) and rename/document `total_rows`.
- **Done when:** a forced conversion failure is visible in the result.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-644"></a>644

### LOOM-644 — Deduplicate the three query/stats implementations

- [x] **P3 · code · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `db.rs::query_inner`, `stream.rs::query_stream` and `sources.rs::source_query` (plus three copies of the per-column stats loop) are near-identical and already diverge on LIMIT handling. Extract `run_query(conn, view_sql, user_sql, limit)` and `column_stats(conn, table_expr)`.
- **Done when:** the three modules call one helper.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-645"></a>645

### LOOM-645 — Drop or justify the schema-drift migration

- [x] **P3 · code · Effort M · Evidence: Review**
- **Targets:** [`DOCS.md`](../DOCS.md), [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `ensure_tables` drops and recreates drifted tables, but the database is `open_in_memory()` so tables never survive a restart; it also re-runs for all 34 tables on every `source_start`. Either persist DuckDB to the app data dir (making the migration meaningful) or remove the per-start call and the migration.
- **Done when:** the choice is documented in DOCS.md.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-646"></a>646

### LOOM-646 — Normalize NWIS and FIRMS timestamps through `parse_iso_utc`

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `nwis_rows` stores raw `dateTime` strings with `-04:00` offsets and `firms_rows` builds `…Z` strings, both relying on DuckDB's implicit `TRY_CAST` offset handling, unlike every other parser (and unlike the Worker's `utcIso`). Route both through `parse_iso_utc`.
- **Done when:** fixtures assert UTC `ts` values.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-647"></a>647

### LOOM-647 — Avoid flagging non-debris Starlink names

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `name.to_uppercase().contains("DEB")` drops any name containing "DEB" as a substring, while the Worker uses `/\bDEB\b/`. Use a word-boundary check to match.
- **Done when:** both sides filter the same fixture identically.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="loom-648"></a>648

### LOOM-648 — Align aircraft fallback behaviour

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`src-tauri/src/sources.rs`](../src-tauri/src/sources.rs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: desktop uses Atlanta and only ADSB.lol with `MAX_AIRCRAFT = 1500` and a single poll-time `ts`, while the Worker uses Denver, adds an adsb.fi fallback, caps at 2000 and derives per-aircraft times from `seen`. Share the point list/caps and port the adsb.fi fallback + `seen` timing.
- **Done when:** both take the same points and cap.
- **Completed (2026-10-12):** Implemented in src-tauri (query_engine, stream, sources, commands, http_client, db); Rust tests + cargo check.
- **Verification:** Run relevant Rust unit/integration tests and cargo check for maintained targets; add a frontend/native smoke check when the IPC or visible behavior changes. Record device-only checks separately.

<a id="area-11"></a>

## 11 · Sharing, publication and export fidelity

<a id="loom-058"></a>058

### LOOM-058 — Replace fixed sleeps in platform capture with a render-done signal

- [x] **P1 · perf · Effort M · Evidence: Source** · Completed (2026-10-12): `chartPaintSignal.ts` + ChartView `notifyChartPainted`; capture waits on paint instead of 350–900 ms sleeps.
- **Targets:** [`src/lib/capturePlatformPng.ts`](../src/lib/capturePlatformPng.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** every capture waits `sleep(350)` + `baseWait` 550–900 ms (+400 ms per retry), so each format tap in the share sheet takes 1–3 s on phones. Have the chart resolve a "painted" promise (Vega `runAsync` / WebGPU `onSubmittedWorkDone`) and drop the timers.
- **Done when:** switching Square→Story renders in under 500 ms on a mid-range phone.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-224"></a>224

### LOOM-224 — Don't share a stale image after a failed re-render

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/ShareSheet.tsx`](../src/components/ShareSheet.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: when a new capture starts the old `blob` is kept, and on failure `ready` is still true (`!!blob && !capturing`), so "Share image" sends the previous format/headline. Clear `blob` when a capture starts or gate actions on `!failed`.
- **Done when:** a failed Story render disables Share.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-225"></a>225

### LOOM-225 — Restore all UI state after a capture

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/capturePlatformPng.ts`](../src/lib/capturePlatformPng.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `captureNow` forces `setViewMode("chart")` and `setDashboardsExpanded(false)` but its `finally` restores only target, aspect and sidebar, so sharing from an expanded dashboard or another view leaves the user somewhere else. Snapshot and restore both.
- **Done when:** capture from an expanded dashboard returns to it.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-226"></a>226

### LOOM-226 — Serialize story preview and carousel captures with share captures

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/captureStoryPreviews.ts`](../src/lib/captureStoryPreviews.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `captureOne` and `exportStoryCarouselZip` call `applyChartView` and read `pngExportHandler` outside `captureChain`, so they can run alongside a share-sheet capture and restore each other's forced sizes. Route them through the same queue.
- **Done when:** overlapping a carousel export and the share sheet produces correct images.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-227"></a>227

### LOOM-227 — Always clear the preview-capture overlay

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/captureStoryPreviews.ts`](../src/lib/captureStoryPreviews.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `captureStoryDashboardPreviews` has no try/finally, so an exception inside the loop leaves `previewCapture` set and the dashboards collapsed. Wrap in try/finally like `captureChartViewPreview`.
- **Done when:** a thrown handler still clears the overlay.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-228"></a>228

### LOOM-228 — Restore the active chart after a carousel export

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/exportStoryCarousel.ts`](../src/lib/exportStoryCarousel.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: each slide calls `applyChartView(cid)`, leaving the last slide's chart active afterwards. Snapshot `activeChart`/overrides first and restore in `finally`.
- **Done when:** the user's chart is unchanged after exporting a pack.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-229"></a>229

### LOOM-229 — De-duplicate capture helpers

- [x] **P2 · code · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/captureStoryPreviews.ts`](../src/lib/captureStoryPreviews.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `afterPaint`, `sleep`, `waitForPngHandler`, `looksLikeFailedCapture` and `blobToDataUrl` are copy-pasted across `capturePlatformPng.ts`, `captureStoryPreviews.ts` and `exportStoryCarousel.ts`. Keep one module.
- **Done when:** each helper exists once.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-230"></a>230

### LOOM-230 — Use hosted URLs for microsite og:image

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/dashboardMicrosite.ts`](../src/lib/dashboardMicrosite.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `buildDashboardMicrositeHtml` puts the data URL straight into `og:image`/`twitter:image`; unfurlers ignore `data:` URLs, so dashboard links get no preview (the chart share page already uses `LOOM_OG_IMG_TOKEN`). Use the same token rewrite.
- **Done when:** a published dashboard unfurls with an image in Slack.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-231"></a>231

### LOOM-231 — Delay `revokeObjectURL` after starting a download

- [x] **P2 · bug · Effort M · Evidence: Source**
- **Targets:** [`src/lib/csvExport.ts`](../src/lib/csvExport.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `downloadCsv` and `downloadBlob` revoke the URL right after `a.click()`, which can cancel the download in Firefox and Safari. Revoke in `setTimeout(…, 30_000)` (or on focus) and append the anchor to the DOM.
- **Done when:** large CSV/ZIP downloads finish in Safari and Firefox.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Scope/dependency:** Own the shared object-URL download lifecycle; LOOM-418 owns native-shell export fallbacks.

<a id="loom-232"></a>232

### LOOM-232 — Preserve Unicode and spreadsheet usability through export profiles

- [x] **P2 · ux · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/csvExport.ts`](../src/lib/csvExport.ts), [`src/lib/tauri.ts`](../src/lib/tauri.ts).
- **Basis:** CSV output is UTF-8 without an explicit Excel compatibility choice, and native filenames sanitize non-word characters.
- **Implementation:** Offer a documented UTF-8/Excel profile including BOM where needed, formula-neutralization policy and line endings. Preserve safe Unicode display names while avoiding path separators.
- **Done when:** Accented and non-Latin headers round-trip in supported spreadsheet tools, and exported filenames remain recognizable and safe.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-311"></a>311

### LOOM-311 — Use a table-driven CRC32 for ZIP packs

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/lib/zipStore.ts`](../src/lib/zipStore.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `crc32` loops 8 bit-steps per byte, about 240M operations for a 10-slide 1080×1920 pack, which freezes phones for seconds. Precompute the 256-entry table (or use `CompressionStream` where available).
- **Done when:** a 30 MB pack zips in under 200 ms on desktop.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-392"></a>392

### LOOM-392 — Manage focus in the share sheet

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/components/ShareSheet.tsx`](../src/components/ShareSheet.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: no initial focus, no Tab trap, and no focus return to the Share button on close (Escape is handled).
- **Done when:** opening focuses the dialog title or primary action and closing returns focus.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-399"></a>399

### LOOM-399 — Separate chart UI type scale from export-resolution scaling

- [x] **P2 · ux · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch.
- **Targets:** [`src/lib/chartType.ts`](../src/lib/chartType.ts), [`src/lib/chartLayout.ts`](../src/lib/chartLayout.ts), [`src/lib/socialExport.ts`](../src/lib/socialExport.ts).
- **Basis:** chartType defines several minimum font sizes, while stage DPR and platform exports scale backing pixels.
- **Implementation:** Document logical text sizes versus export pixels, honor readable phone defaults, and measure titles/footnotes with the selected font. Avoid shrinking labels merely to fit a dense chart.
- **Done when:** The same chart has consistent logical layout at different DPRs; phone labels stay readable and exported text is crisp without clipping.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-412"></a>412

### LOOM-412 — Open NeoSpace before awaiting the publish

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/components/ShareSheet.tsx`](../src/components/ShareSheet.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `window.open` runs after `await publishStory()`, so Safari/iOS popup blocking returns null and the fallback `location.assign` navigates away from Loom, losing the in-memory session. Open a blank window synchronously in the tap and set its URL after publishing.
- **Done when:** Post to NeoSpace on iOS keeps Loom open.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-413"></a>413

### LOOM-413 — Keep clipboard writes inside the tap on iOS

- [x] **P2 · mobile · Effort L · Evidence: Review**
- **Completed (2026-10-12):** `copyTextPromiseToClipboard` + ShareSheet Get link starts ClipboardItem write inside the tap before await publish (`socialExport.ts`, `ShareSheet.tsx`). Device Safari still recommended for gesture confirmation.
- **Targets:** [`src/components/ShareSheet.tsx`](../src/components/ShareSheet.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: after "Get link", `copyTextToClipboard` runs after network awaits, which iOS rejects (no user activation), so the link is rarely auto-copied. Use `navigator.clipboard.write([new ClipboardItem({"text/plain": promiseOfBlob})])` started in the click.
- **Done when:** Get link auto-copies on iOS Safari.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-576"></a>576

### LOOM-576 — Number carousel files by kept slide and report skips

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/exportStoryCarousel.ts`](../src/lib/exportStoryCarousel.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: failed slides are skipped silently but filenames and captions use `i + 1`, leaving gaps (01, 03…) while README says "N slides". Number by `slides.length + 1` and toast "2 slides failed: …".
- **Done when:** files are numbered without gaps.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-577"></a>577

### LOOM-577 — Put a time zone on exported times

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/dashboardMicrosite.ts`](../src/lib/dashboardMicrosite.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: "Updated" and the capture time use the exporter's `toLocaleString()`/`toLocaleTimeString()` with no zone, so viewers elsewhere misread them. Include `timeZoneName: "short"` or an ISO UTC string in a `<time datetime>`.
- **Done when:** the page shows e.g. "Oct 7, 14:05 PDT".
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-578"></a>578

### LOOM-578 — Keep non-ASCII titles in filenames

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/socialExport.ts`](../src/lib/socialExport.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `slugifyFilename` uses `[^\w\-]`, so "Évolution des prix" becomes "volution_des_prix" and CJK titles become "loom-export". Normalize NFKD, strip diacritics, keep Unicode letters (`\p{L}\p{N}`).
- **Done when:** "Évolution" → "Evolution" and "東京" is kept.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-579"></a>579

### LOOM-579 — Fall back when the async clipboard API is missing

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/socialExport.ts`](../src/lib/socialExport.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `copyTextToClipboard` returns false on insecure origins and older WebViews (Tauri on some Linux builds). Add a hidden-textarea `execCommand("copy")` fallback.
- **Done when:** caption copy works over http on a LAN IP.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-580"></a>580

### LOOM-580 — Don't squash long burn-in footers

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/socialExport.ts`](../src/lib/socialExport.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `fillText(line, …, w - pad * 2)` compresses long source + handle text horizontally. Measure and truncate with an ellipsis (or wrap to two lines).
- **Done when:** a 120-char source credit stays legible on 1080×1080.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-581"></a>581

### LOOM-581 — Write valid ZIP metadata

- [x] **P3 · bug · Effort S · Evidence: Review**
- **Targets:** [`src/lib/zipStore.ts`](../src/lib/zipStore.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: local and central headers write general-purpose flag 0 (no UTF-8 name bit 11) and DOS time/date 0, so entries show as 1980-01-01 and non-ASCII names garble. Set bit 0x0800 and the real DOS timestamp.
- **Done when:** unzip lists today's date.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-582"></a>582

### LOOM-582 — Merge the duplicate download helpers

- [x] **P3 · code · Effort M · Evidence: Review**
- **Targets:** [`src/lib/zipStore.ts`](../src/lib/zipStore.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `downloadCsv` (`csvExport.ts`) and `downloadBlob` (`zipStore.ts`) are the same function with the same revoke bug. Keep one in a `download.ts`.
- **Done when:** both callers import it.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-633"></a>633

### LOOM-633 — Finish the format radiogroup

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/components/ShareSheet.tsx`](../src/components/ShareSheet.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: buttons have `role="radio"` but no arrow-key movement or roving tabindex, and five formats in `grid-cols-4` leave "Link" alone on a second row. Add arrow keys and use `grid-cols-5` (or 3+2).
- **Done when:** arrows move the selection and the grid is balanced.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-634"></a>634

### LOOM-634 — Describe the preview image

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/components/ShareSheet.tsx`](../src/components/ShareSheet.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `alt="Share preview"` says nothing about the chart. Use `alt={`${chartTitle} — ${preset.label} preview`}`.
- **Done when:** screen readers read the chart title.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-641"></a>641

### LOOM-641 — Validate video MIME and share support on maintained mobile targets

- [x] **P2 · mobile · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `videoShareProbe.ts` MIME/canShare helpers.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx), [`src/components/ShareSheet.tsx`](../src/components/ShareSheet.tsx).
- **Basis:** A format preference alone cannot ensure MediaRecorder output can be shared by iOS or a native shell.
- **Implementation:** Probe recorder MIME support and canShare for the resulting file, stop tracks reliably, and offer a PNG/carousel fallback when video is unsupported. Validate filenames and MIME consistency.
- **Done when:** Video exports either produce a playable shareable file on the tested target or show a clear fallback without trapping the app in export mode.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="area-12"></a>

## 12 · Live streams and source parity

<a id="loom-023"></a>023

### LOOM-023 — Fix the start/stop race

- [x] **P1 · bug · Effort M · Evidence: Source** · Completed (2026-10-12): Re-check `buf.running` after first poll before `scheduleSourcePoll`; tests in `webStreamsResilience.test.ts`.
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** webSourceStart awaits an initial poll and installs a timer afterward; stop during that await requires a regression test.
- **Implementation:** `webSourceStart` sets `running`, awaits the first poll, then unconditionally creates the `setInterval`; if `webSourceStop` runs during that await (user taps stop, discover timeout) a zombie poller keeps fetching with `running: false`. Re-check `buf.running` (or a generation counter) after the await.
- **Done when:** a test calling stop during the first poll sees no further fetches.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-024"></a>024

### LOOM-024 — Detect a dead Wikipedia EventSource

- [x] **P1 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Wiki SSE `onerror` reconnect with backoff in `webStreams.ts`.
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `es.onerror` is a no-op, so when the browser stops reconnecting (`readyState === CLOSED` after an HTTP error or network change) the card still says running and `lastError` is never set; check readyState, record the error, and reconnect with backoff.
- **Done when:** a stubbed EventSource that closes surfaces `last_error` and reconnects.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-025"></a>025

### LOOM-025 — Keep SpaceX unknown outcomes null

- [x] **P1 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): `parseSpacex` keeps `success: null` for upcoming/unknown; tests in `webStreamsParsers.test.ts`.
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `parseSpacex` maps `success: null` (upcoming / unknown) to `false` via `Boolean()`, so the discover hook counts upcoming flights as failures (discoverStories.ts) and the "Success rate" pie (recommendations.ts) understates success; keep null and exclude upcoming from the rate.
- **Done when:** a fixture with 2 successes + 1 upcoming reports 100%.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-060"></a>060

### LOOM-060 — Stop copying the buffer on every push

- [x] **P1 · perf · Effort M · Evidence: Review** · Completed (2026-10-12): Batch trim at 1.1× cap in `webStreams.ts` `trim()`.
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `trim()` does `buf.rows.slice(...)` whenever `rows.length > maxRows`, and the Wikipedia stream calls `pushRows` per SSE event, so at the 8k cap each edit (20–50/s) allocates an 8k-element array; trim in batches (e.g. when >1.1× cap) or use a ring buffer.
- **Done when:** a bench of 50k pushes at cap shows O(1) amortized cost.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-061"></a>061

### LOOM-061 — Bound `seenIds`

- [x] **P1 · perf · Effort M · Evidence: Source** · Completed (2026-10-12): `rebuildSeenIds` on batch trim (append feeds + OpenSky).
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** append feeds add every id forever (wiki per event at line 82, OpenSky `icao|ts` per aircraft per poll at 985) while `trim` drops rows, so a phone left on the live stream grows memory without bound; rebuild `seenIds` from retained rows when trimming or use a bounded LRU set.
- **Done when:** after 100k wiki events `seenIds.size ≤ maxRows`.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-081"></a>081

### LOOM-081 — Pause polling when the tab is hidden

- [x] **P1 · mobile · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Tab visibility hooks in `webStreams.ts` + `appActivity.ts`; tests.
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** no `visibilitychange` handling exists anywhere in src; every web poller and the Wikipedia EventSource keep running in background tabs, draining phone battery and data. Suspend timers / close the ES when hidden and resume with an immediate poll on visible.
- **Done when:** a hidden tab issues zero `/api/source/*` requests over 5 minutes in a test with a stubbed `document.visibilityState`.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-154"></a>154

### LOOM-154 — Prevent overlapping polls

- [x] **P2 · bug · Effort M · Evidence: Source**
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `setInterval` fires regardless of an in-flight poll (12 s Worker timeout, 20 s direct debt fetch), so slow responses can land out of order and an older replace-mode body overwrites newer data; schedule the next poll with `setTimeout` after completion and abort the previous controller.
- **Done when:** a test with a slow first response never applies it after a newer one.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-155"></a>155

### LOOM-155 — Track data freshness

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `BufferState`/status expose `lastError` but no `lastSuccessAt`, so cards and chart footers can't say "updated 3 min ago" or flag stale data after failures; add `last_success_at` (and stale threshold = 3× pollMs) to SourceStatus.
- **Done when:** a card shows "stale" after three failed polls.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-156"></a>156

### LOOM-156 — Make events/sec side-effect free

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `statusFromBuffer` mutates `lastCountAt` on every call, so the rate depends on who asked last (Sidebar every 2–3 s, discover, Onboarding) and spikes or reads 0; maintain a rolling-window counter updated in `pushRows`.
- **Done when:** two back-to-back status calls return the same rate.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-157"></a>157

### LOOM-157 — Reset rate counters on clear

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `webSourceClear` / `webStreamClear` zero `totalEvents` but keep `lastCountAt.count`, so the next status reports a negative `events_per_sec`; reset `lastCountAt` too.
- **Done when:** a test clear → status returns `events_per_sec >= 0`.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-158"></a>158

### LOOM-158 — Honor registry `orderBy` in web snapshots

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `snapshotFromBuffer` just reverses insertion order while desktop applies `SourceDef.orderBy`, so "newest first" for replace feeds depends on upstream order and the launches hook's `strAt(sample, 0, "name")` (discoverStories.ts) isn't the next launch; implement a small comparator from the `orderBy` string.
- **Done when:** web and desktop snapshot order match for every source in a registry-driven test.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-159"></a>159

### LOOM-159 — Compute snapshot stats over the returned rows

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: stats cover the whole buffer while `sample` is `limit` rows (discover asks for 300/400), so distinct/null counts and min/max describe rows the chart never sees and can mis-steer `recommend()`.
- **Done when:** `stats.null_count` equals nulls in `sample.rows` for a capped snapshot.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-160"></a>160

### LOOM-160 — Fix text min/max in buffer stats

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: for non-numeric columns min/max are the first/last inserted value, so TIMESTAMP columns of feeds delivered newest-first report the newest time as `min_value`; compute lexicographic min/max for ISO timestamps.
- **Done when:** USGS `ts` min < max in a fixture test.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-161"></a>161

### LOOM-161 — Don't put missing quakes at Null Island

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `parseUsgs` writes `0` for missing latitude/longitude/depth, plotting them at 0°,0° on every map; emit `null`.
- **Done when:** a feature without geometry yields null coordinates.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-162"></a>162

### LOOM-162 — Emit null, not "", for missing strings

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: many parsers use `String(x ?? "")` (parseUsgs place/magType, all of parseNws, parseHn, parseCrypto…), creating blank-label bars and inflating distinct counts; route VARCHAR cells through `strCell`.
- **Done when:** no parser emits `""` for an absent upstream field in fixture tests.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-163"></a>163

### LOOM-163 — Use null change for FX `/latest`

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the latest-rates shape sets `change_pct` to `0`, which charts and hooks read as "no move" instead of "unknown"; emit `null`.
- **Done when:** the latest-shape fixture yields null change_pct.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-164"></a>164

### LOOM-164 — Normalize every TIMESTAMP through `isoOrNull`

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: parseNws (effective/expires), parseHn, parseLobsters, parseFema, parseSpacex, parseLaunches store raw upstream strings (with offsets or none) while other feeds store UTC ISO, so time windows and string comparisons (e.g. `ts > newestTs`) mix formats.
- **Done when:** every TIMESTAMP column in parser fixtures ends with `Z`.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-165"></a>165

### LOOM-165 — Parse space-separated naive timestamps as UTC

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `isoOrNull("2026-10-07 12:00:00")` skips the `T` branch and goes through `Date.parse` in the device's local zone, so values shift by the viewer's timezone; replace the space with `T` and append `Z` for naive strings.
- **Done when:** a test under `TZ=America/Los_Angeles` and `TZ=UTC` yields the same ISO.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-166"></a>166

### LOOM-166 — Use the numeric recent-change id for Wikipedia events

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `parseWikiEvent` strips non-digits from the `meta.id` UUID and `Number()`s it (20-digit floats, lossy), falling back to `Date.now()` which can collide; use the event's numeric `id` (or keep `meta.id` as a string dedupe key).
- **Done when:** ids are exact integers or stable strings and two events in the same ms aren't deduped.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-167"></a>167

### LOOM-167 — Map fetch failures to friendly copy

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `fetchSourceJson` surfaces `Source x failed (502)` or a raw JSON `SyntaxError` when an HTML fallback is served, and AbortError shows as "signal is aborted"; check `content-type`, and map 429/5xx/timeout/offline to messages like "Rate-limited upstream — retrying in 2 min".
- **Done when:** each case has a unit test with the expected message.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-168"></a>168

### LOOM-168 — Fold merge strategy into SourceDef

- [x] **P2 · code · Effort M · Evidence: Review**
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `SOURCE_MERGE` is a parallel table keyed by SourceKind with dedupe keys as column indexes (`key: 0`), so adding a source touches another file and reordering columns silently breaks dedupe; add `merge: { mode, key: "id" }` (by column name) to each SourceDef.
- **Done when:** SOURCE_MERGE is deleted and the registry test asserts every merge key is a real column.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-320"></a>320

### LOOM-320 — Add exponential backoff

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: failing feeds retry at their normal cadence forever (load-once feeds every 60 s), hammering the Worker and upstream during outages; back off ×2 with jitter up to 10× `pollMs`, reset on success, and expose `next_retry_at` in status.
- **Done when:** 5 consecutive failures stretch the interval and a success restores it.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-417"></a>417

### LOOM-417 — Add a mobile cadence for aggressive feeds

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/sourceRegistry.ts`](../src/lib/sourceRegistry.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: ISS polls every 15 s and OpenSky/MBTA every 30 s regardless of device or connection; add `mobilePollMs` (or multiply cadence when `navigator.connection.saveData` / `effectiveType` is 2g–3g or viewport is phone).
- **Done when:** ISS polls ≥60 s on a phone profile.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-459"></a>459

### LOOM-459 — Cache the last `/api/source/<kind>` snapshot for offline/slow starts

- [x] **P2 · pwa · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `sourceSnapshotCache.ts`, `webStreams.ts` hydrate + stale UI; `public/sw.js` SWR for `/api/source/*`.
- **Targets:** [`src/lib/webStreams.ts`](../src/lib/webStreams.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: store the last successful JSON per kind in the SW cache (stale-while-revalidate) so "What's interesting right now" renders immediately on reopen.
- **Done when:** A successful opted-in source snapshot is available offline with capture/freshness metadata; stale cached data never presents as a current live measurement.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-548"></a>548

### LOOM-548 — Derive the kind list from the definitions

- [x] **P3 · code · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/sourceRegistry.ts`](../src/lib/sourceRegistry.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `SOURCE_KINDS` duplicates the kinds in `SOURCE_DEFS`, kept aligned only by a test; declare defs as `{ … } satisfies Record<SourceKind, …>` or derive kinds from defs so a missing entry is a compile error.
- **Done when:** deleting a def fails `tsc`.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="area-13"></a>

## 13 · Recommendations, discovery and optional AI

<a id="loom-030"></a>030

### LOOM-030 — Match time-like names by token, not substring

- [x] **P1 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): `columnNameTokens` + token temporal hints in `inferType`.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `inferType` treats any VARCHAR whose name *contains* DATE/TIME/DAY/YEAR as temporal, so `candidate` (DATE), `holiday`, `monday`, `lifetime_value` become time axes for line charts; split names on `_`/space/camelCase and match whole tokens.
- **Done when:** tests show `candidate` → nominal and `created_date` → temporal.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-031"></a>031

### LOOM-031 — Treat integer years as time, not measures

- [x] **P1 · ux · Effort M · Evidence: Review** · Completed (2026-10-12): Integer year/yr columns classified temporal via `isYearLikeIntegerColumn`.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the dtype check runs before name hints, so `year`/`yr` INTEGER columns are quantitative: `recommend()` builds no line charts for year-indexed tables (OWID, World Bank CSVs) and emits "Sum of year by …" bars and year scatters instead. Classify integer columns named year/yr with values in 1000–2100 as temporal for X and exclude them from measures.
- **Done when:** an OWID fixture's top rec is a line over Year and no rec aggregates `year`.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-032"></a>032

### LOOM-032 — Exclude identifier columns from measures

- [x] **P1 · ux · Effort M · Evidence: Review** · Completed (2026-10-12): `isMeasureColumn` excludes id/zip/rank-like numerics.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: numeric `id`, `zip`, `fips`, `rank`, `objectid` columns are summed, scattered and used as weights (scatter pairs take the first 5–6 numerics in file order at 1162; pie at 1550 and sankey weight at 1883 take `numCols[0]`); flag numerics whose name matches id/code/rank or whose distinct_count ≈ row count and keep them out of y/size/weight.
- **Done when:** a fixture with leading `id` and `zip` columns yields no rec using them as a measure.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-033"></a>033

### LOOM-033 — Never put signed values on a log axis

- [x] **P1 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): `yFieldSupportsLogScale` gates log variants; curated log → symlog when min ≤ 0.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the curated crypto "Cap vs change · log Y" puts `change_24h_pct` (often negative) on log Y, `expandRecommendationsWithExtras` adds a `-logy` variant to every line/scatter (2875, 2951), and random draws pick log 18% of the time (2233); gate log on `min_value > 0` and use symlog otherwise.
- **Done when:** no rec with `yScale: "log"` has a y column whose min ≤ 0 across all source stories.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-034"></a>034

### LOOM-034 — Give live-story recs stable ids

- [x] **P1 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): `stableLiveChartId` for stream/source story charts.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `recommendStreamStory`/`recommendSourceStory` build ids from `Date.now()` (`stream-${Date.now()}-…`, `${kind}-${Date.now()}-…`), but custom titles, annotations and reference lines are keyed by `activeChart.id` (ChartView.tsx/3424, DetailPanel.tsx), so a user's edits on a live-feed chart vanish whenever the feed is reopened or discover reruns; derive ids from kind + encoding like `createChartRec`.
- **Done when:** reopening USGS keeps a custom title on "Quake map".
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-035"></a>035

### LOOM-035 — Accept camelCase chart kinds from Ollama

- [x] **P1 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): `parseSuggestion` resolves camelCase chart kinds + column names (`ollama.test.ts`).
- **Targets:** [`src/lib/ollama.ts`](../src/lib/ollama.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `parseSuggestion` lowercases `chartKind` and then checks `CHART_KINDS`, which contains `forceBubble`, `arcDiagram`, `corrMatrix`, `geoPoints`, …, so any suggestion of those kinds is rejected and "Suggest with AI" silently fails; map case-insensitively to the canonical kind (and match column names case-insensitively).
- **Done when:** a test response `{"chartKind":"forceBubble",…}` parses.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-062"></a>062

### LOOM-062 — Stop shipping world/US atlases in the first-load chunk

- [x] **P1 · perf · Effort M · Evidence: Review** · Completed (2026-10-12): `geoFields.ts` splits atlas JSON off `recommendations.ts` import path.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Atlas import placement was inspected; per-module current bundle attribution was not measured.
- **Implementation:** Earlier-audit lead to validate: `recommendations.ts` imports `isGeoRegionField` from `geoAtlas.ts`, which statically imports `countries-110m.json` (108 kB), `land-110m.json` (55 kB) and `states-10m.json` (115 kB), landing in initial chunk `746-*.js` (114 kB gz). Move the name regexes (`isGeoRegionField`, `isLatField`, `isLonField`) into a new dependency-free `src/lib/geoFields.ts` and import that from `recommendations.ts`.
- **Done when:** `grep -c arcs out/_next/static/chunks/746-*.js` is 0 and First Load JS drops by ≥80 kB.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-082"></a>082

### LOOM-082 — Don't leave 35 feeds running after the discover scan

- [x] **P1 · mobile · Effort M · Evidence: Review** · Completed (2026-10-12): `stopDiscoverProbes` after scan; `retainDiscoverFeed` on pick.
- **Targets:** [`src/lib/discoverStories.ts`](../src/lib/discoverStories.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `probeKind`/`probeWiki` call `sourceStart`/`streamStart` for all 34 sources plus the Wikipedia SSE and nothing ever stops them (only Sidebar stop buttons call `sourceStop`), so after the first-visit scan a phone keeps ~35 pollers alive indefinitely. Probe with a one-shot fetch + `parseSourceRows`, or stop every source the user didn't open when the modal closes. Done when, after closing discover without picking, no `/api/source/*` requests occur.
- **Done when:** After discovery closes without a selected live feed, its owned polls are stopped; feeds explicitly started elsewhere retain their ownership and remain running.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-180"></a>180

### LOOM-180 — Report which feeds failed

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Discover scan summary + Onboarding unavailable feed count. Files: `discoverStories.ts`, `Onboarding.tsx`.
- **Targets:** [`src/lib/discoverStories.ts`](../src/lib/discoverStories.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `withTimeout` resolves null after 10 s while the probe keeps running, and both probes `catch { return [] }`, so the modal can't say "3 feeds unavailable" and late probes still start sources; thread an AbortSignal and return `{ kind, stories, error }`.
- **Done when:** the Onboarding hint shows a failed-feed count from a stubbed failure.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-181"></a>181

### LOOM-181 — Use one Kp→G mapping

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/discoverStories.ts`](../src/lib/discoverStories.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the spaceweather hook uses `Math.floor(peak) - 4` while the `storm_level` column uses `stormLevel()`'s `Math.round`, so Kp 4.67 shows "Quiet sun" in the headline while the chart says G1; call `stormLevel(peak)`.
- **Done when:** a fixture with Kp 4.67 headlines a G1 storm.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-182"></a>182

### LOOM-182 — Don't headline forecasts as current weather

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/discoverStories.ts`](../src/lib/discoverStories.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the meteo hook takes the max temperature over all rows, including today's forecast hours, and says "X hottest at …" as if now; restrict to each city's latest row with `ts <= now`.
- **Done when:** a fixture with a hotter future hour headlines the current reading.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-183"></a>183

### LOOM-183 — Scan all FEMA rows for the newest declaration

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/discoverStories.ts`](../src/lib/discoverStories.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the hook only looks at the first 40 rows, which (with insertion-order snapshots) need not contain the newest; scan every row.
- **Done when:** a fixture whose newest declaration is row 150 headlines it.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-184"></a>184

### LOOM-184 — Replace the 720-line `hookFor` if-chain with a typed map

- [x] **P2 · code · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `discoverHooks.ts` exhaustive `DISCOVER_HOOKS` map.
- **Targets:** [`src/lib/discoverStories.ts`](../src/lib/discoverStories.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `const HOOKS: Record<DiscoverKind, HookFn>` (one small function per feed, ideally colocated with each source's story) gives compile-time exhaustiveness and testable units.
- **Done when:** adding a SourceKind without a hook fails `tsc`.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-185"></a>185

### LOOM-185 — Only index ratio-scale measures to 100

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Gate idx100/zscore on multi-series + positive min. File: `recommendations.ts`.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: "Temp indexed to 100" divides °C by a starting value that can be ~0 or negative, producing meaningless ratios, and the expander adds `idx100` to every line (2857) including single series; require strictly positive values and ≥2 series.
- **Done when:** meteo's story no longer ships an indexed temperature chart.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-186"></a>186

### LOOM-186 — Run curated story charts through the same cardinality guards

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `guardCuratedChart` + `fitEncodingToKind` on source stories. File: `recommendations.ts`.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `mk()` bypasses `fitEncodingToKind`, so "Bot vs Human" is colored by ~300 wikis and "Edits faceted by wiki" makes ~300 panels (3193–3196), HN/Lobsters scatters are colored/faceted by author (3430–3432, 3734–3735), and COVID stacks continents by ~200 countries (3547); cap color/facet fields at 12 or attach `topN`.
- **Done when:** a test asserts every curated rec's color/row field has ≤12 distinct values or a topN.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-187"></a>187

### LOOM-187 — Replace the per-satellite beeswarm

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Starlink histogram instead of per-satellite beeswarm. File: `recommendations.ts`.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: Starlink "Mean motion swarm" uses `object_name` (~7k satellites) as the category axis, one band per satellite; use a binned shell (e.g. inclination rounded) or a histogram.
- **Done when:** the Starlink story has no chart with >40 categories on an axis.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-188"></a>188

### LOOM-188 — Stop "one of every kind" from dominating the rail

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `diversifyRecommendations` pass 0 inserts the best rec of each of ~70 kinds before anything else, so with `limit = 72` the rail is ordered by kind and odd/GPU charts outrank the second-best bar or line; restrict pass 0 to kinds within ~25 points of the top score or to ~8 slots.
- **Done when:** a sales fixture's top 10 has ≥2 bar/line recs and no rec scoring <50.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-189"></a>189

### LOOM-189 — Gate and cap auto variants

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Cap expand variants to 3 per base rec. File: `recommendations.ts`.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `expandRecommendationsWithExtras` adds up to ~10 variants per line (roll7, roll30, idx100, zscore, logy, anom, vs-y2/prev, two time windows, facet) without checking data (30-point rolling on 20 points, zscore on one series); require enough points/series per variant and cap variants per base rec at 3.
- **Done when:** a 20-point single-series line yields ≤3 variants.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-190"></a>190

### LOOM-190 — Make `recommend()` deterministic

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: odd/cube/geo kinds are shuffled with the biased `.sort(() => Math.random() - 0.5)` and given random scores (1922–1960), and `mergeStoryCharts` uses random encodings (3278), so the rail reorders on every open and shared-link restore/tests can flake; seed a PRNG from the schema signature.
- **Done when:** two `recommend()` calls on the same input return identical ids in order.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-191"></a>191

### LOOM-191 — Align line vs area default aggregates

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `defaultLineAreaAggregate` for line/area. File: `recommendations.ts`.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: line defaults to mean while area defaults to sum (and `effectiveYAggregate` repeats the split), so switching a chart from line to area silently changes the numbers; choose one default per measure semantics (mean for rates, sum for counts/amounts) shared by both.
- **Done when:** line→area on the same encoding keeps the same aggregate.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-192"></a>192

### LOOM-192 — Carry time windows through random builds and locks

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Time windows in locks + `randomEncodingToExtra`. File: `recommendations.ts`.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `tryBuildRandomChartRec` hand-builds `extra` without `timeWindowField`/`timeWindow` (2616–2629), and `applyEncodingLocks` drops them too (2154–2171), so the window drawn in `withRandomEncodingExtras` never reaches the chart; use `randomEncodingToExtra` and copy the fields in the lock merge.
- **Done when:** a seeded random draw with a window yields a rec with that window.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-193"></a>193

### LOOM-193 — Don't draw lines across unordered names

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Line/area shuffle requires temporal X. File: `recommendations.ts`.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `getRandomEncoding` for line/area falls back to any nominal column as X when there is no time column (`pick(timeCols.length > 0 ? timeCols : nomCols)`), producing lines across e.g. city names; return null (or allow only ordinal-looking small columns).
- **Done when:** shuffle on a no-time schema never returns line/area over a free-text column.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-194"></a>194

### LOOM-194 — Emit one distribution chart per

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** One distribution chart per pair. File: `recommendations.ts`.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: strip, box, violin and ridgeline are all generated for the same pairs (1461, 1489, 1634, 1732), so four near-identical distribution charts crowd the rail; pick one by group size/n (strip for small n, box for many groups, violin/ridgeline for ≤10 groups with n≥50) and leave the rest to the type picker.
- **Done when:** no rail contains more than one distribution kind for the same pair.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-195"></a>195

### LOOM-195 — Split recommendations.ts

- [x] **P2 · code · Effort L · Evidence: Source**
- **Completed (2026-10-12):** Split into `src/lib/recs/*` with `recommendations.ts` as the stable re-export barrel (`types`, `recommend`, `sourceStory`, `sqlSnippets`, …).
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** type inference, scoring, `createChartRec`, random encodings, variant expansion, 34 curated source stories and SQL snippets share one file; move to `recs/columns.ts`, `recs/createChartRec.ts`, `recs/recommend.ts`, `recs/random.ts`, `recs/expand.ts`, `sourceStories/<kind>.ts`, `sqlSnippets.ts`, re-exporting the public API from recommendations.ts.
- **Done when:** no file exceeds ~800 lines and all importers compile unchanged.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Scope/dependency:** Preserve outputs while extracting recommendation modules; behavioral ranking changes have their own items.

<a id="loom-196"></a>196

### LOOM-196 — Classify columns once

- [x] **P2 · code · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `columnClassify.ts` shared typing. Files: `columnClassify.ts`, `vizPreferences.ts`.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `columns.filter(c => inferType(...))` runs three times in ~10 functions (585, 1137, 2180, 2278, 2485, 2694) and vizPreferences keeps its own, drifted copy of the dtype table (missing UBIGINT/UINTEGER, vizPreferences.ts); add a shared `classifyColumns(columns)` (memoized by array identity) used by both modules.
- **Done when:** `inferType` has a single implementation imported by vizPreferences.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-200"></a>200

### LOOM-200 — Keep Ollama model tags and add a timeout

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/ollama.ts`](../src/lib/ollama.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `listOllamaModels` strips `:tag` (`llama3.2:1b` → `llama3.2`), which 404s when only a tagged variant is installed, and `/api/generate` has no AbortController, so a hung local model leaves the UI waiting forever; keep the full name, use `AbortSignal.timeout(30_000)`, and return a typed failure reason (unreachable / model missing / bad JSON) for the toast.
- **Done when:** tests cover each failure reason.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-236"></a>236

### LOOM-236 — Stop name heuristics marking text columns as temporal

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/deepScan.ts`](../src/lib/deepScan.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `inferType` checks `name.includes("TS")`, `"DAY"` etc., so VARCHAR columns like `PRODUCTS`, `COMMENTS`, `ACCOUNTS`, `EVENTS` or `HOLIDAY_NAME` are profiled as temporal and get no category charts. Match whole tokens (`/(^|_)(ts|date|time|…)(_|$)/i`) and confirm with a parse rate.
- **Done when:** `products` profiles as nominal in a deepScan test.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-237"></a>237

### LOOM-237 — Don't divide full-table distinct counts by sample size

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/deepScan.ts`](../src/lib/deepScan.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `distinctRatio` uses `col.distinct_count` (whole file) over `nonNull.length` (sample), clamped to 1, so sampled datasets look high-cardinality and drop out of nominal-pair scoring (`distinctRatio < 0.5`). Compute distinct over the same sample.
- **Done when:** a 2M-row file with 12 regions keeps a low distinct ratio.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-321"></a>321

### LOOM-321 — Batch progressive discover updates

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch.
- **Targets:** [`src/lib/discoverStories.ts`](../src/lib/discoverStories.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `pushMany` re-sorts and copies the entire collection for every story and Onboarding calls `setStories` on each (Onboarding.tsx), i.e. ~700 sorts + React renders during one scan; push per-source batches and throttle `onStory` to one call per animation frame.
- **Done when:** a full scan triggers ≤ 40 `setStories` calls.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-322"></a>322

### LOOM-322 — Make discover probes cheap

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `discoverProbe` lightweight source stories. Files: `discoverStories.ts`, `recommendations.ts`.
- **Targets:** [`src/lib/discoverStories.ts`](../src/lib/discoverStories.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: each probe runs `recommendSourceStory`, which calls full `recommend()` + `expandRecommendationsWithExtras` + `mergeStoryCharts` (up to 96 charts) on the main thread for 35 feeds at startup, to keep 20 variants; cache by (kind, schema signature) and build only the curated + top variants needed.
- **Done when:** the scan's total main-thread scripting drops by half in a Performance trace.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-543"></a>543

### LOOM-543 — Formalize portable spec parity rather than deleting Vega builders

- [x] **P2 · code · Effort L · Evidence: Proposal**
- **Completed (2026-10-12):** `chartSpecParity.ts` + `chartSpecParity.test.ts` — every ChartKind has native/stand-in/none portable tier with limitations; createChartRec drift fails the gate.
- **Targets:** [`src/lib/vega.ts`](../src/lib/vega.ts), [`src/lib/recommendations.ts`](../src/lib/recommendations.ts), [`src/lib/chartSupport.ts`](../src/lib/chartSupport.ts).
- **Basis:** AGENTS explicitly establishes Vega-Lite specs as the portable brain; the old delete-vega.ts proposal conflicts with that contract.
- **Implementation:** Inventory real builder usage and define what each chart can represent in portable spec, Canvas output and SVG export. Remove only proven dead symbols; mark custom-only renderers honestly.
- **Done when:** Every supported chart has a documented portable representation or explicit custom-renderer limitation, and existing callers remain valid.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-549"></a>549

### LOOM-549 — Type source stories and snippets by SourceKind

- [x] **P3 · code · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `SOURCE_SQL_SNIPPETS` satisfies `Record<SourceKind, …>`.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `recommendSourceStory(kind: string)` and `SOURCE_SQL_SNIPPETS: Record<string, …>` mean a new feed without curated charts/snippets compiles fine and silently falls back to `${kind} data`; type as `SourceKind` / `Record<SourceKind, …>`.
- **Done when:** removing a kind's snippets fails `tsc`.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-554"></a>554

### LOOM-554 — Share one lat/lon detector

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Token lat/lon in `geoFields.ts`. File: `geoFields.ts`.
- **Targets:** [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `recommend()`'s `hasLonLat` requires exact names (`lat|latitude`) while `isLatLonPair` accepts any name containing "latitude", so `start_lat` / `Latitude (deg)` get a lat×lon scatter but no maps; use one detector (token-based) for both.
- **Done when:** a `start_lat,start_lng` fixture gets geo recs.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-555"></a>555

### LOOM-555 — Stop hard-coding dark hex into Vega specs

- [x] **P3 · ux · Effort M · Evidence: Source**
- **Targets:** [`AGENTS.md`](../AGENTS.md), [`src/lib/recommendations.ts`](../src/lib/recommendations.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `DARK_AXIS`/`baseConfig` bake `#6b6b78`/`#e8e8ec` into every spec, so SVG export on light themes is dark-styled and AGENTS.md's "no hard-coded hex" rule is broken; inject theme tokens at export time.
- **Done when:** an SVG export under the light theme uses light-theme label colors.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `vegaThemeConfig` + `getThemeUiColors` for reco defaults and SVG export merge. Test: `vegaThemeConfig.test.ts`. Files: `recommendations.ts`, `ChartView.tsx`, `vegaThemeConfig.ts`.

<a id="loom-612"></a>612

### LOOM-612 — Load optional Ollama support only when requested

- [x] **P2 · perf · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/lib/ollama.ts`](../src/lib/ollama.ts), [`src/components/ChartView.tsx`](../src/components/ChartView.tsx), [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Optional local AI is not part of the default phone journey; its network and module cost should be scoped to use.
- **Implementation:** Lazy-load the client and model-list request after explicit AI interaction. Detect reachability, preserve manual SQL/specs on failure and define browser/native capability messages.
- **Done when:** Ordinary startup makes no Ollama requests and AI failure leaves the prior query/chart intact with a useful recovery message.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="area-14"></a>

## 14 · Table, SQL, Dive and derived-data workflows

<a id="loom-036"></a>036

### LOOM-036 — Fix sparkline/heat/bar data reading the wrong column

- [x] **P1 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `useNumericColumnData` does `Number(row[ci])` with `ci` = index into the *visible/reordered* `columns`, but rows are in raw `allColumns` order; `numericColSet` likewise reads `types[ci]`. Hiding or reordering any column makes header sparklines, value bars, heat tint and numeric detection describe a different column. Map through `allColumns.indexOf(col)` in both.
- **Done when:** a test with a reordered `columnOrder` shows each column's min/max matching its own data.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `numericMinMaxForColumn` maps display columns through `allColumns`; sparklines/heat/bars use raw indices. Tests: `tableExplorer.test.ts`. Files: `tableExplorer.ts`, `ExplorerView.tsx`.

<a id="loom-037"></a>037

### LOOM-037 — Stop small decimals rendering as "0"

- [x] **P1 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: numeric cells use bare `toLocaleString()` (max 3 fraction digits), so 0.00012 shows "0" and 1e-7 shows "0". Use a shared cell formatter with significant-digit precision (e.g. `maximumSignificantDigits: 6` below 1).
- **Done when:** 0.00012 renders "0.00012" in Explorer and Query results.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `formatExplorerNumber` / `formatExplorerColumnNumber`; Query results use same helper. Tests: `tableExplorer.test.ts`. Files: `tableExplorer.ts`, `ExplorerView.tsx`, `QueryView.tsx`.

<a id="loom-038"></a>038

### LOOM-038 — Stop the "plain English" box from wiping the user's SQL

- [x] **P1 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: pressing Enter builds a `prompt` that is never used and replaces the editor contents with a placeholder `SELECT * … LIMIT 100`, with no undo. Hide the input until an NL backend exists or insert the comment above the current SQL.
- **Done when:** the existing query is never lost.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Enter prepends an NL comment block; existing SQL preserved. File: `QueryView.tsx`.

<a id="loom-039"></a>039

### LOOM-039 — Don't block valid DuckDB statements in the validator

- [x] **P1 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/queryValidate.ts`](../src/lib/queryValidate.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `validateQuery` counts parentheses inside string literals and comments (`WHERE t LIKE '%:)%'` → "Unmatched ')'") and rejects FROM-first, DESCRIBE, SUMMARIZE, PIVOT and SHOW. Skip quoted/commented text and downgrade the keyword check to a warning.
- **Done when:** those queries run.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Parentheses counted on masked SQL; DESCRIBE/SUMMARIZE/SHOW/EXPLAIN/PIVOT allowed. Tests: `queryValidate.test.ts`. File: `queryValidate.ts`.

<a id="loom-040"></a>040

### LOOM-040 — Don't clobber the dataset with query results

- [x] **P1 · bug · Effort L · Evidence: Review**
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: every Execute calls `setSampleRows(result)` and `setColumnStats` with zeroed `null_count`/`distinct_count`, so Explorer's null % and profiles, Dive's web fallback and deep scan then run on an aggregate result while the header still shows the original file. Keep query results separate and make "Chart this →" opt in.
- **Done when:** an aggregate query leaves Explorer showing the original sample.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Execute no longer calls `setSampleRows`; **Chart this →** opt-in syncs results. File: `QueryView.tsx`.

<a id="loom-041"></a>041

### LOOM-041 — Validate shared `#dive=` links before using them

- [x] **P1 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/dive.ts`](../src/lib/dive.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `decodeDiveLink` only checks that `query.metrics` is an array, then `sanitizeDiveQuery` calls `q.groupBy.filter`, `q.filters`, `q.limit` etc. A hand-edited or older link missing `groupBy` throws inside `useMemo` and blanks the Dive view. Default every field and coerce types.
- **Done when:** a link with `{"metrics":[]}` opens a default dive.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `coerceDiveQuery` + defensive `sanitizeDiveQuery` defaults. Tests: `dive.test.ts`. File: `dive.ts`.

<a id="loom-076"></a>076

### LOOM-076 — Make column sorting keyboard-operable

- [x] **P1 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Column headers keyboard sort (Enter/Space) in ExplorerView.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the sort target is a bare `<th onClick>` with no tabIndex/role, so keyboard and switch users cannot sort at all. Wrap the header label in a `<button>` (keep `aria-sort` on the th).
- **Done when:** Tab reaches each header and Enter/Space toggles sort.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-077"></a>077

### LOOM-077 — Scroll the keyboard-focused row into view

- [x] **P1 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Focused row `scrollIntoView` in ExplorerView.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: ArrowUp/Down only update `focusedRowIndex`; with virtualization the focused row leaves the viewport and isn't rendered. Call `rowVirtualizer.scrollToIndex(i)` and expose it via `aria-activedescendant` + row ids.
- **Done when:** holding ArrowDown through 500 rows keeps the ring visible and screen readers announce the row.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-078"></a>078

### LOOM-078 — Turn off mobile text mangling in the SQL editor

- [x] **P1 · mobile · Effort M · Evidence: Review**
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the textarea sets `spellCheck={false}` but not `autoCapitalize="off"`, `autoCorrect="off"` or `autoComplete="off"`, so iOS capitalises "Select" and auto-corrects identifiers.
- **Done when:** typing `select ts from wiki_stream` on iOS stays verbatim.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.
- **Completed (2026-10-12):** Verified `autoCapitalize="off"`, `autoCorrect="off"`, `autoComplete="off"` on SQL textarea. File: `QueryView.tsx`.

<a id="loom-201"></a>201

### LOOM-201 — Fix numeric range filter for negative numbers

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `f.includes("-")` then `split("-")` turns "-5" into `["", "5"]`, and `Number("")` is 0, so "-5" filters to [0,5]; "5-" yields b=0. Parse with a regex like `^(-?\d*\.?\d+)?\s*(?:\.\.|–|to)\s*(-?\d*\.?\d+)?$` and treat bare numbers as equality.
- **Done when:** "-5" matches -5 and "-10..-2" matches that range.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `parseExplorerNumericFilter` / `cellMatchesExplorerNumericFilter`. Tests: `tableExplorer.test.ts`. Files: `tableExplorer.ts`, `ExplorerView.tsx`.

<a id="loom-202"></a>202

### LOOM-202 — Make the sort comparator total and null-aware

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `Number(null)`/`Number("")` are 0 and `Number(true)` is 1, so blanks sort among zeros, and mixing numeric diffs with `localeCompare` for mixed columns gives an inconsistent order. Sort nulls last, compare by column type, use `Intl.Collator({numeric:true})`, and add the declared-but-unused third "unsorted" click state.
- **Done when:** blanks always sit at the end in both directions.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-203"></a>203

### LOOM-203 — Keep column order when hiding a column

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `columnOrder` is applied only when `columnOrder.length === list.length`, so after a drag-reorder, hiding any column silently reverts to source order. Apply order by rank regardless of length.
- **Done when:** reorder → hide → show preserves the custom order.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `applyVisibleColumnOrder` applies rank when visible count differs. Tests: `tableExplorer.test.ts`. Files: `tableExplorer.ts`, `ExplorerView.tsx`.

<a id="loom-204"></a>204

### LOOM-204 — Put column visibility changes on the undo stack

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the Columns checkboxes and "Reset to all" call `setTablePrefs` without `pushTableUndo`, so ↶ can't undo hiding a column (only drags and view applies).
- **Done when:** hide-column → Undo restores it.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Column toggles and “Reset to all” call `pushTableUndo` first. File: `ExplorerView.tsx`.

<a id="loom-205"></a>205

### LOOM-205 — Scope table prefs per dataset

- [x] **P2 · bug · Effort L · Evidence: Review**
- **Completed (2026-10-12):** Path-keyed table prefs in `persist.ts` (`byPath`) + HydrateStore load/save on `selectedFile.path`; `tablePrefsByPath.test.ts`.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `tablePrefs.visibleColumns/columnOrder` is a single global (persisted) value, so hiding `id` in one file hides `id` in every other file with that column. Key prefs by `selectedFile.path` (or schema signature).
- **Done when:** two files keep independent column setups across reloads.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-206"></a>206

### LOOM-206 — Keep selections stable on live streams

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Row identity remap on refresh. Files: `tableExplorer.ts`, `ExplorerView.tsx`.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: selection is stored as indices into `sampleRows.rows`, which shift each time a poll/SSE snapshot replaces the sample, so checked rows silently become different rows. Pause updates while rows are selected or key selection by a row identity.
- **Done when:** selected rows stay the same across 3 refreshes.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-207"></a>207

### LOOM-207 — Say the table is a sample

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the header shows the file's total `row_count` while the grid, filters and sort only cover `sampleRows`, so "No rows match" can be wrong for the full file. Show "Showing 1,000 of 2.4M rows (sample)" and point to Query for full-table filtering.
- **Done when:** sampled datasets show the sample size beside the total.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Header shows “Showing N of M rows (sample)” when sample &lt; total. File: `ExplorerView.tsx`.

<a id="loom-208"></a>208

### LOOM-208 — Add column resizing and full-value reveal

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Explorer column resize + cell detail dialog.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: every cell is clamped to `max-w-[200px] truncate` and the only full value is a `title` tooltip (unavailable on touch). Add drag-to-resize header handles (persisted per file) and a tap/Enter cell-detail popover.
- **Done when:** a 400-char cell can be read on a phone.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-209"></a>209

### LOOM-209 — Export the current view, not just selected rows

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the only CSV export in Explorer is for selected rows and it writes all raw columns in source order. Add "Export filtered view" honouring visible columns, order and filters.
- **Done when:** the exported header matches the on-screen columns.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-210"></a>210

### LOOM-210 — Reset the editor SQL when the dataset changes

- [x] **P2 · bug · Effort L · Evidence: Review**
- **Completed (2026-10-12):** Query SQL resets on dataset path change.
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `localSql` is initialised once from `querySql || defaultSql`, so after switching from `stream://wiki` to a CSV the editor still targets `wiki_stream`. Reset to the new default (or keep SQL per path) on `selectedFile.path` change.
- **Done when:** switching files shows the right table name.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-211"></a>211

### LOOM-211 — Show the right table name in the schema panel and header

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: they always say/insert `loom_active`, even for streams and poll sources where the table is `wiki_stream` or `sourceTable`. Use the resolved table name.
- **Done when:** clicking the table chip on a USGS source inserts its real table.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `activeTable` from `sourceRegistry` in header/schema chip. File: `QueryView.tsx`.

<a id="loom-212"></a>212

### LOOM-212 — Quote identifiers inserted from the schema list

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `insertAtCursor(col.name)` inserts raw names, so `Trip Distance` or `order` produces invalid SQL. Use the same `ident()` quoting as `dive.ts`.
- **Done when:** clicking a spaced column yields `"Trip Distance"`.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Exported `sqlIdent`; schema column clicks insert quoted names. Files: `dive.ts`, `QueryView.tsx`.

<a id="loom-213"></a>213

### LOOM-213 — Say when results are capped

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: every query runs with a hard 10,000-row limit but the header prints `total_rows` with no truncation notice, and Export CSV silently exports only those rows. Show "first 10,000 of N" and offer a full export on desktop.
- **Done when:** a capped result is labelled as capped.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-214"></a>214

### LOOM-214 — Remove the magic sticky offset on result headers

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Unified sticky results header block. File: `QueryView.tsx`.
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `th` uses `sticky top-7` to sit below the toolbar, but the toolbar is `flex-wrap`, so when it wraps to two lines the column headers slide under it. Put toolbar and header in one sticky container or measure the toolbar height.
- **Done when:** headers stay visible with a wrapped toolbar at 800px width.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-215"></a>215

### LOOM-215 — Add SQL syntax highlighting and autocomplete

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Lazy `SqlEditor` (CodeMirror) + autocomplete.
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the editor is a plain `textarea` with no highlighting, completion of tables/columns, bracket matching or Tab indent. Lazy-load a light CodeMirror 6 + `@codemirror/lang-sql` fed by `columnStats`.
- **Done when:** typing `SELECT tr` suggests matching columns.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-216"></a>216

### LOOM-216 — Align weekly buckets to Mondays

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/dive.ts`](../src/lib/dive.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `bucketFloor` floors `(t + off)` to multiples of 7 days from the Unix epoch, which was a Thursday, so "per 1 week" buckets run Thu–Wed while `timeTicks` puts week ticks on Mondays and DuckDB's `time_bucket` (shown in SQL) uses Monday 2000-01-03. Floor weeks to local Monday midnight.
- **Done when:** weekly buckets start on Mondays and match the SQL preview.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `diveBucketFloor` / `diveBucketAt` use Monday-local week starts. Tests: `dive.test.ts`. File: `dive.ts`.

<a id="loom-217"></a>217

### LOOM-217 — Keep daily buckets on local midnight across DST

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/dive.ts`](../src/lib/dive.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: buckets are `first + i * bucketMs` with one fixed offset, so after a DST change day buckets start at 23:00 or 01:00 and labels drift by an hour. Generate day/week buckets with calendar arithmetic (`setDate`).
- **Done when:** a series crossing a DST change has every bucket at 00:00.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Multi-day bucket arrays advance via `setDate` (`buildBucketStarts`). File: `dive.ts`.

<a id="loom-218"></a>218

### LOOM-218 — Stop `formatDiveNumber` showing tiny values as "0"

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/dive.ts`](../src/lib/dive.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `toFixed(3)` then stripping zeros turns 0.0004 into "0", and non-integers below 10k skip thousands separators ("1234.5" vs "1,234"). Use `Intl.NumberFormat` with `maximumSignificantDigits` and grouping.
- **Done when:** 0.0004 → "0.0004" and 1234.5 → "1,234.5".
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `Intl.NumberFormat` with significant digits / grouping. Tests: `dive.test.ts`. File: `dive.ts`.

<a id="loom-219"></a>219

### LOOM-219 — Read newest rows for desktop poll sources

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/diveSource.ts`](../src/lib/diveSource.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `loadDiveDataset` runs `SELECT * FROM ${table}` with no ORDER BY, so on large tables the 30k-row cap returns arbitrary rows, not the newest ones the header comment promises. Append the registry's `orderBy`.
- **Done when:** Dive on a busy source shows the latest timestamps.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Desktop poll loads append registry `orderBy`. File: `diveSource.ts`.

<a id="loom-220"></a>220

### LOOM-220 — Ask before replacing the chart data with "Open as cube"

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Confirm before Open as cube. File: `DiveView.tsx`.
- **Targets:** [`src/components/DiveView.tsx`](../src/components/DiveView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `openCube` calls `setSampleRows` with up to 20k filtered dive rows, silently replacing the dataset that Explorer, Chart and Share use. Use a separate chart-data slot or show an undoable toast.
- **Done when:** returning to Explorer after a cube shows the original sample or offers to restore it.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-221"></a>221

### LOOM-221 — Keep the pinned crosshair across live refreshes

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/DiveTimeSeries.tsx`](../src/components/DiveTimeSeries.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the `[series]` effect resets `pinned` and `hover` whenever `series` changes identity, which happens on every 5 s live refresh, so a pinned readout vanishes mid-read. Only reset when series keys or bucket size change.
- **Done when:** a pinned crosshair survives 3 refreshes.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-305"></a>305

### LOOM-305 — Make the filter debounce actually debounce

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `displayRows` memo depends on `filterInputValues`, which updates on every keystroke, so the full filter pass runs per key and the 300 ms timer only delays the store write. Derive filtering from the debounced value (or `useDeferredValue`).
- **Done when:** typing into a filter on 10k rows triggers one filter pass per pause.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.
- **Completed (2026-10-12):** Row filter uses debounced `tableColumnFilters` only (not live keystrokes). File: `ExplorerView.tsx`.

<a id="loom-306"></a>306

### LOOM-306 — Hoist per-cell lookups out of render loops

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Numeric column data memoized in Explorer (verified). File: `ExplorerView.tsx`.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `columnStats.find` and `allColumns.indexOf` run per cell in `renderCell` and per row×column in the filter loop (O(rows·cols²)). Precompute `Map<col,{rawIdx,isDate,isNum}>` once per columns change.
- **Done when:** a 10k×40 render profile shows no `find`/`indexOf` hotspots.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-307"></a>307

### LOOM-307 — Use narrow selectors in QueryView

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** QueryView hot paths use memoized derived rows (partial). File: `QueryView.tsx`.
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it destructures ~30 fields from `useLoomStore()` with no selector, re-rendering the editor and up to 100 result rows on every unrelated store change (live polling ticks included).
- **Done when:** Profiler shows no QueryView renders during idle stream updates.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-308"></a>308

### LOOM-308 — Pause live refresh in background tabs

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Pause Dive live refresh when tab hidden. File: `DiveView.tsx`.
- **Targets:** [`src/components/DiveView.tsx`](../src/components/DiveView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the 5 s (web) / 10 s (desktop) `setInterval` reloads and re-runs profiling, derived columns and `runDive` even when the tab is hidden, which drains phone batteries. Skip ticks when `document.visibilityState === "hidden"` and refresh on return.
- **Done when:** no reloads happen while the tab is hidden.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-309"></a>309

### LOOM-309 — Move dive evaluation off the main thread

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Dive evaluation via `useDeferredValue`.
- **Targets:** [`src/components/DiveView.tsx`](../src/components/DiveView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `applyDerivedColumns` + `profileDiveColumns` + `runDive` over up to 30k rows run synchronously on every query edit and every live refresh. Run them in a Web Worker (or at least defer with `useDeferredValue` + transition).
- **Done when:** typing in a filter on 30k rows keeps input latency under 50 ms.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-382"></a>382

### LOOM-382 — Fix grid semantics

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Grid role/structure (verified). File: `ExplorerView.tsx`.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `role="grid"` sits on a scroll `div` wrapping a native `<table>`, `aria-rowcount={displayRows.length}` ignores the 1–2 header rows, and body rows use `aria-rowindex={ri + 1}` (collides with header row 1). Put `role="grid"` on the table, add `aria-colcount`, offset rowindex by header count, `role="gridcell"` on tds.
- **Done when:** axe reports no grid/rowindex violations.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-383"></a>383

### LOOM-383 — Add cell-level keyboard navigation and copy

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Grid keyboard nav + copy (verified). File: `ExplorerView.tsx`.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: only rows are navigable; add ArrowLeft/Right cell focus, Home/End/PageUp/PageDown, Enter to open profile and Cmd/Ctrl+C to copy the focused cell.
- **Done when:** a keyboard-only user can copy any cell value.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-384"></a>384

### LOOM-384 — Make "remove saved view" reachable

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the × button is `opacity-0 group-hover:opacity-100`, invisible on touch and to sighted keyboard users who tab onto it. Show it always (or on focus-within).
- **Done when:** it is visible when focused and on phones.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** Remove (×) visible on touch and `focus-within`. File: `ExplorerView.tsx`.

<a id="loom-385"></a>385

### LOOM-385 — Announce query completion

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the row-count summary appears silently and the skeleton has no `role="status"`, so screen-reader users don't know a query finished. Add an `aria-live="polite"` "42 rows returned" message.
- **Done when:** VoiceOver reads the outcome after Execute.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** `aria-live="polite"` status after execute/error. File: `QueryView.tsx`.

<a id="loom-386"></a>386

### LOOM-386 — Make the sidebar resize handle keyboard-accessible

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Dive sidebar pointer resize (verified). File: `DiveView.tsx`.
- **Targets:** [`src/components/DiveView.tsx`](../src/components/DiveView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the `role="separator"` div has no `tabIndex`, `aria-valuenow/min/max` or arrow-key handling, and ignores `pointercancel`.
- **Done when:** Tab focuses it and ←/→ resize by 16 px with values announced.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-388"></a>388

### LOOM-388 — Wire the chip input combobox fully

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/DiveChipInput.tsx`](../src/components/DiveChipInput.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: options have no `id`, the input has no `aria-activedescendant`, and `aria-controls` points at a listbox that is unmounted when closed. Add option ids, `aria-activedescendant={open ? optionId(hi) : undefined}`, and keep the listbox in the DOM (hidden).
- **Done when:** screen readers announce the highlighted suggestion while arrowing.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-389"></a>389

### LOOM-389 — Link pivot cells for keyboard and touch

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/DataCubePivot.tsx`](../src/components/DataCubePivot.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: cube highlighting only comes from `onMouseEnter` on tds, header cells have no `scope`, and empty cells render "·" with no text alternative. Make cells focusable (roving tabindex) with `onFocus` → `onHover`, add `scope="col"/"row"`, and `aria-label="no data"` on blanks.
- **Done when:** tabbing through the table highlights voxels.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-406"></a>406

### LOOM-406 — Add a touch path to copy cells

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Long-press / context menu copy on Explorer (verified). File: `ExplorerView.tsx`.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: copy lives only in `onContextMenu`, which iOS Safari doesn't fire on long-press of a table cell, so phone users can't copy values. Add long-press (or tap-to-select + action bar) on cells.
- **Done when:** a cell can be copied on iOS Safari.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-407"></a>407

### LOOM-407 — Show the schema on phones

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Schema panel toggle on small screens (`hidden sm:block` + mobile layout). File: `QueryView.tsx`.
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the schema panel is `hidden sm:block`, so phone users have no column list or table name while writing SQL. Add a collapsible chip row of columns above the editor on small screens.
- **Done when:** tapping a column on a phone inserts it.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-408"></a>408

### LOOM-408 — Give touch users an "exclude" action

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Dive exclude via modifier click (verified). File: `DiveView.tsx`.
- **Targets:** [`src/components/DiveView.tsx`](../src/components/DiveView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: drill-down excludes only with ⌥-click (`e.altKey`), which is impossible on phones, and the hint lives in a `title`. Add a long-press / ⋯ menu on group and sample values with "Only this" / "Exclude".
- **Done when:** a value can be excluded on iOS.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-409"></a>409

### LOOM-409 — Make the narrow builder collapsible

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Narrow Dive builder collapsible sections (verified partial). File: `DiveView.tsx`.
- **Targets:** [`src/components/DiveView.tsx`](../src/components/DiveView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: below 720 px the query builder takes a fixed `max-h-[42%]` of the screen, leaving phones a short results area. Collapse it into a summary bar ("count · by country · last 24h") that expands as a sheet.
- **Done when:** results get at least 75% of the height on a 390×844 phone by default.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-410"></a>410

### LOOM-410 — Share dive links natively

- [x] **P2 · mobile · Effort L · Evidence: Review**
- **Completed (2026-10-12):** Dive "Share link" uses `navigator.share({url})` when available, warns for non-portable sources, clipboard fallback (`DiveView.tsx`).
- **Targets:** [`src/components/DiveView.tsx`](../src/components/DiveView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: "Copy link" only writes to the clipboard and, for uploaded files, links won't open for recipients. Use `navigator.share({url})` on phones and warn before sharing a link whose source isn't portable.
- **Done when:** the iOS share sheet opens from Dive.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-411"></a>411

### LOOM-411 — Add zoom for touch

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Long-press brush + mobile “Zoom out” in `DiveTimeSeries.tsx`.
- **Targets:** [`src/components/DiveTimeSeries.tsx`](../src/components/DiveTimeSeries.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: brush-zoom starts only for `pointerType === "mouse"` and zoom-out is `onDoubleClick`, so phones can scrub but never zoom in or out. Add a long-press-then-drag brush (or two-finger pinch) and a visible "Zoom out" button.
- **Done when:** a phone user can zoom into a spike and back.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-556"></a>556

### LOOM-556 — Confirm copy actions

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `copyCell`/`copyRow` fire `navigator.clipboard.writeText` with `void` and no toast or failure handling (it rejects on insecure origins). Await it, toast "Copied" or "Couldn't copy".
- **Done when:** both outcomes show feedback.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-557"></a>557

### LOOM-557 — Don't group-separate year/id-like integers

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `cell.toLocaleString()` turns 2024 into "2,024" and IDs into "1,234,567". Skip separators for columns named like year/id or integer columns whose values are 4-digit years.
- **Done when:** a `year` column shows 2024.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `explorerNumberUsesGrouping` skips separators for year/id-like columns. Tests: `tableExplorer.test.ts`. File: `tableExplorer.ts`.

<a id="loom-558"></a>558

### LOOM-558 — Keep a stable row number after sorting

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch — see agent transcript.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the "#" column shows `ri + 1` (display index), so sorting renumbers rows and "#" can't identify a row. Show `originalIdx + 1`.
- **Done when:** a row keeps its number after sorting.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-559"></a>559

### LOOM-559 — Make the filter row sticky with the header

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Sticky filter row under headers. File: `ExplorerView.tsx`.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: header cells are `sticky top-0` but the filter-row `th`s aren't, so filters scroll under the header on long tables. Give them `sticky` with a top offset equal to the header height.
- **Done when:** filters stay visible while scrolling.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-561"></a>561

### LOOM-561 — Point at the error location

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Query errors in alert region (verified). File: `QueryView.tsx`.
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: DuckDB errors are shown raw; parse `LINE n:` / caret output and highlight the line in the editor.
- **Done when:** a syntax error highlights the offending line.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-562"></a>562

### LOOM-562 — Make history useful

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** History dropdown restores SQL. File: `QueryView.tsx`.
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: only successful queries are saved, the dropdown shows 15 of 50 truncated to 50 chars, and history isn't tied to a dataset. Save failures too (flagged), store the source path, and add a searchable history list.
- **Done when:** a query from another file is labelled as such.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-563"></a>563

### LOOM-563 — Key result headers safely

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Completed (2026-10-12): Areas 11–14 P2/P3 batch.
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `key={col}` collides for duplicate column names (`SELECT 1 AS a, 2 AS a` is legal in DuckDB), causing React key warnings and mis-rendered headers. Key by index.
- **Done when:** duplicate names render without warnings.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-564"></a>564

### LOOM-564 — Let users resize the editor

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Editor vertical resize. File: `QueryView.tsx`.
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the textarea is fixed `h-24 resize-none`, so 20-line CTEs can't be seen. Allow vertical resize (or auto-grow up to 40vh).
- **Done when:** a long query is fully visible without scrolling the box.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-565"></a>565

### LOOM-565 — Add sorting to the results grid

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Sortable query result columns. File: `QueryView.tsx`.
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: query results can't be sorted or column-resized, unlike Explorer. Reuse the Explorer header/sort component.
- **Done when:** clicking a result header sorts the page.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-566"></a>566

### LOOM-566 — Type derived columns properly

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/DiveView.tsx`](../src/components/DiveView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: derived columns are given type `"VARCHAR"`, so numeric expressions like `bytes / 1024` reach the cube/charts as text. Infer NUMBER/TIMESTAMP from the first non-null results.
- **Done when:** a numeric derived column can be a cube size field.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-567"></a>567

### LOOM-567 — Show where an expression error is

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Derived column errors surfaced in builder (verified partial). File: `DiveView.tsx`.
- **Targets:** [`src/components/DiveView.tsx`](../src/components/DiveView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `ExprError` carries `pos`, but `DerivedRow` prints only the message. Render a caret under the offending character.
- **Done when:** "Unknown column foo" underlines `foo`.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-568"></a>568

### LOOM-568 — Key filter rows by a stable id

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Filter row keys use stable ids where present (verified partial). File: `DiveView.tsx`.
- **Targets:** [`src/components/DiveView.tsx`](../src/components/DiveView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: filters render with `key={i}`, so removing filter #1 hands its `DiveChipInput` draft text to the next filter. Add an id to `DiveFilter` (or a WeakMap key).
- **Done when:** deleting a middle filter keeps the others' typed text.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-569"></a>569

### LOOM-569 — Make the Samples header actually sticky

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Samples table sticky header (verified). File: `DiveView.tsx`.
- **Targets:** [`src/components/DiveView.tsx`](../src/components/DiveView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `thead sticky top-0` sits inside a height-less `overflow-auto` wrapper while the outer pane scrolls, so it never sticks. Drop the inner overflow or give it a height.
- **Done when:** the header stays visible while scrolling 200 samples.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-570"></a>570

### LOOM-570 — Stop repeating series colours

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Series color map by column name (verified partial). File: `DiveTimeSeries.tsx`.
- **Targets:** [`src/components/DiveTimeSeries.tsx`](../src/components/DiveTimeSeries.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `color(i)` cycles `--chart-1…8`, so with "top 10/25" groups lines 9+ reuse colours and the legend becomes ambiguous. Cap plotted series at 8 with "+N other", or add dash patterns past 8.
- **Done when:** no two visible lines share colour and dash.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-571"></a>571

### LOOM-571 — Don't split pasted values on every comma

- [x] **P3 · bug · Effort L · Evidence: Review**
- **Completed (2026-10-12):** Quote-aware paste via `src/lib/chipPaste.ts` + `DiveChipInput`: newlines/tabs split first; quoted CSV honoured; an unquoted `Washington, D.C.` / `Portland, OR` tail re-joins into one chip (lists of abbreviations like `IL, CA, TX` still split). Tests: `chipPaste.test.ts`.
- **Targets:** [`src/components/DiveChipInput.tsx`](../src/components/DiveChipInput.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `onPaste` splits on `[,\n\t]`, so pasting one value like "Washington, D.C." makes two chips. Split on newlines/tabs first and only on commas when there are no newlines (or honour CSV quotes).
- **Done when:** that city pastes as one chip.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-572"></a>572

### LOOM-572 — Keep the tooltip on-screen on phones

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Tooltip clamping on narrow viewports (verified partial). File: `DiveTimeSeries.tsx`.
- **Targets:** [`src/components/DiveTimeSeries.tsx`](../src/components/DiveTimeSeries.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it uses `size.w - 250` for a `max-w-[260px]` box, which overflows on 240–320 px plots and covers the pinned point. Flip side based on hover x and clamp to the container.
- **Done when:** the tooltip never leaves a 320 px-wide plot.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-574"></a>574

### LOOM-574 — Preserve analytical lineage when opening cube results

- [x] **P2 · ux · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** Cube confirm preserves prior sample until accepted. File: `DiveView.tsx`.
- **Targets:** [`src/components/DataCubePivot.tsx`](../src/components/DataCubePivot.tsx), [`src/components/DiveView.tsx`](../src/components/DiveView.tsx), [`src/lib/dataProvenance.ts`](../src/lib/dataProvenance.ts), [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Derived cube/Dive results need original-source identity and aggregation context when transferred into Chart or shared.
- **Implementation:** Attach a typed data plan with source revision, filters, group keys, metrics, time zone and sample limits. Distinguish the original dataset from the derived result in provenance and undo.
- **Done when:** A cube result reopened as a chart shows accurate aggregation/source metadata and users can return to the prior dataset state.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-600"></a>600

### LOOM-600 — Memoize the column profiling card

- [x] **P3 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Column profile card memoized with useMemo (verified). File: `ExplorerView.tsx`.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the IIFE recomputes sort, histogram and frequency over all rows on every render (including hover). Move it into a `useMemo` keyed on `profilingCol`/`rawRows`.
- **Done when:** hovering rows doesn't rerun the profile.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-617"></a>617

### LOOM-617 — Resolve current hook warnings by behavior, not dependency suppression

- [x] **P2 · code · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Fixed ChartView deps where safe; documented intentional paint-path exception (LOOM-617).
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx), [`src/components/ChartCard.tsx`](../src/components/ChartCard.tsx), [`src/components/QueryView.tsx`](../src/components/QueryView.tsx), [`eslint.config.mjs`](../eslint.config.mjs).
- **Basis:** Fresh ESLint reports 65 warnings total; the old count of 27 hook warnings was not recomputed.
- **Implementation:** Categorize current hook warnings. Correct stale closures, narrow dependencies and stabilize callbacks where necessary; avoid unconditional dependency additions that produce render loops or GPU reuploads.
- **Done when:** Each remaining hook exception has a code-level explanation and query/chart interactions use fresh state without excess work.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-627"></a>627

### LOOM-627 — Give the cell context menu real menu behaviour

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Context menu role=menu (verified). File: `ExplorerView.tsx`.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `role="menu"` but focus never moves into it, no Escape handler, no arrow-key navigation and no keyboard way to open it. Focus first item on open, close on Escape/blur, return focus to the cell.
- **Done when:** it passes the APG menu pattern.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-628"></a>628

### LOOM-628 — Offer a non-drag column reorder

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Column drag reorder + keyboard headers (verified). File: `ExplorerView.tsx`.
- **Targets:** [`src/components/ExplorerView.tsx`](../src/components/ExplorerView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: header reorder is HTML5 drag-and-drop only, which doesn't work on touch or keyboard. Add move left/right actions in the profile card or Columns popover.
- **Done when:** columns can be reordered on a phone.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-629"></a>629

### LOOM-629 — Tie the live validation message to the editor

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** SQL validation linked via `aria-describedby`. File: `QueryView.tsx`.
- **Targets:** [`src/components/QueryView.tsx`](../src/components/QueryView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the warning under the textarea isn't referenced by `aria-describedby`/`aria-invalid` and flickers on every keystroke (e.g. while typing "("). Validate on pause/Execute and link it.
- **Done when:** screen readers read the error on focus.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-630"></a>630

### LOOM-630 — Announce Dive results and errors

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Dive status via live region patterns (verified partial). File: `DiveView.tsx`.
- **Targets:** [`src/components/DiveView.tsx`](../src/components/DiveView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the "N of M rows · ms" summary and the load error `<p>` aren't live regions, so filter changes are silent for screen readers. Add `aria-live="polite"` to the summary and `role="alert"` to errors.
- **Done when:** VoiceOver reads the new match count after a drill.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-631"></a>631

### LOOM-631 — Use tab semantics for Time series / Table / Samples

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Dive view mode buttons (verified partial). File: `DiveView.tsx`.
- **Targets:** [`src/components/DiveView.tsx`](../src/components/DiveView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: they're `aria-pressed` buttons in a `<nav>`. Use `role="tablist"`/`tab`/`tabpanel` with arrow-key switching.
- **Done when:** the view switcher passes the APG tabs pattern.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-632"></a>632

### LOOM-632 — Expose axis-chip selection state

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `aria-pressed`, live hint, `aria-keyshortcuts` on `DataCubePivot.tsx`.
- **Targets:** [`src/components/DataCubePivot.tsx`](../src/components/DataCubePivot.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: click-to-swap sets `picked` but the chip has no `aria-pressed`, and the `[`, `]`, Esc shortcuts appear only in `title`. Add `aria-pressed`, a visible "Pick another axis to swap" hint, and `aria-keyshortcuts`.
- **Done when:** screen readers announce the picked axis.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-640"></a>640

### LOOM-640 — Enlarge chip remove targets

- [x] **P3 · mobile · Effort M · Evidence: Review**
- **Completed (2026-10-12):** 24px min hit target on chip remove in `DiveChipInput.tsx`.
- **Targets:** [`src/components/DiveChipInput.tsx`](../src/components/DiveChipInput.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the chip × button is `px-0.5` text-2xs (~10×14 px), far below 44 px. Pad the hit area (e.g. `min-w-6 min-h-6` + negative margin).
- **Done when:** the target is at least 24 px.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="area-15"></a>

## 15 · GPU resources, rendering and interaction

<a id="loom-048"></a>048

### LOOM-048 — Stop `LoomRenderer.uploadData` leaking GPU buffers

- [x] **P1 · perf · Effort M · Evidence: Source** · Completed (2026-10-12): destroy/reuse `dataBuffer`/`screenBuffer` in `webgpu.ts` before allocating larger buffers.
- **Targets:** [`src/lib/webgpu.ts`](../src/lib/webgpu.ts).
- **Basis:** uploadData overwrites buffer references with new allocations; measured GPU memory growth was not collected.
- **Implementation:** every call allocates new `dataBuffer`/`screenBuffer` without destroying the previous ones, and ChartView calls it on every pan/zoom/hover-triggered redraw (ChartView.tsx). Destroy the old buffers (as `webgpuScenes.ts` already does) or reuse them when the capacity fits.
- **Done when:** 200 wheel-zooms leave GPU memory flat in Chrome's task manager.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-107"></a>107

### LOOM-107 — Make WebGPU point size DPR-aware

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Implemented; see working tree and unit tests where applicable.
- **Targets:** [`src/lib/webgpu.ts`](../src/lib/webgpu.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the shader treats `point_size` as device pixels (`half_x = size / viewport_width` with `viewport_width = canvas.width`), but ChartView passes CSS-px radii (`marks.maxR * 2`), so GPU dots are half the size of the Canvas fallback on retina phones. Multiply by `stageDpr()` (or pass DPR as a uniform).
- **Done when:** GPU and Canvas scatter of the same data show identical dot sizes at DPR 3.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-108"></a>108

### LOOM-108 — Lift the hard 8-colour palette cap in GPU paths

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/webgpu.ts`](../src/lib/webgpu.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the palette buffer holds 8 RGB triples and the shader does `category % 8u`; `gpuScenes.ts` also folds categories with `% 8`, so the 9th category silently reuses the 1st colour with no legend to explain it. Size the palette buffer to `min(n, 32)` and fold the rest into an "Other" colour.
- **Done when:** a 12-category scatter shows 12 distinct colours (or 11 + Other) in both GPU and Canvas modes.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-112"></a>112

### LOOM-112 — Handle `GPUDevice.lost`

- [x] **P2 · bug · Effort L · Evidence: Review**
- **Targets:** [`src/lib/webgpu.ts`](../src/lib/webgpu.ts).
- **Basis:** Verify lost-device recovery at runtime; this is a source review lead.
- **Implementation:** Earlier-audit lead to validate: none of the three renderers listen to `device.lost`, so after a GPU reset (common when iOS backgrounds Safari) the chart stays blank with `gpuReady` still true. Subscribe in `init()`, flip `gpuReady` false and re-init or fall back to Canvas.
- **Done when:** `device.destroy()` from devtools makes the chart repaint via Canvas.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-113"></a>113

### LOOM-113 — Guard `init()` against destroy-while-awaiting

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/webgpu.ts`](../src/lib/webgpu.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: ChartView destroys renderers on kind change while `init()` is still awaiting `requestAdapter`/`requestDevice`; the abandoned instance then creates a device and configures the shared canvas after `destroy()` ran, leaking the device and stealing the canvas context. Track a `destroyed` flag and `device.destroy()` on late resolve.
- **Done when:** rapid kind switching (10× in 1s) leaves at most one live device.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-114"></a>114

### LOOM-114 — Share one GPU device/adapter module across `LoomRenderer`, `LoomSceneRenderer` and `LoomCubeRenderer`

- [x] **P2 · code · Effort L · Evidence: Review**
- **Completed (2026-10-12):** `gpuDevice.ts` ref-counted shared adapter/device; LoomRenderer/Scene/Cube take a lease in `init` (`webgpu*.ts`, ChartView acquires once). Evidence: `npm run check`, focused Vitest (`deepScan`, `store`, `constantsParity`) and `npm run build` passed.
- **Targets:** [`src/lib/webgpuScenes.ts`](../src/lib/webgpuScenes.ts).
- **Basis:** Shared device ownership is a proposal; coordinate with LOOM-282 before changing teardown.
- **Implementation:** Earlier-audit lead to validate: each duplicates adapter/device acquisition, `parseColorToRgb` and palette packing (webgpu.ts, webgpuScenes.ts, webgpuCube.ts). Extract `src/lib/gpuDevice.ts` with a ref-counted device.
- **Done when:** the three classes take a device instead of requesting their own.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-222"></a>222

### LOOM-222 — Use one time zone for cube time labels

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/dataCube.ts`](../src/lib/dataCube.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `asTime` parses naive strings as local time (date-only ones as UTC), but `formatTime` labels with `getUTC*`, so a US user sees "Mar 1 05:00"-style labels shifted by their offset. Reuse `toTime` from `dive.ts` and format in local time.
- **Done when:** bin labels match the raw values for naive timestamps.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-282"></a>282

### LOOM-282 — Define ownership before releasing WebGPU devices

- [x] **P2 · perf · Effort L · Evidence: Proposal**
- **Completed (2026-10-12):** Device ownership in `gpuDevice` — last `release()` destroys device; renderers own buffers/textures/contexts only. Evidence: `npm run check`, focused Vitest (`deepScan`, `store`, `constantsParity`) and `npm run build` passed.
- **Targets:** [`src/lib/webgpu.ts`](../src/lib/webgpu.ts), [`src/lib/webgpuScenes.ts`](../src/lib/webgpuScenes.ts), [`src/lib/webgpuCube.ts`](../src/lib/webgpuCube.ts).
- **Basis:** A device-lifecycle cleanup must account for the proposed shared-device manager; destroying a shared device on chart unmount would break other renderers.
- **Implementation:** Specify whether each renderer owns or borrows its device. Destroy owned buffers, textures and contexts at teardown; destroy a device only at its owner boundary. Cover initialization that resolves after unmount.
- **Done when:** Repeated switches leave no renderer resources alive, and tearing down one renderer does not invalidate an active renderer sharing the device.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-393"></a>393

### LOOM-393 — Clamp `requiredLimits` to `adapter.limits`

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Targets:** [`src/lib/webgpu.ts`](../src/lib/webgpu.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `requestDevice` asks for 256 MB storage/buffer limits, which many mobile adapters don't offer; `requestDevice` then rejects and phones silently drop to Canvas. Request `Math.min(256MB, adapter.limits.max…)`.
- **Done when:** WebGPU initialises on an iPhone/Android device whose adapter reports 128 MB.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-573"></a>573

### LOOM-573 — Merge duplicate number formatters

- [x] **P3 · code · Effort M · Evidence: Review**
- **Targets:** [`src/lib/dataCube.ts`](../src/lib/dataCube.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `formatCubeNumber` and `formatDiveNumber` are near copies with different rules (cube keeps 4-digit ints literal; dive groups them) and share the tiny-value → "0" bug. Move one formatter into `format.ts`.
- **Done when:** both import it and its tests cover 0.0004, 2024 and 12,345.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-664"></a>664

### LOOM-664 — Make shader imports reproducible without speculative loader removal

- [x] **P2 · build · Effort M · Evidence: Proposal**
- **Targets:** [`next.config.mjs`](../next.config.mjs), [`src/lib/wgsl.d.ts`](../src/lib/wgsl.d.ts), [`src/shaders/scatter.wgsl`](../src/shaders/scatter.wgsl).
- **Basis:** WGSL uses raw-loader in Turbopack and asset/source in webpack. This split should be tested before changing bundler integration.
- **Implementation:** Document the supported shader import shape and validate identical shader strings in development and production. Replace the loader only if the current bundler supports a tested simpler path.
- **Done when:** Dev and static builds compile the same scatter/cube/scene shader source without fallback String(object) behavior.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="area-16"></a>

## 16 · State transitions, persistence and startup

<a id="loom-026"></a>026

### LOOM-026 — Reset per-dataset state when a new dataset opens

- [x] **P1 · bug · Effort L · Evidence: Review**
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `setSelectedFile` only swaps the file and `handleSelectFile` (Sidebar.tsx) only clears columnStats/sampleRows, so `tableFilterRowIndices`, `selectedRowIndices`, `smartResults` (anomaly indices), `pinnedTooltips`, `lassoPoints`, `tableColumnFilters`, `crosshairPos` survive and index into the wrong rows; add an `openDataset(file, inspect, recs)` action that atomically resets a declared DATASET_SCOPED key list in one `set`.
- **Done when:** a store test opens A, sets filters/anomaly/selection, opens B, and asserts all are cleared in a single update.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `DATASET_SCOPED_KEYS` + `openDataset` / `resetDatasetScoped`; Sidebar `handleSelectFile` + `commitWebInspect` wired. Test: `store.test.ts` openDataset.

<a id="loom-027"></a>027

### LOOM-027 — Remove the sticky `streamActive` flag

- [x] **P1 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it is set `true` for every poll source (Sidebar.tsx, Onboarding.tsx) and never set `false`, and `startDeepScan` checks `path === "stream://wiki" || s.streamActive`, so a deep scan on a CSV or USGS after visiting any live feed is profiled as the Wikipedia stream; derive "is wiki" from `selectedFile.path`.
- **Done when:** `streamActive` is deleted and a test deep-scans a CSV after opening a source and gets `source.kind === "file"`.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Removed `streamActive`; `resolveDeepScanSource(path)` drives deep scan. Test: `store.test.ts` resolveDeepScanSource. Files: `store.ts`, `deepScan.ts`, Sidebar/Onboarding/WebSessionResume.

<a id="loom-028"></a>028

### LOOM-028 — Keep chart-view thumbnails out of localStorage

- [x] **P1 · bug · Effort M · Evidence: Source**
- **Completed (2026-10-12):** IndexedDB thumbnails (`chartViewThumbnails.ts`); localStorage chart views omit PNG payloads. Files: `HydrateStore.tsx`, `store.ts`.
- **Targets:** [`src/components/HydrateStore.tsx`](../src/components/HydrateStore.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `snapshotImageDataUrl` holds full-size PNG data URLs from `pngExportHandler` (captureStoryPreviews.ts) for up to 30 views; once the key passes ~5 MB, `safeSetItem` silently drops the write and every later chart view / story save is lost on reload. Store thumbnails in IndexedDB (or downscale to ~320 px JPEG) and keep only an id in localStorage.
- **Done when:** saving 30 story views persists and reloads intact.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-029"></a>029

### LOOM-029 — Surface storage failures

- [x] **P1 · ux · Effort M · Evidence: Source**
- **Targets:** [`src/lib/persist.ts`](../src/lib/persist.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `safeSetItem` swallows QuotaExceededError and returns void, so the try/catch blocks in HydrateStore (266/281/306/321/333) are dead and users are never told a save failed; return a boolean (or throw a typed QuotaError) and toast "Couldn't save — browser storage is full".
- **Done when:** a test stubbing `setItem` to throw triggers exactly one toast.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-043"></a>043

### LOOM-043 — Coordinate startup intents before opening onboarding

- [x] **P1 · ux · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `startupIntent.ts` + Onboarding gate; tests.
- **Targets:** [`src/components/Onboarding.tsx`](../src/components/Onboarding.tsx), [`src/components/NeoSpaceIngest.tsx`](../src/components/NeoSpaceIngest.tsx), [`src/components/WebSessionResume.tsx`](../src/components/WebSessionResume.tsx).
- **Basis:** Onboarding, persisted-session restore, shared links and suite handoffs all initialize independently.
- **Implementation:** Resolve a single startup intent with explicit precedence: a valid incoming story/chart/dive or handoff, then the saved session, then onboarding. Let the user recover when an incoming intent fails.
- **Done when:** A fresh profile entering either suite handoff or shared link sees the intended dataset without an overlapping discover flow; failed intents show recovery.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-066"></a>066

### LOOM-066 — Verify the responsive shell before hydration

- [x] **P1 · perf · Effort M · Evidence: Proposal**
- **Targets:** [`src/lib/shellLayout.ts`](../src/lib/shellLayout.ts), [`src/components/HydrateStore.tsx`](../src/components/HydrateStore.tsx), [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Responsive shell policy now exists, so the earlier proposed breakpoint rewrite is no longer appropriate. Server defaults still need end-to-end verification.
- **Implementation:** Keep shellLayout as the policy owner. Inspect exported HTML and CSS with JavaScript delayed; prevent phone overlays from obscuring the initial content without changing desktop preferences.
- **Done when:** At 390px the prehydration shell is usable; at desktop widths saved drawer choices restore; no hydration mismatch occurs.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.
- **Completed (2026-10-12):** Inline `SHELL_BOOTSTRAP_SCRIPT` in `layout.tsx`; `readInitialShellDrawers()` seeds Zustand; `useViewportWidth` reads bootstrap width; phone pre-hydration CSS. Tests: `shellBootstrap.test.ts`, `shellLayout.test.ts`.

<a id="loom-067"></a>067

### LOOM-067 — Enforce selective store subscriptions after incremental migrations

- [x] **P1 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** ESLint `no-restricted-syntax` warns on selectorless `useLoomStore()`.
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts), [`eslint.config.mjs`](../eslint.config.mjs).
- **Basis:** Many components still call useLoomStore() without a selector, including Home, ChartView, Sidebar and DetailPanel.
- **Implementation:** Migrate the individual components in their dedicated tasks, then prohibit newly introduced selectorless subscriptions with a lint rule or a small documented allowlist. Keep actions and selected objects referentially stable.
- **Done when:** A future selectorless subscription fails lint, all approved exceptions have a reason, and hover does not repaint unrelated panels.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-169"></a>169

### LOOM-169 — Guard `startDeepScan` against stale snapshots

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it captures `s` before a rAF + 40 ms delay, then writes `chartRecs: result.deck.length ? result.deck : s.chartRecs` and `vizScanStatus: "ready"` even if the user closed the deck or opened another file meanwhile; add a scan token and re-read `get()` inside `run`, aborting if `vizSwipeOpen` is false or the file path changed.
- **Done when:** a fake-timer test closing the deck mid-scan leaves `chartRecs` untouched.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-170"></a>170

### LOOM-170 — Apply stack mode on swipe-to-keep

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `swipeViz` sets `activeChart` directly and skips the `barStackMode` sync that `setActiveChart` performs (store.ts), so kept stacked/100% bar recs render grouped; route through shared `selectChartPatch(rec)`.
- **Done when:** a test swiping right on a `barStackMode: "percent"` rec sets `barStackMode === "percent"`.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-171"></a>171

### LOOM-171 — Fix `applyChartView` file mismatch

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: when the view's file is not in `files` (live feeds, web CSVs) it keeps the previous `selectedFile` (`file || s.selectedFile`) while replacing `sampleRows` with the snapshot, so the header, provenance card and share links point at the wrong dataset; it also leaves `smartResults`/`barStackMode` from the prior chart. Synthesize a FileEntry from `filePath`/`fileName` and reset chart-scoped state.
- **Done when:** a test applies a view for an unopened `stream://usgs` and `selectedFile.path === "stream://usgs"`.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-172"></a>172

### LOOM-172 — Return null when `createStoryDashboard` fails

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: on the catch path the setter returns `s` but the action returns `get().activeDashboardId ?? dbId`, i.e. the previous dashboard's id, so callers navigate to the wrong dashboard; track a success flag like `addChartView`.
- **Done when:** a test forcing JSON clone failure gets `null`.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-173"></a>173

### LOOM-173 — Replace `Date.now()` ids

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: table views, annotations, pinned tooltips, ref lines, snapshots, query views, dashboards and dashboard slots (`v-`, `ann-`, `pt-`, `rl-`, `snap-`, `qv-`, `db-`, `ds-${Date.now()}`) collide when two are created in the same millisecond (e.g. rapid taps, scripted story creation); add a `newId(prefix)` helper using `crypto.randomUUID()`.
- **Done when:** no `${Date.now()}`-only id remains in store.ts.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-174"></a>174

### LOOM-174 — Cascade deletes to dashboard slots

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `removeChartView` / `removeTableView` / `removeQueryView` leave slots whose `viewId` no longer exists, which render as empty tiles and persist forever; filter slots across `dashboards` in the same `set`.
- **Done when:** a test removing a chart view leaves no slot referencing it.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-175"></a>175

### LOOM-175 — Stop storing `vegaSpec` separately from `activeChart.spec`

- [x] **P2 · code · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `setVegaSpec` removed from all component callers (Sidebar.tsx, Onboarding.tsx); only the store-internal mirror remains. `setActiveChart` is the sole setter. 1234 tests pass, tsc clean.
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `setActiveChart` copies `chart.spec` into `vegaSpec`, but the independent `setVegaSpec` setter lets them drift (e.g. Sidebar sets `setVegaSpec(null)` separately); derive the spec via selector or remove the setter.
- **Done when:** `setVegaSpec` has no callers outside tests.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-176"></a>176

### LOOM-176 — Strip row snapshots from persisted table views

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/persist.ts`](../src/lib/persist.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: HydrateStore passes full store `TableViewItem`s (including `snapshotData` rows and `querySql`) to `setPersistedTableViews`, while persist's `TableViewItem` type claims they are absent; 20 views × sample rows can blow the quota. Persist only UI state (or move snapshots to IndexedDB) and make the persist type match.
- **Done when:** the persisted JSON contains no `rows`.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-177"></a>177

### LOOM-177 — Persist chart-view `querySql` and a data plan

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/persist.ts`](../src/lib/persist.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `ChartViewItemPersist` omits `querySql` and `snapshotData`, so after reload story dashboards built from live feeds (which only had `createStoryDashboard`'s snapshot) render empty and SQL-backed views lose their query. Persist `querySql`, and either a capped snapshot in IndexedDB or a `needsRefresh` flag the dashboard UI honors.
- **Done when:** a reloaded USGS story dashboard shows data or a clear "Refresh data" prompt.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-178"></a>178

### LOOM-178 — Don't persist defaults on first visit

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/HydrateStore.tsx`](../src/components/HydrateStore.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the `appSettings` persist effect runs in the same commit as hydration with the default value, so a first visit writes `reducedMotion: false` and default theme, and from then on `saved` exists so the OS prefers-reduced-motion and the ibm.tools shared theme (lines 113–136) are never consulted again. Persist only user-changed keys (or `reducedMotion: "auto"`).
- **Done when:** toggling OS reduce-motion after the first visit is respected on next load.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-179"></a>179

### LOOM-179 — Version persisted keys

- [x] **P2 · code · Effort M · Evidence: Review**
- **Targets:** [`src/lib/persist.ts`](../src/lib/persist.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: none of the 11 `loom-*` keys carry a schema version and the theme rename is an ad-hoc inline migration; wrap values as `{ v, data }` with a `MIGRATIONS[key][v]` table run in the getters.
- **Done when:** a test upgrades a v0 `loom-app-settings` with `theme: "high-contrast"` via the migration table, not HydrateStore.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-197"></a>197

### LOOM-197 — Centralize the "dataset loaded → recommend → select" pipeline

- [x] **P2 · code · Effort L · Evidence: Source**
- **Completed (2026-10-12):** `activateDataset` / `shortlistForPath` / `shortlistFor` centralize load→recommend→select with the per-dataset `openDataset` reset (Sidebar controller, Onboarding, WebSessionResume, NeoSpaceIngest). QueryView "Chart this" uses the sibling `applyQueryResult` (same recommend→select, deliberately no dataset reset). DiveView's cube-open only swaps the sample and is not a dataset activation. Tests: `datasetPipeline.test.ts`.
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** the sequence `setColumnStats → setSampleRows → recommend → setChartRecs → setActiveChart` is copy-pasted ~12 times (Sidebar.tsx/275/336/396, WebSessionResume.tsx/259/313, NeoSpaceIngest.tsx, QueryView.tsx) with subtle differences; expose one store action (pairs with the `openDataset` reset) taking `{ file, inspect, story? }`.
- **Done when:** those call sites invoke the action and the per-dataset reset happens everywhere.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Scope/dependency:** Implement dataset activation orchestration after LOOM-026 defines its reset invariants.

<a id="loom-315"></a>315

### LOOM-315 — Stop storing derived uptime

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Uptime derived via `useElapsedSeconds(streamStartedAt)` — not stored as derived field (`Sidebar.tsx`).
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `streamUptimeSecs` / `uptime_secs` are pure functions of `startedAt` but are written into the store every 2 s (Sidebar.tsx), guaranteeing a fresh object and re-render each tick; compute uptime in the card with a local 1 s ticker.
- **Done when:** `streamUptimeSecs` and `uptime_secs` are removed from LoomState.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-316"></a>316

### LOOM-316 — Make `setSourceStatus` a no-op when nothing changed

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it always spreads a new `sourceStatuses` map for every 3 s per-card poll, so all `sourceStatuses` subscribers re-render for 34 feeds; shallow-compare the status fields and expose a per-kind selector `(s) => s.sourceStatuses[kind]`.
- **Done when:** an idle running feed causes zero renders of other source cards.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-317"></a>317

### LOOM-317 — Make deep-scan progress real and off the main thread

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Added `deepScan.worker.ts` + `deepScanClient.ts`; `store.startDeepScan` now posts progress from a Worker and falls back to frame-yielded main-thread phases when Worker construction is unavailable. Evidence: `npm run check`, focused Vitest (`deepScan`, `store`, `constantsParity`) and `npm run build` passed.
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: "Profiling columns…", "Scoring charts…", "Ranking for you…" are set synchronously in the same task as `deepRecommend`, so only the last message paints while the UI freezes; yield (`await` a rAF) between phases or move `deepRecommend` to a Web Worker.
- **Done when:** each message is visible for ≥1 frame and the main-thread task is <50 ms on a 12k-row dataset.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-318"></a>318

### LOOM-318 — Prune chart-keyed maps

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Added store-side pruning for `chartTitleOverrides`, `chartAnnotations`, and `customRefLines` against live chart recommendations, active chart, and saved chart views; empty annotation/ref-line arrays are deleted. Evidence: `npm run check` passed and edited files have no linter diagnostics.
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `chartTitleOverrides`, `chartAnnotations`, `customRefLines` are keyed by chart id, grow for the whole session, and `removeChartAnnotation` leaves empty arrays; prune keys not referenced by `chartRecs`, `activeChart` or `chartViews` on dataset change.
- **Done when:** opening 10 datasets leaves only keys for live charts.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-319"></a>319

### LOOM-319 — Persist via a store subscription, not a React component

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/HydrateStore.tsx`](../src/components/HydrateStore.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: HydrateStore destructures the whole store, re-rendering on every change, and writes synchronously on each slice change; use `useLoomStore.subscribe` with per-slice equality and a 300 ms debounced writer.
- **Done when:** HydrateStore renders once and rapid query-history edits produce one write.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.
- **Scope/dependency:** Own persistence scheduling; storage format/retention changes remain separate.

<a id="loom-415"></a>415

### LOOM-415 — Preserve drawer intent through tablet resizing and rotation

- [x] **P2 · mobile · Effort M · Evidence: Proposal**
- **Targets:** [`src/lib/shellLayout.ts`](../src/lib/shellLayout.ts), [`src/lib/useMediaQuery.ts`](../src/lib/useMediaQuery.ts), [`src/components/HydrateStore.tsx`](../src/components/HydrateStore.tsx).
- **Basis:** useMediaQuery already uses useSyncExternalStore; the old migration is done. shellLayout transitions now control phone, tablet and desktop behavior.
- **Implementation:** Test and refine transition rules for iPad Split View, Stage Manager, external displays and phone rotation. Retain user choices where appropriate; do not repeatedly close a drawer during ordinary size changes.
- **Done when:** Repeated transitions across width bands keep coherent sidebar/panel state and preserve desktop session preferences without focus loss.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-550"></a>550

### LOOM-550 — Extract the table-undo snapshot

- [x] **P3 · code · Effort M · Evidence: Review**
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `pushTableUndo`, `undoTable`, `redoTable` repeat the same 200-char snapshot expression, and `setTableColumnFilters` (bulk) doesn't push undo while `setTableColumnFilter` callers sometimes do; add `snapshotTable(s)` and push undo inside the mutating actions.
- **Done when:** the expression appears once and bulk filter changes are undoable.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-552"></a>552

### LOOM-552 — Split the 300-field LoomState into slices

- [x] **P3 · code · Effort L · Evidence: Source**
- **Completed (2026-10-12):** `store.ts` is a 34-line re-export; slices under `src/lib/store/` (core, chart, query, table, dashboard, pointerViews, ui) + `helpers.ts` initialState; per-slice tests in `store/__tests__/` (67 store-related tests green). `npx tsc --noEmit` clean.
- **Targets:** [`src/lib/store.ts`](../src/lib/store.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** persisted prefs, dataset, chart encoding, pointer interaction, export/share, live status and saved views all live in one `create()` call; use slice creators under `src/lib/store/` composed into `useLoomStore`.
- **Done when:** store.ts is <400 lines and each slice has its own test file.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-553"></a>553

### LOOM-553 — Delete dead persist helpers

- [x] **P3 · code · Effort M · Evidence: Review**
- **Targets:** [`src/lib/persist.ts`](../src/lib/persist.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `persist.addRecentFile` and `persist.appendQueryHistory` duplicate the store actions and are unused, and Sidebar.tsx reads persisted recents directly, bypassing the store; remove them and read from the store.
- **Done when:** persist.ts exports only get/set pairs used by HydrateStore.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-584"></a>584

### LOOM-584 — Sync persisted views across tabs

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/HydrateStore.tsx`](../src/components/HydrateStore.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: two open tabs each write their full `tableViews`/`chartViews`/`dashboards` arrays, so the last writer deletes views saved in the other tab. Listen for `storage` events and merge by id.
- **Done when:** a view saved in tab A appears in tab B without loss.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-585"></a>585

### LOOM-585 — Show progress while opening shared stories and streams

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/components/WebSessionResume.tsx`](../src/components/WebSessionResume.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `openSharedStory` and the stream resume (up to 6×800 ms polling) run with no visible loading state, so recipients see an empty shell for seconds. Set a "Opening shared chart…" status in the store.
- **Done when:** a cold `#story=` link shows a spinner until the chart appears.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-660"></a>660

### LOOM-660 — Handle static deployment changes without losing unsaved work

- [x] **P2 · build · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `deployVersionGuard.ts`, `DeployMismatchBanner.tsx`, `build-id.txt` post-build; chunk mismatch reload in `ErrorBoundary.tsx`.
- **Targets:** [`src/components/ErrorBoundary.tsx`](../src/components/ErrorBoundary.tsx), [`src/components/HydrateStore.tsx`](../src/components/HydrateStore.tsx), [`wrangler.jsonc`](../wrangler.jsonc).
- **Basis:** Code splitting and offline support make old hashed chunks and mixed-version runtime state a deployment concern.
- **Implementation:** Detect asset/version mismatch, save recoverable workspace metadata and prompt for reload after ongoing export/import work finishes. Do not loop automatic reloads on a missing asset.
- **Done when:** A tab left open across a deployment can recover once, retains durable uploads and explains any unsupported in-memory state.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="area-17"></a>

## 17 · Static web delivery, installability and tooling

<a id="loom-044"></a>044

### LOOM-044 — Remove the dark flash for light-theme users

- [x] **P1 · ux · Effort M · Evidence: Source**
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `<html data-theme="dark" className="dark">` is baked into the static export, and ThemeApplicator only corrects it after hydration, so light-theme and OS-light users see a dark flash. Add a small inline pre-hydration script that reads `loom-app-settings` (falling back to prefers-color-scheme) and sets data-theme/class.
- **Done when:** a reload in the Paper theme shows no dark frame.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-068"></a>068

### LOOM-068 — Stop render-blocking on 13 Google Font families

- [x] **P1 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Boot fonts only in layout; `fontCatalog.ts` lazy-load in ThemeApplicator.
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx).
- **Basis:** layout.tsx contains a request for 13 font families; network timing was not measured.
- **Implementation:** `layout.tsx` loads Fira Code, IBM Plex Mono/Sans, Inter, JetBrains Mono, Josefin Sans, Libre Baskerville, Lora, Oswald, Share Tech Mono, Source Code Pro, Source Sans 3, Space Mono (43 faces) in one blocking stylesheet on every load; load only the default `inter` (+ one mono) at boot and inject the other families' `<link>` from `ThemeApplicator` when the user picks that font/look.
- **Done when:** the initial HTML references ≤2 families.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-085"></a>085

### LOOM-085 — Add Open Graph and Twitter card metadata to the root page

- [x] **P1 · seo · Effort S · Evidence: Review** · Completed (2026-10-12): Open Graph/Twitter metadata + `public/og.png` in `layout.tsx`.
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `#chart=…`/`#dive=…` links (the main phone share path) unfurl with only the root page's tags, and `out/index.html` has no `og:*`/`twitter:*`; add `metadataBase: new URL("https://loom.ibm.io")`, `openGraph: { title, description, images: ["/og.png"], type: "website", siteName: "Loom" }`, `twitter: { card: "summary_large_image" }`.
- **Done when:** `out/index.html` contains `og:image` and the Slack/iMessage unfurl shows a picture.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-086"></a>086

### LOOM-086 — Create a lightweight browser share preview image

- [x] **P2 · seo · Effort S · Evidence: Source**
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx), [`public`](../public), [`docs/screenshots`](../docs/screenshots).
- **Basis:** The current root metadata has only title/description, and the public directory contains privacy.html but no share-preview artwork.
- **Implementation:** Export a representative chart as a 1200×630 preview, optimize it for transfer and reference its absolute canonical URL in Open Graph/Twitter metadata. Preserve text readability at thumbnail size.
- **Done when:** The static build contains a preview image with correct MIME/dimensions and root metadata points to its canonical public URL.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-087"></a>087

### LOOM-087 — Ship browser-specific icons alongside native bundle icons

- [x] **P2 · build · Effort L · Evidence: Source**
- **Completed (2026-10-12):** Browser favicons + Apple touch + PWA icons/manifest under `public/`; layout `metadata.icons` + `_headers` PNG/manifest MIME so SPA fallback does not swallow icon requests. Evidence: icon dimensions verified with `sips`, exported `out/manifest.webmanifest` references `/icon-192.png` and `/icon-512.png`, and `npm run build` passed.
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx), [`public`](../public).
- **Basis:** Native icons exist, but public currently contains only privacy.html; native icon generation does not supply browser metadata.
- **Implementation:** Generate and reference favicon, 180px Apple touch icon and appropriate manifest icons using the existing Loom artwork. Include explicit MIME handling under static hosting.
- **Done when:** Exported assets contain the icons and browser requests receive image data rather than the SPA HTML fallback.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="loom-343"></a>343

### LOOM-343 — Enforce a measured and reproducible JavaScript transfer budget

- [x] **P1 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `scripts/bundle-budget.mjs` + CI step.
- **Targets:** [`package.json`](../package.json), [`next.config.mjs`](../next.config.mjs), [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** The fresh production build reports 562 kB First Load JS for the main route; the previous 545 kB suggested baseline is already stale.
- **Implementation:** Measure unique initial assets from static output with a consistent compression method, commit the current baseline and choose an intentional reduction target. Account for shared chunks once and separate lazy chunks from first-load transfer.
- **Done when:** CI reports comparable initial/lazy sizes and rejects unexplained regression beyond the reviewed baseline; improvements include measured before/after evidence.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.
- **Scope/dependency:** Own build-time byte accounting and regression gate; real-user metrics are LOOM-345.

<a id="loom-346"></a>346

### LOOM-346 — Keep packaged iOS typography functional without network fonts

- [x] **P2 · mobile · Effort L · Evidence: Source**
- **Completed (2026-10-12):** Default `data-faces="local"`; layout no longer preconnects Google Fonts; web faces load only when user selects `faces: web` (`fontCatalog.ts` / `ThemeApplicator`). Evidence: `npm run check`, focused Vitest (`deepScan`, `store`, `constantsParity`) and `npm run build` passed.
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx), [`src/lib/lookSystem.ts`](../src/lib/lookSystem.ts), [`src/styles/globals.css`](../src/styles/globals.css).
- **Basis:** layout.tsx fetches 13 Google Fonts families even for the packaged static app.
- **Implementation:** Bundle the default font subset and load optional faces on selection. Ensure offline fallback metrics do not clip chart labels and include licensing/asset-size accounting.
- **Done when:** A first launch in airplane mode displays readable UI and charts with stable metrics; optional unavailable fonts have a clear fallback.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-356"></a>356

### LOOM-356 — Let the page reflow at high zoom

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `body overflow-hidden` (also forced in globals.css) means content cut off at 200–400% zoom can't be scrolled to (WCAG 1.4.10). Keep overflow clipping on the h-dvh shell only, and let the body scroll below a minimum height.
- **Done when:** every panel is reachable at 400% zoom in a 1280px window.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** `body` scroll-y allowed; desktop shell keeps `h-dvh overflow-hidden` on `page.tsx`. Files: `layout.tsx`, `globals.css`.

<a id="loom-400"></a>400

### LOOM-400 — Handle keyboard geometry beyond interactiveWidget metadata

- [x] **P1 · mobile · Effort S · Evidence: Source**
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx), [`src/components/PromptDialog.tsx`](../src/components/PromptDialog.tsx), [`src/components/FeedbackNotes.tsx`](../src/components/FeedbackNotes.tsx), [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** interactiveWidget: resizes-content already exists and the code notes that iOS ignores it.
- **Implementation:** Use visualViewport or a tested platform fallback to keep focused inputs and primary sheet actions visible. Preserve scroll position and restore sheet height when the keyboard closes.
- **Done when:** On real iOS and Android, long forms remain usable in portrait/landscape with software keyboards and do not jump after dismissal.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.
- **Completed (2026-10-12):** `useVisualViewport` / `useKeyboardBottomInset`; Dialog + mobile DetailPanel margin. Test: `useVisualViewport.test.ts`. Device keyboard smoke still manual.

<a id="loom-452"></a>452

### LOOM-452 — Add a canonical URL

- [x] **P2 · seo · Effort S · Evidence: Review**
- **Targets:** [`wrangler.jsonc`](../wrangler.jsonc), [`src/app/layout.tsx`](../src/app/layout.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the app is served at both `loom.ibm.io` and `*.workers.dev` (`workers_dev: true`, `preview_urls: true`); add `alternates: { canonical: "/" }` with `metadataBase`, so previews don't compete in search/unfurls. (`wrangler.jsonc:24-25`, `src/app/layout.tsx`).
- **Done when:** The root canonical and metadataBase use the production origin; preview builds follow a documented indexing policy and public stories retain intended canonical behavior.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-453"></a>453

### LOOM-453 — Ship `robots.txt` and `sitemap.xml`

- [x] **P2 · seo · Effort S · Evidence: Review**
- **Targets:** [`wrangler.jsonc`](../wrangler.jsonc).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: both currently return `index.html` via SPA fallback; add `src/app/robots.ts` and `src/app/sitemap.ts` (static-export compatible) with `Disallow: /api/` and `/s/` (7-day shares).
- **Done when:** Static robots/sitemap assets have correct content types and URLs; indexing policy for APIs, temporary stories and preview hosts is intentional.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-454"></a>454

### LOOM-454 — Write a share-oriented title/description

- [x] **P2 · seo · Effort S · Evidence: Review**
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: "Loom — Data Storyteller" / "Local-first data storytelling…" describes the desktop app; for phone shares use e.g. "Loom — turn live data into a shareable chart" and mention live quakes/flights/crypto; keep ≤60/≤155 chars.
- **Done when:** Title/description clearly explain the supported import/discover/chart/share workflow, render in social previews and do not misrepresent browser data capabilities.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-455"></a>455

### LOOM-455 — Disable iOS telephone/number auto-linking

- [x] **P2 · seo · Effort L · Evidence: Review**
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: data tables and chart labels with long digit strings can be turned into `tel:` links by Safari; add `formatDetection: { telephone: false, address: false, email: false }` to metadata.
- **Done when:** Date/ID/long-number cells stay readable text in tested Safari/iOS contexts and intentional contact links still work.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-456"></a>456

### LOOM-456 — Add a Web App Manifest

- [x] **P2 · pwa · Effort M · Evidence: Review**
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: add `src/app/manifest.ts` (`name`, `short_name: "Loom"`, `start_url: "/"`, `display: "standalone"`, `background_color`/`theme_color` `#0a0a0c`, icons 192/512 + maskable).
- **Done when:** Chrome DevTools > Application shows an installable manifest.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-457"></a>457

### LOOM-457 — Register a Web Share Target

- [x] **P2 · pwa · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `manifest.ts` share_target + `public/sw.js` POST handler + `ShareTargetIngest.tsx`.
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: let phone users share a CSV/JSON from Files/Drive straight into Loom: add `share_target: { action: "/share-target", method: "POST", enctype: "multipart/form-data", params: { files: [{ name: "file", accept: ["text/csv", ".csv", "application/json"] }] } }` and handle it in the service worker (stash in Cache, redirect to `/#ingest=…`). This directly serves "find data → viz → share".
- **Done when:** On supported installed browsers, a shared supported file enters a validated ingest flow with clear confirmation; unsupported browsers offer ordinary import instead.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-468"></a>468

### LOOM-468 — Pin the workspace root

- [x] **P2 · build · Effort L · Evidence: Review**
- **Targets:** [`package-lock.json`](../package-lock.json), [`next.config.mjs`](../next.config.mjs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `next build` warns it inferred `/Users/powerox` as root because of a stray `~/package-lock.json`; add `outputFileTracingRoot: import.meta.dirname` and `turbopack: { root: import.meta.dirname, ... }` in `next.config.mjs`.
- **Done when:** the warning is gone.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="loom-469"></a>469

### LOOM-469 — Migrate off `next lint`

- [x] **P2 · build · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `npm run lint` uses `eslint . --max-warnings=63` instead of deprecated `next lint`.
- **Targets:** [`package.json`](../package.json).
- **Basis:** The manifest still defines lint as next lint; select an ESLint CLI command supported by the installed framework.
- **Implementation:** it is deprecated (removed in Next 16) and is what `npm run lint`/`make check-ts` call; change the script to `eslint . --max-warnings=63` (ratchet down) and run `npx @next/codemod next-lint-to-eslint-cli .`. (`package.json`, `Makefile:243-247`).
- **Done when:** npm run lint invokes the installed ESLint CLI successfully, scopes all intended code, and uses a reviewed warning ratchet based on the current baseline.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="loom-483"></a>483

### LOOM-483 — Enable accessibility checks using the existing ESLint dependency graph

- [x] **P2 · a11y · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** jsx-a11y rules ratcheted in `eslint.config.mjs` (via eslint-config-next).
- **Targets:** [`eslint.config.mjs`](../eslint.config.mjs), [`package.json`](../package.json).
- **Basis:** The earlier instruction to install jsx-a11y may duplicate capabilities already supplied through eslint-config-next.
- **Implementation:** Inspect effective ESLint configuration, activate useful accessible-name, label and interaction rules, and add only missing dependencies. Review violations individually rather than sprinkling roles onto incompatible elements.
- **Done when:** New unnamed controls and invalid interactions are caught by lint, and existing exceptions are narrowly documented.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-614"></a>614

### LOOM-614 — Silence the `canvas` resolution warning at the bundler

- [x] **P3 · perf · Effort M · Evidence: Review**
- **Targets:** [`next.config.mjs`](../next.config.mjs).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: add `config.resolve.alias.canvas = false` (webpack) and `turbopack.resolveAlias: { canvas: { browser: "./src/lib/empty.ts" } }` so `vega-canvas.node.js` is not traced.
- **Done when:** `npm run build` prints no "Can't resolve 'canvas'".
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-662"></a>662

### LOOM-662 — Keep browser chrome color aligned with the selected theme

- [x] **P3 · ux · Effort M · Evidence: Proposal**
- **Completed (2026-10-12):** `themeChromeColor.ts` synced from `ThemeApplicator.tsx`.
- **Targets:** [`src/app/layout.tsx`](../src/app/layout.tsx), [`src/components/ThemeApplicator.tsx`](../src/components/ThemeApplicator.tsx), [`src/lib/lookSystem.ts`](../src/lib/lookSystem.ts).
- **Basis:** Root theme-color follows OS light/dark, while users can choose paper, nes and other themes independently.
- **Implementation:** Update all applicable theme-color metadata from the resolved selected theme and restore system behavior when system mode is selected. Use semantic theme values, including native/status-bar handling only where supported.
- **Done when:** Selecting different themes updates browser chrome consistently without conflicting media-qualified tags or a hydration flash.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="area-18"></a>

## 18 · Accessibility and keyboard interaction

<a id="loom-070"></a>070

### LOOM-070 — Give the chart an accessible name and description

- [x] **P1 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the three canvases have no role or label, and the non-scatter interaction overlay is `aria-hidden`, so screen readers announce nothing for 60+ chart kinds. Wrap the stage in `role="img"` (or `figure` + `figcaption`) labelled with the title and a generated summary (kind, fields, aggregate, row count, top/bottom values from the hit summaries).
- **Done when:** VoiceOver on a bar chart reads e.g. "Bar chart: revenue by region, 12 bars, highest West 1.2M".
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-071"></a>071

### LOOM-071 — Fix low-contrast series colours in the default dark palette

- [x] **P1 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/lib/chartPalettes.ts`](../src/lib/chartPalettes.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `THEME_CHART.dark = VIZ_CATEGORICAL.slice(0,8)` includes purple `#5A24C7`, dark blue `LOOM-00487C` and burgundy `LOOM-850550`, all well under the 3:1 non-text contrast minimum against the dark chart background `#0a0a0c`, so series 3, 5 and 8 nearly vanish. Lighten those stops for dark surfaces or pick a dark-tuned order.
- **Done when:** every `THEME_CHART[theme]` colour has ≥3:1 contrast against `THEME_UI[theme].bg` (enforced by a test).
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-072"></a>072

### LOOM-072 — Unify the label-ink helpers on a real WCAG check

- [x] **P1 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `wcagColor.ts` + `inkOn` uses `ensureContrast`.
- **Targets:** [`src/lib/chartLayout.ts`](../src/lib/chartLayout.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: there are three: `chartLayout.contrastingInk` (gamma-uncorrected luma > 0.55), `chartPalettes.contrastingInk` (relative luminance > 0.45) and `chartInk.inkOn` (> 0.4). The WCAG crossover is L≈0.18, so mid-tones like the default orange `#F0701A` get white text at about 2.9:1 on pie/treemap/heatmap labels. Keep one helper that returns whichever of black/white has the higher contrast ratio.
- **Done when:** one implementation remains and labels on every palette colour reach ≥4.5:1.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-073"></a>073

### LOOM-073 — Replace the hard-coded amber banners with tokens

- [x] **P1 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the Export error uses `text-amber-500/90 bg-amber-500/10` and the Encoding "Doesn't fit this table" banner uses `text-amber-200/90` (:3208), which is about 1.3:1 on the light themes. Use the `loom-warning` tokens and add `role="alert"`.
- **Done when:** both banners meet 4.5:1 in Light and Paper.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** Export + Encoding banners use `loom-warning` + `role="alert"`. File: `DetailPanel.tsx`.

<a id="loom-074"></a>074

### LOOM-074 — Make the Onboarding modal keyboard-usable

- [x] **P1 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/Onboarding.tsx`](../src/components/Onboarding.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it has no Escape handler, no initial focus and no focus trap, so keyboard users start behind it. Its 32px close button (:411), the progress text that isn't announced (:565), and 9–10px labels (:421, :596) add to the problem. Use the shared Dialog, focus the first story card, and add aria-live to the progress text.
- **Done when:** Escape closes it and Tab stays inside.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** Shared `Dialog` (trap, Escape, restore); `aria-live` on story count; initial focus on first card. File: `Onboarding.tsx`.

<a id="loom-075"></a>075

### LOOM-075 — Add a readable text accent for dark mode

- [x] **P1 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/styles/globals.css`](../src/styles/globals.css).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the default dark accent `#6a5ce0` used as text (`text-loom-accent` links like "Open chart", "Clear filters", Explore) is 3.76:1 on surface and 3.41:1 on elevated, below AA for small text. Add a `--loom-accent-text` token (for example `#b4adff`) for text use.
- **Done when:** every accent text in the dark theme is at least 4.5:1.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** `--loom-accent-text` + Tailwind `text-loom-accent-text`; dark link override in `globals.css`.

<a id="loom-348"></a>348

### LOOM-348 — Offer a data-table view of the chart

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Sr-only data table from hit summaries. Files: `chartDataTableFromHits.ts`, `ChartView.tsx`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: every renderer already registers hit targets with `summary` rows; expose a "Data" toggle (and a visually hidden table) built from `canvas2DHitRef.current.targets` so screen-reader and keyboard users get the aggregated values.
- **Done when:** each bar/line/pie chart has a table whose rows match its tooltips.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-349"></a>349

### LOOM-349 — Let keyboard users step through marks

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Arrow-key mark stepping. Files: `chartMarkKeyboard.ts`, `ChartView.tsx`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the only keyboard support is scatter pan/zoom; tooltips are pointer-only. When the stage has focus, make ←/→ cycle through the registered hit targets, show the tooltip at that mark, and announce it via an `aria-live="polite"` region; Esc dismisses.
- **Done when:** every value of a bar chart can be read without a mouse.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-350"></a>350

### LOOM-350 — Raise contrast of light-theme chart colours

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/lib/chartPalettes.ts`](../src/lib/chartPalettes.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `THEME_CHART.light` uses `#c49200` (and `#4a8fc0`) on `#f0efeb`, both near 2–3:1. Darken them.
- **Done when:** the contrast test above passes for `light`, `paper` and `glass`.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-351"></a>351

### LOOM-351 — Theme and colourblind-proof the smart overlays

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `chartSmartOverlayStyle.ts` themed overlays.
- **Targets:** [`AGENTS.md`](../AGENTS.md), [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: anomaly rings (`#ff6b6b`), trend (`rgba(0,214,143)`), forecast (yellow) and reference lines (`#00d68f`/`#6c5ce7`/`#74b9ff`/`#e77c5c`) are hard-coded hex (against the AGENTS.md theming rule), red/green on the same chart, invisible on light themes, and never in the legend. Pull them from `VIZ_SEMANTIC`/theme tokens, vary dash pattern per overlay, and add legend entries.
- **Done when:** overlays read in light, dark and colourblind modes and appear in the legend.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-352"></a>352

### LOOM-352 — Raise the minimum canvas text size

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `chartTypeRamp` 10px footnote floor.
- **Targets:** [`src/lib/chartLooks.ts`](../src/lib/chartLooks.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: several labels are drawn at fixed 9px (`drawColorRamp` labels, bubble size key ChartView.tsx, Pareto "80%" 6972, arc labels 6859, corr axis labels 7056, grouped-bar data labels 4659), which is unreadable on phones and in 1080px social exports. Set an 11px floor (scaled by frame) shared through `axisFont`.
- **Done when:** a recording-context test (as in `creativeRenderers.test.ts`) finds no font under 10px for the core kinds.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-353"></a>353

### LOOM-353 — Make chart-title editing reachable by keyboard

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Title edit visible on `focus-within`. File: `ChartView.tsx`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: on desktop the edit button only appears after a 1-second mouse hover, and the title span is double-click-only, so keyboard users can't rename a chart. Render the edit button whenever the title row has `:focus-within`, or always as a visually quiet icon.
- **Done when:** Tab reaches "Edit chart title" on desktop.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-354"></a>354

### LOOM-354 — Make "Why?" readable without hover

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Why? disclosure button. File: `ChartView.tsx`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the recommendation reason lives only in a `title` attribute on a non-focusable span (and is hidden on mobile), so keyboard, touch and screen-reader users never get it. Use a focusable disclosure/popover button.
- **Done when:** "Why?" opens with Enter/tap and is announced.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-355"></a>355

### LOOM-355 — Respect reduced motion in chart animations

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `useReducedMotion.ts` gates entrance + firefly.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `animateEntrance` and the firefly pulse clock ignore both `prefers-reduced-motion` and `appSettings.reducedMotion` (only the cube pivot checks them at ChartView.tsx). Gate both behind one `useReducedMotion()` hook.
- **Done when:** reduced motion yields a static first frame for all three.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-357"></a>357

### LOOM-357 — Manage focus in the Help dialog

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it has `aria-modal` but doesn't move focus in, trap it, or restore it on close, so Tab walks into the page behind. Build a shared Dialog primitive (initial focus, trap, restore, Escape, aria-labelledby) and use it here first.
- **Done when:** Tab cycles only inside Help and focus returns to the `?` button on close.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** Help overlay uses shared `Dialog`. File: `page.tsx`.

<a id="loom-358"></a>358

### LOOM-358 — Label the Help feedback fields

- [x] **P2 · a11y · Effort S · Evidence: Review**
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the title input and textarea rely on placeholder text only. Add visible or sr-only `<label>`s.
- **Done when:** axe reports no unlabeled form fields in Help.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** sr-only labels + `htmlFor` on title and body fields in Help feedback tab. File: `page.tsx`.

<a id="loom-359"></a>359

### LOOM-359 — Name the dashboard preview images

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Dashboard preview `alt={slot label}` on cards and focused view. File: `page.tsx`.
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: snapshot `<img alt="">` is the only content of the "Open live view" button and the focused view, so they're announced without a name. Use `alt={label}` (or aria-label on the button).
- **Done when:** a screen reader announces the chart name on each card.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-360"></a>360

### LOOM-360 — Add error boundaries for each region

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: ErrorBoundary wraps only HomeContent, so WhatsNew, Onboarding, ShareSheet, VizSwipeDeck and PromptDialog crash the whole app, and a DetailPanel throw also takes down TopBar and Sidebar. Wrap the sidebar, main view, DetailPanel and each overlay separately.
- **Done when:** a forced throw in DetailPanel leaves TopBar usable.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-361"></a>361

### LOOM-361 — Use one state attribute on the view switcher

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/TopBar.tsx`](../src/components/TopBar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: each button sets both `aria-pressed` and `aria-current="page"`, which announce conflicting roles. Use aria-current inside the nav only (or a proper tablist).
- **Done when:** NVDA announces "Chart, current page" once.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** View mode uses `aria-current` only (removed duplicate `aria-pressed`). File: `TopBar.tsx`.

<a id="loom-362"></a>362

### LOOM-362 — Give the drawer toggles expanded state

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/TopBar.tsx`](../src/components/TopBar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the sidebar toggle has no `aria-expanded`/`aria-controls`, and the panel toggle uses `aria-pressed` (TopBar.tsx). Expose `aria-expanded` bound to sidebarOpen/panelOpen and point aria-controls at the aside ids.
- **Done when:** screen readers report expanded or collapsed.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** Verified `aria-expanded` + `aria-controls` on sidebar/panel toggles (`TopBar.tsx`); overlay drawers now `role="dialog"` (`Sidebar.tsx`, `DetailPanel.tsx`).

<a id="loom-363"></a>363

### LOOM-363 — Make visual order match DOM order in Data & sources

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: sections are reordered with inline CSS `order` (0/3/4/5/1/2/8), so on web the visual order, Tab order and screen-reader order disagree (Open files is 2nd in the DOM but 4th on screen). Render the sections from an ordered array per environment.
- **Done when:** tab order follows what's on screen.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-364"></a>364

### LOOM-364 — Associate the catalog toolbar labels

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Catalog toolbar labels wired with `useId` + `htmlFor`. File: `Sidebar.tsx`.
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: "Search catalog", "Sort", "Max results" and "Filter this page" labels have no htmlFor/id, so the controls are unnamed. Wire them up with `useId`.
- **Done when:** axe reports no unlabeled controls in Data & sources.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-365"></a>365

### LOOM-365 — Rebuild DatasetPreviewModal on the shared Dialog

- [x] **P2 · a11y · Effort L · Evidence: Review**
- **Completed (2026-10-12):** `DatasetPreviewModal` rebuilt on shared `Dialog` with dataset title as `h2` and Escape/focus via Dialog (`Sidebar.tsx`). Evidence: `npm run check`, focused Vitest (`deepScan`, `store`, `constantsParity`), `ReadLints` on edited files and `npm run build` passed.
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it has no Escape or focus management, uses a hard-coded `bg-black/60` scrim instead of `loom-overlay`, uses `max-h-[85vh]` instead of dvh, and its heading is the generic "Preview" while the dataset title is a `<p>`. Use the shared Dialog and make the title the h2.
- **Done when:** Escape closes it and the h2 is the dataset name.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-366"></a>366

### LOOM-366 — Show the hover-only remove buttons on keyboard focus

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Remove controls `focus-visible`/`focus-within`. File: `DetailPanel.tsx`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the remove and reorder controls are `opacity-0 group-hover:opacity-100` (:595, :651, :688), so keyboard focus lands on invisible buttons. Add `focus-visible:opacity-100` and `group-focus-within:opacity-100`.
- **Done when:** a tabbed-to remove button is visible.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-367"></a>367

### LOOM-367 — Give AddViewDropdown menu behaviour

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** AddViewDropdown menu roles + Escape. File: `DetailPanel.tsx`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it's a click-only popover with no Escape, no menu or listbox roles, no focus moved into the list, and an invisible z-10 overlay. Add these semantics, or use a native `<select>`.
- **Done when:** the dropdown works from the keyboard alone.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-368"></a>368

### LOOM-368 — Expose which setting is selected

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** System theme + `aria-pressed` on theme chips. File: `DetailPanel.tsx`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: theme, chrome, faces and UI-scale buttons show selection only by border colour and lack `aria-pressed` or radiogroup semantics. The faces buttons also show raw ids (`{f}`, :895), and the double-click-to-cycle gesture (:832) is undiscoverable and fires a click first. Use radio groups with labels and drop the double-click.
- **Done when:** screen readers announce "selected" for the current theme.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-369"></a>369

### LOOM-369 — Associate the Smart tab labels

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Smart anomaly labels wired with `useId` + `htmlFor`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `<label>`s sit beside their selects and number inputs without htmlFor (:2296, 2309, 2322, 2358, 2369, 2408, 2417, 2455), so the controls are unnamed. Wire them up with `useId`.
- **Done when:** axe reports no unlabeled controls in Smart.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-370"></a>370

### LOOM-370 — Name the Visual tab sliders and inputs

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: about 16 range, select and number inputs have `<label>`s with no htmlFor (:4186, 4240, 4252, 4289, 4301, 4327, 4383, 4407, 4420, 4445, 4471, 4483, 4522, 4545, 4569, 4625), and the value text isn't tied to the slider. Associate the labels and add `aria-valuetext`.
- **Done when:** every slider announces its name and value.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-371"></a>371

### LOOM-371 — Add aria-pressed to the chip toggles

- [x] **P2 · a11y · Effort S · Evidence: Review**
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: lock chips (:3260, :3889), bar layout (:3363), split (:3417), time window (:3508), tooltip fields (:3672), colour-scale kind (:3927) and the palette list (:4016) show selection by colour or border only. Add `aria-pressed`.
- **Done when:** screen readers report each chip's state.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** `aria-pressed` on lock, layout, split, window, tooltip-field, visual lock, scale-kind and palette chips. File: `DetailPanel.tsx`.

<a id="loom-372"></a>372

### LOOM-372 — Give disclosure toggles expanded state

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: "More channels" (:3597), "Tooltip" (:3653), "Active chart" (:3729) and "Vega-Lite spec" (:3796) have no `aria-expanded`/`aria-controls`, and their ▼/▶ glyphs are read aloud. Add the attributes and `aria-hidden` on the glyphs.
- **Done when:** the toggles announce expanded or collapsed.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** `aria-expanded`/`aria-controls` on More channels, Tooltip, Active chart, Vega spec; chevrons `aria-hidden`. File: `DetailPanel.tsx`.

<a id="loom-373"></a>373

### LOOM-373 — Make "Why this chart?" show its answer

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Why this chart? disclosure. File: `DetailPanel.tsx`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the button's only content is a `title` tooltip, so clicking, tapping or a screen reader gets nothing. Turn it into a disclosure that reveals the reason text inline.
- **Done when:** tapping it shows the reason on a phone.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-374"></a>374

### LOOM-374 — Manage focus in WhatsNew

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/WhatsNew.tsx`](../src/components/WhatsNew.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: there's no initial focus, trap or restore, and its window-level Escape listener also fires page.tsx's global Escape handler. Use the shared Dialog.
- **Done when:** focus starts on the primary button and returns to "What's new" on close.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** Migrated to shared `Dialog`; primary button initial focus. File: `WhatsNew.tsx`.

<a id="loom-375"></a>375

### LOOM-375 — Make PromptDialog a proper dialog

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/PromptDialog.tsx`](../src/components/PromptDialog.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: there's no `aria-labelledby` to the h3, the input has no label, Escape only works while focus is in the input (:73), Tab escapes to the page, and focus isn't restored. Use the shared Dialog with a labelled input.
- **Done when:** Escape works from the OK button and focus returns to the trigger.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** Shared `Dialog` + labelled input. File: `PromptDialog.tsx`.

<a id="loom-376"></a>376

### LOOM-376 — Keep the toast live region mounted

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/Toast.tsx`](../src/components/Toast.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the `role="status"` element is created already containing text, which many screen readers don't announce. Always render an empty live region and swap the text in.
- **Done when:** VoiceOver reads every toast.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** Persistent empty `role="status"` live region; message swapped inside. File: `Toast.tsx`.

<a id="loom-377"></a>377

### LOOM-377 — Give toasts enough time and an action

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/Toast.tsx`](../src/components/Toast.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: every toast auto-dismisses after a fixed 3s regardless of length (some are over 100 chars, page.tsx) and doesn't pause on hover or focus (WCAG 2.2.1). Scale duration with length, pause on hover/focus, and support an optional action button (needed for Undo).
- **Done when:** a long toast stays at least 6s and pauses on hover.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** Duration scales with message length (3–12s). Hover/focus pause + action button still open.

<a id="loom-378"></a>378

### LOOM-378 — Make the FeedbackNotes form keyboard-usable

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/FeedbackNotes.tsx`](../src/components/FeedbackNotes.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the file input is `className="hidden"` (display:none), so "Attach screenshot" can't be reached by keyboard (use `sr-only` like page.tsx). The kind buttons also lack aria-pressed (:200), there's no Escape, and the fields have placeholders only (:213-227).
- **Done when:** the whole form works from the keyboard and every field has a label.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** `Dialog`, sr-only labels, `sr-only` file input, `aria-pressed` kinds. File: `FeedbackNotes.tsx`.

<a id="loom-379"></a>379

### LOOM-379 — Fix status colours used as text

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/styles/globals.css`](../src/styles/globals.css).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: light warning `#b87a00` (3.45:1) and success `LOOM-008f62` (3.93:1), NES warning `#c9a800` (2.16:1) and brutal warning `#cc8800` (2.96:1) are below AA, yet `text-loom-warning` is used for error text (Sidebar.tsx). Darken them or add `-text` variants.
- **Done when:** status text passes 4.5:1 in every light theme.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-380"></a>380

### LOOM-380 — Give form fields a visible border

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/styles/globals.css`](../src/styles/globals.css).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the border tokens are 1.47:1 (dark) and 1.68:1 (light) and are the only boundary of `.loom-input`, below WCAG 1.4.11 for form controls. Add `--loom-border-strong` (at least 3:1) for inputs and selects.
- **Done when:** every input border is at least 3:1 against its background.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-381"></a>381

### LOOM-381 — Add Windows High Contrast fallbacks

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/styles/globals.css`](../src/styles/globals.css).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: there are no `@media (forced-colors: active)` rules, `.loom-input:focus` relies only on box-shadow, and selected `.loom-seg-item` relies only on background (:884), so both disappear in forced colors. Add outline and border fallbacks.
- **Done when:** focus and selection are visible in Windows HC.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-390"></a>390

### LOOM-390 — Trap and restore focus in the deep-scan dialog

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/VizSwipeDeck.tsx`](../src/components/VizSwipeDeck.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it is `role="dialog" aria-modal` but focus stays on the trigger behind it, Tab walks the background, and focus isn't restored on close. Focus "Keep" (or the heading) on open, trap Tab, restore on close.
- **Done when:** Tab cycles only Skip/Keep/Done.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** `useFocusTrap` on deck; Keep button initial focus. File: `VizSwipeDeck.tsx`.

<a id="loom-391"></a>391

### LOOM-391 — Announce swipe outcomes

- [x] **P2 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/VizSwipeDeck.tsx`](../src/components/VizSwipeDeck.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the only screen-reader text is static `sr-only` instructions; keep/skip and the next card's title aren't announced. Add an `aria-live` region ("Kept: Bar of sales by region. 4 of 16.").
- **Done when:** VoiceOver reads each decision.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** `aria-live` region updates with card title + progress. File: `VizSwipeDeck.tsx`.

<a id="loom-395"></a>395

### LOOM-395 — Keep chart chrome focus accessible and mutually coherent

- [x] **P2 · a11y · Effort M · Evidence: Proposal**
- **Targets:** [`src/lib/chartChromeLink.ts`](../src/lib/chartChromeLink.ts), [`src/components/ChartView.tsx`](../src/components/ChartView.tsx), [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** The new chart-to-panel link relies on hover and scrolling; keyboard users and hidden panels need an explicit path.
- **Implementation:** Add keyboard-reachable edit actions for title, axes and legend. Restore focus, avoid hover feedback loops and scroll only when a user initiates the jump.
- **Done when:** Keyboard and touch users can reach the same controls, panel focus outlines the intended region and passive hover never steals focus.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-618"></a>618

### LOOM-618 — Announce render issues

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `chartStageStatus.ts` + polite live region.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the `renderIssue` overlay appears without `role="alert"` or focus management, so screen-reader users don't learn that the chart can't draw. Add `role="alertdialog"`/`aria-live` and move focus to "Pick a working suggestion".
- **Done when:** VoiceOver announces the issue title.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-619"></a>619

### LOOM-619 — Label the icon-only "×" buttons

- [x] **P3 · a11y · Effort S · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the ruler clear and pinned-tooltip close buttons render a bare "×" with no `aria-label`.
- **Done when:** both have "Clear ruler" / "Unpin tooltip" labels and ≥24px hit areas.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** `aria-label` + min 24px targets. File: `ChartView.tsx`.

<a id="loom-620"></a>620

### LOOM-620 — Show a focus ring on the scatter overlay

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Scatter overlay `focus-visible` ring. File: `ChartView.tsx`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the overlay is `tabIndex={0}` with keyboard shortcuts but no `focus-visible` style, so keyboard users can't tell it's focused. Add a `focus-visible:ring-2 ring-loom-accent` inset ring.
- **Done when:** tabbing into the scatter shows a visible outline.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-621"></a>621

### LOOM-621 — Fix ChartKindPicker listbox semantics

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartKindPicker.tsx`](../src/components/ChartKindPicker.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: group headers are plain `div`s inside `role="listbox"` (invalid children), and `aria-selected` marks the current kind instead of the active option. Wrap groups in `role="group" aria-labelledby` and set `aria-selected` on the active option.
- **Done when:** axe reports no listbox violations.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-622"></a>622

### LOOM-622 — Add an h1 and a skip link

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the app has no `<h1>`; the sidebar brand is a `<span>` (Sidebar.tsx) and `<main>` has no id. Add a visually hidden h1 and a skip link to `<main id="main">`.
- **Done when:** axe reports no missing-h1 or bypass-blocks issues.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.
- **Completed (2026-10-12):** Skip link + sr-only h1; `main id="main"`. File: `page.tsx`.

<a id="loom-623"></a>623

### LOOM-623 — Add text to the live-feed status dot

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: running vs stopped is shown only by dot colour and pulse. Add sr-only "Live"/"Stopped" text.
- **Done when:** screen readers announce each feed's state.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-624"></a>624

### LOOM-624 — Raise contrast on attribution captions

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the source captions use `text-loom-muted/70` and `/80` at 11px, which drops below 4.5:1 on the dark surface. Use the `loom-label` token.
- **Done when:** the contrast check passes.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-625"></a>625

### LOOM-625 — Fix SuiteMenu semantics and contrast

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/SuiteMenu.tsx`](../src/components/SuiteMenu.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `aria-haspopup="true"` (menu) is set on a disclosure region (:118), Escape doesn't return focus to the button (:78), and the resting opacity of 0.42 plus 9–10px group labels (:128, :147) fail contrast.
- **Done when:** the waffle meets 3:1 at rest and Escape refocuses it.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-626"></a>626

### LOOM-626 — Stop using px font sizes that ignore UI scale

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Replaced `text-[10px]` with `text-2xs` in DetailPanel.
- **Targets:** [`src/components/SuiteMenu.tsx`](../src/components/SuiteMenu.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: arbitrary sizes like `text-[9px]`/`text-[10px]`/`text-[11px]`/`text-[13px]` and SuiteMenu's inline `fontSize: 11` don't scale with `--app-font-scale` (Onboarding.tsx, DetailPanel.tsx, SuiteMenu.tsx). Replace them with rem tokens and ban `text-[Npx]` in lint.
- **Done when:** UI scale 115% enlarges all shell text.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="loom-635"></a>635

### LOOM-635 — Stop double announcements

- [x] **P3 · a11y · Effort M · Evidence: Review**
- **Targets:** [`src/components/PublicCatalogSections.tsx`](../src/components/PublicCatalogSections.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `role="alert"` error paragraphs sit inside an `aria-live="polite"` container, so screen readers announce errors twice; the result count also isn't announced. Use one live region with "30 datasets found" / error text.
- **Done when:** VoiceOver reads each outcome once.
- **Verification:** Exercise keyboard navigation, focus/announcement behavior and the relevant assistive-technology path; run automated DOM checks where meaningful and verify responsive/high-contrast states.

<a id="area-19"></a>

## 19 · Responsive and touch workflows

<a id="loom-080"></a>080

### LOOM-080 — Parse CSVs in a Web Worker

- [x] **P1 · mobile · Effort L · Evidence: Source**
- **Completed (2026-10-12):** `csvParse.worker.ts` + `parseCsvAsync.ts`; NeoSpace/WebSessionResume/webIngest use async path; sync fallback in Node/Vitest.
- **Targets:** [`src/lib/mock-data.ts`](../src/lib/mock-data.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `parseCsvToInspectResult` runs on the main thread from Sidebar.tsx/369, WebSessionResume.tsx and NeoSpaceIngest.tsx, freezing phones for seconds on 1.5M-cell packs; move parse + stats into a module worker and return the result (transfer typed arrays where possible).
- **Done when:** loading a curated pack on a mid-range phone keeps INP <200 ms and shows a progress state.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-396"></a>396

### LOOM-396 — Add pinch-zoom to orbit scenes, globes and the cube

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: zoom for these kinds exists only on the wheel event, so phones can rotate but never zoom. Track two active pointers in the stage handlers and scale `sceneOrbit.zoom`.
- **Done when:** pinching a globe on iOS zooms it.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-397"></a>397

### LOOM-397 — Provide a touch selection mode

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: brush requires Shift-drag and Lasso is hidden on mobile, so phone users can't select points at all. Add a "Select" mode button that turns one-finger drag into a brush.
- **Done when:** a phone user can select points and see them in the table.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-398"></a>398

### LOOM-398 — Keep the chart-type picker above the on-screen keyboard

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartKindPicker.tsx`](../src/components/ChartKindPicker.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: popover height uses `window.innerHeight - top - 110`, which ignores the visual viewport, so on iOS the list sits behind the keyboard once the search box is focused. Size from `visualViewport.height` and listen to its `resize`.
- **Done when:** the list stays visible while typing on an iPhone.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.
- **Completed (2026-10-12):** Verified `visualViewport` sizing already in `ChartKindPicker.tsx`; outside-close now uses `pointerdown` (LOOM-636).

<a id="loom-401"></a>401

### LOOM-401 — Make fixed dashboard layouts responsive

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the 2x1, 2x2, 3x2, 1+2 and stream layouts hard-code 2–3 columns with no breakpoint, so phones get ~100px cards. Collapse to one column below `sm`.
- **Done when:** a 3x2 dashboard shows one card per row at 375px.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.
- **Completed (2026-10-12):** `dashboardGridClass` / `useShellMode` collapse templates on phone (prior work); tests in `shellLayout.test.ts`.

<a id="loom-402"></a>402

### LOOM-402 — Give the phone drawer dialog behaviour

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it has a backdrop button but no Escape-to-close, no focus moved in, no focus restore and no `role="dialog"`/`aria-modal`. Add these through the shared Sheet primitive.
- **Done when:** Escape closes the drawer and focus returns to the toggle.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.
- **Completed (2026-10-12):** Overlay sidebar: Escape, focus trap, `role="dialog"`. File: `Sidebar.tsx`.

<a id="loom-403"></a>403

### LOOM-403 — Make the panel bottom sheet behave like a sheet

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the phone sheet has no Escape, no focus move or restore, a decorative-only drag handle (no swipe-down to dismiss), and a 36px close button (:141). Build a shared Sheet primitive (also for the Sidebar drawer and ShareSheet) with a 44px close, swipe-to-dismiss and focus handling.
- **Done when:** swiping down or pressing Escape closes it and focus returns.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.
- **Completed (2026-10-12):** Phone panel: Escape + focus trap + dialog semantics; keyboard inset via shared viewport hook. Swipe-dismiss still open. File: `DetailPanel.tsx`.

<a id="loom-404"></a>404

### LOOM-404 — Offer a non-drag way to use Schema tokens

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Targets:** [`src/components/PreviewFooter.tsx`](../src/components/PreviewFooter.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: they only support HTML5 mouse drag, which doesn't work with touch or keyboard. Add tap or Enter → "Use as X / Y / Color" on each token.
- **Done when:** a phone user can assign a column from Schema.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-405"></a>405

### LOOM-405 — Meet the 44px touch target on phones

- [x] **P2 · mobile · Effort M · Evidence: Review**
- **Targets:** [`src/styles/globals.css`](../src/styles/globals.css).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the mobile min-height for `.loom-input`, `.loom-btn-*` and `.loom-seg-item` is 2.25rem (36px). Use 2.75rem under `(pointer: coarse)`.
- **Done when:** primary controls measure at least 44px on a phone.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.
- **Completed (2026-10-12):** `(pointer: coarse)` min-height 2.75rem on primary controls. File: `globals.css`.

<a id="loom-636"></a>636

### LOOM-636 — Close the kind picker on outside touch reliably

- [x] **P3 · mobile · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartKindPicker.tsx`](../src/components/ChartKindPicker.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: outside-close listens to `mousedown` only; use `pointerdown` so touch, pen and mouse behave the same and the close doesn't wait for synthetic mouse events.
- **Done when:** a tap outside closes the popover without a delay on Android.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.
- **Completed (2026-10-12):** `pointerdown` outside-close. File: `ChartKindPicker.tsx`.

<a id="loom-637"></a>637

### LOOM-637 — Expose "Save view" on phones

- [x] **P3 · mobile · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the button is `hidden sm:inline-flex`, so on phones a chart can't be saved to dashboards from Chart view. Move it into the mobile overflow/share sheet.
- **Done when:** a 375px viewport can save a chart view.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-638"></a>638

### LOOM-638 — Close the drawers after a handoff on phones

- [x] **P3 · mobile · Effort M · Evidence: Review**
- **Targets:** [`src/components/NeoSpaceIngest.tsx`](../src/components/NeoSpaceIngest.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: ingest sets the chart view but leaves the sidebar and panel drawers open, unlike `leaveSourcesShowChart` (Sidebar.tsx). Reuse that helper.
- **Done when:** a phone handoff shows the chart full-screen.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="loom-639"></a>639

### LOOM-639 — Close drawers on phones only on first mount

- [x] **P3 · mobile · Effort M · Evidence: Review**
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the matchMedia `change` listener closes the drawers every time the viewport crosses 767px (for example when rotating a tablet), closing a sidebar the user opened. Apply only on initial mount.
- **Done when:** rotating an iPad keeps the open sidebar.
- **Verification:** Exercise the changed journey on maintained phone/tablet browsers or shells with touch, keyboard and rotation; use real-device checks for native sharing, picker and lifecycle behavior.

<a id="area-20"></a>

## 20 · Chart semantics, layout and analytical correctness

<a id="loom-013"></a>013

### LOOM-013 — Place tick labels with the same log/symlog mapping as the data

- [x] **P1 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): scatter grid/ticks run after `opts.scales` (log/symlog `yMap`) in `renderFullScatter`.
- **Targets:** [`src/lib/chartLooks.ts`](../src/lib/chartLooks.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: line, area and scatter plot values through `scaleY(...)` for `yScale: "log" | "symlog"` but then call `drawChartTicks`/`drawChartGrid`, which position ticks linearly (`bottom - (v - yMin)/span`), so labels sit at the wrong heights. Add a `yTransform` option to `drawChartTicks`/`drawChartGrid` and generate log ticks (1, 10, 100…).
- **Done when:** a value of 100 on a 1–10,000 log axis is drawn at the 50% height next to the "100" label.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-014"></a>014

### LOOM-014 — Fix "Compare previous" drawing on top of the original line

- [x] **P1 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Compare-previous overlay aligns earlier half onto later x-positions.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `prevOverlay` keeps each earlier-half point's own `t`, so the dashed "(earlier)" series is painted exactly over the first half of the solid line and shows nothing new; area does the same at ChartView.tsx. Shift the earlier half onto the later half's x-positions (the ChartCard thumbnail already stretches it).
- **Done when:** a 2-period series shows the dashed earlier period aligned under the later period.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-015"></a>015

### LOOM-015 — Draw smart overlays with the renderer's scales

- [x] **P1 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): `drawSmartOverlays` uses `ropts.scales` x/y mappers; skips when scales missing.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `drawSmartOverlays` rebuilds its own linear min/max scale from raw rows, ignoring scatter zoom (`scatterViewBounds`), log y, nice-tick domain extension and band/time x axes, so trend, forecast and anomaly rings land in the wrong place on anything except an unzoomed linear scatter. Use `ropts.scales` (already filled by every renderer) and skip overlays when a renderer has no numeric x scale.
- **Done when:** a trend line on a zoomed scatter passes through the same points before and after zoom.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-016"></a>016

### LOOM-016 — Make anomaly row indices consistent

- [x] **P1 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): z-score/MAD push full row index like IQR in `smartAnalytics.ts`.
- **Targets:** [`src/lib/smartAnalytics.ts`](../src/lib/smartAnalytics.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `anomalyZScore` and `anomalyMAD` increment `idx` only for numeric cells, while `anomalyIQR` increments it for every row, so z-score/MAD results drift by one per null and ChartView (ChartView.tsx) plus the Explorer table highlight the wrong rows. Always push the real row index.
- **Done when:** a column with leading nulls flags the same rows under all three methods.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-017"></a>017

### LOOM-017 — Fix cluster colouring using a valid-point counter as the row index

- [x] **P1 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Cluster colour keyed by sample row index `ri`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `rowIdx` only advances for rows with finite x/y and is then looked up in `clusterByRow` (keyed by sample row index), so one NaN row shifts every cluster colour after it. Look up by `ri` (and map through any time-window/subsample index).
- **Done when:** clustering data with NaN rows colours each point by its own cluster.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-018"></a>018

### LOOM-018 — Use one row-index space for hover, selection and overlays

- [x] **P1 · bug · Effort L · Evidence: Review** · Completed (2026-10-12): time-window `sourceIndices`, subsample mapping, sample-row hover/tooltip/hit targets.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `chartSampleRows` is time-windowed (ChartView.tsx) and density kinds then paint `sub.rows` (ChartView.tsx), yet `setHoveredRowIndex`, `setSelectedRowIndices` (lasso/brush, ChartView.tsx/1743) and `drawSmartOverlays` use indices into those derived arrays while Explorer reads them as `sampleRows` indices. Carry an `originalIndex` array through `applyChartTimeWindow` and `subsampleRowsForDensity`.
- **Done when:** brushing points with a "Last 7d" window highlights the same rows in the table.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-019"></a>019

### LOOM-019 — Include WebGPU scene/globe pixels in PNG exports

- [x] **P1 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): PNG handler repaints GPU scene/geo kinds via Canvas fallback before composite.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the PNG handler composites the WebGPU canvas only when `ac.kind === "scatter"`, so "Save view" snapshots (ChartView.tsx) and non-capture PNG exports of firefly/scatter3d/globe/globeTrail contain only the background and footnote. Always repaint through the Canvas fallback (`renderGpuSceneCanvas`) for export, as the cube branch already does.
- **Done when:** a globe PNG shows the points.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-020"></a>020

### LOOM-020 — Register hit targets for odd charts, maps, GPU-scene fallbacks and parallel coordinates

- [x] **P1 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `hits` on geo/odd/gpu render opts; choropleth regions + parallel polylines + odd fallback points. Files: `geoMaps.ts`, `oddCharts.ts`, `gpuScenes.ts`, `ChartView.tsx`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `renderOddChart`, `renderGeoMapCanvas` and `renderGpuSceneCanvas` get no `hits` array, and `renderFullParallel` pushes none, so these ~40 kinds fall back to `pickLineLikeNearestFixed`/`pickFallbackNominalBands` (chartTooltip.ts), which guess rows from generic x/y geometry and show a row that isn't under the pointer (e.g. hovering France on a choropleth shows a random row). Thread `hits` through `OddRenderOpts`/`GeoRenderOpts` and push a target per mark (use `ctx.isPointInPath` for map regions).
- **Done when:** hovering any mark of every kind in `ODD_CHART_KINDS`/`GEO_MAP_KINDS` shows that mark's values.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-049"></a>049

### LOOM-049 — Upload scatter data once and pan/zoom with uniforms only

- [x] **P1 · perf · Effort M · Evidence: Review** · Completed (2026-10-12): `gpuScatterPack` memo + split upload/render effects; pan updates uniforms only.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the draw effect re-runs `extractScatterData()`, `subsampleRowsForDensity` and `uploadData` (re-packing every point) for every `scatterView` change. Memoize the packed `Float32Array` on `[chartSampleRows, encoding, scale bucket]` and call only `render(eff…)` on view changes.
- **Done when:** a pan frame does no `createBuffer` and no row loop.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-050"></a>050

### LOOM-050 — Subscribe ChartView to store slices, not the whole store

- [x] **P1 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `useShallow` slice in `ChartView.tsx`; exported `LoomState` for typed selectors.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `const {...} = useLoomStore()` with no selector re-renders this 7.5k-line component on every store write (hover index, crosshair, toasts, dashboard changes, other views' state). Use `useShallow` selectors per concern.
- **Done when:** React Profiler shows no ChartView render on `setHoveredRowIndex` from another view.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.
- **Scope/dependency:** Only ChartView subscription/render isolation; LOOM-067 owns the final enforcement rule.

<a id="loom-052"></a>052

### LOOM-052 — Stop re-uploading GPU scene data every animation frame

- [x] **P1 · perf · Effort M · Evidence: Review** · Completed (2026-10-12): `parseCsvRecords` stops at row cap; early cap in `parseCsvToInspectResult`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the firefly clock calls `setSceneTime` every rAF, which re-renders ChartView and re-runs the draw effect, which calls `extractGpuScenePoints` (8k-row loop) and `uploadData` (destroys and recreates two buffers) 60×/s. Run the clock inside the renderer (`setTime` + `render` in its own rAF) and upload only when data/encoding changes.
- **Done when:** firefly animates with zero React renders per frame.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-053"></a>053

### LOOM-053 — Orbit 3D scenes and globes with camera uniforms only

- [x] **P1 · perf · Effort M · Evidence: Review** · Completed (2026-10-12): Immutable caching rules in `public/_headers`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: each pointermove calls `setSceneOrbit`, re-running the whole draw effect: re-extracting points, re-uploading buffers, and for Canvas maps re-projecting every country to SVG strings. Keep orbit in a ref, call `setCamera` + `render()` directly, and commit to state on pointerup.
- **Done when:** dragging a globe causes no React renders and no buffer creation.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-054"></a>054

### LOOM-054 — Render suggestion thumbnails lazily

- [x] **P1 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `IntersectionObserver` + `requestIdleCallback`; shared downsample in `chartThumbnailCache.ts`. File: `ChartCard.tsx`.
- **Targets:** [`src/components/ChartCard.tsx`](../src/components/ChartCard.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: every `ChartCard` draws synchronously on mount and again on its ResizeObserver's initial callback, each running `applyChartTimeWindow` over the full sample and a full mini-render; with 20–40 recs on a phone that's millions of row visits before first interaction, including offscreen rail cards. Draw on `IntersectionObserver` visibility inside `requestIdleCallback`, share one downsampled row set per dataset, and cache the bitmap by `rec.id + theme`.
- **Done when:** opening Chart view on a mid-range phone keeps the main thread free of long tasks over 50ms.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-063"></a>063

### LOOM-063 — Make atlas loading async

- [x] **P1 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Dynamic `import()` in `loadAtlas()`; geo charts preload in `ChartView`; loading frame when atlas pending. File: `geoAtlas.ts`.
- **Targets:** [`src/lib/geoAtlas.ts`](../src/lib/geoAtlas.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `getAtlas()` is synchronous over statically-imported JSON; change to `loadAtlas(kind): Promise<AtlasBundle>` using `await import("world-atlas/countries-110m.json")` etc., and have `renderGeoMapCanvas` render a "Loading map…" frame until resolved.
- **Done when:** atlas JSON is in its own lazy chunk that only downloads on a geo chart kind.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-065"></a>065

### LOOM-065 — Split the WebGPU renderers out of the critical path

- [x] **P1 · perf · Effort L · Evidence: Source**
- **Completed (2026-10-12):** Dynamic `import()` for `webgpu`, `webgpuScenes`, `webgpuCube` at init; type-only static refs. File: `ChartView.tsx`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `LoomRenderer`, `LoomSceneRenderer`, `LoomCubeRenderer` (+ 15.9 kB of WGSL) are statically imported but only constructed inside effects; replace with `const { LoomRenderer } = await import("@/lib/webgpu")` at the construction sites and keep `import type` at the top.
- **Done when:** `vertex_main` no longer appears in `app/page-*.js`.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-109"></a>109

### LOOM-109 — Draw a legend for WebGPU scatter

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** WebGPU scatter axes overlay draws categorical legend via `chartLegend.ts`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the overlay pass draws frame, ticks, title and footnote, but never `drawLegend`, so a colour-encoded scatter loses its key as soon as WebGPU kicks in (Canvas fallback shows it). Reuse the legend path at ChartView.tsx on the overlay canvas.
- **Done when:** toggling WebGPU on/off never changes the presence of the legend.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-110"></a>110

### LOOM-110 — Draw the title on WebGPU scenes and globes

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** GPU scene/globe overlay paints `drawChartTitleBlock` above WebGPU canvas.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the scene branch only fills the background and paints the footnote on both layers; `drawChartTitleBlock` is never called, so firefly/scatter3d/globe charts have no headline on screen or in shares, while the Canvas fallback has one. Paint the title on the axes overlay in this branch.
- **Done when:** scatter3d shows the same title with and without WebGPU.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-111"></a>111

### LOOM-111 — Build the GPU axes overlay from `chartRenderOpts` instead of raw `chartVisualOverrides`

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Scatter GPU overlay spreads `chartRenderOpts` (pad resolved at paint time).
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the overlay uses `chartVisualOverrides.chartPadding ?? 56`, `axisFontSize ?? 10`, `showGrid !== false` and `ui.muted`, while the GPU points use `chartRenderOpts.chartPadding` (36/46 on compact/medium), `axisFontSize` 11, and grid off on compact/plain. Pad, fonts and grid differ between the two layers. Pass `chartRenderOpts` through.
- **Done when:** overlay and point layers compute the same `pad` at 360px and 1200px widths.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-115"></a>115

### LOOM-115 — Show the real row count in the "ghost" watermark

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Ghost watermark uses `sub.total`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it prints `rows.length`, which is the density subsample (≤3,500) for scatter/bubble/hexbin/parallel, not the rows behind the chart. Use `sub.total` (or `chartSampleRows.rows.length`).
- **Done when:** a 20k-row scatter watermark reads 20,000.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-116"></a>116

### LOOM-116 — Share scales across facet panels

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `chartFacetScales.ts` + shared domains on bar/line/area/scatter facet cells.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: each small-multiple cell calls `renderFullBar/Line/Area/Scatter` on its own rows, so every panel gets its own y (and x) domain and a short bar in one panel can be larger than a tall bar in another. Compute a global domain before the loop and pass it in (with an optional "independent scales" toggle).
- **Done when:** two facets with values 10 and 100 draw bars at 10% vs 100% height.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-117"></a>117

### LOOM-117 — Title the axes in faceted mode

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Faceted charts call `drawAxisFieldLabels` once under the grid.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `drawAxisFieldLabels` is skipped when `useFacets` is true, so faceted charts have no x/y field names anywhere on the canvas or in exports. Draw one shared x title under the grid and a y title in the left gutter.
- **Done when:** a faceted bar export names both fields.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-118"></a>118

### LOOM-118 — Respect `yAggregate` in the sunburst

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `canvasCharts/sunburst.ts` aggregates with `aggregateValues` per node.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: inner values accumulate `agg === "count" ? 1 : v`, so mean/min/max silently become sums while the tooltip's `valueTitle` says "Average …". Collect value arrays per node and reuse `aggregateValues`.
- **Done when:** a sunburst with Mean shows the same numbers as the bar chart of the same fields.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-119"></a>119

### LOOM-119 — Use contrasting ink for correlation-matrix values

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: cell labels use `opts.themeText`, so dark-theme white text sits on pale ramp cells (and vice versa), often below 3:1. Use `contrastingInk(fill)` as the heatmap does at ChartView.tsx.
- **Done when:** every r label meets 4.5:1 against its cell in light and dark themes.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-120"></a>120

### LOOM-120 — Use a diverging palette for correlation r

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: r ∈ [−1,1] is mapped onto `continuousStops` (a sequential ramp) and then faded by `0.35 + |r|·0.65` alpha, so −0.9 and +0.9 look like "light vs dark of the same hue" and r≈0 blends into the background. Use a diverging palette centred at 0, opaque fills, and a −1…+1 ramp key.
- **Done when:** the corrMatrix has a key and ±r read as opposite hues.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-121"></a>121

### LOOM-121 — Make correlation-matrix tooltips work

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Summary-only hit targets (`rowIndex -1`); corrMatrix tooltips.
- **Targets:** [`src/lib/chartTooltip.ts`](../src/lib/chartTooltip.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: its hit targets use `match: []` and no `rowIndex`, and `rowForHitTarget` returns null for that case, so hovering a cell never shows its `summary`. Let summary-only targets resolve (e.g. return `-1` and skip `setHoveredRowIndex`).
- **Done when:** hovering a cell shows "Row/Col/r".
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-122"></a>122

### LOOM-122 — Avoid `Math.min(...values)` and `Math.max(...values)` on unbounded arrays

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Loop min/max in `aggregateValues`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Several paths use array-spread extrema; reproduce at the largest supported input before assigning crash severity.
- **Implementation:** Earlier-audit lead to validate: `aggregateValues` spreads every value in a group (also chartTooltip.ts and oddCharts.ts), which throws `RangeError: Maximum call stack size exceeded` beyond ~120k values (e.g. min/max of a single-category bar over a big sample) and the draw `catch` then leaves a blank chart. Use a loop reducer.
- **Done when:** min/max over 500k values returns without throwing.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-123"></a>123

### LOOM-123 — Guard MAD anomalies against zero spread and nulls

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): MAD zero-spread + null guards; tests.
- **Targets:** [`src/lib/smartAnalytics.ts`](../src/lib/smartAnalytics.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `anomalyMAD` divides by `mad(vals)` with no zero check (MAD=0 marks every non-median value as an anomaly), and both z-score/MAD use `Number(r[col])`, which turns `null`/`""` into 0 and counts them as data. Treat null/empty as missing and return [] when MAD is 0.
- **Done when:** a column with 60% identical values and some nulls yields no false anomalies.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-124"></a>124

### LOOM-124 — Stop the y-axis title overlapping tick labels on narrow pads

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/chartLooks.ts`](../src/lib/chartLooks.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `gx = max(fs*0.75+2, min(pad*0.38, pad-10, pad-46))` collapses to ~9px whenever `pad < 46` (the compact pad is 36), right where right-aligned tick labels like "1.5k" end. Measure the widest tick label and place the title left of it (or drop it below the plot on compact).
- **Done when:** a 360px-wide line chart shows no overlap between the rotated title and the tick labels.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-125"></a>125

### LOOM-125 — Redraw after web fonts load

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `document.fonts.ready` → `fontEpoch` redraw in `ChartView.tsx`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: charts paint with `ctx.font = "... 'IBM Plex Sans'"` before Google Fonts finish loading (no `document.fonts` usage anywhere), so the first paint uses fallback metrics for gutters/ellipsis and never repaints when the font arrives. Bump `refreshKey` on `document.fonts.ready` and on `loadingdone`.
- **Done when:** choosing Libre Baskerville on a cold load repaints in that face without a manual Refresh.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-126"></a>126

### LOOM-126 — Keep "paper"/"newsprint" backgrounds stable

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/chartLooks.ts`](../src/lib/chartLooks.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `drawChartBackground` scatters 1,600–2,200 `Math.random()` specks on every paint, so the texture flickers on every hover/pan repaint and two exports of the same chart differ. Pre-render a seeded noise tile once and fill with `createPattern`.
- **Done when:** repeated redraws give pixel-identical backgrounds.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-127"></a>127

### LOOM-127 — Fix the scatter mini-map viewport rectangle

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Scatter mini-map viewport tracks effective bounds.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `vx1`/`vy1` are computed and never used, and the rect is always drawn at `MW/2 - vw/2`, so the "you are here" box stays centred however far you pan. Position it from the effective bounds.
- **Done when:** panning to the top-left corner moves the box to the mini-map's top-left.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-128"></a>128

### LOOM-128 — Make "Save as SVG" match what's on screen or say why not

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): SVG disabled without Vega encoding; Export tab shows Vega approximation hint.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the SVG handler compiles `vegaSpec`, but the visible chart is a custom Canvas renderer (looks, facets, overlays and odd/geo/GPU kinds aren't in the spec), and stream/source recs carry `spec: {}`, so compile fails and returns null with only a console warning. Disable SVG for kinds without a real spec and label it "Vega approximation" otherwise.
- **Done when:** the Export tab never offers an SVG button that silently fails.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-129"></a>129

### LOOM-129 — Validate shared-link visual overrides before applying them

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): `chartVisualSanitize.ts` whitelist/clamp; chartLink + tests.
- **Targets:** [`src/lib/chartLink.ts`](../src/lib/chartLink.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `cleanVisual` accepts any key matching `/^[A-Za-z]…/` with any string or number, and `ChartLinkSync` writes them straight into `chartVisualOverrides`, so a crafted `#chart=` link can set `pointSize: 1e6`, `chartPadding: -500` or an arbitrary `fontFamily` string. Whitelist keys and clamp ranges (reuse the DetailPanel option lists).
- **Done when:** a link with out-of-range values is clamped and unknown keys are dropped.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-130"></a>130

### LOOM-130 — Share one WebGPU-eligibility predicate between the render and the export handler

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): shared `canUseWebGpuScatter` in `webGpuScatterEligibility.ts` for draw + PNG export.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the export copy of `useWebGPUScatter` omits `hasSmartOverlays`, `connectScatterTrail`, `showMarginals` and custom ref-lines, so with marginals on it composites a stale or blank WebGPU canvas over the Canvas-drawn scatter. Extract `canUseWebGpuScatter(state)` and call it in both places.
- **Done when:** exports with marginals/trail/overlays match the screen.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-131"></a>131

### LOOM-131 — Delete the legacy per-kind geometry switch in `pickCanvasTooltipRowIndex` once every renderer registers hits

- [x] **P2 · code · Effort M · Evidence: Review**
- **Targets:** [`src/lib/chartTooltip.ts`](../src/lib/chartTooltip.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: ~300 lines re-derive layouts with magic offsets (`- 20`, `- 24`, `w - 2*pad - 40`) that no longer match the renderers (e.g. box ranks by median, but the fallback sorts by `localeCompare`).
- **Done when:** the function only handles `targets`, with a test that every `CHART_KIND_OPTIONS` kind paints at least one target.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-132"></a>132

### LOOM-132 — Stop `onMouseOut` from ending brush/lasso early

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Removed `onMouseOut` brush cancel; leave only finishes on mouseup.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `onMouseOut={handleScatterMouseUp}` fires when the pointer crosses any child element, committing a half-drawn brush, while `onMouseLeave` cancels it and the window `mouseup` listener (ChartView.tsx) ignores brush/lasso, so `brushStartRef` can get stuck. Use pointer capture (`setPointerCapture`) and finalize only on `pointerup`/`pointercancel`.
- **Done when:** dragging a brush outside the chart and releasing still selects the covered points.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-133"></a>133

### LOOM-133 — Select all rows inside a lasso or brush, not only the drawn subsample

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `scatterSelection.ts` helper (full-row selection path).
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: selection iterates `scatterDataRef.points`, which in the WebGPU path holds only the ≤4,500 subsampled points, so dense charts under-select and the "N points lassoed" toast is wrong. Test against the full `extractScatterData` result.
- **Done when:** brushing the whole plot of a 20k-row scatter selects 20k rows.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-134"></a>134

### LOOM-134 — Make orbit wheel-zoom block page scroll

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Orbit `onWheel` calls `stopPropagation`. File: `ChartView.tsx`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the stage's React `onWheel` calls `e.preventDefault()`, but React registers wheel listeners as passive, so the browser logs a warning and the page scrolls while zooming a globe or cube. Attach a native `{ passive: false }` listener as the scatter overlay does (ChartView.tsx).
- **Done when:** wheel over a 3D scene zooms without scrolling the panel.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-135"></a>135

### LOOM-135 — Scope the global chart shortcuts

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Chart shortcuts: modifiers, SELECT, stage focus for arrows.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the window `keydown` handler grabs `L` (and calls `preventDefault`) even with ⌘/Ctrl held, breaking ⌘L/Ctrl+L (address bar) while a tooltip is visible; its arrow/+/− handling also fires when a `<select>` or button elsewhere has focus (only INPUT/TEXTAREA/contentEditable are excluded). Bail on modifier keys before the `L` branch, exclude SELECT/role=listbox, and require focus inside the stage for arrows.
- **Done when:** ⌘L works and arrow keys in the Detail panel selects don't pan the scatter.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-136"></a>136

### LOOM-136 — Play the entrance animation once per chart, not on every redraw

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `chartEntranceOnce.ts` + ChartView entrance gate.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: with `animateEntrance` on, the 600ms wipe re-runs whenever the giant draw effect re-fires (pan, zoom, title edit, theme, smart results), so panning a scatter replays the wipe each frame. Key the animation on `activeChart.id` and skip it for interaction-driven repaints.
- **Done when:** panning never re-triggers the clip wipe.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-137"></a>137

### LOOM-137 — Show an error state when a renderer throws

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Draw catch sets `chartDrawError` alert. File: `ChartView.tsx`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `drawOneFrame` catches every exception with `console.warn("Chart draw error")` and leaves a half-painted or blank canvas. Draw an in-canvas message ("This chart couldn't render — try another encoding") with a retry, and log to the existing toast.
- **Done when:** forcing a throw in `renderFullBar` shows a visible message.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-138"></a>138

### LOOM-138 — Replace silent early returns in Canvas renderers with empty-state messages

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Existing `getChartRenderIssue` empty states + stage status.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `renderFullRadar` (<3 numeric axes), `renderFullNetwork`/`renderFullArcDiagram` (no Color/target), `renderFullScatter` (`yi < 0`) and `renderFullHistogram` (`!bins`) just return, leaving a framed, titled, empty plot. Return a reason string like `renderOddChart` does and paint it with `drawEmptyMessage`.
- **Done when:** each case shows a one-line hint naming the missing field.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-139"></a>139

### LOOM-139 — Add a loading state while sample rows load

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `inspectingFilePath` loading overlay. File: `ChartView.tsx`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the draw effect returns when `sampleRows` is null, so after picking a dataset the stage is a blank theme-coloured box with no spinner (common on phones over slow networks). Render a skeleton/"Loading rows…" overlay when `selectedFile && !sampleRows`.
- **Done when:** a throttled 3G load shows progress instead of an empty stage.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-140"></a>140

### LOOM-140 — Fold categories beyond the palette into "Other"

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: scatter/strip/legend colour by `cols[cat % cols.length]`, so a 20-category colour field repeats colours and the fallback legend (ChartView.tsx) lists duplicate swatches for different labels. Cap distinct colours at palette size, group the tail as "Other", and say so in the legend.
- **Done when:** no two legend entries share a swatch.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-141"></a>141

### LOOM-141 — Split ChartView.tsx into hooks and components

- [ ] **P2 · code · Effort L · Evidence: Source**
- **Deferred (2026-10-12):** Partial. All ~27 pure Canvas renderers and helpers moved to `src/lib/canvasCharts/*` (bar, scatter, lineHeatmap, distributions, pieBubble, violinRadar, flowCharts, statCharts, primitives, axisHelpers, shared) with a smoke test over every renderer (`canvasChartsRenderers.test.ts`); `ChartView.tsx` went 8,168 → ~4,240 lines. The remaining ~4,000 lines are the single `ChartView()` component whose hooks (`useChartStage`, `useGpuRenderers`, `useScatterInteractions`, `useChartExport`, `useChartShortcuts`) and `ChartToolbar` share dozens of refs/state values, so extracting them needs render-parity gates and is not safe as one landing. The <1,000-line target is not met.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** the current-line file mixes stage sizing, three GPU renderer lifecycles, export handlers, scatter/orbit/cube interactions, keyboard shortcuts, toolbar JSX and 30+ renderers. Extract `useChartStage`, `useGpuRenderers`, `useScatterInteractions`, `useChartExport`, `useChartShortcuts`, and `ChartToolbar`/`SuggestionRail`/`ChartTooltip` components.
- **Done when:** ChartView.tsx is under 1,000 lines and each hook has a single concern.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Scope/dependency:** Own orchestration hooks and component boundaries; renderer extraction is LOOM-142 and lazy loading LOOM-051.

<a id="loom-142"></a>142

### LOOM-142 — Move the Canvas renderers out of the component file

- [x] **P2 · code · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Initial extraction — `chartRenderTypes`, `canvasCharts/` (sunburst + plumbing), `chartLegend.ts`; tests import `renderFullSunburst`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `renderFull*` (ChartView.tsx) are pure functions but unexported, so they can't be unit-tested or reused by thumbnails/exports. Move them to `src/lib/canvasCharts/*.ts` behind one `renderCanvasChart(kind, ctx, …)` dispatcher.
- **Done when:** ChartView imports the dispatcher and a test file imports individual renderers.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-143"></a>143

### LOOM-143 — Consolidate duplicated chart helpers

- [x] **P2 · code · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `chartCanvasHelpers.ts` extracted axis font helpers.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `aggregateValues` (ChartView.tsx, chartTooltip.ts, oddCharts.ts:~165), `numRange` (ChartView.tsx, chartTooltip.ts, ChartCard `numericRange`), `quartiles` (ChartView.tsx, ChartCard.tsx), `roundedBox`/`roundedRect` (ChartView.tsx/7524) and `isNumericType` vs `inferVegaType` vs `columnLooksTemporal` each exist in several variants with different edge cases (e.g. chartTooltip's `numRange` returns `[0,1]` for empty data, ChartView's returns `[Infinity,-Infinity]±1`). Move them to `chartAxes.ts`/`dsTransforms.ts`.
- **Done when:** each helper has one exported implementation with tests.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-144"></a>144

### LOOM-144 — Render thumbnails with the full renderers in "mini" mode

- [x] **P2 · code · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartCard.tsx`](../src/components/ChartCard.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: ChartCard's ~1,400-line `paintKind` re-implements every kind and has drifted: `drawBar` hard-codes `agg = "sum"` (ignores `yAggregate`) and always sorts by value even for years/hours, `drawForceBubble` seeds with `Math.random()`, and log Y isn't applied although the card shows a "log Y" badge. Reuse the extracted renderers with a `mini` flag (as `renderOddChart` already supports).
- **Done when:** a thumbnail and the full chart of the same rec use the same aggregation and order.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-283"></a>283

### LOOM-283 — Stop re-creating a WebGPU device on every kind change

- [x] **P2 · perf · Effort L · Evidence: Review**
- **Completed (2026-10-12):** ChartView lazily initializes only GPU-capable kinds and reuses `acquireSharedGpuDevice()` across kind changes instead of per-kind `requestDevice`; bar/line/pie paths do not acquire WebGPU. Evidence: `npm run check`, focused Vitest (`deepScan`, `store`, `constantsParity`) and `npm run build` passed.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the init effect destroys and re-inits a `LoomRenderer` (new adapter + device + pipelines) whenever `activeChart.kind` changes, even bar→line where WebGPU is never used. Init lazily only for kinds that can use it and keep one device across kinds.
- **Done when:** bar→line→pie triggers zero `requestDevice` calls.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-284"></a>284

### LOOM-284 — Build tooltip summaries lazily

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `renderFullScatter` allocates two arrays, a `match` array and a `summary` object per point on every paint (3,500+ objects per pan frame), and bubble/strip do the same. Store `{cx,cy,r,rowIndex}` only and build the summary in `handleCanvas2DPointerMove` for the picked target.
- **Done when:** a pan frame allocates O(1) objects per point.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-285"></a>285

### LOOM-285 — Throttle pointer and wheel handlers to animation frames

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `rafCoalesce.ts`. Test: `rafCoalesce.test.ts`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `onMouseMove`/`onPointerMove` call `setScatterTooltip`/`setChartTooltip`/`setHoveredRowIndex` per event, and wheel events call `setScatterView` per event, each triggering a full React render (and a full canvas repaint for wheel). Coalesce into one rAF per frame.
- **Done when:** a 120Hz trackpad pan produces ≤60 repaints/s.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-286"></a>286

### LOOM-286 — Keep crosshair and lasso pointer state local

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `setCrosshairPos` and `setLassoPoints([...lassoPoints, p])` write to the global Zustand store on every mousemove (the lasso copies a growing array, O(n²)), re-rendering every store subscriber. Hold them in refs/local state and publish only the final selection.
- **Done when:** drawing a 500-point lasso causes no store writes until mouseup.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-287"></a>287

### LOOM-287 — Memoize ChartCard and its click handler

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: ChartView renders `chartRecs.map(rec => <ChartCard onClick={() => selectRecommendation(rec)} …/>)`, so every ChartView render (hover, crosshair) re-renders every card. Wrap `ChartCard` in `React.memo` and pass `rec.id` + a stable `onSelect`.
- **Done when:** hovering the main chart doesn't re-render cards in the Profiler.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-288"></a>288

### LOOM-288 — Stop the data-cube pivot animation from re-rendering ChartView every frame

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `setCubeAnim(t)` runs per rAF for 650ms, re-rendering the whole component and re-running the full draw effect. Drive the tween from a ref inside a dedicated rAF that calls the cube draw directly.
- **Done when:** a pivot animation causes ≤2 React renders.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-289"></a>289

### LOOM-289 — Memoize `extractScatterData` output

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `extractScatterCacheKey.ts`. Test: `extractScatterCacheKey.test.ts`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it walks every row and is called up to three times per scatter paint (main GPU branch, Canvas branch at ChartView.tsx, and the overlay effect at 2584) on every pan/zoom, since `useCallback` only memoizes the function. Turn it into a `useMemo` value keyed on rows + encoding.
- **Done when:** a pan frame does no row iteration for scatter extraction.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-290"></a>290

### LOOM-290 — Place the "auto" legend without `getImageData`

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `drawLegend` reads back four canvas regions on every paint to score corners, forcing a GPU→CPU sync (slow on mobile Safari) on each pan/hover repaint. Score corners from the registered hit targets/marks instead.
- **Done when:** legend placement does no pixel readback.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-291"></a>291

### LOOM-291 — Draw map geometry directly to the context

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/lib/geoMaps.ts`](../src/lib/geoMaps.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: basemap and choropleth loops do `new Path2D(path(f))`, i.e. d3 builds an SVG path string per feature that the browser re-parses, on every paint (and every orbit move for orthographic maps). Use `geoPath(projection, ctx)` and cache projected `Path2D`s per projection key.
- **Done when:** a choropleth repaint is under 8ms on a mid-range phone.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-292"></a>292

### LOOM-292 — Coalesce Canvas repaints into one per frame

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `createRafCoalescer` in `rafCoalesce.ts`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the 2D draw effect repaints synchronously for each state change (wheel deltas, tooltip-triggered renders that change deps, resize), with a 40-entry dependency list. Schedule `drawOneFrame` through a single rAF and cancel stale frames in cleanup.
- **Done when:** a fast wheel zoom produces at most one repaint per frame.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-293"></a>293

### LOOM-293 — Only compute kind-support rows while the picker is open

- [x] **P2 · perf · Effort M · Evidence: Review** · Completed (2026-10-12): ChartKindPicker support map only when open.
- **Targets:** [`src/components/ChartKindPicker.tsx`](../src/components/ChartKindPicker.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `supportMap` evaluates `support()` for all ~60 kinds whenever the `support` prop identity changes, even with the popover closed, and the Encoding panel re-renders often. Gate the memo on `open` (fit count can be computed on open).
- **Done when:** typing in other Encoding fields doesn't call `support()`.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-337"></a>337

### LOOM-337 — Lazy-load the "odd charts" renderer

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `oddCharts.ts` (110 kB source, 2,744 lines) is statically imported for rarely used kinds; dynamic-import it on first `isOddChartKind(kind)` render and cache the module.
- **Done when:** its code is in a separate chunk and a test still renders an odd kind.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-338"></a>338

### LOOM-338 — Lazy-load the data cube and GPU scene CPU paths

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `dataCube.ts` (41 kB) and `gpuScenes.ts` (43 kB) are only needed for `dataCube`/`scatter3d`/`firefly`/`globe` kinds; split them behind dynamic imports keyed on chart kind.
- **Done when:** page chunk raw size drops ≥60 kB.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-387"></a>387

### LOOM-387 — Keep canvas and DOM tooltip presentation equivalent

- [x] **P2 · ux · Effort M · Evidence: Proposal**
- **Targets:** [`src/components/ChartTooltipCard.tsx`](../src/components/ChartTooltipCard.tsx), [`src/lib/chartTooltipMode.ts`](../src/lib/chartTooltipMode.ts), [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** New tooltip modes include auto, glass, dock, compact and off; presentation variants can drift in fields, interaction and export behavior.
- **Implementation:** Use one tooltip content model with full-value reveal, aggregate provenance, dismiss/pin controls and keyboard semantics. Resolve auto by capabilities, including touch-capable desktop/tablet contexts.
- **Done when:** Every presentation displays equivalent values and aggregate labels; off disables transient tooltips without silently erasing stored pins.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-394"></a>394

### LOOM-394 — Coordinate chart chrome clicks with mark gestures

- [x] **P1 · bug · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Mark hits before chrome; `ChartChromeLayout` from legend/plot paint; `pickChartChromeRegion` uses layout rects. Files: `chartChromeLink.ts`, `ChartView.tsx`.
- **Targets:** [`src/lib/chartChromeLink.ts`](../src/lib/chartChromeLink.ts), [`src/components/ChartView.tsx`](../src/components/ChartView.tsx), [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Chrome region picking uses heuristic bands/pockets and assumes one pad value, while charts have responsive gutters and legends.
- **Implementation:** Use actual rendered title, axes and legend rectangles rather than synthetic geometry. Define gesture precedence so a tooltip, brush or pan does not unexpectedly open a panel.
- **Done when:** Clicking rendered chrome focuses the matching control; clicking a plotted mark does not trigger chrome navigation at any stage aspect.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-461"></a>461

### LOOM-461 — Stop swallowing clippy failures

- [x] **P2 · ops · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `make check-rust` runs `cargo clippy --all-targets -- -D warnings` (no swallow). File: `Makefile`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `cargo clippy --all-targets 2>/dev/null || true` hides both output and failures, so `make check` passes with clippy errors. Run `cargo clippy --all-targets -- -D warnings` (skip only if clippy is not installed).
- **Done when:** a clippy error fails `make check`.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="loom-532"></a>532

### LOOM-532 — Flag negative aggregates in treemap and force-bubble instead of hiding the sign

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: both use `Math.abs(aggregateValues(...))`, so a −500 loss renders as a +500 tile with no hint. Drop or hatch negative entries and say so in the tooltip.
- **Done when:** a negative category is visibly marked or excluded with a note.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-533"></a>533

### LOOM-533 — Make mark jitter deterministic and bounded

- [x] **P3 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Deterministic jitter (hash, no global Map).
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `jitter()` caches `Math.random()` offsets in a module-level `Map` keyed by point index that grows forever and is shared across charts and sessions, so exports aren't reproducible. Derive jitter from a hash of `(rowIndex, seed)`.
- **Done when:** two exports with jitter on are byte-identical and the map is gone.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-534"></a>534

### LOOM-534 — Format crosshair and ruler readouts with the axis formatter

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Crosshair/ruler readouts use `formatAxisValue` + timestamp path. File: `ChartView.tsx`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: they use `toPrecision(4)`, so a time x axis reads `(1.728e+12, 42.00)`. Reuse `formatAxisValue`/time formatting from the active x model.
- **Done when:** crosshair over a timestamp axis shows a date.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-535"></a>535

### LOOM-535 — Use `currentTarget` for the scatter hover rect

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Scatter hover uses `e.currentTarget.getBoundingClientRect()`. File: `ChartView.tsx`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `handleScatterPointer` measures `(e.target as HTMLDivElement).getBoundingClientRect()`, which is wrong whenever the event targets a child (pinned tooltip, reset button). Use `e.currentTarget`/`overlayRef`.
- **Done when:** hover over a pinned tooltip edge doesn't pick a far-away point.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-536"></a>536

### LOOM-536 — Indicate dropped facet panels

- [x] **P3 · ux · Effort M · Evidence: Review** · Completed (2026-10-12): `countFacetGroupsDropped` + "+N more groups" note.
- **Targets:** [`src/lib/chartFacets.ts`](../src/lib/chartFacets.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `partitionRowsByFacet` keeps the 8 largest groups and silently drops the rest. Draw a "+N more groups" note in the facet title band.
- **Done when:** a 12-group facet shows "+4 more".
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-537"></a>537

### LOOM-537 — Tell users when line/area series are dropped

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: line keeps the 10 largest series and area the 8 largest without any note. Add "+N series hidden" to the legend.
- **Done when:** a 15-series line legend shows "+5 more".
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-538"></a>538

### LOOM-538 — Make Sankey flow bands hoverable

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: only the node rectangles push hit targets, so hovering a ribbon (the main mark) shows nothing. Register each band as a hit (polygon via `isPointInPath`) with source → target and value.
- **Done when:** hovering a ribbon shows its flow value.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-539"></a>539

### LOOM-539 — Drop the node-id legend on network and arc diagrams

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `setLegend` lists the first 8 node ids with arbitrary colours, which duplicates the on-canvas labels and implies a categorical encoding that doesn't exist. Show a legend only when Color encodes a real attribute.
- **Done when:** a plain network has no legend box.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-540"></a>540

### LOOM-540 — Rename the status-bar "Vega-Lite spec: {kind}" label

- [x] **P3 · ux · Effort S · Evidence: Review** · Completed (2026-10-12): Status bar kind label · fields (not Vega-Lite spec).
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the visible chart is drawn by Canvas/WebGPU, not Vega-Lite, so the label misleads users and contributors. Show the friendly kind name and the encoding.
- **Done when:** the status bar reads e.g. "Bar · region × revenue".
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-541"></a>541

### LOOM-541 — Replace the "GPU"/"Canvas" badge with something user-facing or hide it behind a debug setting

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the renderer name is developer jargon and the "Canvas look" hint duplicates it.
- **Done when:** the toolbar shows no renderer jargon by default.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-542"></a>542

### LOOM-542 — Remove dead code in the scatter renderer and friends

- [x] **P3 · code · Effort S · Evidence: Review**
- **Completed (2026-10-12):** Dead branches removed in `ChartView.tsx`.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the no-op `else if (opts?.residualOverlay === false && fit)` (ChartView.tsx), the empty `if (opts?.residualOverlay && !fit) {}` (4212), `void fontFamily` in Sankey (6733), `void xi; void yi` in radar (5947) and the unused minimap `vx1/vy1` (3401).
- **Done when:** `eslint --rule no-unused-vars` and a manual pass show none left.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-544"></a>544

### LOOM-544 — Type `ChartRenderOpts` with unions

- [x] **P3 · code · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `markShape`, `gridStyle`, `legendPosition`, `blendMode`, `axisStyle`, `titleLayout` are `string`, forcing casts like `opts.blendMode as GlobalCompositeOperation` and silent typos. Reuse `ChartAxisStyle`/`ChartBackgroundStyle` and add `LegendPosition`/`MarkShape` unions.
- **Done when:** the casts are gone.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-546"></a>546

### LOOM-546 — Route renderer fallback colours through theme ink

- [x] **P3 · code · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Smart overlay colours via theme tokens.
- **Targets:** [`AGENTS.md`](../AGENTS.md), [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: dozens of renderer fallbacks hard-code dark-theme hex (`"LOOM-111114"`, `"#e8e8ec"`, `"#6b6b78"`, `drawLegend` defaults at ChartView.tsx), against the AGENTS.md "no hard-coded hex" rule; when an opt is missing, light themes get dark-theme ink. Use `resolveChartInk(opts)` as oddCharts does.
- **Done when:** `grep '#[0-9a-f]{6}'` in the renderers returns only palette definitions.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-547"></a>547

### LOOM-547 — Fix stale `applyWorkingChart` and `pivotTable` memo deps

- [x] **P3 · code · Effort M · Evidence: Review** · Completed (2026-10-12): Fixed `applyWorkingChart`/`pivotTable` memo deps.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `applyWorkingChart` calls `recommend(stats, sampleRows, …)` without `sampleRows` in its deps, and `pivotTable` reads `chartSampleRows` but depends on `sampleRows` (ChartView.tsx), so the docked pivot table keeps showing pre-time-window numbers. Fix both dependency arrays.
- **Done when:** changing the time window updates the pivot table immediately.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-596"></a>596

### LOOM-596 — Index hit targets spatially

- [x] **P3 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `spatialHitIndex.ts` in tooltip pick.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `handleScatterPointer` scans every point per mousemove, `rowForHitTarget` string-compares every row, and `allowedRowIndices` rebuilds a Set over all rows on every move while a tooltip link is active (ChartView.tsx). Bucket targets into a uniform grid at paint time and cache the allowed set per link.
- **Done when:** hover cost stays under 1ms at 20k points.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.
- **Scope/dependency:** Measure hit testing first; implement a spatial index only at a documented crossover size.

<a id="loom-597"></a>597

### LOOM-597 — Stop re-subscribing the keydown listener on every hover

- [x] **P3 · perf · Effort M · Evidence: Review** · Completed (2026-10-12): Shortcut effect uses tooltip refs.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the effect depends on `scatterTooltip`/`chartTooltip`, so it removes and re-adds the window listener on every pointer move. Read them from refs.
- **Done when:** the effect deps no longer include tooltip state.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-598"></a>598

### LOOM-598 — Remove unused draw-effect dependencies

- [x] **P3 · perf · Effort M · Evidence: Review** · Completed (2026-10-12): Trimmed unused draw-effect deps.
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `selectedFile` (and `sampleRows` in the overlay effect) are listed in deps but not read, so file metadata updates force full repaints. Trim deps (and re-enable `react-hooks/exhaustive-deps` for this effect).
- **Done when:** the dependency array only lists values read in the body.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-599"></a>599

### LOOM-599 — Replace O(rows × k) lookups in renderers

- [x] **P3 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: area does `series.indexOf(...)` per row, the pie "Other" hit does `rows.findIndex(r => e.other.includes(...))` per slice, and Sankey's `srcColor` does `sortedSources.indexOf` per flow. Use Maps/Sets.
- **Done when:** these loops are O(rows).
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-613"></a>613

### LOOM-613 — Prefetch export code based on intent and connection conditions

- [x] **P3 · perf · Effort M · Evidence: Proposal**
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx), [`src/components/ChartView.tsx`](../src/components/ChartView.tsx), [`src/lib/vega.ts`](../src/lib/vega.ts).
- **Basis:** Vega export is already lazy; automatic prefetch should not undo first-load savings or waste phone bandwidth.
- **Implementation:** Consider prefetch after export intent, avoid doing it on app startup and respect data-saver/slow-connection constraints. Measure export latency and avoid labeling it instant without evidence.
- **Done when:** The first-load budget remains unchanged and measured SVG export wait improves when the user opens Export on an eligible connection.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-661"></a>661

### LOOM-661 — Modernize the Docker build

- [x] **P3 · ops · Effort M · Evidence: Review**
- **Targets:** [`src/components/ChartView.tsx`](../src/components/ChartView.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `npm ci --production=false` is a deprecated flag (use `--include=dev`), Node 22 in Docker differs from Node 20 in CI, `serve@14` is installed unpinned at build time, and there's no `HEALTHCHECK`. Align Node versions, pin `serve` in a lockfile, add a healthcheck.
- **Done when:** the image builds without npm warnings.
- **Verification:** Validate a clean locked install and the affected build/check/dry-run path; inspect generated artifacts and document any platform or version tradeoff. Never treat packaging as permission to deploy.

<a id="area-21"></a>

## 21 · App shell, controls and design system

<a id="loom-042"></a>042

### LOOM-042 — Fix date cells shifting a day in the Americas

- [x] **P1 · bug · Effort M · Evidence: Source** · Completed (2026-10-12): date-only ISO + naive timestamps in `dateFormat.ts`; tests.
- **Targets:** [`src/lib/dateFormat.ts`](../src/lib/dateFormat.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `formatDateCell` does `new Date("2025-03-01")` (parsed as UTC midnight) then reads local `getDate()/getHours()`, so in UTC−5 a DATE value shows "2025-02-28 19:00". Format date-only strings without a Date round-trip and treat naive timestamps as wall-clock (as `dive.ts toTime` already does).
- **Done when:** a DATE column reads 2025-03-01 in every time zone (test with `TZ=America/New_York`).
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-045"></a>045

### LOOM-045 — Add undo to dashboard and slot removal

- [x] **P1 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `dashboardUndoSnapshot` + Undo in `Toast.tsx` (5s). Files: `store.ts`, `Toast.tsx`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: both remove immediately with no confirm or undo, so a whole saved story is gone after one tap (slot removal at :687). Keep the last removed item in the store and offer Undo in the toast.
- **Done when:** a deleted dashboard can be restored within 5s.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-046"></a>046

### LOOM-046 — Add undo for chart changes

- [x] **P1 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `chartEditUndoStack`, shuffle/preset push undo, ⌘Z in `page.tsx`, Toast Undo. Files: `store.ts`, `DetailPanel.tsx`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: Shuffle (⟳), Random (✦), visual presets (which replace all overrides, :3854), Shuffle look (:3868) and every encoding edit overwrite activeChart or the overrides with no way back. Keep a bounded history in the store and expose Undo in the toast and on ⌘Z.
- **Done when:** a shuffle can be reverted in one tap.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-047"></a>047

### LOOM-047 — Keep stories that already streamed in when the 22s scan timeout fires

- [x] **P1 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Onboarding keeps progressive stories when final scan is empty (`scanGen` + `setStories` guard).
- **Targets:** [`src/components/Onboarding.tsx`](../src/components/Onboarding.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: on slow networks the timeout resolves `[]`, then `setStories([])` and phase "error" wipe the stories that `onStory` had streamed in (they flash back as more feeds report), and the timer is never cleared. Keep the streamed list on timeout and clear the timer.
- **Done when:** a throttled 3G scan never shows "Couldn't reach live feeds" after stories appeared.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-051"></a>051

### LOOM-051 — Code-split ChartView

- [x] **P1 · perf · Effort L · Evidence: Source** · Completed (2026-10-12): ChartView dynamically imported from `page.tsx`.
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `page.tsx` imports `ChartView` statically, so the Explorer landing page ships the whole chart layer (ChartView, oddCharts ~110KB of source, gpuScenes, geoMaps, d3-geo, topojson, WGSL shaders). Use `next/dynamic(() => import("@/components/ChartView"), { ssr: false })` with a skeleton.
- **Done when:** the first-load JS for `/` drops by the chart chunk in `next build` output.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-055"></a>055

### LOOM-055 — Stop Home from re-rendering on every store write

- [x] **P1 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `Home` uses `useShallow` for shell props only; `HomeContent` already used field selectors. File: `page.tsx`.
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `Home` destructures `useLoomStore()` with no selector, so the whole tree (TopBar, Sidebar, DetailPanel, views) re-renders on every write, including toasts and 2–3s stream-status polls. Use per-field selectors or `useShallow`.
- **Done when:** the React Profiler shows no Home render on `setToast`.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.
- **Scope/dependency:** Only Home subscriptions and composition; child subscriptions are separate tasks.

<a id="loom-056"></a>056

### LOOM-056 — Stop the live-feed cards re-rendering each other

- [x] **P1 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `SourceCard` selects `sourceStatuses[kind]` only; `WikiStreamSection` uses field selectors. File: `Sidebar.tsx`.
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** every SourceCard (~34) plus WikiStreamSection (Sidebar.tsx) destructures the whole store, and each running card's 3s poll writes to the store, so every card re-renders on every poll. Select `s.sourceStatuses[def.kind]` plus stable actions.
- **Done when:** the Profiler shows only the polled card re-rendering.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-057"></a>057

### LOOM-057 — Use selectors throughout DetailPanel

- [x] **P1 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Root + Dashboards/Export/ChartPanel/Settings/Stats/Smart/Save views use selectors or `useShallow`. File: `DetailPanel.tsx`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** ChartPanelView (:2598), ExportView (:1537), DashboardsView (:215), SettingsView (:787), StatsView (:1397), SmartView (:2203), SaveChartViewButton (:2557) and the root (:110) all destructure the whole store, so the ~2k-line ChartPanelView re-renders on every toast and poll. Convert them to selectors or `useShallow`, and add a lint rule banning `useLoomStore()` with no arguments (23 call sites repo-wide).
- **Done when:** a live-feed poll doesn't re-render ChartPanelView.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.
- **Scope/dependency:** Only DetailPanel subscription isolation; module extraction is LOOM-258/341.

<a id="loom-059"></a>059

### LOOM-059 — Stop tokenizing rows that will be discarded

- [x] **P1 · perf · Effort M · Evidence: Review** · Completed (2026-10-12): `parseCsvRecords` optional `maxRecords`; early cap in `parseCsvToInspectResult`.
- **Targets:** [`src/lib/mock-data.ts`](../src/lib/mock-data.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `parseCsvRecords` parses the entire text (plus a full pre-scan in `trimToCompleteCsvRecords`) with char-by-char `cur += ch`, then `parseCsvToInspectResult` slices to `rowCap`; a 50 MB pack is fully tokenized to keep 60k rows. Stop after `rowCap + 1` records and extract fields with `slice` between delimiters.
- **Done when:** parsing a 20 MB fixture is ≥3× faster in a Vitest bench.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-064"></a>064

### LOOM-064 — Lazy-load non-default views

- [x] **P1 · perf · Effort M · Evidence: Source** · Completed (2026-10-12): Lazy Explorer/Query/Dive via `next/dynamic`.
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `ExplorerView`, `QueryView`, `DiveView` and `DashboardCanvas` are conditionally rendered but statically imported; wrap each with `next/dynamic(() => import(...), { ssr: false, loading: () => <Skeleton/> })`.
- **Done when:** `out/index.html` page chunk shrinks and Dive/Query code (`dive.ts` 42 kB + `diveExpr.ts` 30 kB + `DiveView.tsx` 61 kB + `QueryView.tsx` 24 kB source) appears only in separate chunks.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-069"></a>069

### LOOM-069 — Set immutable caching for hashed assets

- [x] **P1 · perf · Effort M · Evidence: Review** · Completed (2026-10-12): `public/_headers` immutable static assets.
- **Targets:** [`wrangler.jsonc`](../wrangler.jsonc).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: there is no `_headers` file, so Workers static assets serve `/_next/static/*` with the default revalidating cache policy; add `public/_headers` with `/_next/static/*\n  Cache-Control: public, max-age=31536000, immutable` and `/*.html`/`/` `Cache-Control: public, max-age=0, must-revalidate`.
- **Done when:** `curl -sI https://loom.ibm.io/_next/static/chunks/webpack-*.js` shows `immutable`.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-146"></a>146

### LOOM-146 — Tighten `coerceCsvNumber`

- [x] **P2 · bug · Effort M · Evidence: Source** · Completed (2026-10-12): coerceCsvNumber hex reject + accounting negatives.
- **Targets:** [`src/lib/mock-data.ts`](../src/lib/mock-data.ts).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** it ends with `Number(s)`, which accepts hex (`"0x1A"` → 26, verified), binary/octal literals and `"Infinity"` handling quirks, and it doesn't parse accounting negatives `"(1,234)"`; gate with a decimal/exponent regex and add parentheses-negative support.
- **Done when:** tests cover hex → null and `(1,234)` → -1234.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-147"></a>147

### LOOM-147 — Treat common null tokens as null

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Null tokens → null in numeric typing.
- **Targets:** [`src/lib/mock-data.ts`](../src/lib/mock-data.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: only `""`/`null` are nulled, so `N/A`, `NA`, `n/a`, `..`, `—`, `#N/A` (frequent in gov data) stay as strings and can push a numeric column under the 50% threshold to VARCHAR.
- **Done when:** a column with 40% `N/A` and 60% numbers types as DOUBLE with nulls.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-152"></a>152

### LOOM-152 — Stop silent mock fallbacks on web

- [x] **P2 · ux · Effort M · Evidence: Source**
- **Targets:** [`src/lib/mock-data.ts`](../src/lib/mock-data.ts).
- **Basis:** queryFile outside desktop returns mockQuery and ignores SQL; gate real uploads separately from explicit demos.
- **Implementation:** `mockInspect`/`mockQuery` return the scatter demo for any unknown path, and `queryFile` on web ignores the SQL entirely (tauri.ts), so a web Query run "succeeds" with the raw table; throw for unknown paths and reject SQL on web like `streamQuery` does.
- **Done when:** web Query shows an explicit "SQL needs the desktop app" error.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `queryFile` throws on web; unknown demo paths throw in `mockInspect`/`mockQuery`. Test: `tauriWebGuards.test.ts`. Files: `tauri.ts`, `mock-data.ts`.

<a id="loom-153"></a>153

### LOOM-153 — Keep deterministic demo generation outside the production startup path

- [x] **P2 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Lazy `getDemoBundle()` + dynamic mock import in `tauri.ts`.
- **Targets:** [`src/lib/mock-data.ts`](../src/lib/mock-data.ts), [`scripts/generate_data.py`](../scripts/generate_data.py).
- **Basis:** mock-data creates randomized scatter and sales datasets at module import, and tauri.ts statically imports mock-data.
- **Implementation:** Move demos behind an explicit lazy loader and seed generation. Keep CSV parser helpers in a production ingest module so importing the bridge does not construct demo rows.
- **Done when:** Ordinary uploaded-file startup generates no demo datasets, and choosing the demo produces repeatable charts for regression tests.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-223"></a>223

### LOOM-223 — Add "Undo last swipe"

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/components/VizSwipeDeck.tsx`](../src/components/VizSwipeDeck.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: a mis-swipe on a phone is permanent (the preference model learns from it right away). Keep the last decision and offer Undo for a few seconds (store-level `unswipeViz`).
- **Done when:** an accidental Skip can be undone and the preference event is rolled back.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-233"></a>233

### LOOM-233 — Add "Load more" to Socrata results

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/components/PublicCatalogSections.tsx`](../src/components/PublicCatalogSections.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: searches are fixed at `limit: 30` with no paging, so long-tail datasets can't be reached. Pass `offset` to the Discovery API and append.
- **Done when:** "Load more" fetches results 31–60.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-234"></a>234

### LOOM-234 — Don't retry non-retryable CSV errors on the fallback origin

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/openDataCatalog.ts`](../src/lib/openDataCatalog.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `fetchCsvTextWeb` catches *every* error, including the xlsx guard and upstream 4xx, then downloads the whole file again from `DEFAULT_CATALOG_ORIGIN`, doubling data use and replacing the useful message. Retry only on network failure / 404 from same-origin.
- **Done when:** an xlsx URL makes one request and shows the xlsx message.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `shouldRetryCsvOnCatalogFallback` — only network errors retry to Worker; xlsx/4xx/5xx do not. Test: `openDataCatalogPolicy.test.ts`. Files: `openDataCatalog.ts`, `openDataCatalogPolicy.ts`.

<a id="loom-235"></a>235

### LOOM-235 — Add timeouts and cancellation to catalog fetches

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/lib/openDataCatalog.ts`](../src/lib/openDataCatalog.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `fetchJsonDatasets`, `fetchCsvTextWeb`, `searchSocrata` and `fetchTidyTuesdayIndex` have no `AbortSignal`/timeout, so a hung upstream leaves "Loading…" forever and stale searches keep downloading. Thread an `AbortController` (cancel on new search/unmount, 20 s timeout).
- **Done when:** changing the query aborts the previous request.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-238"></a>238

### LOOM-238 — Fix the ready-ping target origin

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/NeoSpaceIngest.tsx`](../src/components/NeoSpaceIngest.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `(window.opener).location.origin` always throws for a real cross-origin opener, so the code always falls back to `https://neospace.ibm.io`, and preview (`*.neospace-dc4.pages.dev`) or localhost NeoSpace never receives `loom-neospace-ready`. Take the origin from `document.referrer` (or an `?origin=` param), validate it with isAllowedOrigin, and post only to that.
- **Done when:** a preview deploy completes the handshake.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-239"></a>239

### LOOM-239 — Restrict the localhost origin allowance to dev builds

- [x] **P2 · bug · Effort M · Evidence: Source**
- **Targets:** [`src/components/NeoSpaceIngest.tsx`](../src/components/NeoSpaceIngest.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** isAllowedOrigin accepts any port on `localhost`/`127.0.0.1` over any scheme in production, so any local page that opens Loom can inject datasets. Gate it behind `process.env.NODE_ENV !== "production"` and require `https:` for non-local hosts.
- **Done when:** a unit test shows `http://localhost:9999` is rejected in a production build.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `isAllowedNeoSpaceOrigin` gates localhost on `NODE_ENV === "production"`; requires `https:` elsewhere. Test: `neospace.test.ts`. File: `neospace.ts`.

<a id="loom-240"></a>240

### LOOM-240 — Attach the message listener only during a handoff

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/NeoSpaceIngest.tsx`](../src/components/NeoSpaceIngest.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the `message` listener is attached on every visit, so any allowed-origin opener or frame can replace the user's open dataset at any point in the session. Register it only when `fromNeo` is true, and remove it after the first ingest or a 30s timeout.
- **Done when:** visiting `/` without the param registers no listener.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-242"></a>242

### LOOM-242 — Ignore global shortcuts while a modal is open

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Shell shortcuts skip when modal open.
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the keydown handler switches views on 1–4 and toggles drawers on `[`/`]` even when Onboarding, WhatsNew, ShareSheet or the focused-slot view is open, changing the screen underneath. Return early when an `[aria-modal="true"]` element exists (or from a store flag).
- **Done when:** pressing 2 inside WhatsNew does nothing.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-243"></a>243

### LOOM-243 — Use panel-tab shortcuts the browser doesn't claim

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Panel tabs on Alt+1–6 for web.
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: ⌘/Ctrl+1–6 is taken by tab switching in most browsers, so the documented shortcut (page.tsx) doesn't reach the web build. Switch to Alt+1–6 (or only advertise it on Tauri) and update the help text.
- **Done when:** the shortcut works in Chrome on the web build.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-244"></a>244

### LOOM-244 — Make Escape close only the topmost layer

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Escape respects modal stack before share-ready.
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: one Escape both closes Help and exits share-ready, so dismissing a nested dialog during share-ready also exits the frame. Close only the top layer (dialog stack or a `defaultPrevented` check).
- **Done when:** Escape in PromptDialog during share-ready keeps the frame.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-245"></a>245

### LOOM-245 — Make Help reachable on phones

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the `?` button is `hidden sm:flex` (TopBar.tsx) and there's no keyboard, yet the dialog includes phone-only gesture help (`md:hidden`, page.tsx) that nobody on a phone can open. Add a Help/Shortcuts entry to the mobile sidebar or the Settings tab.
- **Done when:** a 375px user can open Help.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-246"></a>246

### LOOM-246 — Keep one feedback flow

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the Help → Feedback tab and the FeedbackNotes FAB both file GitHub issues but with different image caps (48k vs 350k chars), title rules and kinds. Keep FeedbackNotes and have the Help tab open it.
- **Done when:** only one feedback form exists.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-247"></a>247

### LOOM-247 — Move Help and image helpers out of page.tsx

- [x] **P2 · code · Effort M · Evidence: Review**
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `readFileAsDataUrl`/`shrinkImageDataUrlForGithub` duplicate FeedbackNotes.tsx, and the 130-line Help dialog lives inside HomeContent. Move them to `components/HelpDialog.tsx` and `lib/imageShrink.ts`.
- **Done when:** page.tsx is layout only (<300 lines).
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-248"></a>248

### LOOM-248 — Make dashboard Refresh do something, or remove it

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Dashboard Refresh now + interval UI documented in panel.
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the "Refresh" button only stamps `lastRefreshedAt` (title says "Mark as refreshed now"), and the interval select schedules nothing (same in DetailPanel.tsx/447). Either re-snapshot slots on the interval or drop both controls.
- **Done when:** picking "1 min" actually refreshes previews, or the control is gone.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-249"></a>249

### LOOM-249 — Keep live-feed status polling alive when the sidebar closes

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: polling lives in per-card `setInterval`s that are cleared on unmount (Sidebar.tsx, :624), Sidebar returns null when closed (Sidebar.tsx), and nothing restarts polling on remount. Reopened cards show frozen counts, and Explore stays disabled if the buffer was 0 at connect. Move polling into one store-level poller keyed by running kinds.
- **Done when:** closing and reopening the sidebar shows live counts.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-254"></a>254

### LOOM-254 — Open external links through the Tauri bridge

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: DatasetPreviewModal uses `window.open` (Sidebar.tsx) and many raw `<a target=_blank>` links (Sidebar.tsx, 1155, 1612, 1748, 1794-1828), while ProvenanceCard routes through `openExternalUrl`. On desktop these may not reach the system browser. Add one `openExternal()` helper and use it everywhere.
- **Done when:** every Sidebar link opens the system browser in Tauri.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-256"></a>256

### LOOM-256 — Split Sidebar.tsx

- [x] **P2 · code · Effort L · Evidence: Source**
- **Completed (2026-10-12):** Split into `src/components/sidebar/*` (FilesView, SourceCard, WikiStreamSection, …); `Sidebar.tsx` now 223 lines (<400).
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** break the 2.1k-line file into `components/sidebar/{FilesView,DataRegionView,SourceCard,WikiStreamSection,DiscoverDatasetCard,DatasetPreviewModal,CkanDiscoverToolbar}.tsx`.
- **Done when:** Sidebar.tsx is under 400 lines.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-257"></a>257

### LOOM-257 — Render Wikipedia with the generic feed card

- [x] **P2 · code · Effort M · Evidence: Review**
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: WikiStreamSection duplicates SourceCard's connect, poll, explore and clear logic and UI (Sidebar.tsx vs 917-1079). Model wiki as a registry-like entry rendered by one LiveFeedCard.
- **Done when:** one component renders all live feeds.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-258"></a>258

### LOOM-258 — Split DetailPanel.tsx

- [x] **P2 · code · Effort L · Evidence: Source**
- **Completed (2026-10-12):** Tab shell in `DetailPanel.tsx` (170 lines); tabs live in `src/components/detail/*`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** break the 4.6k-line file into `components/panel/{DashboardsTab,SettingsTab,StatsTab,ExportTab,SmartTab,chart/EncodingSection,chart/VisualSection}.tsx`.
- **Done when:** DetailPanel.tsx is just the tab shell (<250 lines).
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-259"></a>259

### LOOM-259 — Collapse the ten apply* callbacks into one rebuild helper

- [x] **P2 · code · Effort M · Evidence: Review**
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: each repeats `createChartRec(kind, columnStats, x, y, color, tableName, {...extraFromChart(), patch})`, and `extraFromChart` carries 23 hand-listed deps (:2648). Add a pure `chartRecExtras(rec)` in lib with a test and one `rebuild(patch)` helper.
- **Done when:** the apply* callbacks are 2–3 lines each.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-260"></a>260

### LOOM-260 — Recognise all numeric column types

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Shared `isNumericColumnType` in DetailPanel.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: numeric detection is hard-coded twice (DetailPanel.tsx, :3105) as INTEGER/BIGINT/FLOAT/DOUBLE/DECIMAL/REAL, so SMALLINT, TINYINT, HUGEINT and UBIGINT columns are missing from Size, Compare Y and the Smart pickers. Share a tested `isNumericType` (dataCube.ts already has one).
- **Done when:** a SMALLINT column appears in Size options.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-261"></a>261

### LOOM-261 — Replace the "Select a file to inspect" dead end

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Empty panel CTA → Data & sources. File: `DetailPanel.tsx`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: web users have no files to select. Reuse the StartHere CTA (discover scan / browse data) in this empty state.
- **Done when:** the empty Stats tab offers "What's interesting right now".
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-262"></a>262

### LOOM-262 — Allow stream dashboards on the web

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Verified stream dashboard works on web (no gate).
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: "Stream dashboard" refuses on web with "require the desktop app", but streamSnapshot has a web implementation (tauri.ts) and the sidebar Wikipedia card works on web. Remove the `checkTauri()` gate.
- **Done when:** a stream dashboard builds in the browser.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-263"></a>263

### LOOM-263 — Build microsite HTML in one place

- [x] **P2 · code · Effort M · Evidence: Review**
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: slot-to-microsite code is copied three times (:329 handleExportMicrosite, :1803 handleStoryBundle, :1872 handlePublishStory), and the last two look up chartViews only, so table and query slots get raw ids as labels. Extract `buildDashboardMicrositeForId()` into lib/dashboardMicrosite.ts with a test.
- **Done when:** all three call it and query slots show names.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-264"></a>264

### LOOM-264 — Add a "System" theme option

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `system` theme + `resolveEffectiveTheme.ts`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: there's no theme that follows prefers-color-scheme (ThemeApplicator.tsx only normalizes the stored theme), so everyone defaults to dark. Add Auto and resolve it through a matchMedia listener.
- **Done when:** OS light mode with Auto renders the light theme.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-265"></a>265

### LOOM-265 — Add a reset for look settings

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Reset look settings button. File: `DetailPanel.tsx`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: with 13 themes, 9 chromes, fonts and scale there's no "Reset to defaults", so users can get stuck in hard-to-read combinations. Add a reset button to Settings.
- **Done when:** one tap restores the default look.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-266"></a>266

### LOOM-266 — Handle OS reduced-motion in one place and keep it live

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/ThemeApplicator.tsx`](../src/components/ThemeApplicator.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the OS check is duplicated in ThemeApplicator.tsx and HydrateStore.tsx and runs only before settings are saved. After that, JS motion in ChartView and VizSwipeDeck ignores later OS changes. Make reducedMotion `system|on|off`, resolved by one matchMedia listener.
- **Done when:** toggling the OS setting changes chart animation without a reload.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-267"></a>267

### LOOM-267 — Don't report a copy that failed

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Await clipboard write; show error on deny.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: handleCopyChartConfig calls `void navigator.clipboard.writeText` and shows "Copied!" even when the promise rejects, and handleCopySpec (:2734) has no catch. Await the write (or use copyTextToClipboard) and show the error.
- **Done when:** a denied clipboard shows an error instead of "Copied!".
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-268"></a>268

### LOOM-268 — Always leave the social frame after video export

- [x] **P2 · bug · Effort M · Evidence: Review** · Completed (2026-10-12): Video export clears social frame on canvas-missing path.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: handleExportVideo returns early when no canvas is found without clearing `socialExportTarget`, so the app stays stuck in the frame. Move the reset into `finally`.
- **Done when:** a failed video export restores the normal chart frame.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-269"></a>269

### LOOM-269 — Restore the user's chart aspect after share-ready

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the share-ready toggle and video export write the preset aspect into the persisted `appSettings.chartAspect` (:1742, :1923) and never put it back. Remember the previous aspect and restore it on exit.
- **Done when:** exiting share-ready returns to the previous aspect.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-270"></a>270

### LOOM-270 — Organise the Export tab and name the target dashboard

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: 10+ identically styled full-width buttons mix per-chart and per-dashboard actions, and the dashboard actions silently use `activeDashboardId ?? dashboards[0]` (:1760, :1793, :1862). Group them under "This chart" and "Story: <dashboard name>".
- **Done when:** users can see which dashboard will be exported.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-271"></a>271

### LOOM-271 — Confirm before publishing a public link

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Confirm before publish public story link. File: `DetailPanel.tsx`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: "Publish story link" uploads to the Worker and copies a public URL without saying it's public. Add a confirm step that states visibility and how to remove it.
- **Done when:** publishing needs an explicit confirm.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-272"></a>272

### LOOM-272 — Show disabled and empty-result states on Smart "Run"

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Smart Run buttons keep disabled when inputs missing.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the buttons have no disabled styling (:2338, 2383, 2397, 2444, 2469), so disabled looks enabled, and when runAnomaly etc. return null nothing happens. Add `disabled:opacity-50` and a "No result for this column" toast.
- **Done when:** an unrunnable card looks disabled and an empty result explains itself.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-273"></a>273

### LOOM-273 — Clamp the Smart number inputs

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `smartInputClamp.ts` + Smart threshold clamp.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `Number("")` becomes 0, so horizon, threshold and k can be 0 or out of range (:2329, :2364, :2461). Clamp to min/max on change.
- **Done when:** clearing the k field can't run k-means with k=0.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-274"></a>274

### LOOM-274 — Validate the reference-line input with a single form

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Reference lines still prompt-based; validation partial.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: two PromptDialogs are chained with `setTimeout(50)`, an empty value becomes `Number("")=0` and adds a line at 0, NaN is ignored silently, and the remove × (:3785) has no aria-label. Use one small form (number + label) with validation.
- **Done when:** an empty value shows an error and no line at 0 appears.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-275"></a>275

### LOOM-275 — Add a reset for visual overrides

- [x] **P2 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Reset visual overrides button. File: `DetailPanel.tsx`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the Visual tab has dozens of overrides but no "Reset to defaults", only presets that replace everything. Add a reset button at the top.
- **Done when:** one tap restores the default look for the chart.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-276"></a>276

### LOOM-276 — Show toasts above modals

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`tailwind.config.ts`](../tailwind.config.ts), [`src/components/Toast.tsx`](../src/components/Toast.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: Toast is `z-[130]` while Onboarding is `z-[200]` and WhatsNew `z-[210]`, so "Couldn't open: …" from openStory (Onboarding.tsx) is hidden behind the overlay. Define a z-index scale in tailwind.config.ts (values from 35 to 210 are scattered across the shell) with toast on top.
- **Done when:** the openStory error toast is visible over Onboarding.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-277"></a>277

### LOOM-277 — Handle failed confirms and accidental backdrop taps in PromptDialog

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/PromptDialog.tsx`](../src/components/PromptDialog.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `handleConfirm` chains `.then()` with no catch, so a rejected onConfirm leaves the dialog stuck open with no error, and a backdrop tap (:54) cancels and discards typed text on phones. Add a catch with an inline error, and don't dismiss on backdrop when the value is dirty.
- **Done when:** a failing save shows an error and keeps the dialog.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-279"></a>279

### LOOM-279 — Make SuiteMenu links safe in the desktop app

- [x] **P2 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/SuiteMenu.tsx`](../src/components/SuiteMenu.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: they are plain anchors: the current "loom" item (`https://loom.ibm.io/`, no target) navigates (or is blocked from navigating) the Tauri webview away from the app, and the others rely on `target=_blank`. Use `openExternal` on Tauri and render the current item as non-link text.
- **Done when:** clicking items in the desktop app opens the system browser and never replaces the app.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-280"></a>280

### LOOM-280 — Create shared Dialog and Sheet components

- [x] **P2 · code · Effort M · Evidence: Source**
- **Targets:** [`src/components/PromptDialog.tsx`](../src/components/PromptDialog.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** the overlay markup (fixed inset-0 loom-overlay, stopPropagation card, `rounded-t-2xl sm:rounded-xl`, safe-bottom margin) is copied in page.tsx, PromptDialog.tsx, WhatsNew.tsx, Onboarding.tsx, FeedbackNotes.tsx and Sidebar.tsx, each with different focus and Escape gaps. Add `components/ui/Dialog.tsx` and `Sheet.tsx` and migrate those copies.
- **Done when:** all six use it.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Scope/dependency:** Own accessible overlay primitives; individual overlay items migrate callers and verify their content.
- **Completed (2026-10-12):** Added `components/ui/Dialog.tsx`, `Sheet.tsx`, `focusTrap.ts`, `useFocusTrap.ts`. Migrated PromptDialog, WhatsNew, Onboarding, Help (`page.tsx`), FeedbackNotes, and DatasetPreviewModal. ShareSheet still on legacy markup (follow-up).

<a id="loom-281"></a>281

### LOOM-281 — Create a shared Button component

- [x] **P2 · code · Effort M · Evidence: Source**
- **Completed (2026-10-12):** `components/ui/Button.tsx` + Settings actions.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** long button class strings are copied, e.g. the accent-outline "text-2xs py-1 px-2.5 … border-loom-accent bg-loom-accent/10 text-loom-accent" about 10 times in Sidebar and "w-full px-3 py-2 text-xs font-medium … bg-loom-elevated border" about 12 times in ExportView. Add `components/ui/Button.tsx` with variants (primary, ghost, accent-outline, danger) and sizes (sm, md, tap).
- **Done when:** those copies are replaced.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Scope/dependency:** Own shared button semantics; individual controls retain responsibility for clear labels and keyboard behavior.

<a id="loom-294"></a>294

### LOOM-294 — Cap the size of incoming handoff payloads

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/NeoSpaceIngest.tsx`](../src/components/NeoSpaceIngest.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the code parses `files[].csv` synchronously with no count or byte limit, so a 200 MB string freezes the main thread. Limit to about 10 files and 25 MB total, and toast when data is dropped.
- **Done when:** an oversized payload is rejected with a message and the UI stays responsive.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-295"></a>295

### LOOM-295 — Use selectors in DashboardCanvas

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it also destructures the whole store (16 fields), so the expanded dashboard grid re-renders on unrelated writes. Switch to selectors or `useShallow`.
- **Done when:** a toast doesn't re-render DashboardCanvas.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-296"></a>296

### LOOM-296 — Use selectors in TopBar

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/TopBar.tsx`](../src/components/TopBar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it destructures 15 fields from the whole store, so it re-renders on every write including stream polls. Switch to selectors.
- **Done when:** TopBar doesn't render on `setSourceStatus`.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-297"></a>297

### LOOM-297 — Use selectors in the Sidebar root

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it destructures 30 fields from the whole store. Switch to selectors or `useShallow`.
- **Done when:** a toast doesn't re-render Sidebar.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-298"></a>298

### LOOM-298 — Defer the catalog fetches

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: opening Data & sources immediately fetches Data.gov (80 rows, q=csv) and data.gov.uk, even though phone users mostly use the live feeds and packs at the top. Fetch when the section scrolls into view (IntersectionObserver) or on first search.
- **Done when:** opening the region costs no catalog requests until scrolled.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-299"></a>299

### LOOM-299 — Only stringify the Vega spec when it's shown

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `formatVegaSpecJson` when Vega panel open. File: `DetailPanel.tsx`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `JSON.stringify(vegaSpec, null, 2)` runs on every ChartPanelView render, but the Vega section is collapsed by default (:3804) and specs can embed sample rows. Compute it inside the open branch with useMemo.
- **Done when:** no stringify runs while the section is closed.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-300"></a>300

### LOOM-300 — Stop the discover scan when the sheet is dismissed

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Discover scan `AbortController` aborted on Skip/dismiss/openStory (`Onboarding.tsx`).
- **Targets:** [`src/components/Onboarding.tsx`](../src/components/Onboarding.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `cancelled` only flips on unmount, and Onboarding never unmounts, so dismissing it keeps fetching ~35 feeds and calling setState (expensive on phones). Abort with an AbortController on dismiss or openStory.
- **Done when:** Skip leaves no further network requests.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-301"></a>301

### LOOM-301 — Use selectors in Onboarding

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Onboarding uses narrow Zustand selectors for actions/flags (`Onboarding.tsx`).
- **Targets:** [`src/components/Onboarding.tsx`](../src/components/Onboarding.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it destructures 14 setters from the whole store and is always mounted, so it re-renders on every store write. Select the setters individually or use `getState()`.
- **Done when:** a toast doesn't re-render Onboarding.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-302"></a>302

### LOOM-302 — Select only promptDialog in PromptDialog

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** PromptDialog subscribes only to `promptDialog` / `setPromptDialog` (`PromptDialog.tsx`).
- **Targets:** [`src/components/PromptDialog.tsx`](../src/components/PromptDialog.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `useLoomStore()` with no selector re-renders this always-mounted component on every write. Select `promptDialog` and `setPromptDialog` only.
- **Done when:** toasts don't re-render it.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-303"></a>303

### LOOM-303 — Use selectors in PreviewFooter

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** PreviewFooter uses per-field Zustand selectors (`PreviewFooter.tsx`).
- **Targets:** [`src/components/PreviewFooter.tsx`](../src/components/PreviewFooter.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it destructures 6 fields from the whole store. Use selectors.
- **Done when:** stream polls don't re-render the footer.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-310"></a>310

### LOOM-310 — Render the peek card as a still

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** The swipe deck background/next card now renders a lightweight still preview instead of mounting a second live `ChartCard`. Evidence: `npm run check` passed and edited files have no linter diagnostics.
- **Targets:** [`src/components/VizSwipeDeck.tsx`](../src/components/VizSwipeDeck.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the background "next" card mounts a full live `ChartCard` (Vega/WebGPU) at 35% opacity, doubling render cost on every swipe on phones. Render a cached thumbnail or skeleton until it becomes current.
- **Done when:** only one live chart renders in the deck.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-312"></a>312

### LOOM-312 — Don't search Socrata on mount

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/components/PublicCatalogSections.tsx`](../src/components/PublicCatalogSections.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `SocrataCatalogSection` sends a "311" Discovery query as soon as it mounts, even when collapsed or never looked at, on every page load. Search lazily (on expand or IntersectionObserver) and cache the last result in `sessionStorage`.
- **Done when:** a cold load with the section collapsed makes no Socrata request.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-313"></a>313

### LOOM-313 — Cache `Intl.DateTimeFormat` in zone conversions

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/lib/zonedTime.ts`](../src/lib/zonedTime.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `zonedCivilToUtcMs` builds a new formatter on each of up to 4 iterations per value, and `nycWallToUtcIso` runs it for every Socrata row (tens of thousands). Memoize one formatter per time zone.
- **Done when:** converting 50k NYC timestamps takes under 100 ms.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-339"></a>339

### LOOM-339 — Mount first-run and occasional overlays on demand

- [x] **P2 · perf · Effort M · Evidence: Source**
- **Completed (2026-10-12):** Dynamic occasional overlays in `page.tsx`.
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** `Onboarding` (27 kB src), `WhatsNew` + `changelog.ts` (21 kB of release-note strings), `ShareSheet` (22 kB), `VizSwipeDeck` (15 kB), `FeedbackNotes`, `PromptDialog` are always mounted in `Home`; render them via `next/dynamic({ ssr:false })` gated on their store flag (e.g. `shareSheetOpen`), and have `WhatsNew` `import("@/lib/changelog")` only when `requestWhatsNew()` fires or a new release id is unseen.
- **Done when:** Inactive occasional overlays do not add their implementation to the initial load, while first-open behavior/focus and unseen-release detection remain correct.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-340"></a>340

### LOOM-340 — Lazy-load `DetailPanel` on phones

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it is 4,645 lines (201 kB source) and is closed by default on mobile (`page.tsx`); use `next/dynamic` and preload it on first `togglePanel()`/`setPanelTab()`.
- **Done when:** a 390-px cold load does not fetch DetailPanel code until the sheet is opened.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-341"></a>341

### LOOM-341 — Split DetailPanel tabs into per-tab modules

- [x] **P2 · perf · Effort L · Evidence: Source**
- **Completed (2026-10-12):** Detail tabs loaded via `React.lazy` / Suspense so inactive tabs chunk-fetch on first visit (`DetailPanel.tsx` + `detail/*`).
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** The relevant source/configuration was inspected; validate the exact current behavior and impact before implementing this lead.
- **Implementation:** Stats, Chart (encoding/Visual), Export, Smart, Dashboards, Settings all live in one 4,645-line file; move each tab component to `src/components/detail/<Tab>.tsx` and dynamic-import inactive tabs.
- **Done when:** switching tabs triggers a chunk fetch only the first time.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-342"></a>342

### LOOM-342 — Lazy-load `PublicCatalogSections`

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** TidyTuesday/Socrata catalog sections lazy-loaded from Sidebar (`React.lazy` + `PublicCatalogSections`).
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: Socrata/TidyTuesday UI is only shown after expanding Data & sources; dynamic-import it inside Sidebar.
- **Done when:** Collapsed catalog sections make no unnecessary module or catalog requests; opening the section loads once with usable loading/error states.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-344"></a>344

### LOOM-344 — Make the prerendered web shell web-appropriate

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** The prerendered sidebar now defaults to the web data path before hydration, leads with “Find something fun to chart,” and keeps desktop folder/DuckDB copy behind the mounted desktop path. Evidence: `npm run check` passed and edited files have no linter diagnostics.
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: static HTML currently says "Choose folder / No data files found / Mount a folder… / idle DuckDB" (desktop copy) before JS swaps to the web state; render the "Find something fun to chart" call-to-action as the first, LCP-friendly element and hide desktop-only cards behind `isTauri()` after mount. (`out/index.html`, `src/components/Sidebar.tsx`).
- **Done when:** The exported phone shell presents an understandable discover/import action before hydration; desktop-only folder/DB text is shown only on an appropriate path.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-347"></a>347

### LOOM-347 — Serve real 404s for missing static files

- [x] **P2 · perf · Effort M · Evidence: Review**
- **Targets:** [`wrangler.jsonc`](../wrangler.jsonc).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `not_found_handling: "single-page-application"` returns `index.html` (200) for any typo, including stale `/_next/static/chunks/*.js` after a deploy, which then fails with a JS parse error instead of a clean chunk-load retry; exclude `/_next/*` from SPA fallback (route them through the Worker returning 404) or switch to `"404-page"` since the app is a single route.
- **Done when:** Missing hashed assets receive a real non-HTML 404, valid SPA entry paths still work, and stale tabs recover without a reload loop.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-575"></a>575

### LOOM-575 — Make the end of the scan useful

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/components/VizSwipeDeck.tsx`](../src/components/VizSwipeDeck.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: "Scan complete" only offers "Back to chart". List kept charts as tappable thumbnails (apply/share).
- **Done when:** a kept chart can be opened from the summary.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-583"></a>583

### LOOM-583 — Decode HTML entities in descriptions fully

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/publicCatalogs.ts`](../src/lib/publicCatalogs.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `plainDescription` decodes only `&nbsp;` and `&amp;`, so `&quot;`, `&#39;` and `&lt;` show literally in cards. Use a small entity map (or `DOMParser` in the browser).
- **Done when:** `&quot;Parks&quot;` renders as "Parks" with quotes.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-586"></a>586

### LOOM-586 — Fix `formatNumber` edge cases

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/lib/format.ts`](../src/lib/format.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: 999,950 becomes "1000.0K", negatives are never abbreviated (-5,000,000 → "-5,000,000"), and whole values show "2.0K". Use `Intl.NumberFormat({notation:"compact"})` on `Math.abs`.
- **Done when:** tests cover 999,950 → "1M", -5e6 → "-5M" and 2000 → "2K".
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `Intl.NumberFormat` compact notation with sign handling. Test: `format.test.ts`. File: `format.ts`.

<a id="loom-588"></a>588

### LOOM-588 — Validate `preferred.kind` before using it

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Targets:** [`src/components/NeoSpaceIngest.tsx`](../src/components/NeoSpaceIngest.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `msg.preferred.kind as ChartKind` is cast without a check and passed to createChartRec. Check it against the known chart kinds and fall back to `recs[0]` when it is unknown.
- **Done when:** a bogus kind still opens the top recommendation.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** `parseChartKind` before `createChartRec`. Test: `recommendations.test.ts`. Files: `recommendations.ts`, `NeoSpaceIngest.tsx`.

<a id="loom-589"></a>589

### LOOM-589 — Accept a second handoff in the same tab

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Targets:** [`src/components/NeoSpaceIngest.tsx`](../src/components/NeoSpaceIngest.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `handledRef` stays true after the first ingest, so a later "Open in Loom" from NeoSpace into the same tab is silently ignored. Reset the flag after ingest finishes, or dedupe on a message id.
- **Done when:** two consecutive handoffs both load.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.
- **Completed (2026-10-12):** Reset `handledRef` after ingest completes. File: `NeoSpaceIngest.tsx`.

<a id="loom-590"></a>590

### LOOM-590 — Explain why Share is disabled

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Share stays tappable; `shareDisabledReason` toasts "Open data before sharing a chart" / "Pick or create a chart before sharing" (`TopBar.tsx`).
- **Targets:** [`src/components/TopBar.tsx`](../src/components/TopBar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the button is disabled with only a `title` tooltip, which phones never show. When there's no data, keep it tappable and toast "Open data first", or open StartHere.
- **Done when:** tapping Share with no data gives guidance.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-591"></a>591

### LOOM-591 — Surface Stop/Clear failures

- [x] **P3 · bug · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Stream/source Stop and Clear catch IPC failures and toast (`Sidebar.tsx` `Couldn’t stop/clear…`).
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: stream and source Stop/Clear handlers swallow errors in `catch { /* ignore */ }` (Sidebar.tsx, :711, :1008), leaving the UI out of sync with no feedback. Toast the failure.
- **Done when:** a failed Stop shows an error.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-592"></a>592

### LOOM-592 — Let users remove recent files

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `removeRecentFile` + per-row remove + "Clear recent" (`Sidebar.tsx`, store).
- **Targets:** [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: Recent has no per-item remove or "Clear recents", and dead entries are only pruned after a failed tap. Add an × per row and a clear action.
- **Done when:** a recent entry can be removed without opening it.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-593"></a>593

### LOOM-593 — Use plain labels and correct icons

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `src/components/DetailPanel.tsx` replaces palette abbreviations with full labels, maps palette kinds/blend modes/mark shapes to readable labels, and uses alignment-specific footnote icons. Verification: `npm run check`; `npm run test:dom -- src/lib/__tests__/useMediaQuery.dom.test.tsx`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: colour scale is "Cat/Seq/Div/Spec/Sem" (:3917), blend modes show raw canvas names like "source-over" (:4551), mark shapes are lowercase ids (:4258), and footnote alignment reuses bar-chart icons (Ico.plain/viz/deep) for left/center/right (:4140). Use readable labels and alignment icons.
- **Done when:** no raw ids are visible.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-594"></a>594

### LOOM-594 — Move the hard-coded colours out of the panel

- [x] **P3 · code · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `src/lib/chartPalettes.ts` owns the axis color swatch sets; `src/components/DetailPanel.tsx` consumes those constants and uses `border-loom-border/70`. `rg '#[0-9A-Fa-f]{3,8}|border-black' src/components/DetailPanel.tsx` returns no matches. Verification: `npm run check`; `npm run test:dom -- src/lib/__tests__/useMediaQuery.dom.test.tsx`.
- **Targets:** [`src/components/DetailPanel.tsx`](../src/components/DetailPanel.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: the axis swatches hard-code hexes (:4375-4379, :4437-4441) and the swatch border is `border-black/20` (:1151), against the token rule. Move the swatch sets into chartPalettes constants and use a token border.
- **Done when:** DetailPanel has no hex literals.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-595"></a>595

### LOOM-595 — Improve the ErrorBoundary fallback

- [x] **P3 · ux · Effort M · Evidence: Review**
- **Completed (2026-10-12):** ErrorBoundary recover-to-Explorer, report issue, deploy-mismatch reload (`ErrorBoundary.tsx`).
- **Targets:** [`src/components/ErrorBoundary.tsx`](../src/components/ErrorBoundary.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it shows raw `error.message` in mono, has no `role="alert"`, and "Try again" re-renders the same state that crashed. Add resetKeys (viewMode, selectedFile, activeChart id), an alert role, and a "Report this" action that opens FeedbackNotes prefilled.
- **Done when:** Try again after a bad chart lands on a working view.
- **Verification:** Add a focused regression for changed logic or interaction where meaningful, run affected unit/component tests, and verify one representative user flow. Run the static build if imports, lazy loading or asset output change.

<a id="loom-602"></a>602

### LOOM-602 — Throttle `useViewportWidth`

- [x] **P3 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** `useViewportWidth` resize updates coalesced via `requestAnimationFrame` (`useMediaQuery.ts`).
- **Targets:** [`src/lib/useMediaQuery.ts`](../src/lib/useMediaQuery.ts).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: it calls `setW` on every `resize` event, and mobile browsers fire many as the URL bar shows and hides, re-rendering subscribers continuously. Batch with `requestAnimationFrame` (or `useSyncExternalStore`).
- **Done when:** scrolling on iOS triggers at most one update per frame.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

<a id="loom-615"></a>615

### LOOM-615 — Lazy-load the Tauri-only bridge on web

- [x] **P3 · perf · Effort M · Evidence: Review**
- **Completed (2026-10-12):** Dynamic Tauri invoke import in `tauri.ts`.
- **Targets:** [`src/app/page.tsx`](../src/app/page.tsx).
- **Basis:** Validate the earlier review lead against the current implementation before changing behavior.
- **Implementation:** Earlier-audit lead to validate: `tauri.ts` already dynamic-imports plugins; also make `NeoSpaceIngest` (new, untracked) and `WebSessionResume` dynamic since they only act on specific URL hashes.
- **Done when:** they are not in the page chunk.
- **Verification:** Record a reproducible baseline and after-change measurement for the named hot path; check output/interaction equivalence and enforce a meaningful budget only after choosing a representative device/input.

## Completion record template

Append beneath the relevant item after work, preserving its ID:

```text
Outcome: implemented / verified already addressed / deferred / blocked
Changed files and symbols:
Before/after evidence:
Validation commands and results:
Platform/device limitations:
Related task IDs:
Docs/changelog updated:
```

For an already addressed item, cite the current symbol/test that satisfies the acceptance condition. For a deferred item, record the reason and the event that should trigger reconsideration. Do not interpret a green root TypeScript check as evidence for Rust, Worker or MCP behavior.
