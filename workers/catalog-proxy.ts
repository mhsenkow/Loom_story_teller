// =================================================================
// Loom — Cloudflare Worker (static UI + open-data API)
// =================================================================
// Serves Next static export via ASSETS; `/api/catalog/*`, `/api/fetch-csv`,
// `/api/source/*` (live poll feeds), and `/api/feedback` (GitHub issues).
// =================================================================

import {
  fetchUkCatalogUpstream,
  fetchUsCatalogUpstream,
  type FetchDataGovOptions,
  type DataGovSortKey,
} from "../src/lib/openDataCatalog";
import {
  ADSB_POINTS,
  WB_WIDE_INDICATORS,
  WORLD_CITIES,
  adsbToOpensky,
  auroraCells,
  cneosApproaches,
  gdacsEvents,
  joinCitibike,
  ll2ToSpacex,
  mergeCountries,
  mbtaVehicles,
  mempoolBlocks,
  mempoolLowestHeight,
  mergeUkCarbon,
  ndbcLatestObs,
  openMeteoCities,
  paprikaToGecko,
  steamTop,
  treasuryDebt,
  trimNwsAlerts,
  utcDay,
  worldBankWide,
} from "./sourceTransforms";

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Fine-grained PAT with `issues: write` on mhsenkow/Loom_story_teller */
  GITHUB_TOKEN?: string;
}

const GITHUB_REPO = "mhsenkow/Loom_story_teller";
const MAX_CSV_BYTES = 32 * 1024 * 1024;
const PREVIEW_CSV_BYTES = 2 * 1024 * 1024;
const UA =
  "Loom-Data-Storyteller/1.0 (https://loom.ibm.io; github.com/mhsenkow/Loom_story_teller)";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function optsFromUrl(url: URL): FetchDataGovOptions {
  const rows = Number(url.searchParams.get("rows") || "40");
  const q = url.searchParams.get("q") || undefined;
  const sort = (url.searchParams.get("sort") as DataGovSortKey | null) || undefined;
  const csvOnly =
    url.searchParams.get("csvOnly") === "1" || url.searchParams.get("csvOnly") === "true";
  return { rows, query: q, sort: sort || undefined, csvOnly };
}

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local")) return true;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(h)) return true;
  if (h === "0.0.0.0" || h.endsWith(".internal")) return true;
  return false;
}

async function handleFetchCsv(requestUrl: URL): Promise<Response> {
  const target = requestUrl.searchParams.get("url");
  if (!target) return json({ error: "Missing url" }, 400);
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: "Invalid url" }, 400);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return json({ error: "Only http(s) URLs allowed" }, 400);
  }
  if (isBlockedHost(parsed.hostname)) {
    return json({ error: "Host not allowed" }, 400);
  }

  const headers = {
    "User-Agent": UA,
    Accept: "text/csv,text/plain,*/*",
  };

  let useRange = false;
  try {
    const head = await fetch(parsed.toString(), { method: "HEAD", headers, redirect: "follow" });
    const len = Number(head.headers.get("content-length") || "0");
    if (len > MAX_CSV_BYTES) useRange = true;
  } catch {
    /* HEAD may fail */
  }

  const upstream = await fetch(parsed.toString(), {
    headers: useRange
      ? { ...headers, Range: `bytes=0-${PREVIEW_CSV_BYTES - 1}` }
      : headers,
    redirect: "follow",
  });
  if (!upstream.ok && upstream.status !== 206) {
    return json({ error: `Upstream ${upstream.status}` }, 502);
  }

  const reader = upstream.body?.getReader();
  if (!reader) return json({ error: "Empty response" }, 502);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const cap = useRange ? PREVIEW_CSV_BYTES : MAX_CSV_BYTES;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = cap - total;
    if (remaining <= 0) {
      reader.cancel().catch(() => {});
      break;
    }
    if (value.byteLength > remaining) {
      chunks.push(value.slice(0, remaining));
      total += remaining;
      reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }

  // Many open-data portals label Excel workbooks as .csv — reject early
  if (total >= 2 && out[0] === 0x50 && out[1] === 0x4b) {
    return json(
      {
        error:
          "This download is an Excel workbook (xlsx), not CSV. Pick a CSV resource from the portal.",
      },
      415,
    );
  }

  const truncated = useRange || total >= MAX_CSV_BYTES;
  return new Response(out, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      ...(truncated ? { "X-Loom-Truncated": "1" } : {}),
      ...CORS,
    },
  });
}

// ---- Live poll sources (`/api/source/<kind>`) ----
//
// Every kind is one fetcher that returns JSON text in the shape the browser
// parser in src/lib/webStreams.ts reads. `handleSource` wraps it in
// caches.default (per-kind TTL + a stale window served when the upstream
// fails) and every upstream call has a timeout so one hung API can't stall
// the request. Note: the Cache API is a no-op on *.workers.dev — caching
// only takes effect on the custom domain (loom.ibm.io) and in wrangler dev.

interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

class UpstreamError extends Error {}

/** fetch with a hard timeout; throws `UpstreamError` on timeout / network error / non-2xx. */
async function upstream(
  label: string,
  url: string,
  opts: { timeoutMs?: number; accept?: string } = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: opts.accept ?? "application/json,application/geo+json,*/*" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new UpstreamError(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new UpstreamError(`${label} unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    throw new UpstreamError(`${label} ${res.status}`);
  }
  return res;
}

async function upstreamText(label: string, url: string, timeoutMs?: number): Promise<string> {
  return (await upstream(label, url, { timeoutMs })).text();
}

async function upstreamJson<T = unknown>(label: string, url: string, timeoutMs?: number): Promise<T> {
  return (await upstream(label, url, { timeoutMs })).json() as Promise<T>;
}

const SUBCACHE_ORIGIN = "https://loom-source.internal/upstream/";

/** JSON from a slow-changing upstream, cached separately (e.g. GBFS station list, WB country list). */
async function cachedUpstreamJson<T = unknown>(
  label: string,
  url: string,
  ttlSecs: number,
  ctx: WaitUntil,
  timeoutMs?: number,
): Promise<T> {
  const key = SUBCACHE_ORIGIN + encodeURIComponent(url);
  const cache = caches.default;
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return (await hit.json()) as T;
  const text = await upstreamText(label, url, timeoutMs);
  ctx.waitUntil(
    cache
      .put(key, new Response(text, {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttlSecs}` },
      }))
      .catch(() => {}),
  );
  return JSON.parse(text) as T;
}

type SourceFetcher = (ctx: WaitUntil) => Promise<string>;

const OPEN_METEO_LATS = WORLD_CITIES.map((c) => c.lat).join(",");
const OPEN_METEO_LONS = WORLD_CITIES.map((c) => c.lon).join(",");

/**
 * Launch Library 2 allows ~15 calls/hour per IP, which Cloudflare's shared egress
 * exhausts quickly. Fall back to the unthrottled dev mirror (same API, data can lag).
 */
async function spaceDevsText(path: string): Promise<string> {
  try {
    return await upstreamText("Space Devs", `https://ll.thespacedevs.com${path}`, 15_000);
  } catch {
    return upstreamText("Space Devs (dev mirror)", `https://lldev.thespacedevs.com${path}`, 15_000);
  }
}

const SOURCE_FETCHERS: Record<string, SourceFetcher> = {
  usgs: () =>
    upstreamText("USGS", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"),

  eonet: () =>
    upstreamText("NASA EONET", "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=300", 15_000),

  nws: async () => {
    // `limit` is no longer accepted; the full feed is ~1.7 MB — trim to what the parser reads.
    const body = await upstreamJson("NWS", "https://api.weather.gov/alerts/active?status=actual", 15_000);
    return JSON.stringify(trimNwsAlerts(body, 150));
  },

  meteo: async () => {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${OPEN_METEO_LATS}&longitude=${OPEN_METEO_LONS}` +
      `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code,pressure_msl,cloud_cover` +
      `&past_days=2&forecast_days=1&timezone=GMT`; // UTC so every city shares one time axis
    return JSON.stringify(openMeteoCities(await upstreamJson("Open-Meteo", url), "hourly"));
  },

  aq: async () => {
    const url =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${OPEN_METEO_LATS}&longitude=${OPEN_METEO_LONS}` +
      `&current=pm2_5,pm10,ozone,nitrogen_dioxide,european_aqi`;
    return JSON.stringify(openMeteoCities(await upstreamJson("Open-Meteo AQ", url), "current"));
  },

  ukcarbon: async () => {
    const [yesterday, today] = await Promise.all([
      upstreamJson("Carbon Intensity", `https://api.carbonintensity.org.uk/intensity/date/${utcDay(1)}`),
      upstreamJson("Carbon Intensity", "https://api.carbonintensity.org.uk/intensity/date"),
    ]);
    return JSON.stringify(mergeUkCarbon(yesterday, today));
  },

  climate: async () => {
    const year = new Date().getUTCFullYear();
    const url = (y: number) =>
      `https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series/globe/land_ocean/1/0/1880-${y}/data.json`;
    try {
      return await upstreamText("NOAA NCEI", url(year), 15_000);
    } catch {
      return upstreamText("NOAA NCEI", url(year - 1), 15_000);
    }
  },

  opensky: async () => {
    // OpenSky rate-limits Cloudflare's shared IPs (429/522) — try briefly, then ADSB.lol.
    try {
      const body = await upstreamJson<{ states?: unknown[] | null }>(
        "OpenSky",
        "https://opensky-network.org/api/states/all?lamin=24.5&lomin=-125.0&lamax=49.5&lomax=-66.5",
        6_000,
      );
      if (Array.isArray(body.states) && body.states.length > 0) return JSON.stringify(body);
    } catch {
      /* fall through */
    }
    // ADSB.lol tolerates only 2–3 quick calls per IP: go one point at a time, spaced out,
    // starting at a rotating point so coverage moves across the US between polls, and
    // keep whatever arrived before the first 429.
    // Same readsb aircraft format from two community networks; adsb.fi names the list
    // `aircraft` instead of `ac`. Both throttle per IP (~1 req/s), so go one point at a
    // time from a rotating start and keep whatever arrived before the first refusal.
    const providers = [
      { name: "ADSB.lol", url: (p: { lat: number; lon: number }) => `https://api.adsb.lol/v2/point/${p.lat}/${p.lon}/250` },
      { name: "adsb.fi", url: (p: { lat: number; lon: number }) => `https://opendata.adsb.fi/api/v2/lat/${p.lat}/lon/${p.lon}/dist/250` },
    ];
    const start = Math.floor(Date.now() / 60_000) % ADSB_POINTS.length;
    const errors: string[] = [];
    for (const prov of providers) {
      const ok: unknown[] = [];
      for (let i = 0; i < ADSB_POINTS.length; i++) {
        const p = ADSB_POINTS[(start + i) % ADSB_POINTS.length]!;
        try {
          const body = await upstreamJson<{ ac?: unknown[]; aircraft?: unknown[] }>(prov.name, prov.url(p), 8_000);
          ok.push({ ...body, ac: body.ac ?? body.aircraft ?? [] });
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
          break;
        }
        if (i < ADSB_POINTS.length - 1) await new Promise((r) => setTimeout(r, 1_200));
      }
      if (ok.length > 0) return JSON.stringify(adsbToOpensky(ok));
    }
    throw new UpstreamError(`OpenSky and ADS-B fallbacks failed (${errors.join("; ") || "unknown"})`);
  },

  citibike: async (ctx) => {
    const [info, status] = await Promise.all([
      cachedUpstreamJson("Citi Bike GBFS", "https://gbfs.citibikenyc.com/gbfs/en/station_information.json", 86_400, ctx),
      upstreamJson("Citi Bike GBFS", "https://gbfs.citibikenyc.com/gbfs/en/station_status.json"),
    ]);
    return JSON.stringify(joinCitibike(info, status));
  },

  nyc311: () =>
    upstreamText(
      "NYC 311",
      "https://data.cityofnewyork.us/resource/erm2-nwe9.json?$limit=400&$order=created_date%20DESC",
      15_000,
    ),

  iss: () => upstreamText("ISS", "https://api.wheretheiss.at/v1/satellites/25544", 8_000),

  iss_trail: () => {
    // wheretheiss.at allows ≤10 timestamps per request — one orbit (~90m) of samples.
    const now = Math.floor(Date.now() / 1000);
    const stamps: number[] = [];
    for (let i = 9; i >= 0; i--) stamps.push(now - i * 600);
    return upstreamText(
      "ISS trail",
      `https://api.wheretheiss.at/v1/satellites/25544/positions?timestamps=${stamps.join(",")}`,
      8_000,
    );
  },

  // normal mode: pad / agency / rocket / mission.orbit objects (list mode only has strings)
  launches: () => spaceDevsText("/2.2.0/launch/upcoming/?limit=40&mode=normal"),

  spacex: async () => {
    // api.spacexdata.com is gone — Launch Library 2 (normal mode for mission descriptions).
    const body = JSON.parse(await spaceDevsText("/2.2.0/launch/previous/?lsp__name=SpaceX&limit=100&mode=normal"));
    return JSON.stringify(ll2ToSpacex(body));
  },

  spaceweather: () =>
    upstreamText("NOAA SWPC", "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"),

  hn: () => upstreamText("HN", "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50"),

  pageviews: async () => {
    // Yesterday (UTC) lands a few hours after midnight — fall back to the day before.
    const url = (d: string) =>
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${d.replace(/-/g, "/")}`;
    try {
      return await upstreamText("Wikimedia", url(utcDay(1)));
    } catch {
      return upstreamText("Wikimedia", url(utcDay(2)));
    }
  },

  crypto: async () => {
    // CoinGecko 429s Cloudflare's shared IPs often — CoinPaprika mapped into the same shape.
    try {
      return await upstreamText(
        "CoinGecko",
        "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false",
        6_000,
      );
    } catch {
      const body = await upstreamJson("CoinPaprika", "https://api.coinpaprika.com/v1/tickers?limit=50");
      return JSON.stringify(paprikaToGecko(body));
    }
  },

  fx: () => upstreamText("Frankfurter", `https://api.frankfurter.dev/v1/${utcDay(90)}..`),

  fema: () =>
    upstreamText(
      "FEMA",
      "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=200&$orderby=declarationDate%20desc",
      15_000,
    ),

  covid: () => upstreamText("disease.sh", "https://disease.sh/v3/covid-19/countries"),

  countries: async () => {
    // restcountries v3.1 is deprecated (v5 needs a key): mledoze/countries + World Bank population.
    const [list, pop] = await Promise.all([
      upstreamJson("mledoze/countries", "https://raw.githubusercontent.com/mledoze/countries/master/countries.json", 15_000),
      upstreamJson(
        "World Bank",
        "https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=400&mrnev=1",
      ),
    ]);
    return JSON.stringify(mergeCountries(list, pop));
  },

  world_bank: async (ctx) => {
    const [countryList, ...bodies] = await Promise.all([
      cachedUpstreamJson("World Bank", "https://api.worldbank.org/v2/country?format=json&per_page=400", 86_400, ctx),
      // ≈ 265 entities × 24 years ≈ 6.4k rows per indicator — one page each
      ...WB_WIDE_INDICATORS.map((ind) =>
        upstreamJson(
          "World Bank",
          `https://api.worldbank.org/v2/country/all/indicator/${ind.id}?format=json&per_page=10000&date=2000:2023`,
          15_000,
        ),
      ),
    ]);
    return JSON.stringify(worldBankWide(countryList, bodies));
  },

  // ---- Columnar feeds (`{ columns, rows }` in registry order) ----

  gdacs: async () => {
    // The `/MAP` variant 400s; SEARCH returns the 100 most recent events as GeoJSON.
    const body = await upstreamJson(
      "GDACS",
      "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;WF;DR&alertlevel=Green;Orange;Red",
      15_000,
    );
    return JSON.stringify(gdacsEvents(body));
  },

  buoys: async () => {
    const text = await upstreamText("NOAA NDBC", "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt", 15_000);
    return JSON.stringify(ndbcLatestObs(text));
  },

  mbta: async () => {
    // Keyless limit is ~20 req/min per IP — the 30 s source cache keeps us well under it.
    const body = await upstreamJson("MBTA", "https://api-v3.mbta.com/vehicles?include=route&page[limit]=1000");
    return JSON.stringify(mbtaVehicles(body));
  },

  aurora: async () => {
    // ~900 KB / 65k points on a 1° grid → ≈3k 2° cells with probability ≥ 3.
    const body = await upstreamJson("NOAA SWPC", "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json", 15_000);
    return JSON.stringify(auroraCells(body));
  },

  asteroids: async () => {
    const body = await upstreamJson(
      "NASA JPL",
      "https://ssd-api.jpl.nasa.gov/cad.api?date-min=now&date-max=%2B60&dist-max=0.05&fullname=true",
    );
    return JSON.stringify(cneosApproaches(body));
  },

  steam: async () => {
    const body = await upstreamJson("SteamSpy", "https://steamspy.com/api.php?request=top100in2weeks", 15_000);
    return JSON.stringify(steamTop(body));
  },

  bitcoin: async () => {
    // Newest 15 blocks, then 3 older pages one at a time (~60 blocks). A later page
    // failing just means fewer blocks, not an error.
    const first = await upstreamJson("mempool.space", "https://mempool.space/api/v1/blocks", 15_000);
    const pages: unknown[] = [first];
    let low = mempoolLowestHeight(first);
    for (let i = 0; i < 3 && low != null && low > 0; i++) {
      try {
        const page = await upstreamJson("mempool.space", `https://mempool.space/api/v1/blocks/${low - 1}`, 8_000);
        pages.push(page);
        low = mempoolLowestHeight(page);
      } catch {
        break;
      }
    }
    return JSON.stringify(mempoolBlocks(pages));
  },

  debt: async () => {
    // ≈ 8.4k business days since 1993 in one page (~2.8 MB upstream, ~0.4 MB out).
    const body = await upstreamJson(
      "US Treasury",
      "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny" +
        "?fields=record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt" +
        "&sort=-record_date&page[size]=10000",
      20_000,
    );
    return JSON.stringify(treasuryDebt(body));
  },
};

/** Fresh-for seconds per kind (roughly the upstream's own update cadence). */
const SOURCE_TTL_SECS: Record<string, number> = {
  iss: 5,
  mbta: 30,
  opensky: 60,
  bitcoin: 60,
  usgs: 60,
  crypto: 60,
  citibike: 60,
  hn: 60,
  iss_trail: 60,
  nyc311: 300,
  nws: 300,
  meteo: 600,
  aq: 600,
  eonet: 600,
  ukcarbon: 900,
  spaceweather: 900,
  aurora: 300,
  gdacs: 600,
  buoys: 900,
  launches: 3600,
  spacex: 3600,
  fx: 3600,
  fema: 3600,
  covid: 3600,
  pageviews: 3600,
  asteroids: 21_600,
  steam: 21_600,
  countries: 86_400,
  world_bank: 86_400,
  climate: 86_400,
  debt: 86_400,
};

/** How long past its TTL a cached copy may still be served when the upstream fails. */
function staleSecs(ttl: number): number {
  return Math.min(2 * 86_400, Math.max(600, ttl * 4));
}

const SOURCE_CACHE_ORIGIN = "https://loom-source.internal/source/";

function sourceResponse(body: BodyInit | null, cacheState: string, fetchedAt: number): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Loom-Cache": cacheState,
      "X-Loom-Fetched-At": new Date(fetchedAt).toISOString(),
      ...CORS,
    },
  });
}

async function handleSource(kind: string, ctx: WaitUntil): Promise<Response> {
  const fetcher = Object.prototype.hasOwnProperty.call(SOURCE_FETCHERS, kind) ? SOURCE_FETCHERS[kind] : undefined;
  if (!fetcher) return json({ error: "Unknown source" }, 404);

  const ttl = SOURCE_TTL_SECS[kind] ?? 60;
  const stale = staleSecs(ttl);
  const cache = caches.default;
  const key = SOURCE_CACHE_ORIGIN + kind;
  const now = Date.now();

  const cached = await cache.match(key).catch(() => undefined);
  const cachedAt = cached ? Number(cached.headers.get("X-Loom-Fetched-Ms") || "0") : 0;
  if (cached && now - cachedAt <= ttl * 1000) {
    return sourceResponse(cached.body, "HIT", cachedAt);
  }

  try {
    const text = await fetcher(ctx);
    ctx.waitUntil(
      cache
        .put(key, new Response(text, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${ttl + stale}`,
            "X-Loom-Fetched-Ms": String(now),
          },
        }))
        .catch(() => {}),
    );
    cached?.body?.cancel().catch(() => {});
    return sourceResponse(text, "MISS", now);
  } catch (e) {
    if (cached && now - cachedAt <= (ttl + stale) * 1000) {
      return sourceResponse(cached.body, "STALE", cachedAt);
    }
    cached?.body?.cancel().catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 502);
  }
}

async function handleFeedback(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_TOKEN) {
    return json(
      {
        error:
          "Feedback API not configured. Set GITHUB_TOKEN on the Worker (wrangler secret put GITHUB_TOKEN).",
      },
      503,
    );
  }

  let payload: {
    title?: string;
    body?: string;
    imageBase64?: string | null;
    href?: string;
    kind?: string;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const title = (payload.title || "Loom feedback").trim().slice(0, 200);
  let body = (payload.body || "(no description)").trim().slice(0, 50_000);
  const kind = (payload.kind || "feedback").trim().slice(0, 40);
  const href = (payload.href || "").trim().slice(0, 500);

  const meta = [
    `**Kind:** ${kind}`,
    href ? `**Page:** ${href}` : null,
    `**Source:** loom.ibm.io web feedback`,
  ]
    .filter(Boolean)
    .join("\n");

  body = `${body}\n\n---\n${meta}`;

  if (payload.imageBase64 && payload.imageBase64.length < 400_000) {
    const dataUrl = payload.imageBase64.startsWith("data:")
      ? payload.imageBase64
      : `data:image/png;base64,${payload.imageBase64}`;
    body += `\n\n![screenshot](${dataUrl})`;
  }

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": UA,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      body,
      labels: ["feedback", "web"],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return json({ error: `GitHub ${res.status}: ${text.slice(0, 400)}` }, 502);
  }

  const issue = (await res.json()) as { html_url?: string };
  if (!issue.html_url) return json({ error: "No issue URL returned" }, 502);
  return json({ url: issue.html_url });
}

const STORY_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const MAX_STORY_HTML_BYTES = 4 * 1024 * 1024;

function storyId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

async function handlePublishStory(request: Request): Promise<Response> {
  let payload: { html?: string; title?: string; ogImage?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  let html = payload.html?.trim() ?? "";
  if (!html || html.length > MAX_STORY_HTML_BYTES) {
    return json({ error: "HTML missing or too large (4MB max)" }, 400);
  }
  if (!html.includes("<html") && !html.includes("<HTML")) {
    return json({ error: "Expected an HTML document" }, 400);
  }

  const id = storyId();
  const cache = caches.default;
  const cacheUrl = new URL(`https://loom-story.internal/s/${id}`);
  const origin = new URL(request.url).origin;

  // Link unfurlers (iMessage, Slack, X…) ignore data: URLs — host the preview
  // image beside the page and point og:image / twitter:image at it.
  const og = payload.ogImage?.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
  if (og && og[2]!.length < MAX_STORY_HTML_BYTES) {
    const bytes = Uint8Array.from(atob(og[2]!), (c) => c.charCodeAt(0));
    await cache.put(
      `https://loom-story.internal/s/${id}.img`,
      new Response(bytes, {
        headers: { "Content-Type": og[1]!, "Cache-Control": `public, max-age=${STORY_TTL_SECONDS}` },
      }),
    );
    const hosted = `${origin}/s/${id}.img`;
    html = html.split(`content="${payload.ogImage}"`).join(`content="${hosted}"`);
  }

  const res = new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": `public, max-age=${STORY_TTL_SECONDS}`,
      "X-Loom-Story-Title": (payload.title || "Loom story").slice(0, 120),
    },
  });
  await cache.put(cacheUrl.toString(), res.clone());

  return json({ id, url: `${origin}/s/${id}` });
}

async function handleGetStory(id: string): Promise<Response> {
  if (!/^[a-z0-9]{8,16}(\.img)?$/i.test(id)) {
    return json({ error: "Invalid story id" }, 400);
  }
  const cache = caches.default;
  const cacheUrl = `https://loom-story.internal/s/${id}`;
  const hit = await cache.match(cacheUrl);
  if (!hit) {
    return new Response("Story not found or expired.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
    });
  }
  const headers = new Headers(hit.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(hit.body, { status: 200, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: WaitUntil): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/s/"))) {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      if (url.pathname === "/api/catalog/us") {
        const data = await fetchUsCatalogUpstream(optsFromUrl(url));
        return json(data);
      }
      if (url.pathname === "/api/catalog/uk") {
        const data = await fetchUkCatalogUpstream(optsFromUrl(url));
        return json(data);
      }
      if (url.pathname === "/api/fetch-csv") {
        return await handleFetchCsv(url);
      }
      if (url.pathname.startsWith("/api/source/")) {
        const kind = url.pathname.replace("/api/source/", "").replace(/\/$/, "");
        return await handleSource(kind, ctx);
      }
      if (url.pathname === "/api/feedback" && request.method === "POST") {
        return await handleFeedback(request, env);
      }
      if (url.pathname === "/api/stories" && request.method === "POST") {
        return await handlePublishStory(request);
      }
      if (url.pathname.startsWith("/s/")) {
        const id = url.pathname.slice(3).replace(/\/$/, "");
        return await handleGetStory(id);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: msg }, 502);
    }

    return env.ASSETS.fetch(request);
  },
};
