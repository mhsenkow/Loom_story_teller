# Upstream endpoint inventory (LOOM-436)

**Date:** 2026-10-12

Desktop (`src-tauri/src/sources.rs` + `stream.rs`) and the catalog Worker (`workers/catalog-proxy.ts`) each fetch upstreams. Shared column contracts live in `src/lib/sourceRegistry.ts`. Transforms for web live in `workers/sourceTransforms.ts`.

## Contract

| Kind | Primary | Fallback / notes |
|------|---------|------------------|
| wiki | Wikimedia SSE `stream.wikimedia.org` | Desktop reconnect with idle timeout; web `EventSource` |
| usgs | USGS all_day GeoJSON | Worker cached `/api/source/usgs` |
| nws | api.weather.gov alerts | Same path via Worker |
| meteo / aq | Open-Meteo multi-city | `WORLD_CITIES` / Rust `CITIES` — keep names in sync (LOOM-681) |
| citibike | GBFS station_information + station_status | Join in Worker `joinCitibike` / Rust `citibike_*`; shared fixtures under `src-tauri/tests/fixtures/sources/` |
| firms | NASA FIRMS VIIRS CSV | Empty/malformed → no rows |
| nwis | USGS Waterservices IV JSON | Wide pivot; empty values → null |
| starlink | CelesTrak GP JSON | Debris / incomplete objects skipped |
| fx | `api.frankfurter.dev/v1/` (Worker **and** desktop) | Legacy `api.frankfurter.app` only redirects — not used. Shared `fx.json` + `fx_parity_expected.json` gate (Vitest + Rust) |
| world_bank / debt / covid / countries | World Bank / OWID-style JSON | Worker cache TTLs in catalog-proxy |
| usafacts_states | USAFacts Data gateway (`data.mcp.usafacts.org`, beta, keyless) → Census ACS 1-year + FRED annual CPI | 24h cache; per-vintage memo (settled 30 d); no keyless fallback (api.census.gov needs a key) — memo, edge stale copy, then KV last-good |
| usafacts_nation | USAFacts Data gateway → FRED observations (8 series) | 12h cache; per-series memo; `fred.stlouisfed.org/graph/fredgraph.csv` fills only missing series; KV last-good |
| usafacts_budget | USAFacts Data gateway → Treasury MTS Table 9 (paged ≤ 1000 rows) + average interest rates | 12h cache; memo shared with budget_lines; direct `api.fiscaldata.treasury.gov` (keyless, 10k rows); KV last-good |
| usafacts_budget_lines | Same Treasury query, reshaped long (month × line) | as usafacts_budget |
| usafacts_household | USAFacts Data gateway → 14 FRED series, quarterly averages | 12h cache; per-series memo; one `fredgraph.csv` per series (multi-series quarterly asks return a ZIP); KV last-good |
| usafacts_state_jobs | USAFacts Data gateway → BLS LAUS `getSeriesData` (52 series, 2 calls) | 12h cache; per-batch memo; `fredgraph.csv` `{USPS}UR` (2 × 26 ids); KV last-good |

## Machine-checked inventory

`src/lib/sourceEndpoints.ts` lists primary host(s), ordered fallbacks and desktop/Worker reach for **every** `SourceKind`. `src/lib/__tests__/upstreamParity.test.ts` fails if a kind is missing, a listed host disappears from `workers/catalog-proxy.ts` / `sources.rs`, or shared constants (cities, ADSB points, caps) drift.

## Change process

1. Update registry columns/types if the payload shape changes.
2. Update Worker transform **and** Rust parser together.
3. Add/adjust fixtures under `src-tauri/tests/fixtures/sources/` and Vitest boundary tests.
4. Never treat an unexplained HTTP redirect as the schema source of truth — pin the final JSON shape in fixtures.
