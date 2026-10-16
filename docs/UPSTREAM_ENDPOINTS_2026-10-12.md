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
| usafacts_states | USAFacts Data gateway (`data.mcp.usafacts.org`, beta, keyless) → Census ACS 1-year | 24h cache; no fallback (api.census.gov needs a key) — stale cache on outage |
| usafacts_nation | USAFacts Data gateway → FRED observations | 12h cache; fallback `fred.stlouisfed.org/graph/fredgraph.csv` (keyless) |

## Machine-checked inventory

`src/lib/sourceEndpoints.ts` lists primary host(s), ordered fallbacks and desktop/Worker reach for **every** `SourceKind`. `src/lib/__tests__/upstreamParity.test.ts` fails if a kind is missing, a listed host disappears from `workers/catalog-proxy.ts` / `sources.rs`, or shared constants (cities, ADSB points, caps) drift.

## Change process

1. Update registry columns/types if the payload shape changes.
2. Update Worker transform **and** Rust parser together.
3. Add/adjust fixtures under `src-tauri/tests/fixtures/sources/` and Vitest boundary tests.
4. Never treat an unexplained HTTP redirect as the schema source of truth — pin the final JSON shape in fixtures.
