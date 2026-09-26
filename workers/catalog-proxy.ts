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

const METEO_CITIES = [
  { name: "New York", lat: 40.71, lon: -74.01 },
  { name: "London", lat: 51.51, lon: -0.13 },
  { name: "Tokyo", lat: 35.68, lon: 139.69 },
  { name: "Sydney", lat: -33.87, lon: 151.21 },
  { name: "São Paulo", lat: -23.55, lon: -46.63 },
] as const;

const WB_INDICATORS = [
  { id: "NY.GDP.MKTP.CD", name: "GDP (current US$)" },
  { id: "SP.POP.TOTL", name: "Population" },
  { id: "SP.DYN.LE00.IN", name: "Life expectancy at birth" },
  { id: "EN.ATM.CO2E.PC", name: "CO2 emissions (metric tons per capita)" },
] as const;

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

async function handleSource(kind: string): Promise<Response> {
  const headers = { "User-Agent": UA, Accept: "application/geo+json,application/json,*/*" };

  if (kind === "usgs") {
    const r = await fetch(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
      { headers },
    );
    if (!r.ok) return json({ error: `USGS ${r.status}` }, 502);
    return new Response(await r.text(), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (kind === "nws") {
    const r = await fetch("https://api.weather.gov/alerts/active?status=actual&limit=50", {
      headers,
    });
    if (!r.ok) return json({ error: `NWS ${r.status}` }, 502);
    return new Response(await r.text(), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (kind === "meteo") {
    const cities = [];
    for (const city of METEO_CITIES) {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
        `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code,pressure_msl,cloud_cover` +
        `&past_days=2&forecast_days=1&timezone=auto`;
      const r = await fetch(url, { headers });
      if (!r.ok) continue;
      const body = (await r.json()) as { hourly?: Record<string, unknown> };
      cities.push({
        name: city.name,
        lat: city.lat,
        lon: city.lon,
        hourly: body.hourly ?? {},
      });
    }
    return json({ cities });
  }

  if (kind === "world_bank") {
    const rows: Record<string, unknown>[] = [];
    for (const ind of WB_INDICATORS) {
      const url =
        `https://api.worldbank.org/v2/country/all/indicator/${ind.id}` +
        `?format=json&per_page=1000&date=2015:2023`;
      const r = await fetch(url, { headers });
      if (!r.ok) continue;
      const body = (await r.json()) as unknown[];
      const data = Array.isArray(body) ? body[1] : null;
      if (!Array.isArray(data)) continue;
      for (const entry of data) {
        const e = entry as {
          value?: number | null;
          countryiso3code?: string;
          country?: { value?: string };
          date?: string;
          indicator?: { id?: string };
        };
        if (e.value == null) continue;
        rows.push({
          country_code: e.countryiso3code ?? "",
          country_name: e.country?.value ?? "",
          indicator_id: e.indicator?.id ?? ind.id,
          indicator_name: ind.name,
          yr: Number(e.date ?? 0),
          value: e.value,
        });
      }
    }
    return json({ rows });
  }

  if (kind === "iss") {
    const tip = await fetch("https://api.wheretheiss.at/v1/satellites/25544", { headers });
    if (!tip.ok) return json({ error: `ISS ${tip.status}` }, 502);
    return new Response(await tip.text(), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (kind === "iss_trail") {
    // wheretheiss.at allows ≤10 timestamps per request — one orbit (~90m) of samples.
    const now = Math.floor(Date.now() / 1000);
    const stamps: number[] = [];
    for (let i = 9; i >= 0; i--) stamps.push(now - i * 600);
    const trailUrl =
      `https://api.wheretheiss.at/v1/satellites/25544/positions?timestamps=${stamps.join(",")}`;
    const r = await fetch(trailUrl, { headers });
    if (!r.ok) return json({ error: `ISS trail ${r.status}` }, 502);
    return new Response(await r.text(), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (kind === "hn") {
    const r = await fetch("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50", {
      headers,
    });
    if (!r.ok) return json({ error: `HN ${r.status}` }, 502);
    return new Response(await r.text(), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (kind === "crypto") {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false",
      { headers },
    );
    if (!r.ok) return json({ error: `CoinGecko ${r.status}` }, 502);
    return new Response(await r.text(), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (kind === "aq") {
    const cities = [];
    for (const city of METEO_CITIES) {
      const url =
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.lat}&longitude=${city.lon}` +
        `&current=pm2_5,pm10,ozone,nitrogen_dioxide,european_aqi`;
      const r = await fetch(url, { headers });
      if (!r.ok) continue;
      const body = (await r.json()) as { current?: Record<string, unknown> };
      cities.push({
        name: city.name,
        lat: city.lat,
        lon: city.lon,
        current: body.current ?? {},
      });
    }
    return json({ cities });
  }

  if (kind === "fx") {
    const r = await fetch("https://api.frankfurter.app/latest", { headers });
    if (!r.ok) return json({ error: `Frankfurter ${r.status}` }, 502);
    return new Response(await r.text(), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (kind === "fema") {
    const r = await fetch(
      "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=200&$orderby=declarationDate%20desc",
      { headers },
    );
    if (!r.ok) return json({ error: `FEMA ${r.status}` }, 502);
    return new Response(await r.text(), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (kind === "opensky") {
    const r = await fetch(
      "https://opensky-network.org/api/states/all?lamin=24.5&lomin=-125.0&lamax=49.5&lomax=-66.5",
      { headers },
    );
    if (!r.ok) return json({ error: `OpenSky ${r.status}` }, 502);
    return new Response(await r.text(), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (kind === "countries") {
    const r = await fetch(
      "https://restcountries.com/v3.1/all?fields=name,cca3,region,subregion,population,area,capital,independent",
      { headers },
    );
    if (!r.ok) return json({ error: `REST Countries ${r.status}` }, 502);
    return new Response(await r.text(), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (kind === "spacex") {
    const r = await fetch("https://api.spacexdata.com/v5/launches/past", { headers });
    if (!r.ok) return json({ error: `SpaceX ${r.status}` }, 502);
    return new Response(await r.text(), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (kind === "nyc311") {
    const r = await fetch(
      "https://data.cityofnewyork.us/resource/erm2-nwe9.json?$limit=400&$order=created_date%20DESC",
      { headers },
    );
    if (!r.ok) return json({ error: `NYC 311 ${r.status}` }, 502);
    return new Response(await r.text(), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (kind === "covid") {
    const r = await fetch("https://disease.sh/v3/covid-19/countries", { headers });
    if (!r.ok) return json({ error: `disease.sh ${r.status}` }, 502);
    return new Response(await r.text(), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (kind === "launches") {
    const r = await fetch("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=40&mode=list", {
      headers,
    });
    if (!r.ok) return json({ error: `Space Devs ${r.status}` }, 502);
    return new Response(await r.text(), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  return json({ error: "Unknown source" }, 404);
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
  const html = payload.html?.trim() ?? "";
  if (!html || html.length > MAX_STORY_HTML_BYTES) {
    return json({ error: "HTML missing or too large (4MB max)" }, 400);
  }
  if (!html.includes("<html") && !html.includes("<HTML")) {
    return json({ error: "Expected an HTML document" }, 400);
  }

  const id = storyId();
  const cache = caches.default;
  const cacheUrl = new URL(`https://loom-story.internal/s/${id}`);
  const res = new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": `public, max-age=${STORY_TTL_SECONDS}`,
      "X-Loom-Story-Title": (payload.title || "Loom story").slice(0, 120),
    },
  });
  await cache.put(cacheUrl.toString(), res.clone());

  const origin = new URL(request.url).origin;
  return json({ id, url: `${origin}/s/${id}` });
}

async function handleGetStory(id: string): Promise<Response> {
  if (!/^[a-z0-9]{8,16}$/i.test(id)) {
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
  async fetch(request: Request, env: Env): Promise<Response> {
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
        return await handleSource(kind);
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
