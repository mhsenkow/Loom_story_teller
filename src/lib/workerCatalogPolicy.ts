// =================================================================
// Worker catalog policy — pure helpers shared with catalog-proxy tests
// =================================================================

/** Bump when source transform column shapes change (invalidates edge cache). */
export const SOURCE_CACHE_SCHEMA_VERSION = 2;

export function sourceCacheKey(kind: string): string {
  return `https://loom-source.internal/source/v${SOURCE_CACHE_SCHEMA_VERSION}/${kind}`;
}

/** Catalog search `rows` query param — finite integer in [1, 200]. */
export function clampWorkerCatalogRows(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "40"));
  if (!Number.isFinite(n)) return 40;
  return Math.min(200, Math.max(1, Math.floor(n)));
}

export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

export function validateOgImageBytes(contentType: "image/png" | "image/jpeg", bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (contentType === "image/png") {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** World Bank wide indicator window: 2000 through last complete calendar year. */
export function worldBankDateRange(now = new Date()): string {
  const end = now.getUTCFullYear() - 1;
  return `2000:${Math.max(2000, end)}`;
}

const CATALOG_CACHE_ORIGIN = "https://loom-catalog.internal";

/** Stable cache key for `/api/catalog/us|uk` (normalized query). */
export function catalogSearchCacheKey(portal: "us" | "uk", url: URL): string {
  const u = new URL(`${CATALOG_CACHE_ORIGIN}/${portal}`);
  const rows = clampWorkerCatalogRows(url.searchParams.get("rows") ?? "40");
  u.searchParams.set("rows", String(rows));
  const q = (url.searchParams.get("q") || "").trim().slice(0, 500);
  if (q) u.searchParams.set("q", q);
  const sort = (url.searchParams.get("sort") || "").trim();
  if (sort) u.searchParams.set("sort", sort);
  const csvOnly = url.searchParams.get("csvOnly");
  if (csvOnly === "1" || csvOnly === "true") u.searchParams.set("csvOnly", "1");
  return u.toString();
}

export const CATALOG_SEARCH_TTL_SECS = 600;
export const CATALOG_SEARCH_DEADLINE_MS = 15_000;

/** Cache key for successful `/api/fetch-csv` responses (canonical upstream URL). */
export function fetchCsvCacheKey(targetUrl: string): string {
  return `https://loom-fetch-csv.internal/v1/${encodeURIComponent(targetUrl)}`;
}

export const FETCH_CSV_CACHE_TTL_SECS = 3600;

/** Aircraft / live-source fetch budget (OpenSky + ADSB fallbacks). */
export const AIRCRAFT_FETCH_BUDGET_MS = 20_000;

type JsonRecord = Record<string, unknown>;

function rowCountFromPayload(data: unknown): number | null {
  if (Array.isArray(data)) return data.length;
  if (!data || typeof data !== "object") return null;
  const o = data as JsonRecord;
  // Columnar transforms ({ columns, rows }) — FIRMS, GDACS, ADSB fallbacks, …
  if (Array.isArray(o.rows)) return o.rows.length;
  if (Array.isArray(o.states)) return o.states.length;
  if (Array.isArray(o.features)) return o.features.length;
  if (Array.isArray(o.ac)) return o.ac.length;
  if (Array.isArray(o.aircraft)) return o.aircraft.length;
  if (Array.isArray(o.results)) return o.results.length;
  return null;
}

/**
 * Reject empty/degraded snapshots so TTL does not replace a good cache entry.
 * Returns false when the payload should not be written to cache.
 */
export function sourcePayloadCacheable(kind: string, text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    // Non-JSON sources (GeoJSON text, CSV transforms) — require non-trivial body.
    return trimmed.length > 32;
  }
  const rows = rowCountFromPayload(data);
  if (kind === "firms" || kind === "gdacs" || kind === "opensky") {
    return rows !== null && rows > 0;
  }
  if (kind === "meteo" || kind === "aq") {
    if (Array.isArray(data) && data.length === 0) return false;
  }
  if (rows === 0) return false;
  return true;
}
