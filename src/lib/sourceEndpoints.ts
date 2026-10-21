// =================================================================
// sourceEndpoints — upstream endpoint policy per poll source (LOOM-436)
// =================================================================
// One explicit primary/fallback contract for every `SourceKind`. Fetch
// code stays environment-specific (Worker `catalog-proxy.ts`, desktop
// `sources.rs`); this table is the shared, reviewed inventory. The
// parity test (`upstreamParity.test.ts`) fails when a kind is missing,
// or when a listed host no longer appears in the Worker / Rust source.
// Human-readable form: docs/UPSTREAM_ENDPOINTS_2026-10-12.md.
// =================================================================

import type { SourceKind } from "./sourceRegistry";

export interface SourceEndpointContract {
  /** Primary upstream host(s) — each must appear in the Worker route (and Rust when `desktop` is "same"). */
  primary: string[];
  /** Ordered fallbacks tried when the primary fails; empty = none (stale cache / last_error only). */
  fallbacks: string[];
  /** How the desktop app reaches the data. */
  desktop: "same" | "worker-only";
  /** Redirect / versioning assumption to re-verify against upstream docs. */
  note?: string;
}

const none: string[] = [];

export const SOURCE_ENDPOINTS: Record<SourceKind, SourceEndpointContract> = {
  usgs: { primary: ["earthquake.usgs.gov"], fallbacks: none, desktop: "same" },
  eonet: { primary: ["eonet.gsfc.nasa.gov"], fallbacks: none, desktop: "same" },
  gdacs: { primary: ["www.gdacs.org"], fallbacks: none, desktop: "same" },
  nws: { primary: ["api.weather.gov"], fallbacks: none, desktop: "same", note: "Worker trims to newest 150 alerts" },
  meteo: { primary: ["api.open-meteo.com"], fallbacks: none, desktop: "same", note: "city list mirrored in Rust CITIES / WORLD_CITIES" },
  aq: { primary: ["air-quality-api.open-meteo.com"], fallbacks: none, desktop: "same" },
  ukcarbon: { primary: ["api.carbonintensity.org.uk"], fallbacks: none, desktop: "same", note: "yesterday + today stitched" },
  climate: { primary: ["www.ncei.noaa.gov"], fallbacks: ["www.ncei.noaa.gov (previous year)"], desktop: "same", note: "falls back to last year's series in January" },
  buoys: { primary: ["www.ndbc.noaa.gov"], fallbacks: none, desktop: "same" },
  firms: { primary: ["firms.modaps.eosdis.nasa.gov"], fallbacks: none, desktop: "same" },
  nwis: { primary: ["waterservices.usgs.gov"], fallbacks: none, desktop: "same", note: "-999999 sentinel is null" },
  opensky: {
    primary: ["opensky-network.org"],
    fallbacks: ["api.adsb.lol", "opendata.adsb.fi"],
    desktop: "same",
    note: "fallbacks sampled at 5 US points (ADSB_POINTS)",
  },
  citibike: { primary: ["gbfs.citibikenyc.com"], fallbacks: none, desktop: "same", note: "info + status joined; shared parity fixtures" },
  mbta: { primary: ["api-v3.mbta.com"], fallbacks: none, desktop: "same" },
  nyc311: { primary: ["data.cityofnewyork.us"], fallbacks: none, desktop: "same" },
  iss: { primary: ["api.wheretheiss.at"], fallbacks: none, desktop: "same" },
  launches: { primary: ["ll.thespacedevs.com"], fallbacks: ["lldev.thespacedevs.com"], desktop: "same", note: "dev mirror is rate-limit relief only" },
  spacex: { primary: ["ll.thespacedevs.com"], fallbacks: ["lldev.thespacedevs.com"], desktop: "same", note: "api.spacexdata.com is retired" },
  spaceweather: { primary: ["services.swpc.noaa.gov"], fallbacks: none, desktop: "same" },
  aurora: { primary: ["services.swpc.noaa.gov"], fallbacks: none, desktop: "same" },
  asteroids: { primary: ["ssd-api.jpl.nasa.gov"], fallbacks: none, desktop: "same" },
  starlink: { primary: ["celestrak.org"], fallbacks: none, desktop: "same" },
  hn: { primary: ["hn.algolia.com"], fallbacks: none, desktop: "same" },
  lobsters: { primary: ["lobste.rs"], fallbacks: none, desktop: "same" },
  pageviews: { primary: ["wikimedia.org"], fallbacks: ["wikimedia.org (previous day)"], desktop: "same", note: "today's file may not exist yet" },
  steam: { primary: ["steamspy.com"], fallbacks: none, desktop: "same" },
  crypto: { primary: ["api.coingecko.com"], fallbacks: ["api.coinpaprika.com"], desktop: "same", note: "Paprika mapped onto CoinGecko shape" },
  bitcoin: { primary: ["mempool.space"], fallbacks: none, desktop: "same" },
  fx: {
    primary: ["api.frankfurter.dev"],
    fallbacks: none,
    desktop: "same",
    note: "/v1/ path on both runtimes; legacy api.frankfurter.app only redirects here",
  },
  debt: { primary: ["api.fiscaldata.treasury.gov"], fallbacks: none, desktop: "same" },
  fema: { primary: ["www.fema.gov"], fallbacks: none, desktop: "same" },
  covid: { primary: ["disease.sh"], fallbacks: none, desktop: "same" },
  countries: { primary: ["raw.githubusercontent.com", "api.worldbank.org"], fallbacks: none, desktop: "same", note: "two-source join; both required" },
  usafacts_states: {
    primary: ["data.mcp.usafacts.org"],
    fallbacks: none,
    desktop: "same",
    note: "USAFacts Data gateway (beta, keyless JSON-RPC) → Census ACS 1-year; api.census.gov now needs a key, so outages serve the stale cache",
  },
  usafacts_nation: {
    primary: ["data.mcp.usafacts.org"],
    fallbacks: ["fred.stlouisfed.org (fredgraph.csv)"],
    desktop: "same",
    note: "USAFacts Data gateway → FRED observations; keyless fredgraph.csv when any series fails",
  },
  world_bank: { primary: ["api.worldbank.org"], fallbacks: none, desktop: "same" },
  fireballs: { primary: ["ssd-api.jpl.nasa.gov"], fallbacks: none, desktop: "same" },
  satellites: { primary: ["celestrak.org"], fallbacks: none, desktop: "same", note: "GROUP=visual; 403 text when polled before the 2h refresh" },
  internet_outages: { primary: ["api.ioda.inetintel.cc.gatech.edu"], fallbacks: none, desktop: "same", note: "7-day window in 15-min buckets" },
  faa_delays: { primary: ["nasstatus.faa.gov"], fallbacks: none, desktop: "same", note: "XML; often empty on calm days" },
  lobbying: { primary: ["lda.gov"], fallbacks: none, desktop: "same", note: "lda.senate.gov redirects to lda.gov" },
  fda_recalls: { primary: ["api.fda.gov"], fallbacks: none, desktop: "same", note: "food + drug + device enforcement; any one is enough" },
  vehicle_recalls: { primary: ["data.transportation.gov"], fallbacks: none, desktop: "same" },
  arxiv: { primary: ["export.arxiv.org"], fallbacks: none, desktop: "same", note: "five sequential category queries, 1 s apart" },
  github_events: { primary: ["api.github.com"], fallbacks: none, desktop: "same", note: "60 req/h unauthenticated" },
  books: { primary: ["openlibrary.org", "gutendex.com"], fallbacks: none, desktop: "same", note: "either upstream alone is enough" },
  nyc_inspections: { primary: ["data.cityofnewyork.us"], fallbacks: none, desktop: "same" },
  chicago_crime: { primary: ["data.cityofchicago.org"], fallbacks: none, desktop: "same" },
  nyc_parking: { primary: ["data.cityofnewyork.us"], fallbacks: none, desktop: "same", note: "$select omits plate" },
  powerball: { primary: ["data.ny.gov"], fallbacks: none, desktop: "same" },
  fed_spending: { primary: ["api.usaspending.gov"], fallbacks: none, desktop: "same" },
  bikeshare: {
    primary: ["gbfs.divvybikes.com", "gbfs.capitalbikeshare.com", "gbfs.lyftbikes.com"],
    fallbacks: none,
    desktop: "same",
    note: "any system alone is enough",
  },
  bluesky: {
    primary: ["jetstream2.us-east.bsky.network"],
    fallbacks: none,
    desktop: "worker-only",
    note: "WebSocket sampled ~5 s in the Worker; desktop reads /api/source/bluesky",
  },
  bgp: {
    primary: ["ris-live.ripe.net"],
    fallbacks: none,
    desktop: "worker-only",
    note: "WebSocket sampled ~5 s in the Worker; desktop reads /api/source/bgp",
  },
  nobel: { primary: ["api.nobelprize.org"], fallbacks: none, desktop: "same", note: "laureates JSON; one row per prize" },
  trivia: { primary: ["opentdb.com"], fallbacks: none, desktop: "same", note: "10×50 question fetches" },
  pokemon: {
    primary: ["pokeapi.co"],
    fallbacks: none,
    desktop: "worker-only",
    note: "Gen 1 detail fan-out in the Worker; desktop reads /api/source/pokemon",
  },
  met: {
    primary: ["collectionapi.metmuseum.org"],
    fallbacks: none,
    desktop: "worker-only",
    note: "highlight search + object fan-out in the Worker; desktop reads /api/source/met",
  },
  openfood: { primary: ["world.openfoodfacts.org"], fallbacks: none, desktop: "same", note: "top scanned products, capped" },
  radio: { primary: ["de1.api.radio-browser.info"], fallbacks: none, desktop: "same", note: "topvote/500" },
};
