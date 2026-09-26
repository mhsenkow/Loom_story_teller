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
    const r = await fetch("https://api.wheretheiss.at/v1/satellites/25544", { headers });
    if (!r.ok) return json({ error: `ISS ${r.status}` }, 502);
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: msg }, 502);
    }

    return env.ASSETS.fetch(request);
  },
};
