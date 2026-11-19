# USAFacts feeds — connection, data, analysis, and chart coverage

Status: 2026-11-18. Six feeds come through the keyless **USAFacts Data gateway** (`https://data.mcp.usafacts.org/mcp`, MCP "streamable HTTP", no session). It is a public beta with no SLA and fronts 24 federal sources: BEA, BLS, Census (ACS, PEP, Pulse), FRED, Treasury, CDC, CMS, FEC, USAspending, and more. This doc covers:
- how Loom calls it,
- what each feed holds,
- how forecasts and anomalies reach the first look,
- which charts each feed opens with, and why.

| Kind | Rows | Source (via the gateway) | Fallback |
|------|------|--------------------------|----------|
| `usafacts_states` | one per state-year, 2012 → last ACS vintage (no 2020), 52 incl. DC + PR | Census ACS 1-year `getAcs1` per vintage + FRED annual CPI-U + BEA regional price parities (3 calls) | none keyless (api.census.gov / BEA need a key) |
| `usafacts_nation` | one per month since 1990 | FRED, 8 government series | `fredgraph.csv` (fills only missing series) |
| `usafacts_state_jobs` | one per state-month, last 19 calendar years (≈ 11.9k) | BLS LAUS `getSeriesData`, 52 series in 2 calls | `fredgraph.csv` `{USPS}UR` |
| `usafacts_budget` | one per month since 2015-03 | Treasury Monthly Treasury Statement Table 9 (paged, ≤ 1000 rows) + average interest rates | direct Fiscal Data API (keyless) |
| `usafacts_budget_lines` | one per month × line (14 lines) | same Treasury query, reshaped long | direct Fiscal Data API |
| `usafacts_household` | one per quarter since 1990 | FRED, 14 series (Fed Board, BEA, BLS, Census, Labor Dept.) | one `fredgraph.csv` per series |

Where the code lives:
- **Pure transforms:** `workers/usafacts.ts`, re-exported by `workers/sourceTransforms.ts`.
- **Worker network layer:** `workers/catalog-proxy.ts`. Look for `usafactsCall`, `usafactsMemoized`, `budgetPayloads`, `treasuryPages`, `fredGraphCsv`, the fetchers, and `DURABLE_SOURCE_KINDS`.
- **Desktop mirror:** `src-tauri/src/sources.rs`, with the same columns, rounding, and errors. Rows match the Worker cell for cell.
- **Opening charts:** `usafactsStory` in `src/lib/recs/sourceStory.ts`.
- **First-look hooks:** `src/lib/discoverHooks.ts`, built on `src/lib/seriesSignals.ts`.

## Calling the gateway

- One JSON-RPC `tools/call` → `call_source_tool` per request, with `Mcp-Protocol-Version: 2025-03-26`. Replies are SSE `data:` lines; the payload is in `structuredContent` (or JSON text in `content[0]`). The gateway does not accept JSON-RPC batches.
- **Errors are classified, not just thrown** (`UsafactsError`):
  - Fields: `kind`, `upstreamStatus`, `detail` (the agency's body), and `retryable`.
  - `retryable` comes from the gateway's own flag, else from 408/425/429/5xx. JSON-RPC -32603 / -320xx and an HTML page from an edge are also retryable.
  - `notFound` = `upstream_rejected` + 404, which means an ACS vintage that isn't released yet. That is expected, not a failure.
- **One retry**, 400–700 ms later, only when the error is retryable. A timeout is not retried (15 s; 25 s for BLS).
- **Unknown variables cost a column, not a vintage.** When Census answers 400 `unknown variable 'X'`, the call drops `X` and asks again (up to 3 times). The 2025 ACS renumbered B15003, which used to take the whole 2025 vintage down. Education now comes from B06009, whose ids held, and Puerto Rico from B06009PR.
- **Treasury pages.** The gateway serves at most 1000 rows per page, so `treasuryPages` follows `meta["total-pages"]` (capped at 10). The direct Fiscal Data fallback takes 10k rows in one call.
- **fredgraph.csv** answers some multi-series quarterly asks with a **ZIP**. Every fallback goes through `fredGraphCsv` / `fredGraphLooksLikeCsv`, which refuses anything that isn't CSV, and household series fall back one series per request.
- **Government-produced FRED series only.** Rights-tagged series (UMCSENT, USREC, MORTGAGE30US) are refused, so NBER recession months live in `NBER_RECESSIONS`. Update that table when NBER dates a new peak or trough.

## Failure ladder (Worker)

1. **Per-feed memo** in the Cache API: one entry per feed; both budget feeds share one.
   - Each vintage, series, or BLS batch keeps its own fetch time.
   - How long a copy is reused: settled ACS vintages 30 days; the newest two vintages daily; CPI and BEA 7 days; FRED, BLS, and Treasury 12 h.
   - A failed call reuses its memo copy (up to 60 days).
   - Cold edges make about 17 (states), 8, 2, 2 + pages, and 14 calls; a warm daily refresh makes about 2. One memo read and at most one write per refresh keeps cache operations under the subrequest cap.
2. **Completeness rule.** If more than half of the requested ACS vintages fail for reasons other than "not released", the fetcher throws, so a complete older copy answers instead.
3. **Edge stale copy** (the usual `/api/source` stale-on-error).
4. **KV last-good copy.** Stored as `srclast:<kind>` in `LOOM_STORIES` for 45 days; it serves as `X-Loom-Cache: STALE-DURABLE`.

Desktop has no memo. It retries the same way, uses the same keyless fallbacks, then the Worker copy (`https://loom.ibm.io/api/source/<kind>`).

Cache keys: bump `SOURCE_CACHE_KIND_REV` in `src/lib/workerCatalogPolicy.ts` when a payload's columns change (currently states 3, nation 2). Memo names hash the request shape, so they reset on their own.

## Columns

- **states:**
  - `region` (Census region; PR on its own).
  - `real_median_income` (CPI-U, newest vintage's dollars; `meta.dollarsOf`).
  - `price_level` / `rent_price_level` (BEA regional price parities, US = 100; the newest vintage borrows last year's).
  - `income_local_usd` (real income × 100 / price level: what the median income buys at national-average prices).
  - `real_personal_income_pc` (BEA, 2017 $).
- **nation:**
  - Series: UNRATE, CPI YoY, PAYEMS, FEDFUNDS, HOUST, gas, JTSJOL, GS10.
  - Derived: `jobs_added_k`, `decade`, and NBER `recession`.
- **state_jobs:** `unemployment_rate`, plus `unemployment_change_yoy` (percentage points).
- **budget** (all $ billions):
  - Monthly receipts, outlays, and deficit (outlays − receipts).
  - Income, corporate, and payroll taxes; customs duties.
  - Defense, net interest, Social Security, Medicare, and health.
  - The average rate on marketable debt.
  - 12-month sums (`*_ttm_b`) and `interest_share_pct` (12-month net interest ÷ 12-month receipts).
- **budget_lines:**
  - Columns: `flow`, `line`, `amount_b`, `amount_ttm_b`, `share_ttm_pct`.
  - "Other receipts" and "Other outlays" close each month to its total.
- **household:**
  - Saving rate; card, consumer, and mortgage delinquency; debt service; revolving credit.
  - Median new-home price; median weekly pay; real disposable income per person.
  - Homeownership; rental vacancy; prime-age employment; participation; weekly claims.
  - `home_price_years_of_pay` (price ÷ a year of median full-time pay), `decade`, and `recession`.

`derivedFrom` in the registry lists columns computed from others (a total against its parts, a 12-month sum against its month, real against nominal income, years of pay against price). Discover never plots one against its source on scatter-type charts.

## Forecasts and anomalies in the first look

Loom's Analyze tools (`timeSeriesAnalysis.ts`) now reach stories:
- **Calendar-aware forecasts** (`forecastCalendar`). Monthly, quarterly, and yearly series on month starts step in whole months. The Analyze preview used to refuse monthly dates as "irregular", and the overlay drifted off month starts.
- **Analysis presets.** A curated single-series line can carry `analysisPreset` (a forecast band and/or anomaly rings). `analysisPresetPatch` applies it when the chart becomes active (`setActiveChart`, `openDataset`, and the swipe / view paths), never over settings the person already made. For example, "Interest's bite out of every tax dollar" opens with the recent-trend forecast drawn.
- **Series signals** (`seriesSignals.ts`) let hooks say what's alarming in plain words:
  - `extremeSince`: a record, or "highest since May 2002".
  - `trendForecast` / `trendCrossing`: Loom's Holt or straight line, in whole months.
  - `recentAnomaly`: the largest trailing median/MAD break.
  - `firstCrossAbove`: when one series passed another.
- **Hooks** can name the measure they're about (`preferField`), and the headline opens on a chart of that measure. The headline also keeps its slot even when a feed has more chart kinds than variant slots.

| Feed | Hook (what it looks for) |
|------|--------------------------|
| budget | Interest's cents per tax dollar and where the recent trend puts it in 24 months; interest vs defense; the 12-month deficit; the largest recent break in tariff receipts |
| budget_lines | Net interest's rank among spending lines, first 12 months vs newest |
| household | The strain measure at its most unusual (a record, else the longest "highest / lowest since"), and its recent trend |
| nation | A reading not seen in 10+ years (e.g. the 10-year Treasury) leads; otherwise jobs added and unemployment |
| states | The richest state, real income since 2012, fastest-growing state, unemployment risers |
| state_jobs | How many states saw unemployment rise or fall over the year, and the highest state now |

## Chart coverage

Principles:
- Maps and rankings show the newest period (`timeWindow` on `yr` / `month`): "1y" on year columns is the newest year, "30d" on month columns the newest month.
- Medians, rates, prices, and rolling totals are never summed across rows. A rolling total may be summed across lines within one month, which is the "last 12 months" treemap.
- Mixed-unit pairs are same-unit, rebased (z-score / index 100), or mirrored with independent scales.
- Outlier-ruled measures (April 2020 jobs, 2020 claims) stay off linear spread charts.
- Row counts on month and year panels are dropped from Discover.
- Authored axes survive the curated-chart guard when they are bounded:
  - 52 states;
  - 14 budget lines with `topN`;
  - fiscal-year axes, now recognised as time-like.

| Feed | Opening charts (≈ kinds) |
|------|--------------------------|
| states (≈ 30) | choropleths (income, poverty, degrees, age, price level, rent level); education vs income bubble; paychecks vs prices residual scatter; real income by region; heatmaps (poverty, rents); Pareto; treemap; bump (income, real per-capita income); Chernoff region faces; radar; parallel; dumbbell / slope (income → at local prices); stream; waffle; box / violin / beeswarm / ridgeline / errorBars; corrMatrix; scatter3d; contour |
| nation (≈ 22) | lines with forecasts (10-year Treasury); jobs-added bars; Phillips and Beveridge loops; waterfall of jobs per year; stripes; spiral; horizon; yield-curve slope / dumbbell; decade radar; box, violin, ridgeline, density by decade / recession |
| state_jobs (≈ 14) | choropleths (rate, change vs a year ago); heatmap state × year; region lines; bump; sparkGrid; box / violin / beeswarm / ridgeline / errorBars; stripes; spiral; horizon |
| budget (≈ 21) | interest-share line with forecast; interest vs defense; deficit with forecast; tariff line with anomaly rings and last-12-months bars; money in vs out; rate-on-the-debt forecast; rate → bill connected scatter; deficits waterfall; dumbbell / slope / pyramid by fiscal year; stripes; tax-calendar spiral; box / violin / beeswarm / ridgeline / errorBars; sparkGrid; scatter3d |
| budget_lines (≈ 10) | bump ranks (net interest climbing); lines by flow; share heatmap; last-12-months treemap / sunburst / bars / radial bars; sparkGrid; box; ridgeline |
| household (≈ 23) | card delinquency (forecast + rings); years of pay (forecast); saving rate (rings); home prices vs paychecks (index 100); rental vacancy and debt service (forecasts); revolving credit; debt service → delinquency loop; recession box / beeswarm / density / ECDF; decade violin / ridgeline / pyramid / dumbbell / errorBars / sparkGrid; stripes; scatter3d |

Renderer fixes made along the way, which apply to every feed:
- Heatmaps fold long date axes into years and show up to 60 rows. They used to show the first 20 dates and the first 20 states.
- Bar thumbnails keep dates in order.
- Radar, parallel, and glyph charts skip codes, ids, years, and coordinates when picking axes.
- Glyph charts keep a numeric Color (Feature B).
- Year and month footnotes read "2012–2025" / "Jan 2008 – Sep 2026".

## Tests

| File | Covers |
|------|--------|
| `src/lib/__tests__/usafactsTransforms.test.ts` | ACS, FRED, and BLS transforms; errors; fallback parity |
| `src/lib/__tests__/usafactsBudget.test.ts` | Treasury, household, and BEA transforms; calendar forecasts; series signals; analysis presets |
| `src/lib/__tests__/usafactsCharts.test.ts` | Golden payloads in `fixtures/usafacts/` for all six feeds. Every curated chart keeps its fields, passes Discover's checks, and has evidence; every feed keeps its headline; labels; circular pairs |
| `workers/__tests__/catalogProxyHandlers.test.ts` | Memo, retry, dropped variable, KV last-good, fill-only fallbacks, Treasury paging and direct fallback, household per-series fallback, BEA columns |
| `src-tauri/src/sources_tests.rs` | The desktop mirror |
