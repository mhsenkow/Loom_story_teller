// =================================================================
// Loom — Cloudflare Worker (static UI + open-data API)
// =================================================================
// Serves Next static export via ASSETS; `/api/catalog/*`, `/api/fetch-csv`,
// `/api/source/*` (live poll feeds), and `/api/feedback` (GitHub issues).
// =================================================================

import {
  CLOUD_MAX_MONITORS,
  BUNDLE_TTL_SECS,
  deviceKey,
  mergeUpload,
  runMonitorCron,
  sanitizeCloudMonitors,
  validateWebhook,
  webhookRequest,
  makeNotifier,
  bundleExpiry,
  bundleListMeta,
  validatePushSubscription,
  vapidFromEnv,
  type CloudBundle,
} from "./monitorCron";
import { isPublicId, publicFeedXml, publicMomentSvg, publicPageHtml } from "./monitorPublic";
import type { CheckRecord } from "../src/lib/monitoring/types";
import { parseSourceRows } from "../src/lib/sourceParsers";
import {
  fetchUkCatalogUpstream,
  fetchUsCatalogUpstream,
  type DataGovSortKey,
  type FetchDataGovOptions,
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
  firmsViirsCsv,
  ndbcLatestObs,
  nwisIvWide,
  openMeteoCities,
  paprikaToGecko,
  coinloreToGecko,
  starlinkGp,
  steamTop,
  treasuryDebt,
  trimNwsAlerts,
  utcDay,
  londonDay,
  pageviewsPrimaryDaysAgo,
  worldBankWide,
  ACS_STATE_VARS,
  USAFACTS_GATEWAY,
  USAFACTS_NATION_SERIES,
  USAFACTS_NATION_START,
  acsStateYears,
  acsStatesWide,
  fredGraphNationMonthly,
  fredNationMonthly,
  usafactsPayload,
  usafactsToolCall,
} from "./sourceTransforms";
import {
  ARXIV_PER_QUERY,
  ARXIV_QUERIES,
  FDA_CATEGORIES,
  WS_MAX_MESSAGES,
  WS_SAMPLE_MS,
  arxivRows,
  bgpRows,
  bikeshareRows,
  blueskyRows,
  bookRows,
  chicagoCrimeRows,
  faaRows,
  fdaRows,
  fedSpendingRows,
  fireballRows,
  githubEventRows,
  iodaRows,
  IODA_MAX_ROWS,
  iodaWindow,
  lobbyingRows,
  nycInspectionRows,
  nycParkingRows,
  metRows,
  nobelRows,
  openfoodRows,
  pokemonRows,
  powerballRows,
  radioRows,
  satelliteRows,
  triviaRows,
  vehicleRecallRows,
} from "./extraSources";
import { assertHttpUrlAllowed, fetchWithSsrfGuard } from "../src/lib/ssrfGuard";
import { applyBaselineSecurityHeaders, baselineSecurityHeaderRecord } from "../src/lib/securityHeaders";
import { noteSourceOutcome, readSourceHealth } from "./sourceHealth";
import {
  AIRCRAFT_FETCH_BUDGET_MS,
  CATALOG_SEARCH_DEADLINE_MS,
  CATALOG_SEARCH_TTL_SECS,
  catalogSearchCacheKey,
  clampWorkerCatalogRows,
  FETCH_CSV_CACHE_TTL_SECS,
  fetchCsvCacheKey,
  rowCountFromPayload,
  sourceCacheKey,
  sourcePayloadCacheable,
  utf8ByteLength,
  validateOgImageBytes,
  worldBankDateRange,
} from "../src/lib/workerCatalogPolicy";
import {
  allowedOriginHostsFromEnv,
  DEFAULT_ALLOWED_ORIGIN_HOSTS,
  originAllowed,
} from "./allowedOrigins";

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Fine-grained PAT with `issues: write` on mhsenkow/Loom_story_teller */
  GITHUB_TOKEN?: string;
  /** Global story HTML / .img / .data — Cache API is colo-local and breaks NeoSpace handoff */
  LOOM_STORIES?: KVNamespace;
  /**
   * Optional bearer token for non-browser story publish/delete (native shells,
   * ops takedown). Browser callers must send an approved Origin instead.
   */
  STORY_ADMIN_TOKEN?: string;
  /** Comma-separated hostnames; defaults to loom.ibm.io + localhost + workers.dev. */
  ALLOWED_ORIGIN_HOSTS?: string;
  /**
   * Absolute origin for public story / OG URLs (default https://loom.ibm.io).
   * Keeps Cap / workers.dev publishes off personal *.workers.dev hostnames.
   */
  PUBLIC_WEB_ORIGIN?: string;
  /** Web Push (always-on monitors): base64url P-256 public key, private JWK JSON, contact. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_JWK?: string;
  VAPID_SUBJECT?: string;
}

/** Product host for share links — never mint mhsenkow.workers.dev URLs for recipients. */
// Not exported: Workers treat every named export of the entry module as an
// entrypoint, and a string export makes workerd refuse to boot.
const DEFAULT_PUBLIC_WEB_ORIGIN = "https://loom.ibm.io";

export function publicWebOrigin(env?: Env): string {
  const raw = env?.PUBLIC_WEB_ORIGIN?.trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_PUBLIC_WEB_ORIGIN;
}

const GITHUB_REPO = "mhsenkow/Loom_story_teller";
const MAX_CSV_BYTES = 32 * 1024 * 1024;
const UA =
  "Loom-Data-Storyteller/1.0 (https://loom.ibm.io; github.com/mhsenkow/Loom_story_teller)";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
};

/** Sandbox published HTML so scripts cannot read loom.ibm.io storage. */
const STORY_HTML_CSP =
  "sandbox allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation; default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Browser cache short; edge can hold a bit longer and purge on DELETE. */
const STORY_BROWSER_MAX_AGE = 300;
const STORY_EDGE_S_MAXAGE = 3600;

function bearerToken(request: Request): string | null {
  const h = request.headers.get("Authorization");
  if (!h?.startsWith("Bearer ")) return null;
  const t = h.slice(7).trim();
  return t || null;
}

export function storyMutationAuthorized(request: Request, env: Env): boolean {
  const token = bearerToken(request);
  if (token && env.STORY_ADMIN_TOKEN && token === env.STORY_ADMIN_TOKEN) {
    return true;
  }
  const requestOrigin = request.headers.get("Origin");
  return originAllowed(requestOrigin, allowedOriginHostsFromEnv(env));
}

function json(data: unknown, status = 200): Response {
  const headers = new Headers({ "Content-Type": "application/json", ...CORS });
  applyBaselineSecurityHeaders(headers);
  return new Response(JSON.stringify(data), { status, headers });
}

const MAX_STORY_POST_BYTES = 6 * 1024 * 1024;
const MAX_FEEDBACK_POST_BYTES = 512 * 1024;

function shortRequestId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

async function readRequestBodyUpTo(request: Request, maxBytes: number): Promise<ArrayBuffer | "too-large"> {
  const cl = request.headers.get("Content-Length");
  if (cl) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > maxBytes) return "too-large";
  }
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return "too-large";
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out.buffer;
}

async function parseJsonBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  const body = await readRequestBodyUpTo(request, maxBytes);
  if (body === "too-large") {
    return { ok: false, response: json({ error: "Request body too large" }, 413) };
  }
  if (body.byteLength === 0) {
    return { ok: false, response: json({ error: "Invalid JSON" }, 400) };
  }
  try {
    return { ok: true, data: JSON.parse(new TextDecoder().decode(body)) };
  } catch {
    return { ok: false, response: json({ error: "Invalid JSON" }, 400) };
  }
}

/** GitHub issue body: inline code so @mentions and [links] don't fire. */
function githubInlineField(s: string): string {
  const safe = s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/@/g, "@\u200b").replace(/\[/g, "\\[");
  return `\`${safe}\``;
}

/** In-isolate rate limit — dampens abuse across requests on this Worker. */
type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function allowRequest(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (rateBuckets.size > 800) {
    for (const [k, b] of rateBuckets) {
      if (now > b.resetAt) rateBuckets.delete(k);
    }
  }
  const b = rateBuckets.get(key);
  if (!b || now > b.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

/**
 * How many allows to fold into one KV write. Tight caps stay close to exact;
 * the busy monitor caps (60–300/hour) otherwise write once per request and
 * burn the free plan's 1,000 writes/day.
 */
function rateLimitFlushEvery(limit: number): number {
  return Math.max(1, Math.min(10, Math.floor(limit / 5)));
}

type RateBucketKv = { count: number; resetAt: number };
const rlMemo = new Map<string, RateBucketKv>();

/** KV-backed limiter (LOOM_STORIES) so story/feedback caps hold across colos. */
async function rateLimitAllow(
  env: Env,
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const composite = `${bucket}:${key}`;
  const kv = env.LOOM_STORIES;
  if (!kv) return allowRequest(composite, limit, windowMs);

  const rlKey = `rl:${composite}`;
  const now = Date.now();
  const every = rateLimitFlushEvery(limit);
  let b = rlMemo.get(rlKey);
  if (!b || now > b.resetAt) {
    const raw = (await kv.get(rlKey, "json")) as RateBucketKv | null;
    b = raw && now <= raw.resetAt ? { count: raw.count, resetAt: raw.resetAt } : { count: 0, resetAt: now + windowMs };
  } else if (b.count + every >= limit) {
    // Near the cap, take the higher count another location may have flushed.
    const raw = (await kv.get(rlKey, "json")) as RateBucketKv | null;
    if (raw && now <= raw.resetAt && raw.count > b.count) b = { count: raw.count, resetAt: raw.resetAt };
  }
  if (b.count >= limit) {
    rlMemo.set(rlKey, b);
    return false;
  }
  b = { count: b.count + 1, resetAt: b.resetAt };
  rlMemo.set(rlKey, b);
  if (rlMemo.size > 800) {
    for (const [k, bucket] of rlMemo) {
      if (now > bucket.resetAt) rlMemo.delete(k);
    }
  }
  if (b.count === 1 || b.count >= limit || b.count % every === 0) {
    await kv.put(rlKey, JSON.stringify(b), {
      expirationTtl: Math.max(120, Math.ceil((b.resetAt - now) / 1000) + 120),
    });
  }
  return true;
}

/** CORS reflecting an approved Origin (never `*`) for sensitive proxy routes. */
function corsHeadersFor(request: Request, env?: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  const hosts = env ? allowedOriginHostsFromEnv(env) : DEFAULT_ALLOWED_ORIGIN_HOSTS;
  if (origin && originAllowed(origin, hosts)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
      Vary: "Origin",
    };
  }
  return {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
    Vary: "Origin",
  };
}

/**
 * Browser same-site / approved-Origin gate for `/api/fetch-csv`.
 * Allows same-origin GETs and approved Loom Origins (web + Capacitor/Tauri
 * webviews). Capacitor iPad hits the Worker as Sec-Fetch-Site: cross-site from
 * https://localhost — Origin allowlist must win over that, or Explore 403s.
 * Still blocks anonymous curl and unknown cross-site Origins.
 */
export function fetchCsvAuthorized(request: Request, env?: Env): boolean {
  const site = (request.headers.get("Sec-Fetch-Site") || "").toLowerCase();
  const origin = request.headers.get("Origin");
  const hosts = env ? allowedOriginHostsFromEnv(env) : DEFAULT_ALLOWED_ORIGIN_HOSTS;
  if (origin && originAllowed(origin, hosts)) return true;
  if (site === "same-origin" || site === "same-site") return true;
  // Unknown / missing Origin: never allow cross-site or headerless clients.
  if (site === "cross-site") return false;
  if (!site) return false;
  // Sec-Fetch-Site: none without an allowed Origin
  return false;
}

function jsonFor(request: Request, data: unknown, status = 200): Response {
  const headers = new Headers({ "Content-Type": "application/json", ...corsHeadersFor(request) });
  applyBaselineSecurityHeaders(headers);
  return new Response(JSON.stringify(data), { status, headers });
}

function optsFromUrl(url: URL): FetchDataGovOptions {
  const rows = clampWorkerCatalogRows(url.searchParams.get("rows") ?? "40");
  const q = url.searchParams.get("q") || undefined;
  const sort = (url.searchParams.get("sort") as DataGovSortKey | null) || undefined;
  const csvOnly =
    url.searchParams.get("csvOnly") === "1" || url.searchParams.get("csvOnly") === "true";
  return { rows, query: q, sort: sort || undefined, csvOnly };
}

interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

export async function handleFetchCsv(
  request: Request,
  requestUrl: URL,
  ctx: WaitUntil,
  env?: Env,
): Promise<Response> {
  if (!fetchCsvAuthorized(request, env)) {
    return jsonFor(request, { error: "Forbidden origin" }, 403);
  }
  const ip = clientIp(request);
  if (!allowRequest(`fetch-csv:${ip}`, 60, 60_000)) {
    return jsonFor(request, { error: "Too many fetches — try again later" }, 429);
  }

  const target = requestUrl.searchParams.get("url");
  if (!target) return jsonFor(request, { error: "Missing url" }, 400);
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return jsonFor(request, { error: "Invalid url" }, 400);
  }
  try {
    assertHttpUrlAllowed(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Host not allowed";
    return jsonFor(request, { error: msg }, 400);
  }

  const cache = caches.default;
  const cacheReq = new Request(fetchCsvCacheKey(parsed.toString()));
  const cached = await cache.match(cacheReq).catch(() => undefined);
  if (cached) {
    const outHeaders = new Headers(cached.headers);
    outHeaders.set("X-Loom-Cache", "HIT");
    for (const [k, v] of Object.entries(corsHeadersFor(request))) outHeaders.set(k, v);
    applyBaselineSecurityHeaders(outHeaders);
    return new Response(cached.body, { status: cached.status, headers: outHeaders });
  }

  const headers = {
    "User-Agent": UA,
    Accept: "text/csv,text/plain,*/*",
  };

  const upstream = await fetchWithSsrfGuard(parsed.toString(), {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!upstream.ok && upstream.status !== 206) {
    return jsonFor(request, { error: `Upstream ${upstream.status}` }, 502);
  }

  const reader = upstream.body?.getReader();
  if (!reader) return jsonFor(request, { error: "Empty response" }, 502);

  const chunks: Uint8Array[] = [];
  let total = 0;
  let byte0 = -1;
  let byte1 = -1;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (byte0 < 0 && value.length > 0) byte0 = value[0]!;
    if (byte1 < 0 && value.length > 1) byte1 = value[1]!;
    else if (byte1 < 0 && value.length === 1 && byte0 >= 0) byte1 = 0;
    const remaining = MAX_CSV_BYTES - total;
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

  if (total >= 2 && byte0 === 0x50 && byte1 === 0x4b) {
    return jsonFor(
      request,
      {
        error:
          "This download is an Excel workbook (xlsx), not CSV. Pick a CSV resource from the portal.",
      },
      415,
    );
  }

  const truncated = total >= MAX_CSV_BYTES;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }

  const outHeaders = new Headers({
    "Content-Type": "text/csv; charset=utf-8",
    "X-Loom-Cache": "MISS",
    ...(truncated ? { "X-Loom-Truncated": "1" } : {}),
    ...corsHeadersFor(request),
    ...baselineSecurityHeaderRecord(),
  });
  applyBaselineSecurityHeaders(outHeaders);

  if (!truncated && total > 0) {
    ctx.waitUntil(
      cache
        .put(
          cacheReq,
          new Response(out.slice(), {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Cache-Control": `public, max-age=${FETCH_CSV_CACHE_TTL_SECS}`,
            },
          }),
        )
        .catch(() => {}),
    );
  }

  return new Response(out, { status: 200, headers: outHeaders });
}

// ---- Live poll sources (`/api/source/<kind>`) ----
//
// Every kind is one fetcher that returns JSON text in the shape the browser
// parser in src/lib/webStreams.ts reads. `handleSource` wraps it in
// caches.default (per-kind TTL + a stale window served when the upstream
// fails) and every upstream call has a timeout so one hung API can't stall
// the request. Note: the Cache API is a no-op on *.workers.dev — caching
// only takes effect on the custom domain (loom.ibm.io) and in wrangler dev.

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

const MEMPOOL_HOSTS = ["mempool.space", "mempool.emzy.de", "mempool.ninja"] as const;

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
  if (hit) {
    try {
      return (await hit.json()) as T;
    } catch {
      // A bad body slipped into the cache — drop it and refetch.
      ctx.waitUntil(cache.delete(key).catch(() => {}));
    }
  }
  const text = await upstreamText(label, url, timeoutMs);
  // Parse before caching so an error page never sticks for ttlSecs.
  const data = JSON.parse(text) as T;
  ctx.waitUntil(
    cache
      .put(key, new Response(text, {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttlSecs}` },
      }))
      .catch(() => {}),
  );
  return data;
}

/** One USAFacts Data gateway tool call (keyless JSON-RPC POST) → the agency payload. */
async function usafactsCall(sourceId: string, tool: string, args: Record<string, unknown>, timeoutMs = 20_000): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(USAFACTS_GATEWAY, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: usafactsToolCall(sourceId, tool, args),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    throw new UpstreamError(
      name === "TimeoutError" || name === "AbortError"
        ? `USAFacts timed out after ${Math.round(timeoutMs / 1000)}s`
        : `USAFacts unreachable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    throw new UpstreamError(`USAFacts ${res.status}`);
  }
  try {
    return usafactsPayload(await res.text());
  } catch (e) {
    throw new UpstreamError(e instanceof Error ? e.message : String(e));
  }
}

/** Run async jobs with at most `limit` in flight (polite fan-out to one upstream). */
async function settleLimited<T>(jobs: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const out: PromiseSettledResult<T>[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await jobs[i]!() };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return out;
}

type SourceFetcher = (ctx: WaitUntil) => Promise<string>;

/** Lyft GBFS systems in the `bikeshare` feed — mirrors BIKESHARE_SYSTEMS in sources.rs. */
const BIKESHARE_SYSTEMS = [
  { system: "Divvy (Chicago)", base: "https://gbfs.divvybikes.com/gbfs/en/" },
  { system: "Capital Bikeshare (DC)", base: "https://gbfs.capitalbikeshare.com/gbfs/en/" },
  { system: "Bay Wheels (SF)", base: "https://gbfs.lyftbikes.com/gbfs/en/" },
] as const;

/**
 * Open an outbound WebSocket (fetch + `Upgrade: websocket`), collect text
 * frames for `WS_SAMPLE_MS`, then close. Used by bluesky / bgp, which only
 * keep per-window counts (see workers/extraSources.ts).
 */
async function sampleWebSocket(
  label: string,
  wssUrl: string,
  subscribe?: string,
): Promise<{ messages: string[]; secs: number }> {
  let res: Response;
  try {
    res = await fetch(wssUrl.replace(/^wss:/, "https:"), {
      headers: { Upgrade: "websocket", "User-Agent": UA },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (e) {
    throw new UpstreamError(`${label} unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  const ws = (res as Response & { webSocket?: WebSocket | null }).webSocket;
  if (!ws) throw new UpstreamError(`${label}: WebSocket upgrade refused (${res.status})`);
  (ws as WebSocket & { accept: () => void }).accept();
  const messages: string[] = [];
  const started = Date.now();
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, WS_SAMPLE_MS);
    ws.addEventListener("message", (ev: MessageEvent) => {
      if (typeof ev.data === "string") messages.push(ev.data);
      if (messages.length >= WS_MAX_MESSAGES) done();
    });
    ws.addEventListener("close", done);
    ws.addEventListener("error", done);
    if (subscribe) ws.send(subscribe);
  });
  try {
    ws.close(1000, "sample done");
  } catch {
    /* already closed */
  }
  const secs = Math.max(1, (Date.now() - started) / 1000);
  if (!messages.length) throw new UpstreamError(`${label}: no messages in sample window`);
  return { messages, secs };
}

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

export const SOURCE_FETCHERS: Record<string, SourceFetcher> = {
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
      `&current=pm2_5,pm10,ozone,nitrogen_dioxide,european_aqi&timezone=GMT`;
    return JSON.stringify(openMeteoCities(await upstreamJson("Open-Meteo AQ", url), "current"));
  },

  ukcarbon: async () => {
    const [yesterday, today] = await Promise.all([
      upstreamJson("Carbon Intensity", `https://api.carbonintensity.org.uk/intensity/date/${londonDay(1)}`),
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
    const budgetStart = Date.now();
    const overBudget = () => Date.now() - budgetStart >= AIRCRAFT_FETCH_BUDGET_MS;
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
    if (overBudget()) throw new UpstreamError("Aircraft fetch budget exceeded");
    const providers = [
      { name: "ADSB.lol", url: (p: { lat: number; lon: number }) => `https://api.adsb.lol/v2/point/${p.lat}/${p.lon}/250` },
      { name: "adsb.fi", url: (p: { lat: number; lon: number }) => `https://opendata.adsb.fi/api/v2/lat/${p.lat}/lon/${p.lon}/dist/250` },
    ];
    const start = Math.floor(Date.now() / 60_000) % ADSB_POINTS.length;
    const errors: string[] = [];
    for (const prov of providers) {
      const ok: unknown[] = [];
      for (let i = 0; i < ADSB_POINTS.length; i++) {
        if (overBudget()) break;
        const p = ADSB_POINTS[(start + i) % ADSB_POINTS.length]!;
        try {
          const body = await upstreamJson<{ ac?: unknown[]; aircraft?: unknown[] }>(prov.name, prov.url(p), 8_000);
          ok.push({ ...body, ac: body.ac ?? body.aircraft ?? [] });
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
          break;
        }
        if (i < ADSB_POINTS.length - 1) {
          const wait = Math.min(1_200, AIRCRAFT_FETCH_BUDGET_MS - (Date.now() - budgetStart));
          if (wait <= 0) break;
          await new Promise((r) => setTimeout(r, wait));
        }
      }
      if (ok.length > 0) return JSON.stringify(adsbToOpensky(ok));
      if (overBudget()) break;
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

  lobsters: () => upstreamText("Lobsters", "https://lobste.rs/hottest.json"),

  pageviews: async () => {
    // Top pageviews for day D usually land mid-day UTC on D+1 — try a short ladder.
    const url = (d: string) =>
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${d.replace(/-/g, "/")}`;
    let lastErr: unknown;
    for (const ago of pageviewsPrimaryDaysAgo()) {
      try {
        return await upstreamText("Wikimedia", url(utcDay(ago)));
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "Pageviews unavailable"));
  },

  crypto: async () => {
    // CoinGecko 429s Cloudflare's shared IPs and CoinPaprika answers them 402 — both
    // stay first in case they recover; CoinLore serves CF egress. All map to Gecko shape.
    try {
      return await upstreamText(
        "CoinGecko",
        "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false",
        6_000,
      );
    } catch {
      try {
        const body = await upstreamJson("CoinPaprika", "https://api.coinpaprika.com/v1/tickers?limit=50", 6_000);
        return JSON.stringify(paprikaToGecko(body));
      } catch {
        const body = await upstreamJson("CoinLore", "https://api.coinlore.net/api/tickers/?start=0&limit=50");
        return JSON.stringify(coinloreToGecko(body));
      }
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
    const [listR, popR] = await Promise.allSettled([
      upstreamJson("mledoze/countries", "https://raw.githubusercontent.com/mledoze/countries/master/countries.json", 15_000),
      upstreamJson(
        "World Bank",
        "https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=400&mrnev=1",
      ),
    ]);
    const list = listR.status === "fulfilled" ? listR.value : [];
    const pop = popR.status === "fulfilled" ? popR.value : [];
    return JSON.stringify(mergeCountries(list, pop));
  },

  world_bank: async (ctx) => {
    const wbRange = worldBankDateRange();
    const settled = await Promise.allSettled([
      cachedUpstreamJson("World Bank", "https://api.worldbank.org/v2/country?format=json&per_page=400", 86_400, ctx),
      ...WB_WIDE_INDICATORS.map((ind) =>
        upstreamJson(
          "World Bank",
          `https://api.worldbank.org/v2/country/all/indicator/${ind.id}?format=json&per_page=10000&date=${wbRange}`,
          15_000,
        ),
      ),
    ]);
    const countryList = settled[0]?.status === "fulfilled" ? settled[0].value : [];
    const bodies = settled.slice(1).map((r) => (r.status === "fulfilled" ? r.value : []));
    return JSON.stringify(worldBankWide(countryList, bodies));
  },

  // USAFacts Data gateway (data.mcp.usafacts.org, keyless beta) — see usafactsCall above.
  usafacts_states: async () => {
    // One ACS 1-year call per vintage (2012 → last year); an unreleased year just fails.
    // No keyless fallback: api.census.gov now requires a key, so the stale cache covers outages.
    const years = acsStateYears();
    const settled = await settleLimited(
      years.map((year) => async () => ({
        year,
        table: await usafactsCall("census_acs", "getAcs1", { year: String(year), get: ACS_STATE_VARS.join(","), for: "state:*" }),
      })),
      4,
    );
    const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!ok.length) throw new UpstreamError("USAFacts: no ACS vintages returned");
    return JSON.stringify(acsStatesWide(ok));
  },

  usafacts_nation: async () => {
    const settled = await settleLimited(
      USAFACTS_NATION_SERIES.map((s) => () =>
        usafactsCall("fred", "getSeriesObservations", {
          series_id: s.id,
          observation_start: USAFACTS_NATION_START,
          ...("units" in s ? { units: s.units } : {}),
          ...("frequency" in s ? { frequency: s.frequency } : {}),
        }),
      ),
      3,
    );
    const payloads = settled.map((r) => (r.status === "fulfilled" ? r.value : null));
    if (payloads.every((p) => p != null)) return JSON.stringify(fredNationMonthly(payloads));
    // Any series missing → FRED's keyless CSV export for all of them (gas is weekly, so its own call).
    try {
      const [monthly, gas] = await Promise.all([
        upstreamText("FRED", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE,CPIAUCSL,PAYEMS,FEDFUNDS,HOUST", 20_000),
        upstreamText("FRED", `https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASREGW&cosd=${USAFACTS_NATION_START}&fq=Monthly&fam=avg`, 20_000),
      ]);
      return JSON.stringify(fredGraphNationMonthly(monthly, gas));
    } catch (e) {
      if (payloads.some((p) => p != null)) return JSON.stringify(fredNationMonthly(payloads));
      throw e;
    }
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
    // Newest 15 blocks, then 3 older pages (~60 blocks). Heights are consecutive, so the
    // older pages' start heights are known up front — fetch them in parallel so a cold
    // cache answers well inside the browser's wait. A failed page just means fewer blocks.
    // mempool.space sometimes stalls from Cloudflare egress — fall back to public mempool
    // instances running the same API (same block/fee/pool fields).
    let host = "";
    let first: unknown;
    let lastErr: unknown;
    for (const h of MEMPOOL_HOSTS) {
      try {
        first = await upstreamJson(h, `https://${h}/api/v1/blocks`, 8_000);
        host = h;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!host) throw lastErr instanceof Error ? lastErr : new Error("mempool: all hosts failed");
    const low = mempoolLowestHeight(first);
    const starts = low != null ? [1, 2, 3].map((k) => low - 1 - 15 * (k - 1)).filter((h) => h > 0) : [];
    const older = await Promise.allSettled(
      starts.map((h) => upstreamJson(host, `https://${host}/api/v1/blocks/${h}`, 8_000)),
    );
    const pages: unknown[] = [first, ...older.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))];
    return JSON.stringify(mempoolBlocks(pages));
  },

  debt: async () => {
    // ≈ 8.4k business days since 1993 in one page (~2.8 MB upstream, ~0.4 MB out).
    const body = await upstreamJson(
      "US Treasury",
      "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny" +
        "?fields=record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt" +
        "&sort=-record_date&page%5Bsize%5D=10000",
      20_000,
    );
    return JSON.stringify(treasuryDebt(body));
  },

  firms: async () => {
    // Keyless USA contiguous + Hawaii 24h VIIRS CSV (~100 KB). Global 24h is multi-MB — skip.
    const text = await upstreamText(
      "NASA FIRMS",
      "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv",
      20_000,
    );
    return JSON.stringify(firmsViirsCsv(text));
  },

  nwis: async () => {
    const sites = "01646500,05420500,06934500,07374000,09380000,11427100,14211720,05587455";
    const url =
      `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${sites}` +
      `&parameterCd=00060,00065&period=P2D`;
    const body = await upstreamJson("USGS NWIS", url, 20_000);
    return JSON.stringify(nwisIvWide(body));
  },

  starlink: async () => {
    // CelesTrak updates ~every 2h; shorter polls return HTTP 403 text — cache hard.
    const text = await upstreamText(
      "CelesTrak",
      "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json",
      30_000,
    );
    if (text.trimStart().startsWith("GP data has not updated") || text.trimStart().startsWith("<")) {
      throw new UpstreamError("CelesTrak: GP not updated yet (try again after the 2h refresh)");
    }
    return JSON.stringify(starlinkGp(JSON.parse(text)));
  },

  // ---- 2026-10 keyless batch (transforms in workers/extraSources.ts) ----

  fireballs: async () =>
    JSON.stringify(fireballRows(await upstreamJson("NASA JPL", "https://ssd-api.jpl.nasa.gov/fireball.api", 15_000))),

  satellites: async () => {
    // Same CelesTrak etiquette as starlink: 2h refresh, 403 text when polled early.
    const text = await upstreamText("CelesTrak", "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json", 20_000);
    if (text.trimStart().startsWith("GP data has not updated") || text.trimStart().startsWith("<")) {
      throw new UpstreamError("CelesTrak: GP not updated yet (try again after the 2h refresh)");
    }
    return JSON.stringify(satelliteRows(JSON.parse(text)));
  },

  internet_outages: async () => {
    const { from, until } = iodaWindow(Date.now());
    const body = await upstreamJson(
      "IODA",
      `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts?from=${from}&until=${until}&entityType=country&limit=${IODA_MAX_ROWS}`,
      20_000,
    );
    return JSON.stringify(iodaRows(body));
  },

  faa_delays: async () =>
    JSON.stringify(faaRows(await upstreamText("FAA NAS Status", "https://nasstatus.faa.gov/api/airport-status-information", 15_000))),

  lobbying: async () => {
    // lda.senate.gov now redirects here. Anonymous pages cap at 25 rows → newest 4 pages.
    // Paging needs a filter: filing_year of 30 days ago (January still posts last year's Q4).
    const settled = await Promise.allSettled(
      [1, 2, 3, 4].map((p) =>
        upstreamJson<{ results?: unknown[] }>("LDA", `https://lda.gov/api/v1/filings/?ordering=-dt_posted&filing_year=${utcDay(30).slice(0, 4)}&page_size=25&page=${p}`, 20_000),
      ),
    );
    const results = settled.flatMap((r) => (r.status === "fulfilled" ? (r.value.results ?? []) : []));
    if (!results.length) throw new UpstreamError("LDA: no filings returned");
    return JSON.stringify(lobbyingRows({ results }));
  },

  fda_recalls: async () => {
    const settled = await Promise.allSettled(
      FDA_CATEGORIES.map((c) =>
        upstreamJson("openFDA", `https://api.fda.gov/${c}/enforcement.json?limit=100&sort=report_date:desc`, 15_000),
      ),
    );
    const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!ok.length) throw new UpstreamError("openFDA: no enforcement feeds returned");
    return JSON.stringify(fdaRows(ok));
  },

  vehicle_recalls: async () =>
    JSON.stringify(
      vehicleRecallRows(
        await upstreamJson(
          "NHTSA",
          "https://data.transportation.gov/resource/6axg-epim.json?$limit=400&$order=report_received_date%20DESC",
          15_000,
        ),
      ),
    ),

  arxiv: async () => {
    // arXiv asks for one request at a time with a short pause between them.
    const feeds: string[] = [];
    for (const q of ARXIV_QUERIES) {
      try {
        feeds.push(
          await upstreamText(
            "arXiv",
            `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&sortBy=submittedDate&sortOrder=descending&max_results=${ARXIV_PER_QUERY}`,
            20_000,
          ),
        );
      } catch {
        /* one field missing is fine */
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
    if (!feeds.length) throw new UpstreamError("arXiv: no feeds returned");
    return JSON.stringify(arxivRows(feeds));
  },

  github_events: async () =>
    // Unauthenticated limit is 60/h per IP — the 10 min cache keeps us far under it.
    JSON.stringify(githubEventRows(await upstreamJson("GitHub", "https://api.github.com/events?per_page=100", 10_000))),

  books: async () => {
    const [ol, gut] = await Promise.allSettled([
      upstreamJson("Open Library", "https://openlibrary.org/trending/daily.json?limit=50", 20_000),
      upstreamJson("Gutendex", "https://gutendex.com/books/?sort=popular", 20_000),
    ]);
    if (ol.status === "rejected" && gut.status === "rejected") throw new UpstreamError("Books: both upstreams failed");
    return JSON.stringify(bookRows(ol.status === "fulfilled" ? ol.value : null, gut.status === "fulfilled" ? gut.value : null));
  },

  nyc_inspections: async () =>
    JSON.stringify(
      nycInspectionRows(
        await upstreamJson(
          "NYC DOHMH",
          "https://data.cityofnewyork.us/resource/43nn-pn8j.json?$limit=1000&$order=inspection_date%20DESC&$where=inspection_date%3E%272001-01-01%27",
          20_000,
        ),
      ),
    ),

  chicago_crime: async () =>
    JSON.stringify(
      chicagoCrimeRows(
        await upstreamJson("Chicago Data Portal", "https://data.cityofchicago.org/resource/ijzp-q8t2.json?$limit=1000&$order=date%20DESC", 20_000),
      ),
    ),

  nyc_parking: async () =>
    // $select leaves the plate column out entirely. issue_date is text upstream with
    // typos like "2097-12-11", so cap it at tomorrow.
    JSON.stringify(
      nycParkingRows(
        await upstreamJson(
          "NYC Finance",
          "https://data.cityofnewyork.us/resource/nc67-uf89.json?$limit=1000&$order=issue_date%20DESC" +
            "&$select=summons_number,issue_date,violation_time,violation,fine_amount,penalty_amount,amount_due,county,state,issuing_agency,precinct" +
            `&$where=issue_date%20between%20%272000-01-01%27%20and%20%27${utcDay(-1)}%27`,
          20_000,
        ),
      ),
    ),

  powerball: async () =>
    JSON.stringify(
      powerballRows(await upstreamJson("NY Lottery", "https://data.ny.gov/resource/d6yy-54nr.json?$limit=5000&$order=draw_date%20DESC", 15_000)),
    ),

  fed_spending: async () =>
    JSON.stringify(fedSpendingRows(await upstreamJson("USAspending", "https://api.usaspending.gov/api/v2/references/toptier_agencies/", 20_000))),

  bikeshare: async (ctx) => {
    const settled = await Promise.allSettled(
      BIKESHARE_SYSTEMS.map(async (s) => {
        const [info, status] = await Promise.all([
          cachedUpstreamJson("GBFS", `${s.base}station_information.json`, 86_400, ctx),
          upstreamJson("GBFS", `${s.base}station_status.json`),
        ]);
        return { system: s.system, info, status };
      }),
    );
    const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!ok.length) throw new UpstreamError("GBFS: no bike share systems returned");
    return JSON.stringify(bikeshareRows(ok));
  },

  bluesky: async () => {
    const msgs = await sampleWebSocket("Bluesky Jetstream", "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post");
    return JSON.stringify(blueskyRows(msgs.messages, msgs.secs, Date.now()));
  },

  bgp: async () => {
    const msgs = await sampleWebSocket(
      "RIPE RIS Live",
      "wss://ris-live.ripe.net/v1/ws/?client=loom",
      JSON.stringify({ type: "ris_subscribe", data: { host: "rrc00", type: "UPDATE" } }),
    );
    return JSON.stringify(bgpRows(msgs.messages, msgs.secs, Date.now()));
  },

  nobel: async () =>
    JSON.stringify(
      nobelRows(await upstreamJson("Nobel Prize", "https://api.nobelprize.org/2.1/laureates?limit=1500&format=json", 25_000)),
    ),

  trivia: async () => {
    // Open Trivia DB allows one request per 5 s per IP — parallel pages came back
    // 429 (cold fetches failed outright). Three spaced pages → up to 150 questions.
    const bodies: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      if (i) await new Promise((r) => setTimeout(r, 5_200));
      try {
        const body = await upstreamJson<{ response_code?: number }>("Open Trivia DB", "https://opentdb.com/api.php?amount=50", 15_000);
        if (body?.response_code === 0) bodies.push(body);
      } catch {
        /* keep the pages we have */
      }
    }
    if (!bodies.length) throw new UpstreamError("Open Trivia DB: no pages returned");
    return JSON.stringify(triviaRows(bodies));
  },

  pokemon: async () => {
    // One GraphQL request for all 151 — the REST path needs 152 calls and Workers
    // cap a request at 50 subrequests (production silently returned ~48 rows).
    const query =
      "{ pokemon_v2_pokemon(where:{id:{_lte:151}}, order_by:{id:asc}) { id name height weight " +
      "pokemon_v2_pokemontypes { slot pokemon_v2_type { name } } " +
      "pokemon_v2_pokemonstats { base_stat pokemon_v2_stat { name } } } }";
    let res: Response;
    try {
      res = await fetch("https://beta.pokeapi.co/graphql/v1beta", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new UpstreamError(`PokéAPI: ${(e as Error).message}`);
    }
    if (!res.ok) throw new UpstreamError(`PokéAPI ${res.status}`);
    type Gql = {
      data?: { pokemon_v2_pokemon?: {
        id: number; name: string; height: number; weight: number;
        pokemon_v2_pokemontypes?: { slot: number; pokemon_v2_type?: { name: string } }[];
        pokemon_v2_pokemonstats?: { base_stat: number; pokemon_v2_stat?: { name: string } }[];
      }[] };
    };
    const list = ((await res.json()) as Gql).data?.pokemon_v2_pokemon ?? [];
    // Reshape to the REST detail shape pokemonRows already parses.
    const details = list.map((p) => ({
      id: p.id,
      name: p.name,
      height: p.height,
      weight: p.weight,
      types: (p.pokemon_v2_pokemontypes ?? []).map((t) => ({ slot: t.slot, type: { name: t.pokemon_v2_type?.name } })),
      stats: (p.pokemon_v2_pokemonstats ?? []).map((st) => ({ base_stat: st.base_stat, stat: { name: st.pokemon_v2_stat?.name } })),
    }));
    if (!details.length) throw new UpstreamError("PokéAPI: no Pokémon returned");
    return JSON.stringify(pokemonRows(details));
  },

  met: async () => {
    // The Met retired /search (410 Gone for every query); department listings and
    // object lookups still work. Sample evenly across major departments, then lead
    // with the museum's own highlights.
    const MET = "https://collectionapi.metmuseum.org/public/collection/v1";
    // European paintings, modern, Asian, Egyptian, Greek & Roman, medieval.
    // The Met's bot shield 403s bursts, so keep the fan-out small and slow.
    // Workers cap a request at 50 subrequests: 3 listings + 39 objects, with headroom.
    const departments = [11, 6, 10];
    const lists = await settleLimited(
      departments.map((id) => () => upstreamJson<{ objectIDs?: number[] }>("Met Museum", `${MET}/objects?departmentIds=${id}`, 20_000)),
      1,
    );
    const ids: number[] = [];
    for (const r of lists) {
      if (r.status !== "fulfilled") continue;
      const all = Array.isArray(r.value.objectIDs) ? r.value.objectIDs : [];
      const take = 13;
      const step = Math.max(1, Math.floor(all.length / take));
      for (let i = 0; i < all.length && ids.length < departments.length * take; i += step) {
        if (i / step >= take) break;
        ids.push(all[i]!);
      }
    }
    if (!ids.length) throw new UpstreamError("Met Museum: no object IDs");
    const settled = await settleLimited(
      ids.map((id) => () => upstreamJson("Met Museum", `${MET}/objects/${id}`, 15_000)),
      4,
    );
    const details = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!details.length) throw new UpstreamError("Met Museum: no object details returned");
    const highlight = (d: unknown) => ((d as { isHighlight?: boolean })?.isHighlight ? 0 : 1);
    return JSON.stringify(metRows([...details].sort((a, b) => highlight(a) - highlight(b))));
  },

  openfood: async () => {
    const settled = await settleLimited(
      Array.from({ length: 10 }, (_, i) => () =>
        upstreamJson(
          "Open Food Facts",
          `https://world.openfoodfacts.org/cgi/search.pl?action=process&json=true&page_size=100&page=${i + 1}&sort_by=unique_scans_n&fields=code,product_name,product_name_en,brands,nutriscore_grade,countries_tags,categories_tags,nutriments`,
          20_000,
        ),
      ),
      3,
    );
    const bodies = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!bodies.length) throw new UpstreamError("Open Food Facts: no pages returned");
    return JSON.stringify(openfoodRows(bodies));
  },

  radio: async () =>
    JSON.stringify(
      radioRows(await upstreamJson("radio-browser", "https://de1.api.radio-browser.info/json/stations/topvote/500", 20_000)),
    ),
};

/** Fresh-for seconds per kind (roughly the upstream's own update cadence). */
export const SOURCE_TTL_SECS: Record<string, number> = {
  iss: 5,
  mbta: 30,
  opensky: 60,
  bitcoin: 60,
  usgs: 60,
  crypto: 60,
  citibike: 60,
  hn: 60,
  lobsters: 120,
  iss_trail: 60,
  nyc311: 300,
  nws: 300,
  nwis: 300,
  meteo: 600,
  aq: 600,
  eonet: 600,
  firms: 600,
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
  starlink: 7200,
  asteroids: 21_600,
  steam: 21_600,
  countries: 86_400,
  world_bank: 86_400,
  usafacts_states: 86_400,
  usafacts_nation: 43_200,
  climate: 86_400,
  debt: 86_400,
  fireballs: 21_600,
  satellites: 7200,
  internet_outages: 900,
  faa_delays: 300,
  lobbying: 3600,
  fda_recalls: 21_600,
  vehicle_recalls: 21_600,
  arxiv: 3600,
  github_events: 600,
  books: 21_600,
  nyc_inspections: 3600,
  chicago_crime: 3600,
  nyc_parking: 3600,
  powerball: 21_600,
  fed_spending: 21_600,
  bikeshare: 120,
  bluesky: 60,
  bgp: 60,
  nobel: 21_600,
  trivia: 21_600,
  pokemon: 86_400,
  met: 86_400,
  openfood: 21_600,
  radio: 86_400,
};

/** How long past its TTL a cached copy may still be served when the upstream fails. */
function staleSecs(ttl: number): number {
  return Math.min(2 * 86_400, Math.max(600, ttl * 4));
}

/** Upper bound on how long the edge keeps any source copy. */
const SOURCE_CACHE_HARD_SECS = 7 * 86_400;

/**
 * Oldest copy served as STALE while the upstream is failing, and so how long the edge keeps
 * a copy at all (X-Loom-Fetched-Ms stays the freshness clock). Scales with the feed's cadence
 * (24 polls, at least 3 h) instead of a flat week: clients treat any 200 as a live poll, so a
 * week-old ISS fix or per-minute count must not come back as current data.
 */
function sourceCacheMaxAge(ttl: number, stale: number): number {
  return Math.min(SOURCE_CACHE_HARD_SECS, Math.max(ttl + stale, 3 * 3600, ttl * 24));
}

function sourceResponse(
  body: BodyInit | null,
  cacheState: string,
  fetchedAt: number,
  request: Request,
  ttlSec: number,
  staleSec: number,
): Response {
  const ageMs = Math.max(0, Date.now() - fetchedAt);
  const remaining = Math.max(0, ttlSec - Math.floor(ageMs / 1000));
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Loom-Cache": cacheState,
    "X-Loom-Fetched-At": new Date(fetchedAt).toISOString(),
    "Cache-Control": `public, max-age=${remaining}, stale-while-revalidate=${staleSec}`,
    ...corsHeadersFor(request),
  });
  applyBaselineSecurityHeaders(headers);
  return new Response(body, { status: 200, headers });
}

function logSourceRequest(meta: Record<string, unknown>): void {
  console.log(JSON.stringify({ loom: "source", ...meta }));
}

async function refreshSourceCache(
  kind: string,
  fetcher: SourceFetcher,
  ctx: WaitUntil,
  cache: Cache,
  key: string,
  ttl: number,
  stale: number,
  kv?: KVNamespace,
): Promise<void> {
  const lockKey = `${key}:refresh`;
  const inflight = await cache.match(lockKey).catch(() => undefined);
  if (inflight) return;
  await cache.put(
    lockKey,
    new Response("1", { headers: { "Cache-Control": "max-age=60" } }),
  );
  const started = Date.now();
  try {
    const text = await fetcher(ctx);
    if (!sourcePayloadCacheable(kind, text)) {
      logSourceRequest({ kind, cache: "SKIP-EMPTY", ms: Date.now() - started });
      await noteSourceOutcome(kv, kind, { ok: false, error: "Upstream returned empty payload" });
      return;
    }
    const now = Date.now();
    await cache.put(
      key,
      new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${sourceCacheMaxAge(ttl, stale)}`,
          "X-Loom-Fetched-Ms": String(now),
        },
      }),
    );
    logSourceRequest({ kind, cache: "REFRESH", ms: Date.now() - started, status: 200 });
    await noteSourceOutcome(kv, kind, { ok: true, rows: payloadRows(text) });
  } catch (e) {
    logSourceRequest({
      kind,
      cache: "REFRESH-FAIL",
      ms: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    });
    await noteSourceOutcome(kv, kind, { ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    await cache.delete(lockKey).catch(() => {});
  }
}

function payloadRows(text: string): number | null {
  try {
    return rowCountFromPayload(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function handleSource(kind: string, request: Request, ctx: WaitUntil, kv?: KVNamespace): Promise<Response> {
  const fetcher = Object.prototype.hasOwnProperty.call(SOURCE_FETCHERS, kind) ? SOURCE_FETCHERS[kind] : undefined;
  if (!fetcher) return jsonFor(request, { error: "Unknown source" }, 404);

  const ttl = SOURCE_TTL_SECS[kind] ?? 60;
  const stale = staleSecs(ttl);
  const cache = caches.default;
  const key = sourceCacheKey(kind);
  const now = Date.now();
  const started = Date.now();

  const cached = await cache.match(key).catch(() => undefined);
  const cachedAt = cached ? Number(cached.headers.get("X-Loom-Fetched-Ms") || "0") : 0;
  const ageMs = cachedAt > 0 ? now - cachedAt : 0;
  const fallback = cached && ageMs <= sourceCacheMaxAge(ttl, stale) * 1000 ? cached : undefined;

  if (cached && ageMs <= ttl * 1000) {
    logSourceRequest({ kind, cache: "HIT", ms: Date.now() - started });
    return sourceResponse(cached.body, "HIT", cachedAt, request, ttl, stale);
  }

  if (cached && ageMs <= (ttl + stale) * 1000) {
    ctx.waitUntil(refreshSourceCache(kind, fetcher, ctx, cache, key, ttl, stale, kv));
    logSourceRequest({ kind, cache: "STALE-REVALIDATING", ms: Date.now() - started });
    return sourceResponse(cached.body, "STALE-REVALIDATING", cachedAt, request, ttl, stale);
  }

  // The browser gives up after ~12s, and a disconnect cancels work not under waitUntil —
  // so register the fetch, cache write and outcome before awaiting, letting slow feeds
  // (trivia, arxiv) finish and warm the cache even when this visitor has left.
  const job = Promise.resolve().then(() => fetcher(ctx)).then((text) => ({ text, ok: sourcePayloadCacheable(kind, text), fetchedAt: Date.now() }));
  ctx.waitUntil(
    job.then(
      async ({ text, ok, fetchedAt }) => {
        if (!ok) {
          await noteSourceOutcome(kv, kind, { ok: false, error: "Upstream returned empty payload" });
          return;
        }
        await Promise.all([
          cache
            .put(key, new Response(text, {
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": `public, max-age=${sourceCacheMaxAge(ttl, stale)}`,
                "X-Loom-Fetched-Ms": String(fetchedAt),
              },
            }))
            .catch(() => {}),
          noteSourceOutcome(kv, kind, { ok: true, rows: payloadRows(text) }),
        ]);
      },
      (e: unknown) => noteSourceOutcome(kv, kind, { ok: false, error: e instanceof Error ? e.message : String(e) }),
    ),
  );
  try {
    const { text, ok, fetchedAt } = await job;
    if (!ok) {
      // A recent-enough copy beats an error; X-Loom-Fetched-At tells the client its age.
      if (fallback) {
        logSourceRequest({ kind, cache: "STALE", ms: Date.now() - started, fallback: true });
        return sourceResponse(fallback.body, "STALE", cachedAt, request, ttl, stale);
      }
      throw new UpstreamError("Upstream returned empty payload");
    }
    cached?.body?.cancel().catch(() => {});
    logSourceRequest({ kind, cache: "MISS", ms: Date.now() - started, status: 200 });
    return sourceResponse(text, "MISS", fetchedAt, request, ttl, stale);
  } catch (e) {
    // Outcome (ok or failed) is recorded by the waitUntil job above.
    if (fallback) {
      logSourceRequest({
        kind,
        cache: "STALE",
        ms: Date.now() - started,
        error: e instanceof Error ? e.message : String(e),
      });
      return sourceResponse(fallback.body, "STALE", cachedAt, request, ttl, stale);
    }
    cached?.body?.cancel().catch(() => {});
    logSourceRequest({
      kind,
      cache: "ERROR",
      ms: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    });
    return jsonFor(request, { error: "Upstream fetch failed" }, 502);
  }
}

async function handleCatalogSearch(
  portal: "us" | "uk",
  url: URL,
  ctx: WaitUntil,
): Promise<Response> {
  const cache = caches.default;
  const key = catalogSearchCacheKey(portal, url);
  const cacheReq = new Request(key);
  const hit = await cache.match(cacheReq).catch(() => undefined);
  if (hit) {
    const headers = new Headers(hit.headers);
    // Cached entries carry no CORS; native shells (tauri/capacitor localhost) need it on every hit.
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    headers.set("X-Loom-Cache", "HIT");
    applyBaselineSecurityHeaders(headers);
    return new Response(hit.body, { status: hit.status, headers });
  }

  const opts: FetchDataGovOptions = {
    ...optsFromUrl(url),
    deadlineMs: CATALOG_SEARCH_DEADLINE_MS,
    requestTimeoutMs: 12_000,
  };
  const data =
    portal === "us"
      ? await fetchUsCatalogUpstream(opts)
      : await fetchUkCatalogUpstream(opts);
  const body = JSON.stringify(data);
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Loom-Cache": "MISS",
    "Cache-Control": `public, max-age=${CATALOG_SEARCH_TTL_SECS}`,
    ...CORS,
  });
  applyBaselineSecurityHeaders(headers);
  ctx.waitUntil(
    cache
      .put(
        cacheReq,
        new Response(body, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${CATALOG_SEARCH_TTL_SECS}`,
          },
        }),
      )
      .catch(() => {}),
  );
  return new Response(body, { status: 200, headers });
}

async function handleFeedback(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (!originAllowed(origin, allowedOriginHostsFromEnv(env))) {
    return json({ error: "Forbidden origin" }, 403);
  }

  const ip = clientIp(request);
  if (!(await rateLimitAllow(env, "feedback", ip, 5, 60 * 60 * 1000))) {
    return json({ error: "Too many notes — try again later" }, 429);
  }

  if (!env.GITHUB_TOKEN) {
    return json(
      {
        error:
          "Feedback API not configured. Set GITHUB_TOKEN on the Worker (wrangler secret put GITHUB_TOKEN).",
      },
      503,
    );
  }

  const parsed = await parseJsonBody(request, MAX_FEEDBACK_POST_BYTES);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.data as {
    title?: string;
    body?: string;
    imageBase64?: string | null;
    href?: string;
    kind?: string;
  };

  const title = (payload.title || "Loom feedback").trim().slice(0, 200);
  let body = (payload.body || "(no description)").trim().slice(0, 50_000);
  const kind = (payload.kind || "feedback").trim().slice(0, 40);
  const href = (payload.href || "").trim().slice(0, 500);

  const meta = [
    `**Kind:** ${githubInlineField(kind)}`,
    href ? `**Page:** ${githubInlineField(href)}` : null,
    `**Source:** loom.ibm.io web feedback`,
  ]
    .filter(Boolean)
    .join("\n");

  body = `${body}\n\n---\n${meta}`;

  if (payload.imageBase64?.trim()) {
    const kv = env.LOOM_STORIES;
    const b64 = payload.imageBase64.startsWith("data:")
      ? payload.imageBase64.slice(payload.imageBase64.indexOf(",") + 1)
      : payload.imageBase64;
    let linked = false;
    if (kv && b64.length <= 400_000) {
      try {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        if (bin.length > 0 && validateOgImageBytes("image/png", bin)) {
          const imgId = storyId().slice(0, 12);
          await kv.put(`s:${imgId}:img`, bin, {
            expirationTtl: STORY_TTL_SECONDS,
            metadata: { contentType: "image/png" },
          });
          const host = new URL(request.url).origin;
          body += `\n\n![screenshot](${host}/s/${imgId}.img)`;
          linked = true;
        }
      } catch {
        /* invalid base64 */
      }
    }
    if (!linked) {
      body += "\n\n_(Screenshot omitted — stored feedback images require LOOM_STORIES KV and a valid PNG.)_";
    }
  }

  if (body.length > 65_536) {
    body = `${body.slice(0, 65_400)}\n\n_(Body truncated for GitHub API limit.)_`;
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
const MAX_STORY_DATA_BYTES = 900_000;

/** ≥128 bits of entropy as hex (32 chars). */
function storyId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Readable bit of a share URL: /plot/correlation-matrix/{id} */
function storySlug(title: string | undefined): string {
  const slug = (title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "chart";
}

function storyPageUrl(origin: string, id: string, title: string | undefined): string {
  return `${origin}/plot/${storySlug(title)}/${id}`;
}

/** Id or id.ext from /plot/{slug}/{id}, /plot/{id}, /s/{id}, or /p/{id}. */
function storyFileFromPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "");
  const file = "([a-z0-9]{8,32}(?:\\.(?:img|jpe?g|png|data))?)";
  const plot = path.match(new RegExp(`^/plot/(?:[a-z0-9-]+/)?${file}$`, "i"));
  if (plot?.[1]) return plot[1];
  const legacy = path.match(new RegExp(`^/(?:s|p)/${file}$`, "i"));
  return legacy?.[1] ?? null;
}

export async function handlePublishStory(request: Request, env: Env): Promise<Response> {
  // Publishing is intentionally anonymous for approved Loom web origins, but
  // Origin (or STORY_ADMIN_TOKEN) is required — a missing Origin is not auth.
  if (!storyMutationAuthorized(request, env)) {
    return json(
      {
        error:
          "Forbidden: approved Origin required, or Authorization: Bearer <STORY_ADMIN_TOKEN> for native/ops clients",
      },
      403,
    );
  }

  const ip = clientIp(request);
  // 20 stories / hour / IP — enough for normal use, stops KV fill attacks
  if (!(await rateLimitAllow(env, "stories", ip, 20, 60 * 60 * 1000))) {
    return json({ error: "Too many publishes — try again later" }, 429);
  }

  const parsedStory = await parseJsonBody(request, MAX_STORY_POST_BYTES);
  if (!parsedStory.ok) return parsedStory.response;
  const payload = parsedStory.data as { html?: string; title?: string; ogImage?: string; data?: unknown };
  let html = payload.html?.trim() ?? "";
  if (!html || utf8ByteLength(html) > MAX_STORY_HTML_BYTES) {
    return json({ error: "HTML missing or too large (4MB max)" }, 400);
  }
  if (!html.includes("<html") && !html.includes("<HTML")) {
    return json({ error: "Expected an HTML document" }, 400);
  }

  const kv = env.LOOM_STORIES;
  if (!kv) {
    return json({ error: "Story storage not configured (LOOM_STORIES KV)" }, 503);
  }

  const id = storyId();
  // Always publish under loom.ibm.io so anyone can open the link (not Cap localhost
  // or loom-storyteller.mhsenkow.workers.dev).
  const origin = publicWebOrigin(env);
  const ttl = STORY_TTL_SECONDS;

  // Optional data lineage companion — the rows that built the chart at share time.
  let hasData = false;
  if (payload.data != null) {
    const dataJson = typeof payload.data === "string" ? payload.data : JSON.stringify(payload.data);
    if (dataJson.length > 2 && utf8ByteLength(dataJson) <= MAX_STORY_DATA_BYTES) {
      await kv.put(`s:${id}:data`, dataJson, { expirationTtl: ttl });
      hasData = true;
    }
  }

  // Link unfurlers (iMessage, Slack, X…) ignore data: URLs — host the preview
  // image beside the page and point og:image / twitter:image / <img> at it.
  // KV (not Cache API) so NeoSpace can fetch .img from any Cloudflare colo.
  // Prefer stable tokens from buildChartSharePageHtml; also rewrite legacy data: embeds.
  const og = payload.ogImage?.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
  if (og && og[2]!.length < MAX_STORY_HTML_BYTES) {
    const bytes = Uint8Array.from(atob(og[2]!), (c) => c.charCodeAt(0));
    if (!validateOgImageBytes(og[1] as "image/png" | "image/jpeg", bytes)) {
      return json({ error: "Invalid preview image" }, 400);
    }
    await kv.put(`s:${id}:img`, bytes.buffer, {
      expirationTtl: ttl,
      metadata: { contentType: og[1]!, width: 1200, height: 627 },
    });
    const ext = og[1] === "image/jpeg" ? "jpg" : "png";
    const hosted = `${storyPageUrl(origin, id, payload.title)}.${ext}`;
    html = html
      .split("__LOOM_SHARE_IMG__")
      .join(hosted)
      .split("__LOOM_OG_IMG__")
      .join(hosted);
    if (payload.ogImage) {
      html = html.split(`content="${payload.ogImage}"`).join(`content="${hosted}"`);
      html = html.split(`src="${payload.ogImage}"`).join(`src="${hosted}"`);
    }
  }

  // Point "Open in Loom" at the story snapshot when we have one.
  if (hasData) {
    const storyOpen = `${origin}/#story=${id}`;
    html = html.replace(/data-loom-open="1"\s+href="[^"]*"/g, `data-loom-open="1" href="${storyOpen}"`);
  }

  // Canonical, og:url, and oEmbed so LinkedIn / Slack / iMessage / X unfurl the public page.
  const page = storyPageUrl(origin, id, payload.title);
  html = html.split("__LOOM_PAGE_URL__").join(page);
  html = html.split("__LOOM_OEMBED_URL__").join(`${origin}/oembed?url=${encodeURIComponent(page)}`);

  await kv.put(`s:${id}:html`, html, {
    expirationTtl: ttl,
    metadata: {
      contentType: "text/html; charset=utf-8",
      title: (payload.title || "Loom story").slice(0, 120),
      hasData: hasData ? "1" : "0",
    },
  });

  return json({ id, url: storyPageUrl(origin, id, payload.title), hasData });
}

async function handleGetStory(id: string, env: Env): Promise<Response> {
  // Legacy 12-char base36 ids + new 32-char hex ids
  if (!/^[a-z0-9]{8,32}(\.(img|jpe?g|png|data))?$/i.test(id)) {
    return json({ error: "Invalid story id" }, 400);
  }
  const kv = env.LOOM_STORIES;
  if (!kv) {
    return new Response("Story storage not configured.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...CORS },
    });
  }

  const [baseId, ext] = id.includes(".") ? (id.split(".") as [string, string]) : [id, "html"];
  const imageExt = ext === "img" || ext === "jpg" || ext === "jpeg" || ext === "png";
  const key = `s:${baseId}:${imageExt ? "img" : ext === "data" ? "data" : "html"}`;
  const edge = caches.default;
  const edgeReq = new Request(`https://loom-story.internal/${key}`);
  const cached = await edge.match(edgeReq).catch(() => undefined);
  if (cached) return cached;
  type StoryKvHit = KVNamespaceGetWithMetadataResult<
    string | ArrayBuffer,
    { contentType?: string; title?: string; hasData?: string }
  >;
  const hit: StoryKvHit =
    imageExt
      ? await kv.getWithMetadata(key, "arrayBuffer")
      : await kv.getWithMetadata(key, "text");

  if (hit.value == null) {
    // Never let the edge cache a miss — 404s must stay uncached.
    return new Response("Story not found or expired.", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        ...CORS,
      },
    });
  }

  const meta = hit.metadata || {};
  const headers = new Headers({
    "Cache-Control": `public, max-age=${STORY_BROWSER_MAX_AGE}, s-maxage=${STORY_EDGE_S_MAXAGE}`,
    "Access-Control-Allow-Origin": "*",
  });
  applyBaselineSecurityHeaders(headers);

  if (imageExt) {
    headers.set("Content-Type", meta.contentType || "image/png");
    headers.set("Content-Disposition", "inline");
    headers.set("X-Robots-Tag", "index, follow, max-image-preview:large");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800");
    return rememberStory(edge, edgeReq, new Response(hit.value as unknown as ArrayBuffer, { status: 200, headers }));
  }
  if (ext === "data") {
    headers.set("Content-Type", "application/json; charset=utf-8");
    return rememberStory(edge, edgeReq, new Response(hit.value as string, { status: 200, headers }));
  }

  headers.set("Content-Type", meta.contentType || "text/html; charset=utf-8");
  headers.set("Content-Security-Policy", STORY_HTML_CSP);
  headers.set("X-Robots-Tag", "index, follow, max-image-preview:large");
  if (meta.title) headers.set("X-Loom-Story-Title", meta.title);
  if (meta.hasData === "1") headers.set("X-Loom-Story-Data", "1");
  return rememberStory(edge, edgeReq, new Response(hit.value as string, { status: 200, headers }));
}

async function rememberStory(edge: Cache, edgeReq: Request, res: Response): Promise<Response> {
  await edge.put(edgeReq, res.clone()).catch(() => {});
  return res;
}

async function handleDeleteStory(id: string, request: Request, env: Env): Promise<Response> {
  if (!/^[a-z0-9]{8,32}$/i.test(id)) {
    return json({ error: "Invalid story id" }, 400);
  }
  const token = bearerToken(request);
  if (!env.STORY_ADMIN_TOKEN || !token || token !== env.STORY_ADMIN_TOKEN) {
    return json({ error: "Unauthorized" }, 401);
  }
  const kv = env.LOOM_STORIES;
  if (!kv) {
    return json({ error: "Story storage not configured (LOOM_STORIES KV)" }, 503);
  }
  const edge = caches.default;
  await Promise.all([
    kv.delete(`s:${id}:html`),
    kv.delete(`s:${id}:img`),
    kv.delete(`s:${id}:data`),
    edge.delete(new Request(`https://loom-story.internal/s:${id}:html`)).catch(() => false),
    edge.delete(new Request(`https://loom-story.internal/s:${id}:img`)).catch(() => false),
    edge.delete(new Request(`https://loom-story.internal/s:${id}:data`)).catch(() => false),
  ]);
  return json({ ok: true, id, deleted: true });
}

/** oEmbed photo for Slack, WordPress, Embedly, and other OG companions. Lives at /oembed so robots.txt can keep disallowing /api/. */
async function handleOEmbed(url: URL, env: Env): Promise<Response> {
  let target: URL;
  try {
    target = new URL(url.searchParams.get("url") || "");
  } catch {
    return json({ error: "Invalid url" }, 400);
  }
  const file = storyFileFromPath(target.pathname);
  if (!file || file.includes(".")) return json({ error: "Not a story" }, 404);
  const kv = env.LOOM_STORIES;
  if (!kv) return json({ error: "Story storage not configured" }, 503);
  const htmlHit = await kv.getWithMetadata(`s:${file}:html`, "text");
  if (htmlHit.value == null) return json({ error: "Story not found" }, 404);
  const meta = (htmlHit.metadata || {}) as { title?: string };
  const imgHit = await kv.getWithMetadata(`s:${file}:img`, "arrayBuffer");
  const imgMeta = (imgHit.metadata || {}) as { contentType?: string; width?: number; height?: number };
  const origin = publicWebOrigin(env);
  const page = `${origin}${target.pathname.replace(/\/+$/, "")}`;
  const title = meta.title || "Loom chart";
  if (imgHit.value == null) {
    return json({
      version: "1.0",
      type: "link",
      title,
      url: page,
      provider_name: "Loom",
      provider_url: origin,
    });
  }
  const ext = imgMeta.contentType === "image/png" ? "png" : "jpg";
  return json({
    version: "1.0",
    type: "photo",
    title,
    url: `${page}.${ext}`,
    width: imgMeta.width || 1200,
    height: imgMeta.height || 627,
    provider_name: "Loom",
    provider_url: origin,
  });
}

// ---- Always-on monitors (`/api/monitors`, cron) ----

async function handleMonitors(request: Request, url: URL, env: Env): Promise<Response> {
  const kv = env.LOOM_STORIES;
  const cors = corsHeadersFor(request, env);
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } });
  if (!kv) return reply({ error: "Always-on monitors are not configured" }, 503);
  const auth = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const key = await deviceKey(auth);
  if (!key) return reply({ error: "Missing device token" }, 401);
  // Device tokens are self-minted, so also cap per network: the Worker must not be a free relay.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

  if (url.pathname === "/api/monitors/test-webhook" && request.method === "POST") {
    if (!(await rateLimitAllow(env, "mon-test", key, 10, 3_600_000))) return reply({ error: "Too many tests — try later" }, 429);
    if (!(await rateLimitAllow(env, "mon-test-ip", ip, 30, 3_600_000))) return reply({ error: "Too many tests — try later" }, 429);
    const body = (await request.json().catch(() => null)) as { webhook?: unknown } | null;
    const hook = validateWebhook(body?.webhook);
    if (!hook) return reply({ error: "Use an https ntfy, Slack, Discord or JSON webhook URL" }, 400);
    try {
      const res = await fetch(hook.url, {
        ...webhookRequest(hook, { name: "Loom test alert", decision: "Nothing — this is a test.", severity: "info" }, "Your always-on monitors can reach this channel."),
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      return reply({ ok: res.ok, status: res.status });
    } catch {
      return reply({ ok: false, status: 0 });
    }
  }

  if (url.pathname !== "/api/monitors") return reply({ error: "Not found" }, 404);

  if (request.method === "GET") {
    const b = (await kv.get(key, "json")) as CloudBundle | null;
    return reply({
      checks: b?.checks ?? {},
      alerts: b?.alerts ?? [],
      moments: b?.moments ?? [],
      updatedAt: b?.updatedAt ?? null,
      monitors: b?.monitors.length ?? 0,
      public: b?.public ?? null,
      pushDevices: b?.push?.length ?? 0,
    });
  }
  if (request.method === "DELETE") {
    const old = (await kv.get(key, "json")) as CloudBundle | null;
    if (old?.public) await kv.delete(`monpub:${old.public.id}`);
    await kv.delete(key);
    return reply({ ok: true });
  }
  if (request.method === "POST") {
    if (!(await rateLimitAllow(env, "mon-up", key, 60, 3_600_000))) return reply({ error: "Too many updates — try later" }, 429);
    if (!(await rateLimitAllow(env, "mon-up-ip", ip, 300, 3_600_000))) return reply({ error: "Too many updates — try later" }, 429);
    const text = await request.text();
    if (text.length > 200_000) return reply({ error: "Too large" }, 413);
    let body: {
      monitors?: unknown; webhook?: unknown; acks?: unknown; push?: { add?: unknown; remove?: unknown }; public?: { title?: unknown } | null;
      seedChecks?: unknown; dropMoments?: unknown;
    };
    try { body = JSON.parse(text); } catch { return reply({ error: "Bad JSON" }, 400); }
    const monitors = sanitizeCloudMonitors(body.monitors);
    const webhook = body.webhook == null ? undefined : validateWebhook(body.webhook) ?? undefined;
    if (body.webhook != null && !webhook) return reply({ error: "Use an https ntfy, Slack, Discord or JSON webhook URL" }, 400);
    const prev = (await kv.get(key, "json")) as CloudBundle | null;
    if (!prev && !(await rateLimitAllow(env, "mon-new-ip", ip, 20, 86_400_000))) return reply({ error: "Too many new devices from this network today" }, 429);
    // Nothing always-on and nothing to keep (no push devices, no public page): forget the device.
    if (!monitors.length && !prev?.push?.length && !prev?.public && body.push?.add == null && !body.public) {
      await kv.delete(key);
      return reply({ ok: true, monitors: 0, public: null, pushDevices: 0 });
    }
    const acks = Array.isArray(body.acks) ? body.acks.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
    const add = body.push?.add != null ? validatePushSubscription(body.push.add) : undefined;
    if (body.push?.add != null && !add) return reply({ error: "Unsupported push service" }, 400);
    const publicTitle = body.public === null ? null : body.public && typeof body.public.title === "string" ? body.public.title : body.public ? "Loom monitors" : undefined;
    const next = mergeUpload(prev, monitors, webhook, Date.now(), acks, {
      push: { add: add ?? undefined, remove: typeof body.push?.remove === "string" ? body.push.remove : undefined },
      publicTitle,
      seedChecks: body.seedChecks && typeof body.seedChecks === "object" ? (body.seedChecks as Record<string, CheckRecord[]>) : undefined,
      dropMoments: Array.isArray(body.dropMoments) ? body.dropMoments.filter((x): x is string => typeof x === "string").slice(0, 300) : undefined,
    });
    await kv.put(key, JSON.stringify(next), { expiration: bundleExpiry(next), metadata: bundleListMeta(next) });
    if (prev?.public && prev.public.id !== next.public?.id) await kv.delete(`monpub:${prev.public.id}`);
    if (next.public) await kv.put(`monpub:${next.public.id}`, key, { expirationTtl: BUNDLE_TTL_SECS });
    return reply({ ok: true, monitors: monitors.length, accepted: monitors.map((m) => m.id), max: CLOUD_MAX_MONITORS, public: next.public ?? null, pushDevices: next.push?.length ?? 0 });
  }
  return reply({ error: "Method not allowed" }, 405);
}

/** `/w/<id>`, `/w/<id>/feed.xml`, `/w/<id>/m/<moment>.svg` — read-only public monitor pages. */
async function handlePublicMonitors(url: URL, env: Env): Promise<Response> {
  const m = url.pathname.match(/^\/w\/([a-f0-9]{16})(?:\/(feed\.xml|m\/([A-Za-z0-9_-]{1,80})\.svg))?\/?$/);
  const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  if (!m || !isPublicId(m[1]!) || !env.LOOM_STORIES) return notFound();
  const edge = caches.default;
  const cacheReq = new Request(`https://loom-public.internal${url.pathname}`);
  const hit = await edge.match(cacheReq).catch(() => undefined);
  if (hit) return hit;
  const remember = async (res: Response) => {
    if (res.ok) await edge.put(cacheReq, res.clone()).catch(() => {});
    return res;
  };
  const id = m[1]!;
  const deviceKeyName = await env.LOOM_STORIES.get(`monpub:${id}`);
  const bundle = deviceKeyName ? ((await env.LOOM_STORIES.get(deviceKeyName, "json")) as CloudBundle | null) : null;
  if (!bundle?.public || bundle.public.id !== id) return notFound();
  const origin = publicWebOrigin(env);
  const cache = { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" };
  if (m[2] === "feed.xml") return remember(new Response(publicFeedXml(bundle, id, origin), { headers: { "Content-Type": "application/rss+xml; charset=utf-8", ...cache } }));
  if (m[3]) {
    const svg = publicMomentSvg(bundle, m[3]);
    return svg
      ? remember(new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", ...cache, "Cache-Control": "public, max-age=86400" } }))
      : notFound();
  }
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", ...cache });
  applyBaselineSecurityHeaders(headers);
  headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  return remember(new Response(publicPageHtml(bundle, id, origin), { headers }));
}

/** Feed health for the app (hide resting feeds) and the nightly probe. One colo shares one KV read for this long — resting takes hours, so a half-hour view is enough. */
const HEALTH_CACHE_SECS = 30 * 60;

async function handleHealth(request: Request, env: Env, ctx: WaitUntil): Promise<Response> {
  const cache = caches.default;
  const key = "https://loom-source.internal/health/v1";
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return jsonFor(request, await hit.json());
  const body = { generatedAt: Date.now(), sources: await readSourceHealth(env.LOOM_STORIES, Object.keys(SOURCE_FETCHERS)) };
  ctx.waitUntil(
    cache
      .put(key, new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${HEALTH_CACHE_SECS}` } }))
      .catch(() => {}),
  );
  return jsonFor(request, body);
}

async function cronSourceBody(kind: string, ctx: WaitUntil, kv?: KVNamespace): Promise<unknown> {
  const res = await handleSource(kind, new Request(`https://loom.internal/api/source/${kind}`), ctx, kv);
  if (!res.ok) throw new Error(`Feed ${kind} returned ${res.status}`);
  return res.json();
}

export default {
  async fetch(request: Request, env: Env, ctx: WaitUntil): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/s/") || url.pathname.startsWith("/p/") || url.pathname.startsWith("/plot/"))) {
      if (url.pathname === "/api/fetch-csv" || url.pathname.startsWith("/api/source/") || url.pathname.startsWith("/api/monitors")) {
        if (
          url.pathname === "/api/fetch-csv" &&
          !fetchCsvAuthorized(request, env) &&
          !originAllowed(request.headers.get("Origin"), allowedOriginHostsFromEnv(env))
        ) {
          return new Response(null, { status: 403, headers: corsHeadersFor(request, env) });
        }
        return new Response(null, { status: 204, headers: corsHeadersFor(request, env) });
      }
      return new Response(null, { status: 204, headers: CORS });
    }

    const requestId = shortRequestId();
    try {
      if (url.pathname === "/api/catalog/us") {
        return await handleCatalogSearch("us", url, ctx);
      }
      if (url.pathname === "/api/catalog/uk") {
        return await handleCatalogSearch("uk", url, ctx);
      }
      if (url.pathname === "/api/fetch-csv") {
        return await handleFetchCsv(request, url, ctx, env);
      }
      if (url.pathname.startsWith("/api/source/")) {
        const kind = url.pathname.replace("/api/source/", "").replace(/\/$/, "");
        return await handleSource(kind, request, ctx, env.LOOM_STORIES);
      }
      if (url.pathname === "/api/health") {
        return await handleHealth(request, env, ctx);
      }
      if (url.pathname === "/api/monitors/push-key" && request.method === "GET") {
        const vapid = vapidFromEnv(env);
        return vapid ? jsonFor(request, { publicKey: vapid.publicKey }) : jsonFor(request, { error: "Push is not configured" }, 404);
      }
      if (url.pathname.startsWith("/w/")) {
        return await handlePublicMonitors(url, env);
      }
      if (url.pathname === "/api/monitors" || url.pathname === "/api/monitors/test-webhook") {
        return await handleMonitors(request, url, env);
      }
      if (url.pathname === "/api/feedback" && request.method === "POST") {
        return await handleFeedback(request, env);
      }
      if (url.pathname === "/oembed" && request.method === "GET") {
        return await handleOEmbed(url, env);
      }
      if (url.pathname === "/api/stories" && request.method === "POST") {
        return await handlePublishStory(request, env);
      }
      {
        const del = url.pathname.match(/^\/api\/stories\/([a-z0-9]{8,32})$/i);
        if (del && request.method === "DELETE") {
          return await handleDeleteStory(del[1]!, request, env);
        }
      }
      const storyFile = storyFileFromPath(url.pathname);
      if (storyFile) return await handleGetStory(storyFile, env);
      if (/^\/(?:plot|s|p)\//.test(url.pathname)) {
        return json({ error: "Invalid story id" }, 400);
      }
    } catch {
      return json({ error: "Request failed", requestId }, 502);
    }

    if (url.pathname.startsWith("/api/")) {
      return jsonFor(request, { error: "Not found" }, 404);
    }

    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    applyBaselineSecurityHeaders(headers);
    return new Response(asset.body, {
      status: asset.status,
      statusText: asset.statusText,
      headers,
    });
  },

  async scheduled(_controller: unknown, env: Env, ctx: WaitUntil): Promise<void> {
    if (!env.LOOM_STORIES) return;
    const kv = env.LOOM_STORIES;
    ctx.waitUntil(
      runMonitorCron(kv, Date.now(), (kind) => cronSourceBody(kind, ctx, kv), parseSourceRows, makeNotifier(vapidFromEnv(env))).then((r) => {
        console.log(JSON.stringify({ event: "monitor_cron", ...r }));
      }),
    );
  },
};
