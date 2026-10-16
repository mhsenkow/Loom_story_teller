# Data feed overhaul, USAFacts, Collections & Metrics — plan

Status (2026-10-16): **Phase 0 and Phase 1 landed** (uncommitted). Phase 2 is in progress in a parallel session. Phases 3–5 haven't started. Update the phase checkboxes as work lands.

---

## TL;DR

Not too much to bite off, as long as it ships as **five phases that each stand on their own** and in the order below. Each phase makes the next one cheaper:

| # | Phase | Ships to users | Size |
|---|-------|----------------|------|
| 0 | Source catalog foundation (metadata + one `SourceRef` id) | Nothing visible; unblocks everything | S |
| 1 | **USAFacts** feeds (US states panel + US at a glance) | Two new feeds, keyless, cached | M |
| 2 | **Feed browsing + Love / Like / Less / Hide / Save** | Searchable, filterable feed; "For you" ranking | M |
| 3 | **Collections** + join keys | Group datasets that share a key; see how well they match | M–L |
| 4 | **Metrics** in Query | Cross-dataset measures (e.g. disasters per 1M residents), chartable + shareable | L |
| 5 | Starter collections in Discover + polish | Metric stories show up in "What's interesting" on phones | S–M |

Phases 1 and 2 are independent and can run in parallel. 3 → 4 → 5 are sequential.

The key insight tying it together: **USAFacts gives Loom a US "denominator layer"** (population, income, poverty, unemployment by state and year). That makes Collections and Metrics immediately useful. FEMA disasters per capita, for example, is a story Loom can't tell today.

---

## 1. Where things stand (findings)

### Feeds today
- **Three unrelated kinds of "source", each with its own id:**
  - Poll feeds (`SourceKind`, path `stream://<kind>`, 34 in `sourceRegistry.ts`, plus `wiki`).
  - Catalog hits: Data.gov/UK `ds.id`, Socrata `domain/id`, TidyTuesday week, curated `pack.id`. None of these persist as entities. Once loaded they become plain files.
  - User files (`FileEntry.path`: absolute, `web://file/…`, `mock://…`).
- **The Sidebar "Data & sources" panel has no search, sort or filter for live feeds.**
  - Groups render in a fixed order, and cards within a group follow registry array order (`sidebar/DataRegionView.tsx:560-576`).
  - Only the CKAN, Socrata and TidyTuesday sections have their own search boxes.
- **Discover ("What's interesting", `Onboarding.tsx`) is the only ranked surface.**
  - It has search, filters (setting / category / source / chart kind) and five sort modes.
  - Ranking steps:
    - Base score: `discoverHookFor` (`discoverHooks.ts:1393`, roughly 60–99), then a seasonal boost.
    - Variant scores: `altStoryScore`.
    - Scan-time caps: `applyDiversityFilters` (20% per source, 35% per category).
    - Display interleave: `rankDiscoverStories` (`discoverPresentation.ts:162`).
- **No per-source preference exists anywhere.**
  - What does exist: Recent files (20, `loom-recent-files`), and `vizPreferences.ts`, a like/dislike event log on *chart features*. It has a 45-day half-life, Laplace log-odds and a ±25 clamped boost, and is driven by VizSwipeDeck. That model is a ready-made template for source affinity.

### Data / query today
- **Dataset identity is the path string.** The store holds **one** active dataset (`selectedFile`, `columnStats`, `sampleRows`).
- **Desktop:**
  - One in-memory DuckDB. Each query sets `loom_active` as a temp view.
  - Source and stream tables live in the same database.
  - User SQL can't reference other files, because `read_*` is blocked by `sql_policy.rs`.
- **Web / iOS: no SQL engine at all.** `queryFile` throws `WEB_FILE_SQL_ERROR`. Dive, the cube and the chart transforms are all in-memory JS.
- **No join support anywhere.** The closest thing is `geoAtlas.joinKeyCandidates`, which normalizes state names, abbreviations, FIPS and ISO2/3, but only to match atlas features.
- **Reusable building blocks:**
  - `diveExpr.ts`: a DuckDB-compatible expression parser and evaluator. Row-level, and it runs identically in JS and SQL.
  - `dive.ts` aggregates (count, distinct, sum, avg, min, max, percentiles) and `diveToSql`, which is the "JS engine + SQL emitter" pattern.
  - `deltaCompare.ts`.
  - `dataProvenance.ts`, which handles one dataset per call today.
  - `workspaceBackup.ts`: versioned bundle with `datasetRefs`.
  - Dashboards, which can already mix datasets, but only via frozen snapshots.

### USAFacts (verified 2026-10-16)
- **The old REST API is gone.** `api.usafacts.org` / `data.usafacts.org` have no DNS, and `/api/` is disallowed in robots.txt.
- **The live, supported channel is the USAFacts Data MCP** at `https://data.mcp.usafacts.org/mcp`:
  - Active beta, free, **no key**, no SLA, no published rate limits.
  - JSON-RPC over HTTP with SSE `data:` replies, and no session needed.
  - **No CORS**, so it must be called from the Worker or Rust.
  - Four tools: `list_sources`, `get_source`, `get_source_tools`, `call_source_tool`.
  - It covers 25 agency sources: BEA, BLS, Census ACS/PEP/decennial, FRED, Treasury, EIA, CDC PLACES, CMS, FEC, USAspending, and more.
  - Each success includes a `_citation` block (`public_url`, `disclaimer`, `tos_url`). We should show `public_url` and the disclaimer.
- **Coverage notes:**
  - The Census PEP API stops at vintage 2021, so ACS 1-year is the better state population series (no 2020 release).
  - BLS discourages guessing series ids. State LAUS ids are well known: `LASST{fips}0000000000003` is the unemployment rate.
- **Terms:**
  - Government figures are not copyrightable.
  - USAFacts' own content is CC BY-SA 4.0. Credit as "Source: [page](url) by USAFacts".
  - Don't imply endorsement or use their logo.

---

## 2. Architecture decisions

**D1. One `SourceRef` id for everything browsable.**
- New `src/lib/sourceRef.ts` with string ids:
  - `feed:<kind>` (incl. `feed:wiki`)
  - `pack:<id>`
  - `socrata:<domain>/<id>`
  - `ckan:<portal>/<id>`
  - `tt:<date>/<file>`
  - `file:<path>`
- Pure helpers: `refForPath(path, fileEntry?)`, `pathForRef`, `labelForRef`.
- Preferences, collections and metrics all key on this id.

**D2. Extend `SourceDef` with discovery + join metadata** (still the single registry):
```ts
topics: SourceTopic[];          // "disasters" | "economy" | "health" | "climate" | "transport" | "space" | "web" | "people" ...
geo: "world" | "us" | "city" | "global-aggregate";
grain: "event" | "minute" | "day" | "month" | "year" | "snapshot";
joinKeys?: Partial<Record<JoinRole, string>>; // { state: "state", year: "fy_declared" }
```
- `JoinRole` is `"state" | "county" | "country" | "year" | "month" | "date"`.
- The registry test enforces that every `joinKeys` column exists and has a compatible type, the same way it already checks charts and snippets.
- Curated packs get the same fields in `CURATED_OPEN_PACKS`.

**D3. USAFacts via a Worker route, gateway first, agency fallback.**
- The Worker calls the USAFacts gateway server-side with `clientInfo {name:"loom"}` and caches for 24h with stale-on-error, matching the existing `/api/source/<kind>` pattern.
- It falls back to `api.census.gov` / `api.bls.gov` directly, both keyless at this volume. *(As built: Census now needs a key, so only the economy feed has a fallback. See Phase 1.)*
- **We don't depend on a beta with no SLA as the only path.**
- Desktop `sources.rs` does the same JSON-RPC POST through reqwest.

**D4. Metrics engine = pure TS, with an SQL emitter for desktop.**
- New `src/lib/metrics.ts`:
  1. Aggregate each input at a shared grain.
  2. Join on canonical keys.
  3. Evaluate a `diveExpr` expression over the joined row.
  4. Output a `QueryResult`.
- `metricToSql()` emits equivalent DuckDB SQL (CTE per input, then JOIN) for desktop "Show SQL / Open in Query".
- Same pattern as `runDive` / `diveToSql`. Works on web, iOS and desktop **today**, with no new runtime dependency.

**D5. Canonical join keys, not fuzzy joins.**
- New `src/lib/joinKeys.ts` maps a cell to one canonical value per role:
  - state → 2-digit FIPS
  - country → ISO3
  - year → int
  - month → `YYYY-MM`
  - date → `YYYY-MM-DD`
- It reuses the alias tables already in `geoAtlas.ts`, refactored so atlas matching and joins share them.
- Every join reports its **match rate and unmatched samples**. That is the main trust-building UX.

**D6. Collections are references, not copies.**
- A collection holds `SourceRef`s, aliases and declared links.
- Rows load on demand through the existing paths: feed buffers / DuckDB tables, `web://` IDB, `mock://`, or a re-fetch from `sourceUrl`.
- Web members are **pinned against the 24-entry IDB LRU** (`webFileStore.ts`) so a collection doesn't silently lose a member.

**D7. Preferences persist locally and travel in workspace backups.**
- localStorage key `loom-source-preferences`, `{v,data}` envelope.
- Added to `LOOM_PREFERENCE_STORAGE_KEYS` and to the `workspaceBackup` scope plus merge logic.
- Collections and metrics are handled the same way: `loom-collections`, `loom-metrics`.

---

## 3. Phases

### Phase 0 — Source catalog foundation (S) · ✅ landed 2026-10-16
- [x] `src/lib/sourceRef.ts` + tests (round-trip each scheme, stable ids for catalog hits).
- [x] `topics`, `geo`, `grain`, `joinKeys` on every `SourceDef` and curated pack. Packs moved to `src/lib/curatedPacks.ts`; `sidebar/shared.tsx` re-exports them.
- [x] `sourceRegistry.test.ts`: join-key columns exist and are typed right; every def has ≥1 topic.
- [x] `src/lib/sourceCatalog.ts`: `sourceCatalog()` (wiki + feeds + packs → `CatalogEntry[]`, freshness from poll cadence) and `filterCatalog` (text + facets + join role).
- [x] New "United States" sidebar group (`us`): NWS, debt, FEMA, and the USAFacts feeds. NYC 311 stays in Cities & transport next to the other city feeds.

### Phase 1 — USAFacts feeds (M) · desktop + web + iOS + Worker · ✅ landed 2026-10-16

**`usafacts_states`** — "US states, year by year"
- One row per state-year: 2012 → latest vintage (2024 as of today), no 2020 release, 52 rows per year (50 states, DC, PR).
- Columns: `state_fips, state_abbr, state_name, yr, population, median_household_income, poverty_rate, median_age, unemployment_rate, bachelors_or_higher_pct`.
- Source: one gateway `census_acs/getAcs1` call per vintage, 4 in flight at a time.
- Only detailed-table variables are used, because subject and profile ids get renumbered between vintages: `B01003_001E`, `B19013_001E`, `B01002_001E`, `B17001_001/002E`, `B15003_001/022–025E`, `B23025_003/005E`.
- 2012 is the first vintage that has B15003 and B23025.
- Unemployment is the ACS survey rate (unemployed ÷ civilian labor force), not BLS LAUS.
- `joinKeys: { state: "state_abbr", year: "yr" }`.

**`usafacts_nation`** — "US economy, month by month"
- Monthly since 1990.
- Columns: `month, yr, unemployment_rate, inflation_yoy_pct, payrolls_k, fed_funds_rate, housing_starts_k, gas_price_usd`.
- Source: FRED `UNRATE`, `CPIAUCSL` (units `pc1`), `PAYEMS`, `FEDFUNDS`, `HOUST`, `GASREGW` (frequency `m`), via `fred/getSeriesObservations`.
- Government-produced series only: the gateway refuses rights-tagged series (e.g. UMCSENT).
- `joinKeys: { month: "month", year: "yr" }`.

**Fallbacks (as built — differs from D3):**
- `api.census.gov` now requires a key (keyless calls get a 302 to `missing_key.html`), so `usafacts_states` has **no live fallback**. A gateway outage serves the Worker's stale copy (up to 2 days), then the feed errors.
- `usafacts_nation` falls back to keyless `fredgraph.csv` when any series fails. That's two calls, because mixing weekly gas with monthly series returns a ZIP. CPI YoY is computed from levels in that path.
- Follow-up option: an optional `CENSUS_API_KEY` Worker secret to restore a direct Census fallback.

Landed:
- [x] Spike: fixtures in `src-tauri/tests/fixtures/sources/` (`usafacts_*.sse`, `fredgraph_*.csv`).
- [x] Worker: `usafactsCall` (JSON-RPC POST, SSE parse, error mapping, 20 s timeout) + `settleLimited` fan-out in `catalog-proxy.ts`. Pure `usafactsPayload` / `acsStatesWide` / `fredNationMonthly` / `fredGraphNationMonthly` in `sourceTransforms.ts`. TTL 24 h (states) / 12 h (economy).
- [x] `sourceEndpoints.ts` contracts + `UPSTREAM_ENDPOINTS` doc rows.
- [x] `webStreams.ts`: `parseColumnar` + replace merge modes.
- [x] `sources.rs`: same specs, gateway POST, transforms and math, plus `cargo test` against the same fixtures. `usafacts_nation` is in `KEEP_NEWEST_KINDS`.
- [x] `recommendSourceStory` openers (income / poverty maps, education vs. income bubble, unemployment and inflation lines, Phillips curve, …) + `SOURCE_SQL_SNIPPETS`.
- [x] `discoverHooks.ts`: richest state + "unemployment rose in N of M states"; latest unemployment and inflation.
- [x] Attribution names the agency, "via USAFacts", and the Census / St. Louis Fed non-endorsement notices those APIs require. Homepage is https://usafacts.org/mcp/. No USAFacts logo.
- [x] Fixed `pickAtlasKind` (`geoAtlas.ts`) so snake_case region columns (`state_abbr`, `state_fips`) pick the US atlas. Before, `CA` read as Canada.
- [x] Worker handler tests, transform tests, changelog, README, DOCS, `CAPABILITY_MATRIX`, AGENTS.
- [x] Verified live: local Worker → real gateway returned 624 state-year rows and 441 months. Both feeds open in Chart on web (US choropleth, unemployment line).
- [ ] Not verified: the desktop app UI. Covered by `cargo test`, but `make tablet` / the macOS app weren't run.

**Later (not in this phase):** a "US government data (via USAFacts)" catalog section in Data & sources. It would let people search FRED / BLS series by keyword (`searchSeries`) and load one as a dataset. Big "find data" win, but it needs its own UX pass.

### Phase 2 — Feed browsing + preferences (M) · web + desktop + iOS
**Preference model** (`src/lib/sourcePreferences.ts`, modeled on `vizPreferences.ts`):
- Explicit reaction per `SourceRef`: `love (+2) | like (+1) | none | less (−1) | hide`. Plus a separate `saved` flag (bookmark).
- Implicit signal: opens and time-in-dataset from Recent / `appActivity`, decayed with a 30-day half-life and capped small, so explicit signals dominate.
- `sourceAffinity(ref) → −20…+20` (clamped like `BOOST_CLAMP`). A light **topic spillover** (loving USGS nudges other "disasters" feeds by +2) keeps "For you" from being a closed loop.
- Store: `sourcePrefs` + `reactToSource(ref, reaction)` + `toggleSavedSource(ref)` in `uiSlice`. Persisted per D7.

**Where it applies:**
- Discover display: affinity added in `Onboarding.tsx` `visible` memo → new `scoreOf` param on `rankDiscoverStories`. Hidden kinds are filtered out, with a "N hidden · show" chip so it's reversible. The daily IDB cache stays affinity-free.
- Discover scan (mobile 120-story cap): pass the affinity map into `applyDiversityFilters` so loved feeds aren't cut. Probe loved kinds first.
- Sidebar: a **Saved** group above live feeds; within each group, sort by affinity then registry order.
- Command palette: add affinity to `SOURCE_ITEMS` weight.

**Browse revamp** (Data & sources → "Feeds" section, reading `sourceCatalog`):
- One search box across feeds + curated packs + USAFacts (label, description, topics, column names).
- Filter chips: Topic · Where (World / US / City) · Freshness (Live / Daily / Historical, from `pollMs` + `grain`) · Saved.
- Sort: **For you** (default once any preference exists) · Freshest · A–Z.
- Card: reaction control (♥ / 👍 / 👎 in an overflow; ♥ and 🔖 visible), last-updated from `sourceSnapshotCache`, row count, topic chips. Visible buttons, not hover-only, with `max-md:min-h-9` targets.
- DiscoverStoryCard overflow: "More from this source / Less like this / Hide source / Save source".
- Settings → "Your sources": manage loved, saved and hidden in one list (undo-friendly).

Tests:
- `sourcePreferences.test.ts`: decay, clamp, spillover, parse/validate and migration.
- `rankDiscoverStories` with affinity.
- DOM test: hide → card disappears → "show hidden" restores it.
- Workspace backup round-trip.

**Done when:** loving a feed visibly lifts it in Discover, the sidebar and the palette; hiding removes it everywhere but stays reversible; preferences survive a reload and a backup/restore.

### Phase 3 — Collections + join keys (M–L) · web + desktop (+ iOS read-only)
**Model** (`src/lib/collections.ts`, store `collectionSlice.ts`):
```ts
interface Collection {
  id: string; name: string; description?: string; createdAt: number; updatedAt: number;
  members: { ref: SourceRef; alias: string /* "fema", "states" */ }[];
  links: { role: JoinRole; columns: Record<string /*alias*/, string /*column*/> }[];
}
```
- `joinKeys.ts` (D5) + tests over real fixtures: state names / abbrs / FIPS, "Puerto Rico", DC, territories; ISO2/ISO3/country names incl. aliases; year from date / ts / int / fiscal-year.
- **Auto-link:** when members are added, propose links from registry `joinKeys` and column heuristics (`columnClassify`, `isGeoRegionField`, year detection). Show the match rate per link ("51 of 52 states matched · unmatched: 'Puerto Rico'").
- Member loading: `loadCollectionMember(ref)` uses existing loaders (`diveSource.loadDiveDataset`, web cache/IDB, re-fetch `sourceUrl`). Web members get IDB-pinned.
- **UI:**
  - "Add to collection" from SourceCard, DiscoverStoryCard overflow, the file row context menu, and the TopBar dataset menu.
  - Collections list in the sidebar (Files view, above Recent).
- Provenance: `resolveCollectionProvenance` = one credit line per member, used in share and export.
- Persistence + backup per D7. Share links carry collection *definitions*, never rows.

**Done when:** a user can build "US states" from USAFacts states + FEMA, see the auto-detected state + year links with match rates, and reopen it after a reload.

### Phase 4 — Metrics in Query (L) · web + desktop
**Model** (`src/lib/metrics.ts`):
```ts
interface MetricDef {
  id: string; collectionId: string; name: string; unit?: string; format?: "number" | "percent" | "currency" | "per100k";
  inputs: { alias: string; measure: { agg: DiveAgg; column?: string }; filters?: DiveFilter[] }[]; // a = count(fema), b = sum(population)
  grain: JoinRole[];               // ["state", "year"]
  expression: string;              // diveExpr over input aliases: "a / b * 1e6"
  join: "inner" | "left";
}
```
- `runMetric(def, members) → { result: QueryResult, diagnostics: { matched, unmatched[], droppedRows, grainRollups[] } }`.
- Grain mismatch: roll finer inputs up to the coarser grain (day → year) and say so in diagnostics.
- `metricToSql(def)` gives DuckDB SQL for desktop.
- Extend `diveExpr` with nothing. Aggregation happens before the expression, so expressions stay row-level.

**Query view integration** (this is where "how the query aspect works" changes):
- QueryView gets a scope switch: **Dataset | Collection**.
- In Collection scope:
  - The schema browser lists each member as a table under its alias, with link badges on key columns.
  - A **Metrics** panel shows the saved metrics and a builder: pick an input + aggregate per alias → grain (pre-filled from links) → expression with autocomplete over aliases → live preview.
  - Results use the existing paginated grid. "Chart this" calls `applyQueryResult`. The state grain maps straight onto the US atlas.
  - Snapshots and diff work unchanged (results are `QueryResult`).
  - **Desktop:** "Show SQL / Open in SQL" plus free-form multi-table SQL. A new Rust `query_collection(members, sql)` registers each member as a temp view `"<alias>"` (files via `table_expr_for_path`, sources by table name) and then runs `sql_policy`-validated SQL. Follow the IPC recipe: `commands.rs` → `lib.rs` → `tauri.ts` → mock.
  - **Web:** builder only. Free-form multi-table SQL depends on open decision Q1.
- Metric results open as a virtual dataset `metric://<collectionId>/<metricId>`. They work in Recent, dashboards (snapshot), share (≤2,500 rows is plenty) and Dive.
- `deltaCompare` powers "vs. last year" on year-grain metrics.

Tests:
- `metrics.test.ts`: per-capita, ratio of sums vs. mean of ratios, left vs. inner join, grain rollup, divide-by-zero → null.
- **Parity test:** `runMetric` vs. `metricToSql` on DuckDB (cargo test or a Node DuckDB fixture).
- DOM test for the builder.

**Done when:** "FEMA declarations per 1M residents by state, 2015–latest" can be built in under a minute on web, renders as a choropleth, shares as a link, and the desktop SQL gives identical numbers.

### Phase 5 — Starter collections in Discover + polish (S–M)
- Three curated **starter collections** ship in code, each with 2–3 metrics:
  - **US states:** USAFacts states + FEMA. Metrics: declarations per 1M residents; income vs. disasters.
  - **Countries:** World Bank + World countries + COVID. Metrics: COVID deaths per million vs. life expectancy; CO₂ per $ of GDP.
  - **Long view:** Global temperature + USAFacts nation + World Bank world aggregate. Metric: warming vs. US unemployment by year (deliberately "fun", with a correlation ≠ causation note).
- Discover hooks for metric stories (`kind: "metric"`), so the phone loop (find → viz → share) surfaces cross-dataset stories without anyone building a collection.
- Preference signals apply to metric stories through their member refs.
- Docs: `DOCS.md` sections (Source catalog, Preferences, Collections, Metrics), README, `CAPABILITY_MATRIX.md` (web: builder only; desktop: + SQL), `PERFORMANCE_BUDGETS.md` (join cost: target < 150 ms for 50k × 3k rows on a mid phone).

---

## 4. Open decisions (need your call)

- **Q1. Web SQL engine.** Should free-form multi-table SQL work on web/iOS too? It would mean adding **DuckDB-WASM**, which would also fix today's "Query is desktop-only" gap.
  - Costs: about 7–10 MB lazy-loaded wasm, `wasm-unsafe-eval` in CSP, and iOS memory pressure.
  - Recommendation: **not in this pass.** Ship the metric builder (works everywhere), then spike DuckDB-WASM as its own project behind a Query-view lazy load.
- **Q2. Reaction vocabulary.** Love / Like / Less / Hide + Save, or simpler ♥ + Hide + Save? The plan supports either. Recommendation: **♥ Love, 👎 Less, Hide, 🔖 Save** visible (Like stays implicit from usage). Fewer taps on phones.
- **Q3. Sidebar group.** Put USAFacts in a new **"United States"** group, or in "Countries & history"? Recommendation: a new `us` group, since FEMA, NWS, debt and NYC 311 would move there too and it's a natural Collections cluster.
- **Q4. Gateway etiquette.** USAFacts asks for client identity but publishes no limits. With a 24h Worker cache the load is ~2–4 upstream calls per day. Do you want to contact USAFacts before launch to say hello or ask about attribution? It's optional, but nice for a beta dependency.

## 5. Risks

| Risk | Mitigation |
|------|------------|
| USAFacts gateway (beta, no SLA) changes or goes away | Direct Census/BLS fallback; fixture tests; 24h cache + stale-on-error |
| ACS variables shift between vintages | Spike pins variable ids per vintage; registry test on columns |
| Joins silently wrong (e.g. "Georgia" the country vs. the state) | Role-scoped canonical keys (state vs. country never mix); match-rate diagnostics always visible |
| Web memory with multi-member collections | Inputs are aggregated before joining; respect `webMemoryBudget.ts`; members load lazily |
| Scope creep (this touches Sidebar, Discover, Query, store, Rust, Worker) | Phase gates: each phase passes `make check` and ships alone; Phase 4 doesn't start until Phase 3's joins are trusted |
| ESLint warning budget (`NEXT_STEPS.md` #2) | New modules must add zero warnings |
