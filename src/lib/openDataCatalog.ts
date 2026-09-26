// =================================================================
// Loom — Open data catalog fetchers (browser / Worker)
// =================================================================
// Mirrors Rust `fetch_data_gov_recent_csv` / `fetch_uk_data_recent_csv`
// for the static web UI. US Catalog API has no CORS; prefer same-origin
// `/api/catalog/*` (Cloudflare Worker). UK CKAN allows CORS `*`.
// =================================================================

export type DataGovSortKey = "newest" | "updated" | "relevance" | "title_az" | "title_za";

export interface FetchDataGovOptions {
  rows?: number;
  query?: string;
  sort?: DataGovSortKey;
  /** Prefer datasets with a direct CSV download (web explore path). */
  csvOnly?: boolean;
}

export interface DataGovResource {
  id: string;
  name: string;
  format: string;
  url: string;
}

export interface DataGovDataset {
  id: string;
  name: string;
  title: string;
  organization?: string;
  notes?: string;
  resources: DataGovResource[];
  portal_id: string;
}

const US_CATALOG = "https://catalog.data.gov/search";
const UK_CKAN = "https://ckan.publishing.service.gov.uk/api/action/package_search";

/** Deployed Worker origin used when local Next.js has no `/api` routes. */
export const DEFAULT_CATALOG_ORIGIN =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CATALOG_ORIGIN) ||
  "https://loom-storyteller.mhsenkow.workers.dev";

function datasetHasCsv(ds: DataGovDataset): boolean {
  return ds.resources.some(
    (r) => r.format === "CSV" || /\.csv(\?|$)/i.test(r.url),
  );
}

/** First CSV resource suitable for in-browser Load / Explore. */
export function firstCsvResource(ds: DataGovDataset): DataGovResource | null {
  return (
    ds.resources.find((r) => r.format === "CSV" || /\.csv(\?|$)/i.test(r.url)) ?? null
  );
}

function sanitizeQ(q?: string): string | undefined {
  const s = q?.trim();
  if (!s || s.length > 500 || /[\r\n]/.test(s)) return undefined;
  return s;
}

function clampRows(rows?: number): number {
  return Math.min(200, Math.max(1, rows ?? 40));
}

function usSortParam(sort?: DataGovSortKey | null): string {
  if (sort === "relevance") return "relevance";
  return "last_harvested_date";
}

function ukSortParam(sort?: DataGovSortKey | null): string {
  switch (sort) {
    case "newest":
      return "metadata_created desc";
    case "updated":
      return "metadata_modified desc";
    case "relevance":
      return "score desc";
    case "title_az":
      return "title_string asc";
    case "title_za":
      return "title_string desc";
    default:
      return "metadata_created desc";
  }
}

function distHttpUrl(dist: Record<string, unknown>): string | undefined {
  for (const key of ["downloadURL", "accessURL"] as const) {
    const u = dist[key];
    if (typeof u === "string" && (u.startsWith("http://") || u.startsWith("https://"))) return u;
  }
  return undefined;
}

function isCsvDistribution(dist: Record<string, unknown>): boolean {
  const fmt = String(dist.format ?? "").toUpperCase();
  const mt = String(dist.mediaType ?? "").toLowerCase();
  const du = String(dist.downloadURL ?? "");
  const ac = String(dist.accessURL ?? "");
  const title = String(dist.title ?? "");
  if (fmt.includes("CSV") || mt.includes("csv")) return true;
  if (du.toLowerCase().endsWith(".csv") || ac.toLowerCase().endsWith(".csv")) return true;
  if (du.includes("format=csv") || du.includes("format=CSV")) return true;
  return (
    title.trim().toLowerCase() === "csv" &&
    !!du &&
    (du.startsWith("http://") || du.startsWith("https://"))
  );
}

function isUsableDistribution(dist: Record<string, unknown>, url: string): boolean {
  if (isCsvDistribution(dist)) return true;
  const mt = String(dist.mediaType ?? "").toLowerCase();
  const fmt = String(dist.format ?? "").toUpperCase();
  const ul = url.toLowerCase();
  if (mt === "text/html" && !ul.endsWith(".csv") && !ul.includes("format=csv") && !fmt.includes("CSV")) {
    return false;
  }
  if (fmt.includes("ZIP") || mt.includes("zip") || ul.endsWith(".zip")) return true;
  if (mt.includes("json") || fmt.includes("JSON") || ul.endsWith(".json") || ul.endsWith(".geojson")) return true;
  if (mt.includes("geo+json") || fmt.includes("GEOJSON")) return true;
  if (mt.includes("spreadsheet") || fmt.includes("XLSX") || fmt.includes("XLS")) return true;
  return false;
}

function catalogFormat(dist: Record<string, unknown>): string {
  if (isCsvDistribution(dist)) return "CSV";
  const fmt = String(dist.format ?? "").toUpperCase();
  const mt = String(dist.mediaType ?? "").toLowerCase();
  if (fmt.includes("ZIP") || mt.includes("zip")) return "ZIP";
  if (mt.includes("geo+json") || fmt.includes("GEOJSON")) return "GeoJSON";
  if (mt.includes("json") || fmt.includes("JSON")) return "JSON";
  if (fmt.includes("XLSX") || mt.includes("spreadsheet")) return "XLSX";
  return "File";
}

function resourcesFromDcat(dcat: unknown, slug: string): DataGovResource[] {
  const out: DataGovResource[] = [];
  if (!dcat || typeof dcat !== "object") return out;
  const arr = (dcat as { distribution?: unknown }).distribution;
  if (!Array.isArray(arr)) return out;
  arr.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") return;
    const dist = raw as Record<string, unknown>;
    const url = distHttpUrl(dist);
    if (!url || !isUsableDistribution(dist, url)) return;
    const fmtLabel = catalogFormat(dist);
    const name =
      typeof dist.title === "string" && dist.title.trim() ? dist.title : fmtLabel;
    out.push({ id: `${slug}-${idx}`, name, format: fmtLabel, url });
  });
  return out;
}

function dataGovFromCatalogRow(row: Record<string, unknown>): DataGovDataset | null {
  const identifier = typeof row.identifier === "string" ? row.identifier : null;
  if (!identifier) return null;
  const slug = typeof row.slug === "string" ? row.slug : "";
  const name = slug || identifier;
  const title = typeof row.title === "string" ? row.title : name;
  let organization: string | undefined;
  const org = row.organization;
  if (org && typeof org === "object" && typeof (org as { name?: unknown }).name === "string") {
    organization = (org as { name: string }).name;
  } else if (typeof row.publisher === "string") {
    organization = row.publisher;
  }
  const notes =
    typeof row.description === "string" && row.description.trim()
      ? row.description
      : undefined;
  let resources = resourcesFromDcat(row.dcat, name);
  if (resources.length === 0) {
    const harvest = row.harvest_record;
    if (typeof harvest === "string" && (harvest.startsWith("http://") || harvest.startsWith("https://"))) {
      resources = [
        {
          id: `${name}-harvest`,
          name: "Catalog record (metadata)",
          format: "Metadata",
          url: harvest,
        },
      ];
    }
  }
  if (resources.length === 0) return null;
  return {
    id: identifier,
    name,
    title,
    organization,
    notes,
    resources,
    portal_id: "data.gov",
  };
}

/** Parse US Catalog `/search` JSON body into datasets (shared by Worker + browser). */
export function parseUsCatalogBody(body: unknown, rows: number, sort?: DataGovSortKey | null): DataGovDataset[] {
  const collected: DataGovDataset[] = [];
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) throw new Error("Unexpected Data.gov payload (missing results)");

  for (const item of results) {
    if (collected.length >= rows) break;
    if (item && typeof item === "object") {
      const ds = dataGovFromCatalogRow(item as Record<string, unknown>);
      if (ds) collected.push(ds);
    }
  }

  if (sort === "title_az") {
    collected.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  } else if (sort === "title_za") {
    collected.sort((a, b) => b.title.toLowerCase().localeCompare(a.title.toLowerCase()));
  }
  return collected.slice(0, rows);
}

/** Fetch + paginate US Catalog API (no CORS — use from Worker or via `/api/catalog/us`). */
export async function fetchUsCatalogUpstream(
  opts: FetchDataGovOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<DataGovDataset[]> {
  const rows = clampRows(opts.rows);
  let sort = opts.sort ?? null;
  let q = sanitizeQ(opts.query);
  // Empty browse + csvOnly: Catalog's newest harvests are often metadata-only.
  // Seed a CSV-friendly query so Explore has something to open.
  if (opts.csvOnly && !q) {
    q = "csv";
    if (!sort || sort === "newest" || sort === "updated") sort = "relevance";
  }
  const collected: DataGovDataset[] = [];
  let after: string | undefined;
  const maxPages = opts.csvOnly ? 40 : 25;

  for (let page = 0; page < maxPages && collected.length < rows; page++) {
    const url = new URL(US_CATALOG);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("sort", usSortParam(sort));
    if (q) url.searchParams.set("q", q);
    if (after) url.searchParams.set("after", after);

    const res = await fetchImpl(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": "Loom-Data-Storyteller/1.0" },
    });
    if (!res.ok) throw new Error(`Data.gov returned ${res.status}`);
    const body = (await res.json()) as { results?: unknown[]; after?: string };
    const results = Array.isArray(body.results) ? body.results : [];
    for (const item of results) {
      if (collected.length >= rows) break;
      if (item && typeof item === "object") {
        const ds = dataGovFromCatalogRow(item as Record<string, unknown>);
        if (!ds) continue;
        if (opts.csvOnly && !datasetHasCsv(ds)) continue;
        collected.push(ds);
      }
    }
    after = typeof body.after === "string" ? body.after : undefined;
    if (!after || results.length === 0) break;
  }

  if (sort === "title_az") {
    collected.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  } else if (sort === "title_za") {
    collected.sort((a, b) => b.title.toLowerCase().localeCompare(a.title.toLowerCase()));
  }
  return collected.slice(0, rows);
}

/** Parse UK package_search JSON. */
export function parseUkCatalogBody(body: unknown, rows: number): DataGovDataset[] {
  const results = (body as { result?: { results?: unknown[] } })?.result?.results;
  if (!Array.isArray(results)) throw new Error("Unexpected UK data payload");

  const out: DataGovDataset[] = [];
  for (const pkg of results) {
    if (out.length >= rows) break;
    if (!pkg || typeof pkg !== "object") continue;
    const p = pkg as Record<string, unknown>;
    const pkgId = typeof p.id === "string" ? p.id : "";
    const pkgName = typeof p.name === "string" ? p.name : "";
    if (!pkgId || !pkgName) continue;
    const pkgTitle = typeof p.title === "string" ? p.title : pkgName;
    let organization: string | undefined;
    const org = p.organization;
    if (org && typeof org === "object" && typeof (org as { title?: unknown }).title === "string") {
      organization = (org as { title: string }).title;
    }
    const notes =
      typeof p.notes === "string" && p.notes.trim() ? p.notes : undefined;
    const csvResources: DataGovResource[] = [];
    const resources = p.resources;
    if (Array.isArray(resources)) {
      resources.forEach((res, idx) => {
        if (!res || typeof res !== "object") return;
        const r = res as Record<string, unknown>;
        const format = String(r.format ?? "");
        if (format.toUpperCase() !== "CSV") return;
        const url = typeof r.url === "string" ? r.url : "";
        if (!url.startsWith("http://") && !url.startsWith("https://")) return;
        const id =
          typeof r.id === "string" ? r.id : `${pkgId}-${idx}`;
        const name =
          typeof r.name === "string" && r.name.trim() ? r.name : "CSV";
        csvResources.push({ id, name, format: "CSV", url });
      });
    }
    if (csvResources.length === 0) continue;
    out.push({
      id: pkgId,
      name: pkgName,
      title: pkgTitle,
      organization,
      notes,
      resources: csvResources,
      portal_id: "data.gov.uk",
    });
  }
  return out;
}

export async function fetchUkCatalogUpstream(
  opts: FetchDataGovOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<DataGovDataset[]> {
  const rows = clampRows(opts.rows);
  const q = sanitizeQ(opts.query);
  const url = new URL(UK_CKAN);
  url.searchParams.set("rows", String(rows));
  url.searchParams.set("sort", ukSortParam(opts.sort));
  url.searchParams.set("fq", "res_format:CSV");
  if (q) url.searchParams.set("q", q);

  const res = await fetchImpl(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": "Loom-Data-Storyteller/1.0" },
  });
  if (!res.ok) throw new Error(`UK data returned ${res.status}`);
  return parseUkCatalogBody(await res.json(), rows);
}

function catalogQuery(opts: FetchDataGovOptions): string {
  const p = new URLSearchParams();
  p.set("rows", String(clampRows(opts.rows)));
  if (opts.sort) p.set("sort", opts.sort);
  const q = sanitizeQ(opts.query);
  if (q) p.set("q", q);
  if (opts.csvOnly) p.set("csvOnly", "1");
  return p.toString();
}

async function fetchJsonDatasets(path: string, opts: FetchDataGovOptions): Promise<DataGovDataset[]> {
  const qs = catalogQuery(opts);
  const origins = ["", DEFAULT_CATALOG_ORIGIN];
  let lastErr: Error | null = null;

  for (const origin of origins) {
    try {
      const res = await fetch(`${origin}${path}?${qs}`, {
        headers: { Accept: "application/json" },
      });
      if (res.status === 404 && origin === "") continue;
      if (!res.ok) throw new Error(`Catalog API ${res.status}`);
      const data = (await res.json()) as DataGovDataset[] | { error?: string };
      if (Array.isArray(data)) return data;
      throw new Error((data as { error?: string }).error || "Invalid catalog response");
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error("Catalog fetch failed");
}

/** Browser entry: Worker API (US always; UK fallback). Web path asks for CSV-ready sets. */
export async function fetchUsCatalogWeb(opts?: FetchDataGovOptions): Promise<DataGovDataset[]> {
  return fetchJsonDatasets("/api/catalog/us", { csvOnly: true, ...opts });
}

export async function fetchUkCatalogWeb(opts?: FetchDataGovOptions): Promise<DataGovDataset[]> {
  try {
    return await fetchUkCatalogUpstream(opts);
  } catch {
    return fetchJsonDatasets("/api/catalog/uk", opts ?? {});
  }
}

/** Fetch CSV text via Worker proxy (avoids CORS on agency hosts). */
export async function fetchCsvTextWeb(csvUrl: string): Promise<{ text: string; truncated: boolean }> {
  const origins = ["", DEFAULT_CATALOG_ORIGIN];
  let lastErr: Error | null = null;
  for (const origin of origins) {
    try {
      const res = await fetch(
        `${origin}/api/fetch-csv?url=${encodeURIComponent(csvUrl)}`,
        { headers: { Accept: "text/csv,text/plain,*/*" } },
      );
      if (res.status === 404 && origin === "") continue;
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(msg || `Fetch CSV failed (${res.status})`);
      }
      const truncated = res.headers.get("X-Loom-Truncated") === "1";
      return { text: await res.text(), truncated };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error("CSV fetch failed");
}
