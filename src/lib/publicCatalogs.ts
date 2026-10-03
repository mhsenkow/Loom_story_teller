// =================================================================
// Loom — Public data catalogs: Socrata (city & state portals) + TidyTuesday
// =================================================================
// Pure URL building / response parsing plus thin fetchers. Both upstreams
// send `Access-Control-Allow-Origin: *`, so the browser (and the Tauri
// webview) search them directly; the CSV itself still goes through the
// remote-CSV path (`/api/fetch-csv` on web, Save to folder on desktop).
// =================================================================

import { WEB_CSV_CELL_BUDGET, parseCsvRecords } from "./mock-data";

// ---- Socrata Discovery API ------------------------------------------------

export const SOCRATA_DISCOVERY_URL = "https://api.us.socrata.com/api/catalog/v1";

export type SocrataSort = "relevance" | "popular" | "updated";

export interface SocrataSearchOptions {
  query?: string;
  /** Restrict to one portal, e.g. `data.cityofnewyork.us`. */
  domain?: string;
  sort?: SocrataSort;
  limit?: number;
}

export interface SocrataDataset {
  /** Four-by-four id, e.g. `erm2-nwe9`. */
  id: string;
  /** Portal host, e.g. `data.cityofnewyork.us`. */
  domain: string;
  name: string;
  description?: string;
  /** ISO timestamp of the last data (or metadata) update. */
  updatedAt?: string;
  /** Exported columns (system `:@computed_region…` fields excluded). */
  columnCount: number;
  attribution?: string;
  category?: string;
  pageViewsLastMonth?: number;
  permalink: string;
}

/** Portals worth a shortcut; every other Socrata domain is still searchable. */
export const SOCRATA_PORTALS: { domain: string; label: string }[] = [
  { domain: "data.cityofnewyork.us", label: "New York City" },
  { domain: "data.cityofchicago.org", label: "Chicago" },
  { domain: "data.sfgov.org", label: "San Francisco" },
  { domain: "data.seattle.gov", label: "Seattle" },
  { domain: "data.lacity.org", label: "Los Angeles" },
  { domain: "datahub.austintexas.gov", label: "Austin" },
  { domain: "www.dallasopendata.com", label: "Dallas" },
  { domain: "data.ny.gov", label: "New York State" },
  { domain: "data.wa.gov", label: "Washington State" },
  { domain: "data.cdc.gov", label: "CDC" },
];

/** Starter searches for phones (one tap → results). */
export const SOCRATA_SUGGESTIONS = ["311", "trees", "crashes", "restaurant inspections", "permits", "crime"];

/** Rows requested per export — SODA's default is only 1,000. */
export const SOCRATA_MAX_ROWS = 50_000;
/**
 * Cells requested per export. Below the in-browser budget on purpose: a wide
 * 44-column 311 export at the full budget is ~28 MB and 15 s through the proxy.
 */
export const SOCRATA_CELL_TARGET = Math.min(WEB_CSV_CELL_BUDGET, 1_000_000);

const FOUR_BY_FOUR = /^[a-z0-9]{4}-[a-z0-9]{4}$/;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function cleanQuery(q?: string): string | undefined {
  const s = q?.trim();
  if (!s || s.length > 200 || /[\r\n]/.test(s)) return undefined;
  return s;
}

export function socrataSearchUrl(opts: SocrataSearchOptions = {}): string {
  const url = new URL(SOCRATA_DISCOVERY_URL);
  const q = cleanQuery(opts.query);
  if (q) url.searchParams.set("q", q);
  url.searchParams.set("only", "dataset");
  const domain = opts.domain?.trim().toLowerCase();
  if (domain && HOSTNAME.test(domain)) url.searchParams.set("domains", domain);
  const sort = opts.sort ?? "relevance";
  // Without a query, "relevance" has nothing to rank on — show what people use.
  if (sort === "popular" || (!q && sort === "relevance")) url.searchParams.set("order", "page_views_last_month");
  else if (sort === "updated") url.searchParams.set("order", "updatedAt");
  url.searchParams.set("limit", String(Math.min(100, Math.max(1, Math.round(opts.limit ?? 30)))));
  return url.toString();
}

/** Strip HTML / markdown noise and collapse whitespace for a one-line clamp. */
export function plainDescription(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[*_#`>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s || undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Parse a Discovery API body into tabular, CSV-exportable datasets. */
export function parseSocrataSearch(body: unknown): SocrataDataset[] {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) throw new Error("Unexpected Socrata payload (missing results)");
  const out: SocrataDataset[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const res = r.resource as Record<string, unknown> | undefined;
    const meta = r.metadata as Record<string, unknown> | undefined;
    if (!res || !meta) continue;
    const id = str(res.id);
    const domain = str(meta.domain)?.toLowerCase();
    const name = str(res.name);
    if (!id || !FOUR_BY_FOUR.test(id) || !domain || !HOSTNAME.test(domain) || !name) continue;
    // Maps, charts, filtered views, file attachments and external links have no SODA CSV.
    if (res.type !== undefined && res.type !== "dataset") continue;
    if (res.lens_view_type !== undefined && res.lens_view_type !== "tabular") continue;
    if (typeof res.blob_mime_type === "string" && res.blob_mime_type) continue;
    const key = `${domain}/${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fields = Array.isArray(res.columns_field_name) ? res.columns_field_name : [];
    const columnCount = fields.filter((f) => typeof f === "string" && !f.startsWith(":")).length;
    const pv = res.page_views as Record<string, unknown> | undefined;
    const cls = r.classification as Record<string, unknown> | undefined;
    out.push({
      id,
      domain,
      name,
      description: plainDescription(res.description),
      updatedAt: str(res.data_updated_at) ?? str(res.updatedAt),
      columnCount,
      attribution: str(res.attribution),
      category: str(cls?.domain_category),
      pageViewsLastMonth: typeof pv?.page_views_last_month === "number" ? pv.page_views_last_month : undefined,
      permalink: str(r.permalink) ?? `https://${domain}/d/${id}`,
    });
  }
  return out;
}

/** Rows to ask SODA for: fill the cell target, never more than `SOCRATA_MAX_ROWS`. */
export function socrataRowLimit(columnCount: number): number {
  const cols = Math.max(1, columnCount || 20);
  return Math.min(SOCRATA_MAX_ROWS, Math.max(1000, Math.floor(SOCRATA_CELL_TARGET / cols)));
}

/** SODA CSV export, e.g. `https://data.cityofnewyork.us/resource/erm2-nwe9.csv?$limit=22727`. */
export function socrataCsvUrl(ds: Pick<SocrataDataset, "domain" | "id">, limit: number): string {
  if (!HOSTNAME.test(ds.domain) || !FOUR_BY_FOUR.test(ds.id)) throw new Error("Not a Socrata dataset");
  return `https://${ds.domain}/resource/${ds.id}.csv?$limit=${Math.max(1, Math.floor(limit))}`;
}

/** Stable, readable in-browser file name: `311_Service_Requests-erm2-nwe9.csv`. */
export function socrataFileName(ds: Pick<SocrataDataset, "name" | "id">): string {
  const base = ds.name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "dataset";
  return `${base}-${ds.id}.csv`;
}

/** `data.cityofnewyork.us` → `New York City` when it's a known portal, else the host. */
export function socrataPortalLabel(domain: string): string {
  return SOCRATA_PORTALS.find((p) => p.domain === domain)?.label ?? domain.replace(/^www\./, "");
}

export async function searchSocrata(
  opts: SocrataSearchOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<SocrataDataset[]> {
  const res = await fetchImpl(socrataSearchUrl(opts), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Socrata search returned ${res.status}`);
  return parseSocrataSearch(await res.json());
}

// ---- TidyTuesday ----------------------------------------------------------

export const TIDYTUESDAY_RAW = "https://raw.githubusercontent.com/rfordatascience/tidytuesday/main";
export const TIDYTUESDAY_INDEX_URL = `${TIDYTUESDAY_RAW}/static/tt_data_type.csv`;
export const TIDYTUESDAY_HOME = "https://github.com/rfordatascience/tidytuesday";

export interface TidyTuesdayFile {
  name: string;
  url: string;
  /** In-browser file name, unique across weeks (`tt_2024-08-06_olympics.csv`). */
  loomName: string;
  format: "csv" | "tsv";
}

export interface TidyTuesdayWeek {
  /** Release date, `YYYY-MM-DD`. */
  date: string;
  /** Folder year (a late-December week can live under the next year). */
  year: number;
  week: number;
  files: TidyTuesdayFile[];
  title?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `data/<year>/<date>/<file>` — verified for every csv/tsv in the index (2018–2026). */
export function tidyTuesdayFileUrl(year: number, date: string, file: string): string {
  return `${TIDYTUESDAY_RAW}/data/${year}/${date}/${encodeURIComponent(file)}`;
}

export function tidyTuesdayWeekUrl(week: Pick<TidyTuesdayWeek, "year" | "date">): string {
  return `${TIDYTUESDAY_HOME}/tree/main/data/${week.year}/${week.date}`;
}

function tidyFormat(file: string, dataType: string): "csv" | "tsv" | null {
  const f = file.toLowerCase();
  // `.csv.gz` (type "vgz"), xlsx, rds, zip and NA rows are skipped.
  if (f.endsWith(".tsv")) return "tsv";
  if (f.endsWith(".csv") || f.endsWith(".txt")) {
    const t = dataType.toLowerCase();
    return t === "csv" || t === "tsv" ? (t as "csv" | "tsv") : null;
  }
  return null;
}

/**
 * Parse `static/tt_data_type.csv` (Week, Date, year, data_files, data_type, delim)
 * into weeks with loadable files, newest first. Delimiters are sniffed when the
 * file is parsed, so the index's `delim` column (often NA) isn't trusted.
 */
export function parseTidyTuesdayIndex(csvText: string): TidyTuesdayWeek[] {
  const records = parseCsvRecords(csvText);
  if (records.length < 2) return [];
  const header = records[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iWeek = col("week");
  const iDate = col("date");
  const iYear = col("year");
  const iFile = col("data_files");
  const iType = col("data_type");
  if (iDate < 0 || iYear < 0 || iFile < 0) throw new Error("Unexpected TidyTuesday index columns");

  const byDate = new Map<string, TidyTuesdayWeek>();
  for (const rec of records.slice(1)) {
    const date = (rec[iDate] ?? "").trim();
    const year = Number((rec[iYear] ?? "").trim());
    const file = (rec[iFile] ?? "").trim();
    const type = iType >= 0 ? (rec[iType] ?? "").trim() : "csv";
    if (!ISO_DATE.test(date) || !Number.isFinite(year) || !file || file === "NA") continue;
    if (file.includes("/") || file.includes("..")) continue;
    const format = tidyFormat(file, type);
    if (!format) continue;
    let week = byDate.get(date);
    if (!week) {
      week = { date, year, week: Number((rec[iWeek] ?? "").trim()) || 0, files: [] };
      byDate.set(date, week);
    }
    if (week.files.some((f) => f.name === file)) continue;
    const stem = file.replace(/\.(csv|tsv|txt)$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "_");
    week.files.push({
      name: file,
      url: tidyTuesdayFileUrl(year, date, file),
      loomName: `tt_${date}_${stem}.csv`,
      format,
    });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function tidyTuesdayYearReadmeUrl(year: number): string {
  return `${TIDYTUESDAY_RAW}/data/${year}/readme.md`;
}

/**
 * Week titles from a year's `readme.md` table (`| Week | Date | [Title](date/readme.md) | …`).
 * Keyed by the linked folder date, the Date cell, and `year#week` — 2018's table
 * dates sometimes differ from the folder by a day.
 */
export function parseTidyTuesdayYearReadme(md: string, year: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of md.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const week = Number(cells[0]);
    const dateCell = cells[1]!;
    if (!Number.isFinite(week) || week <= 0 || !ISO_DATE.test(dateCell)) continue;
    const data = cells[2]!;
    const link = /^\[([^\]]+)\]\(([^)]*)\)/.exec(data);
    const title = (link ? link[1]! : data).replace(/\s+/g, " ").trim();
    if (!title || title === "NA") continue;
    const linkDate = link ? /(\d{4}-\d{2}-\d{2})/.exec(link[2]!)?.[1] : undefined;
    if (linkDate) out[linkDate] = title;
    if (!out[dateCell]) out[dateCell] = title;
    out[`${year}#${week}`] = title;
  }
  return out;
}

export function tidyTuesdayTitle(
  week: Pick<TidyTuesdayWeek, "date" | "year" | "week">,
  titles: Record<string, string>,
): string | undefined {
  return titles[week.date] ?? titles[`${week.year}#${week.week}`];
}

/** Instant filter over date, title, and file names. */
export function filterTidyTuesdayWeeks(
  weeks: TidyTuesdayWeek[],
  text: string,
  titles: Record<string, string> = {},
): TidyTuesdayWeek[] {
  const terms = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return weeks;
  return weeks.filter((w) => {
    const hay = `${w.date} ${tidyTuesdayTitle(w, titles) ?? ""} ${w.files.map((f) => f.name).join(" ")}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export async function fetchTidyTuesdayIndex(fetchImpl: typeof fetch = fetch): Promise<TidyTuesdayWeek[]> {
  const res = await fetchImpl(TIDYTUESDAY_INDEX_URL);
  if (!res.ok) throw new Error(`TidyTuesday index returned ${res.status}`);
  return parseTidyTuesdayIndex(await res.text());
}

export async function fetchTidyTuesdayYearTitles(
  year: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string>> {
  const res = await fetchImpl(tidyTuesdayYearReadmeUrl(year));
  if (!res.ok) throw new Error(`TidyTuesday ${year} readme returned ${res.status}`);
  return parseTidyTuesdayYearReadme(await res.text(), year);
}
