// =================================================================
// USAFacts Data gateway (https://usafacts.org/mcp/) — pure transforms
// =================================================================
// Keyless JSON-RPC proxy (MCP "streamable HTTP", no session) over ~25
// federal sources. Loom POSTs one `tools/call` → `call_source_tool` per
// request; replies arrive as SSE `data:` lines (or plain JSON). The tool
// payload is the agency's own JSON, in `structuredContent` or as text in
// `content[0]`. Errors come back as a tool result with `isError` and
// `{ kind, message, hint, upstream_status, retryable }` — `retryable` is the
// gateway's own advice, so Loom only retries what it says is transient.
//
// Three feeds, all mirrored by src-tauri/src/sources.rs (same calls,
// columns, rounding):
//   usafacts_states      Census ACS 1-year, one row per state-year
//   usafacts_nation      FRED monthly series (BLS, Fed, Census, EIA, Treasury)
//   usafacts_state_jobs  BLS LAUS unemployment, one row per state-month
//
// No fetch / caches here so Vitest covers it; the Worker's network layer
// (retry, per-call memo, durable last-good copy) is in catalog-proxy.ts.
// =================================================================

import type { Columnar } from "./sourceTransforms";

type Json = Record<string, unknown>;

const asObj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Finite number or numeric string only — blank, ".", "-" and non-numbers are null. */
const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const strOrNull = (v: unknown): string | null => {
  if (v == null || typeof v === "object" || typeof v === "boolean") return null;
  const s = String(v);
  return s ? s : null;
};
const roundTo = (n: number, k: number) => Math.round(n * k) / k;

// ---- Gateway envelope -------------------------------------------------------

export const USAFACTS_GATEWAY = "https://data.mcp.usafacts.org/mcp";
/** MCP protocol revision the gateway negotiates (sent as `Mcp-Protocol-Version`). */
export const USAFACTS_PROTOCOL_VERSION = "2025-03-26";

/** JSON-RPC body for one gateway tool call. */
export function usafactsToolCall(sourceId: string, toolName: string, args: Json, id = 1): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "call_source_tool", arguments: { source_id: sourceId, tool_name: toolName, arguments: args } },
  });
}

/** A gateway, tool, or transport failure, carrying whether trying again could help. */
export class UsafactsError extends Error {
  readonly kind: string;
  readonly retryable: boolean;
  readonly upstreamStatus: number | null;
  /** The agency's own error body, when the gateway passes it on (e.g. "unknown variable 'X'"). */
  readonly detail: string | null;
  constructor(message: string, opts: { kind?: string; retryable?: boolean; upstreamStatus?: number | null; detail?: string | null } = {}) {
    super(message);
    this.name = "UsafactsError";
    this.kind = opts.kind ?? "error";
    this.retryable = opts.retryable ?? false;
    this.upstreamStatus = opts.upstreamStatus ?? null;
    this.detail = opts.detail ?? null;
  }
  /** The agency has nothing for these arguments — e.g. an ACS vintage that isn't released yet. */
  get notFound(): boolean {
    return this.kind === "upstream_rejected" && this.upstreamStatus === 404;
  }
}

/** Gateway HTTP statuses worth one more try (rate limit, overload, edge hiccup). */
export function usafactsRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Gateway reply text → the tool payload; throws `UsafactsError("USAFacts <kind>: …")` on any error shape. */
export function usafactsPayload(text: string): unknown {
  const dataLines = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  const raw = dataLines.length ? dataLines[dataLines.length - 1]! : text.trim();
  let msg: Json;
  try {
    msg = asObj(JSON.parse(raw));
  } catch {
    // An HTML error page from an edge in front of the gateway is usually transient.
    throw new UsafactsError("USAFacts: unreadable reply", { kind: "unreadable", retryable: true });
  }
  if (msg.error) {
    const err = asObj(msg.error);
    const code = numOrNull(err.code);
    // -32603 internal / -32000…-32099 server-defined → transient; -326xx request errors are ours.
    const retryable = code != null && (code === -32603 || (code <= -32000 && code >= -32099));
    throw new UsafactsError(`USAFacts: ${String(err.message ?? "gateway error").slice(0, 200)}`, { kind: "jsonrpc", retryable });
  }
  const result = asObj(msg.result);
  let payload: unknown = result.structuredContent;
  if (payload == null) {
    const t = asObj(asArr(result.content)[0]).text;
    if (typeof t === "string") {
      try {
        payload = JSON.parse(t);
      } catch {
        payload = null;
      }
    }
  }
  const p = asObj(payload);
  const errorShape = typeof p.kind === "string" && typeof p.message === "string" && !("results" in p) && !("observations" in p) && !("Results" in p);
  if (result.isError || errorShape) {
    const upstreamStatus = numOrNull(p.upstream_status);
    const retryable = typeof p.retryable === "boolean" ? p.retryable : upstreamStatus != null && usafactsRetryableStatus(upstreamStatus);
    throw new UsafactsError(`USAFacts ${String(p.kind ?? "error")}: ${String(p.message ?? "tool failed").slice(0, 200)}`, {
      kind: typeof p.kind === "string" ? p.kind : "error",
      retryable,
      upstreamStatus,
      detail: typeof p.upstream_body === "string" ? p.upstream_body.slice(0, 300) : null,
    });
  }
  if (payload == null) throw new UsafactsError("USAFacts: empty payload", { kind: "empty" });
  return payload;
}

/**
 * The variable Census refused ("error: unknown variable 'B15003_024E'"), so the call can be
 * retried without it — the 2025 ACS renumbered B15003, which took a whole vintage down.
 */
export function acsUnknownVariable(e: unknown): string | null {
  if (!(e instanceof UsafactsError) || e.upstreamStatus !== 400) return null;
  return /unknown variable '([A-Za-z0-9_]+)'/.exec(e.detail ?? "")?.[1] ?? null;
}

/** Tiny stable hash (FNV-1a, hex) for memo keys — changes when a request shape changes. */
export function usafactsHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ---- States: FIPS, USPS, names, Census regions --------------------------------

export type CensusRegion = "Northeast" | "Midwest" | "South" | "West" | "Puerto Rico";

/** [FIPS, USPS, name, Census region] for the 50 states, DC and Puerto Rico (as ACS 1-year and LAUS return them). */
export const US_STATES: readonly (readonly [string, string, string, CensusRegion])[] = [
  ["01", "AL", "Alabama", "South"], ["02", "AK", "Alaska", "West"], ["04", "AZ", "Arizona", "West"],
  ["05", "AR", "Arkansas", "South"], ["06", "CA", "California", "West"], ["08", "CO", "Colorado", "West"],
  ["09", "CT", "Connecticut", "Northeast"], ["10", "DE", "Delaware", "South"], ["11", "DC", "District of Columbia", "South"],
  ["12", "FL", "Florida", "South"], ["13", "GA", "Georgia", "South"], ["15", "HI", "Hawaii", "West"],
  ["16", "ID", "Idaho", "West"], ["17", "IL", "Illinois", "Midwest"], ["18", "IN", "Indiana", "Midwest"],
  ["19", "IA", "Iowa", "Midwest"], ["20", "KS", "Kansas", "Midwest"], ["21", "KY", "Kentucky", "South"],
  ["22", "LA", "Louisiana", "South"], ["23", "ME", "Maine", "Northeast"], ["24", "MD", "Maryland", "South"],
  ["25", "MA", "Massachusetts", "Northeast"], ["26", "MI", "Michigan", "Midwest"], ["27", "MN", "Minnesota", "Midwest"],
  ["28", "MS", "Mississippi", "South"], ["29", "MO", "Missouri", "Midwest"], ["30", "MT", "Montana", "West"],
  ["31", "NE", "Nebraska", "Midwest"], ["32", "NV", "Nevada", "West"], ["33", "NH", "New Hampshire", "Northeast"],
  ["34", "NJ", "New Jersey", "Northeast"], ["35", "NM", "New Mexico", "West"], ["36", "NY", "New York", "Northeast"],
  ["37", "NC", "North Carolina", "South"], ["38", "ND", "North Dakota", "Midwest"], ["39", "OH", "Ohio", "Midwest"],
  ["40", "OK", "Oklahoma", "South"], ["41", "OR", "Oregon", "West"], ["42", "PA", "Pennsylvania", "Northeast"],
  ["44", "RI", "Rhode Island", "Northeast"], ["45", "SC", "South Carolina", "South"], ["46", "SD", "South Dakota", "Midwest"],
  ["47", "TN", "Tennessee", "South"], ["48", "TX", "Texas", "South"], ["49", "UT", "Utah", "West"],
  ["50", "VT", "Vermont", "Northeast"], ["51", "VA", "Virginia", "South"], ["53", "WA", "Washington", "West"],
  ["54", "WV", "West Virginia", "South"], ["55", "WI", "Wisconsin", "Midwest"], ["56", "WY", "Wyoming", "West"],
  ["72", "PR", "Puerto Rico", "Puerto Rico"],
];

/** 2-digit state FIPS → USPS code. */
export const STATE_FIPS_ABBR: Record<string, string> = Object.fromEntries(US_STATES.map(([f, a]) => [f, a]));
const STATE_BY_FIPS = new Map(US_STATES.map((s) => [s[0], s]));
const STATE_BY_ABBR = new Map(US_STATES.map((s) => [s[1], s]));

// ---- usafacts_states: Census ACS 1-year, one row per state-year --------------

/**
 * Detailed-table variables (stable across vintages, unlike subject / profile ids).
 * Education comes from B06009 (place of birth by attainment), whose lines kept their ids
 * when the 2025 ACS renumbered B15003; Puerto Rico publishes it as B06009PR.
 * B23025 starts with the 2012 vintage, so the panel does too.
 */
export const ACS_STATE_VARS = [
  "NAME",
  "B01003_001E", // total population
  "B19013_001E", // median household income (inflation-adjusted to that year's dollars)
  "B01002_001E", // median age
  "B17001_001E", // poverty universe
  "B17001_002E", // below poverty
  "B06009_001E", // population 25+ (states, DC)
  "B06009_005E", // bachelor's
  "B06009_006E", // graduate or professional
  "B06009PR_001E", // same three for Puerto Rico
  "B06009PR_005E",
  "B06009PR_006E",
  "B23025_003E", // civilian labor force
  "B23025_005E", // unemployed
] as const;

export const ACS_FIRST_YEAR = 2012;

/** Registry order. Later columns were appended (2026-11) so older indices stay put. */
export const USAFACTS_STATES_COLUMNS = [
  "state_fips", "state_abbr", "state_name", "yr", "population", "median_household_income",
  "poverty_rate", "median_age", "unemployment_rate", "bachelors_or_higher_pct",
  "region", "real_median_income",
  // BEA regional price parities (US = 100) and what income buys at local prices.
  "price_level", "rent_price_level", "income_local_usd", "real_personal_income_pc",
];

/** BEA state × year maps joined into the ACS panel (any may be missing). */
export interface BeaStatePanel {
  rpp?: Map<string, Map<number, number>> | null;
  rent?: Map<string, Map<number, number>> | null;
  rpi?: Map<string, Map<number, number>> | null;
}

/** ACS 1-year vintages to request: 2012 → last calendar year (no 2020 release). Unreleased years just 404. */
export function acsStateYears(now = Date.now()): number[] {
  const last = new Date(now).getUTCFullYear() - 1;
  const out: number[] = [];
  for (let y = ACS_FIRST_YEAR; y <= last; y++) if (y !== 2020) out.push(y);
  return out;
}

/**
 * A vintage older than the newest two is settled: Census doesn't revise it, so a copy
 * can be kept for weeks. The newest two are re-asked daily (one may not exist yet).
 */
export function acsVintageSettled(year: number, now = Date.now()): boolean {
  return year <= new Date(now).getUTCFullYear() - 3;
}

/** FRED call for annual-average CPI-U (the deflator for `real_median_income`). */
export const USAFACTS_CPI_ANNUAL = { series_id: "CPIAUCSL", frequency: "a", observation_start: `${ACS_FIRST_YEAR}-01-01` } as const;

/** FRED annual observations → year → CPI level ("." for a year not finished yet is skipped). */
export function fredAnnualCpi(payload: unknown): Map<number, number> {
  const out = new Map<number, number>();
  for (const o of asArr(asObj(payload).observations)) {
    const ob = asObj(o);
    const y = /^(\d{4})-/.exec(String(ob.date ?? ""))?.[1];
    const v = numOrNull(ob.value);
    if (y && v != null && v > 0) out.set(Number(y), v);
  }
  return out;
}

/** Census jam values (-666666666 etc.) and negatives are "no estimate". */
const acsNum = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n == null || n < 0 ? null : n;
};
const pct = (num: number | null, den: number | null): number | null =>
  num == null || den == null || den <= 0 ? null : roundTo((num / den) * 100, 100);

/**
 * `{ results: [[header…], [row…]…] }` (or the bare 2-D array) per year → wide state-year rows,
 * newest year first. With annual CPI, `real_median_income` restates each year's median income
 * in dollars of the newest vintage that has a CPI level (`meta.dollarsOf`).
 */
export function acsStatesWide(years: { year: number; table: unknown }[], cpi?: Map<number, number> | null, bea?: BeaStatePanel | null): Columnar {
  const vintages = years.map((y) => y.year);
  const dollarsOf = cpi?.size ? Math.max(...vintages.filter((y) => cpi.has(y)), -Infinity) : -Infinity;
  const base = Number.isFinite(dollarsOf) ? cpi!.get(dollarsOf)! : null;
  const rows: unknown[][] = [];
  const seen = new Set<number>();
  for (const { year, table } of years) {
    const grid = asArr(Array.isArray(table) ? table : asObj(table).results);
    const header = asArr(grid[0]).map(String);
    const at = (n: string) => header.indexOf(n);
    const ix = Object.fromEntries([...ACS_STATE_VARS, "state"].map((v) => [v, at(v)])) as Record<string, number>;
    if (ix.state! < 0 || ix.B01003_001E! < 0) continue;
    const deflate = base != null && cpi!.get(year) ? base / cpi!.get(year)! : null;
    for (const r of grid.slice(1)) {
      const cells = asArr(r);
      const get = (v: string) => (ix[v]! >= 0 ? cells[ix[v]!] : undefined);
      const fips = String(get("state") ?? "").padStart(2, "0");
      const st = STATE_BY_FIPS.get(fips);
      if (!st) continue;
      seen.add(year);
      const pop = acsNum(get("B01003_001E"));
      const income = acsNum(get("B19013_001E"));
      const real = income == null || deflate == null ? null : Math.round(income * deflate);
      const priceLevel = beaValueFor(bea?.rpp?.get(fips), year);
      // States and DC fill B06009; Puerto Rico fills B06009PR (the other is null).
      const edu = (t: "B06009" | "B06009PR") => [`${t}_001E`, `${t}_005E`, `${t}_006E`].map((v) => acsNum(get(v)));
      const us = edu("B06009");
      const [adults, bachelors, graduate] = us.every((v) => v != null) ? us : edu("B06009PR");
      rows.push([
        fips,
        st[1],
        strOrNull(get("NAME")) ?? st[2],
        year,
        pop == null ? null : Math.round(pop),
        income,
        pct(acsNum(get("B17001_002E")), acsNum(get("B17001_001E"))),
        acsNum(get("B01002_001E")),
        pct(acsNum(get("B23025_005E")), acsNum(get("B23025_003E"))),
        bachelors == null || graduate == null ? null : pct(bachelors + graduate, adults ?? null),
        st[3],
        real,
        priceLevel,
        beaValueFor(bea?.rent?.get(fips), year),
        // Real income at national-average prices: what the median household's money buys there.
        real == null || priceLevel == null || priceLevel <= 0 ? null : Math.round((real * 100) / priceLevel),
        beaValueFor(bea?.rpi?.get(fips), year),
      ]);
    }
  }
  rows.sort((a, b) => (b[3] as number) - (a[3] as number) || String(a[1]).localeCompare(String(b[1])));
  return {
    columns: USAFACTS_STATES_COLUMNS,
    rows,
    meta: { vintages: [...seen].sort((a, b) => a - b), dollarsOf: base == null ? null : dollarsOf },
  };
}

// ---- usafacts_nation: FRED monthly series ---------------------------------------

/** Government-produced series only — FRED rights-tagged series (UMCSENT, USREC, MORTGAGE30US) are refused by the gateway. */
export const USAFACTS_NATION_SERIES = [
  { column: "unemployment_rate", id: "UNRATE" },
  { column: "inflation_yoy_pct", id: "CPIAUCSL", units: "pc1" },
  { column: "payrolls_k", id: "PAYEMS" },
  { column: "fed_funds_rate", id: "FEDFUNDS" },
  { column: "housing_starts_k", id: "HOUST" },
  { column: "gas_price_usd", id: "GASREGW", frequency: "m" },
  { column: "job_openings_k", id: "JTSJOL" }, // JOLTS, from 2000-12
  { column: "treasury_10y_rate", id: "GS10" },
] as const;

export const USAFACTS_NATION_START = "1990-01-01";

/** Computed here (and in sources.rs), after the series columns. */
export const USAFACTS_NATION_DERIVED = ["jobs_added_k", "decade", "recession"] as const;

export const USAFACTS_NATION_COLUMNS = ["month", "yr", ...USAFACTS_NATION_SERIES.map((s) => s.column), ...USAFACTS_NATION_DERIVED];

/** fredgraph.csv ids for the keyless fallback (monthly series; weekly gas is its own call). */
export const FREDGRAPH_NATION_MONTHLY_IDS = USAFACTS_NATION_SERIES.filter((s) => s.id !== "GASREGW").map((s) => s.id);

/**
 * NBER recessions since 1990, as months after the peak through the trough (FRED USREC's
 * convention — USREC itself is rights-tagged, so the dates live here). Update when NBER
 * announces a new peak or trough: https://www.nber.org/research/business-cycle-dating
 */
export const NBER_RECESSIONS: readonly (readonly [string, string])[] = [
  ["1990-08", "1991-03"],
  ["2001-04", "2001-11"],
  ["2008-01", "2009-06"],
  ["2020-03", "2020-04"],
];

export function nberRecession(month: string): boolean {
  const m = month.slice(0, 7);
  return NBER_RECESSIONS.some(([a, b]) => m >= a && m <= b);
}

const ROUND_BY_COLUMN: Record<string, number> = { inflation_yoy_pct: 100, gas_price_usd: 1000 };

/** "YYYY-MM" one month earlier. */
export function prevMonth(m: string): string {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}

function nationRows(byMonth: Map<string, (number | null)[]>): Columnar {
  const start = USAFACTS_NATION_START.slice(0, 7);
  const payIdx = USAFACTS_NATION_SERIES.findIndex((s) => s.column === "payrolls_k");
  const rows = [...byMonth.entries()]
    .filter(([m, vals]) => m >= start && vals.some((v) => v != null))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, vals]) => {
      const yr = Number(m.slice(0, 4));
      const pay = vals[payIdx];
      const prevPay = byMonth.get(prevMonth(m))?.[payIdx];
      return [
        `${m}-01`,
        yr,
        ...vals.map((v, i) => {
          const k = ROUND_BY_COLUMN[USAFACTS_NATION_SERIES[i]!.column];
          return v == null || !k ? v : Math.round(v * k) / k;
        }),
        pay == null || prevPay == null ? null : roundTo(pay - prevPay, 10),
        `${Math.floor(yr / 10) * 10}s`,
        nberRecession(m) ? "Recession" : "Expansion",
      ];
    });
  return { columns: USAFACTS_NATION_COLUMNS, rows };
}

/** FRED `observations` payload per series (same order as USAFACTS_NATION_SERIES; null = failed) → monthly rows. */
export function fredNationMonthly(payloads: (unknown | null)[]): Columnar {
  const byMonth = new Map<string, (number | null)[]>();
  payloads.forEach((p, i) => {
    if (i >= USAFACTS_NATION_SERIES.length) return;
    for (const o of asArr(asObj(p).observations)) {
      const ob = asObj(o);
      const m = /^(\d{4}-\d{2})-\d{2}$/.exec(String(ob.date ?? ""))?.[1];
      if (!m) continue;
      const v = ob.value === "." ? null : numOrNull(ob.value);
      const vals = byMonth.get(m) ?? Array<number | null>(USAFACTS_NATION_SERIES.length).fill(null);
      vals[i] = v;
      byMonth.set(m, vals);
    }
  });
  return nationRows(byMonth);
}

/** Keep only what the transforms read — FRED payloads shrink ~5× before they're memoized. */
export function compactFredObservations(payload: unknown): { observations: { date: string; value: string }[] } {
  return {
    observations: asArr(asObj(payload).observations).flatMap((o) => {
      const ob = asObj(o);
      return typeof ob.date === "string" ? [{ date: ob.date, value: String(ob.value ?? ".") }] : [];
    }),
  };
}

function parseCsv(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  return { header: (lines[0] ?? "").split(",").map((h) => h.trim()), rows: lines.slice(1).map((l) => l.split(",")) };
}

/**
 * Keyless fallback: fredgraph.csv for the monthly series (levels; it ignores `cosd`
 * when several ids are asked for) + GASREGW averaged to months → one FRED-shaped
 * `observations` payload per series (registry order; null when the CSV lacks it), so
 * the Worker can fill only the series the gateway couldn't return. CPI YoY is computed here.
 */
export function fredGraphNationPayloads(monthlyCsv: string, gasCsv: string): ({ observations: { date: string; value: string }[] } | null)[] {
  const bySeries = new Map<string, Map<string, number | null>>();
  for (const csv of [monthlyCsv, gasCsv]) {
    const { header, rows } = parseCsv(csv);
    for (const r of rows) {
      const m = /^(\d{4}-\d{2})-\d{2}$/.exec(r[0] ?? "")?.[1];
      if (!m) continue;
      header.forEach((h, c) => {
        if (c === 0 || !h) return;
        const series = bySeries.get(h) ?? new Map<string, number | null>();
        series.set(m, numOrNull(r[c]));
        bySeries.set(h, series);
      });
    }
  }
  return USAFACTS_NATION_SERIES.map((s) => {
    const levels = bySeries.get(s.id);
    if (!levels?.size) return null;
    const values = [...levels.entries()].map(([m, v]): [string, number | null] => {
      if (s.id !== "CPIAUCSL") return [m, v];
      const prev = levels.get(`${Number(m.slice(0, 4)) - 1}${m.slice(4)}`);
      return [m, v != null && prev ? (v / prev - 1) * 100 : null];
    });
    return { observations: values.map(([m, v]) => ({ date: `${m}-01`, value: v == null ? "." : String(v) })) };
  });
}

/** The whole economy feed from the keyless fallback alone (tests / desktop parity). */
export function fredGraphNationMonthly(monthlyCsv: string, gasCsv: string): Columnar {
  return fredNationMonthly(fredGraphNationPayloads(monthlyCsv, gasCsv));
}

// ---- usafacts_state_jobs: BLS LAUS, one row per state-month ------------------------

export const USAFACTS_STATE_JOBS_COLUMNS = [
  "month", "yr", "state_fips", "state_abbr", "state_name", "region", "unemployment_rate", "unemployment_change_yoy",
];

/** Calendar years asked for: BLS serves ≤ 20 per query; 19 keeps ≤ 228 months × 52 states under the 12k explore cap. */
export const STATE_JOBS_YEARS = 19;

export function stateJobsYearRange(now = Date.now()): { startyear: string; endyear: string } {
  const end = new Date(now).getUTCFullYear();
  return { startyear: String(end - STATE_JOBS_YEARS + 1), endyear: String(end) };
}

/** LAUS statewide unemployment rate, seasonally adjusted (`LASST` + FIPS + area 0s + measure 03). */
export const blsStateUrSeriesId = (fips: string) => `LASST${fips}0000000000003`;

/** getSeriesData takes ≤ 50 series per call → two calls for 52 states. */
export function blsStateUrBatches(size = 50): string[][] {
  const ids = US_STATES.map(([f]) => blsStateUrSeriesId(f));
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Keep `Results.series[].{seriesID, data[].{year, period, value}}` — drops footnotes and catalog (~10× smaller). */
export function compactBlsSeries(payload: unknown): { Results: { series: { seriesID: string; data: { year: string; period: string; value: string }[] }[] } } {
  const series = asArr(asObj(asObj(payload).Results).series).flatMap((s) => {
    const so = asObj(s);
    if (typeof so.seriesID !== "string") return [];
    return [{
      seriesID: so.seriesID,
      data: asArr(so.data).flatMap((d) => {
        const dob = asObj(d);
        return typeof dob.year === "string" && typeof dob.period === "string"
          ? [{ year: dob.year, period: dob.period, value: String(dob.value ?? "-") }]
          : [];
      }),
    }];
  });
  return { Results: { series } };
}

/** fips → "YYYY-MM" → rate, from whichever upstream answered. */
type StateMonthRates = Map<string, Map<string, number | null>>;

function stateJobsRows(rates: StateMonthRates): Columnar {
  const rows: unknown[][] = [];
  for (const [fips, byMonth] of rates) {
    const st = STATE_BY_FIPS.get(fips);
    if (!st) continue;
    for (const [m, rate] of byMonth) {
      const yearAgo = byMonth.get(`${Number(m.slice(0, 4)) - 1}${m.slice(4)}`);
      rows.push([
        `${m}-01`,
        Number(m.slice(0, 4)),
        fips,
        st[1],
        st[2],
        st[3],
        rate,
        rate == null || yearAgo == null ? null : roundTo(rate - yearAgo, 100),
      ]);
    }
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[3]).localeCompare(String(b[3])));
  return { columns: USAFACTS_STATE_JOBS_COLUMNS, rows };
}

/** BLS getSeriesData payloads (LASST…03 series) → state-month rows, oldest month first. Annual M13 rows are skipped. */
export function blsStateMonthly(payloads: unknown[]): Columnar {
  const rates: StateMonthRates = new Map();
  for (const p of payloads) {
    for (const s of asArr(asObj(asObj(p).Results).series)) {
      const so = asObj(s);
      // LA + S(easonally adjusted) + area "ST" + FIPS + 11 zeros + measure 03 (unemployment rate).
      const fips = /^LASST(\d{2})0{11}03$/.exec(String(so.seriesID ?? ""))?.[1];
      if (!fips || !STATE_BY_FIPS.has(fips)) continue;
      const byMonth = rates.get(fips) ?? new Map<string, number | null>();
      for (const d of asArr(so.data)) {
        const dob = asObj(d);
        const mo = /^M(0[1-9]|1[0-2])$/.exec(String(dob.period ?? ""))?.[1];
        const y = /^\d{4}$/.exec(String(dob.year ?? ""))?.[0];
        if (!mo || !y) continue;
        byMonth.set(`${y}-${mo}`, numOrNull(dob.value));
      }
      rates.set(fips, byMonth);
    }
  }
  return stateJobsRows(rates);
}

/** fredgraph.csv ids for the keyless fallback — FRED mirrors LAUS as `{USPS}UR` (DCUR, PRUR included). */
export function fredGraphStateIdBatches(size = 26): string[][] {
  const ids = US_STATES.map(([, a]) => `${a}UR`);
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Keyless fallback: fredgraph.csv (`observation_date,ALUR,…`) per batch → the same rows, from `startYear`. */
export function fredGraphStateMonthly(csvs: string[], startYear: number): Columnar {
  const rates: StateMonthRates = new Map();
  for (const csv of csvs) {
    const { header, rows } = parseCsv(csv);
    const fipsAt = header.map((h) => STATE_BY_ABBR.get(/^([A-Z]{2})UR$/.exec(h)?.[1] ?? "")?.[0]);
    for (const r of rows) {
      const m = /^(\d{4}-\d{2})-\d{2}$/.exec(r[0] ?? "")?.[1];
      if (!m || Number(m.slice(0, 4)) < startYear) continue;
      fipsAt.forEach((fips, c) => {
        if (!fips || c === 0) return;
        const byMonth = rates.get(fips) ?? new Map<string, number | null>();
        byMonth.set(m, numOrNull(r[c]));
        rates.set(fips, byMonth);
      });
    }
  }
  return stateJobsRows(rates);
}

// ---- Shared: CSV guard for fredgraph fallbacks ------------------------------------

/** fredgraph.csv answers some multi-series requests with a ZIP — never parse that as CSV. */
export function fredGraphLooksLikeCsv(text: string): boolean {
  return !text.startsWith("PK") && /^﻿?observation_date,|^﻿?DATE,/i.test(text);
}

// ---- usafacts_budget / usafacts_budget_lines: Monthly Treasury Statement ----------
// MTS Table 9 ("receipts by source, outlays by function"), monthly since 2015-03,
// plus the average interest rate on marketable debt. One upstream query feeds a wide
// table (totals, 12-month sums, ratios) and a long one (one row per line per month).

export interface Mts9Line {
  code: number;
  flow: "Receipts" | "Outlays";
  /** Name in the long table ("Total" rows only feed the wide table). */
  line: string;
  /** Column in the wide table, if it has one. */
  column: string | null;
  total?: boolean;
}

export const MTS9_LINES: readonly Mts9Line[] = [
  { code: 20, flow: "Receipts", line: "Individual income taxes", column: "individual_income_tax_b" },
  { code: 30, flow: "Receipts", line: "Corporate income taxes", column: "corporate_income_tax_b" },
  { code: 50, flow: "Receipts", line: "Payroll taxes", column: "payroll_tax_b" },
  { code: 80, flow: "Receipts", line: "Excise taxes", column: null },
  { code: 100, flow: "Receipts", line: "Customs duties (tariffs)", column: "customs_duties_b" },
  { code: 120, flow: "Receipts", line: "Total", column: "receipts_b", total: true },
  { code: 140, flow: "Outlays", line: "National defense", column: "defense_b" },
  { code: 240, flow: "Outlays", line: "Health (Medicaid and other)", column: "health_b" },
  { code: 250, flow: "Outlays", line: "Medicare", column: "medicare_b" },
  { code: 260, flow: "Outlays", line: "Income security", column: null },
  { code: 270, flow: "Outlays", line: "Social Security", column: "social_security_b" },
  { code: 280, flow: "Outlays", line: "Veterans", column: null },
  { code: 320, flow: "Outlays", line: "Net interest", column: "net_interest_b" },
  { code: 340, flow: "Outlays", line: "Total", column: "outlays_b", total: true },
];

export const MTS9_FIELDS = "record_date,line_code_nbr,current_month_rcpt_outly_amt";
export const MTS9_FILTER = `line_code_nbr:in:(${MTS9_LINES.map((l) => l.code).join(",")})`;
export const AVG_RATES_FILTER = "security_desc:eq:Total Marketable";
export const AVG_RATES_FIELDS = "record_date,security_desc,avg_interest_rate_amt";
/** Direct Fiscal Data URLs (keyless) — the fallback when the gateway can't answer. */
export const FISCALDATA_MTS9_URL =
  `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/mts/mts_table_9?fields=${MTS9_FIELDS}&filter=${encodeURIComponent(MTS9_FILTER)}&sort=record_date&page%5Bsize%5D=10000`;
export const FISCALDATA_AVG_RATES_URL =
  `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?fields=${AVG_RATES_FIELDS}&filter=${encodeURIComponent(AVG_RATES_FILTER)}&sort=record_date&page%5Bsize%5D=10000`;

/** Fiscal year of a "YYYY-MM" month (October starts the next fiscal year). */
export function fiscalYear(month: string): number {
  const y = Number(month.slice(0, 4));
  return Number(month.slice(5, 7)) >= 10 ? y + 1 : y;
}

const billions = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n == null ? null : roundTo(n / 1e9, 100);
};

/** Fiscal Data pages (`{ data: [{ record_date, line_code_nbr, current_month_rcpt_outly_amt }] }`) → month → code → $B. */
export function mtsMonths(pages: unknown[]): Map<string, Map<number, number | null>> {
  const out = new Map<string, Map<number, number | null>>();
  for (const page of pages) {
    for (const r of asArr(asObj(page).data)) {
      const ro = asObj(r);
      const m = /^(\d{4}-\d{2})-\d{2}$/.exec(String(ro.record_date ?? ""))?.[1];
      const code = numOrNull(ro.line_code_nbr);
      if (!m || code == null) continue;
      const byCode = out.get(m) ?? new Map<number, number | null>();
      byCode.set(code, billions(ro.current_month_rcpt_outly_amt));
      out.set(m, byCode);
    }
  }
  return out;
}

/** Average interest rate on total marketable debt by month (%). */
export function avgRateByMonth(page: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of asArr(asObj(page).data)) {
    const ro = asObj(r);
    if (ro.security_desc != null && ro.security_desc !== "Total Marketable") continue;
    const m = /^(\d{4}-\d{2})-\d{2}$/.exec(String(ro.record_date ?? ""))?.[1];
    const v = numOrNull(ro.avg_interest_rate_amt);
    if (m && v != null) out.set(m, v);
  }
  return out;
}

/** Sum of the 12 months ending at `month`, or null unless all 12 are present. */
function trailing12(series: Map<string, number | null>, month: string): number | null {
  let m = month;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const v = series.get(m);
    if (v == null) return null;
    sum += v;
    m = prevMonth(m);
  }
  return roundTo(sum, 100);
}

export const USAFACTS_BUDGET_COLUMNS = [
  "month", "fy", "receipts_b", "outlays_b", "deficit_b",
  "individual_income_tax_b", "corporate_income_tax_b", "payroll_tax_b", "customs_duties_b",
  "defense_b", "net_interest_b", "social_security_b", "medicare_b", "health_b",
  "avg_interest_rate_pct",
  "receipts_ttm_b", "outlays_ttm_b", "deficit_ttm_b", "net_interest_ttm_b", "defense_ttm_b", "customs_ttm_b",
  "interest_share_pct",
];

/** Wide monthly budget: totals, key lines, 12-month sums and interest's share of revenue. Oldest month first. */
export function budgetMonthly(pages: unknown[], ratesPage: unknown | null): Columnar {
  const months = mtsMonths(pages);
  const rates = ratesPage == null ? new Map<string, number>() : avgRateByMonth(ratesPage);
  const series = (code: number) => new Map([...months].map(([m, byCode]) => [m, byCode.get(code) ?? null]));
  const receipts = series(120);
  const outlays = series(340);
  const deficit = new Map([...months.keys()].map((m) => {
    const r = receipts.get(m);
    const o = outlays.get(m);
    return [m, r == null || o == null ? null : roundTo(o - r, 100)] as const;
  }));
  const interest = series(320);
  const defense = series(140);
  const customs = series(100);
  const rows = [...months.keys()].sort().map((m) => {
    const byCode = months.get(m)!;
    const col = (code: number) => byCode.get(code) ?? null;
    const recTtm = trailing12(receipts, m);
    const intTtm = trailing12(interest, m);
    return [
      `${m}-01`,
      fiscalYear(m),
      col(120), col(340), deficit.get(m) ?? null,
      col(20), col(30), col(50), col(100),
      col(140), col(320), col(270), col(250), col(240),
      rates.get(m) ?? null,
      recTtm, trailing12(outlays, m), trailing12(deficit, m), intTtm, trailing12(defense, m), trailing12(customs, m),
      recTtm == null || intTtm == null || recTtm <= 0 ? null : roundTo((intTtm / recTtm) * 100, 100),
    ];
  });
  return { columns: USAFACTS_BUDGET_COLUMNS, rows };
}

export const USAFACTS_BUDGET_LINES_COLUMNS = ["month", "fy", "flow", "line", "amount_b", "amount_ttm_b", "share_ttm_pct"];

/**
 * Long monthly budget: one row per receipt source / spending function per month, plus
 * "Other receipts" / "Other outlays" so each month's lines add up to its totals.
 */
export function budgetLines(pages: unknown[]): Columnar {
  const months = mtsMonths(pages);
  const sorted = [...months.keys()].sort();
  type Entry = { flow: Mts9Line["flow"]; line: string; values: Map<string, number | null> };
  const entries: Entry[] = [];
  for (const flow of ["Receipts", "Outlays"] as const) {
    const lines = MTS9_LINES.filter((l) => l.flow === flow && !l.total);
    const total = MTS9_LINES.find((l) => l.flow === flow && l.total)!;
    for (const l of lines) entries.push({ flow, line: l.line, values: new Map(sorted.map((m) => [m, months.get(m)!.get(l.code) ?? null])) });
    entries.push({
      flow,
      line: flow === "Receipts" ? "Other receipts" : "Other outlays",
      values: new Map(sorted.map((m) => {
        const byCode = months.get(m)!;
        const t = byCode.get(total.code);
        const parts = lines.map((l) => byCode.get(l.code));
        return [m, t == null || parts.some((p) => p == null) ? null : roundTo(t - parts.reduce<number>((s, p) => s + p!, 0), 100)];
      })),
    });
  }
  const flowTtm = new Map<string, number | null>();
  const rows: unknown[][] = [];
  for (const m of sorted) {
    for (const flow of ["Receipts", "Outlays"] as const) {
      const ttms = entries.filter((e) => e.flow === flow).map((e) => trailing12(e.values, m));
      flowTtm.set(`${flow}|${m}`, ttms.some((t) => t == null) ? null : ttms.reduce<number>((s, t) => s + t!, 0));
    }
    for (const e of entries) {
      const ttm = trailing12(e.values, m);
      const whole = flowTtm.get(`${e.flow}|${m}`);
      rows.push([
        `${m}-01`,
        fiscalYear(m),
        e.flow,
        e.line,
        e.values.get(m) ?? null,
        ttm,
        ttm == null || whole == null || whole <= 0 ? null : roundTo((ttm / whole) * 100, 100),
      ]);
    }
  }
  return { columns: USAFACTS_BUDGET_LINES_COLUMNS, rows };
}

/** Fiscal Data payload with at least one row. */
export function fiscalDataHasRows(p: unknown): boolean {
  return asArr(asObj(p).data).length > 0;
}

// ---- usafacts_household: household finances, quarter by quarter (FRED) -------------

/** Government-produced quarterly (or quarter-averaged) series. `scale` divides the raw value. */
export const USAFACTS_HOUSEHOLD_SERIES = [
  { column: "saving_rate_pct", id: "PSAVERT" },
  { column: "card_delinquency_pct", id: "DRCCLACBS" },
  { column: "consumer_delinquency_pct", id: "DRCLACBS" },
  { column: "mortgage_delinquency_pct", id: "DRSFRMACBS" },
  { column: "debt_service_pct", id: "TDSP" },
  { column: "revolving_credit_b", id: "REVOLSL", scale: 1000 },
  { column: "median_home_price_usd", id: "MSPUS" },
  { column: "median_weekly_earnings_usd", id: "LES1252881500Q" },
  { column: "real_disposable_income_pc", id: "A229RX0" },
  { column: "homeownership_pct", id: "RHORUSQ156N" },
  { column: "rental_vacancy_pct", id: "RRVRUSQ156N" },
  { column: "prime_age_employment_pct", id: "LNS12300060" },
  { column: "labor_force_participation_pct", id: "CIVPART" },
  { column: "initial_claims_k", id: "ICSA", scale: 1000 },
] as const;

export const USAFACTS_HOUSEHOLD_START = "1990-01-01";

export const USAFACTS_HOUSEHOLD_COLUMNS = [
  "quarter", "yr", ...USAFACTS_HOUSEHOLD_SERIES.map((s) => s.column), "home_price_years_of_pay", "decade", "recession",
];

/** A quarter is a recession quarter when any of its months is an NBER recession month. */
export function quarterInRecession(quarterStart: string): boolean {
  let m = quarterStart.slice(0, 7);
  for (let i = 0; i < 3; i++) {
    if (nberRecession(m)) return true;
    const y = Number(m.slice(0, 4));
    const mo = Number(m.slice(5, 7));
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  return false;
}

/** FRED arguments: quarterly, averaged within the quarter (monthly / weekly series). */
export function householdFredArgs(id: string): Record<string, string> {
  return { series_id: id, observation_start: USAFACTS_HOUSEHOLD_START, frequency: "q", aggregation_method: "avg" };
}

/** Keyless fallback URL for one series (fredgraph answers multi-series quarterly asks with a ZIP). */
export function householdFredGraphUrl(id: string): string {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${USAFACTS_HOUSEHOLD_START}&fq=Quarterly&fam=avg`;
}

/** One fredgraph CSV (`observation_date,ID`) → a FRED-shaped observations payload. */
export function fredGraphObservations(csv: string, id: string): { observations: { date: string; value: string }[] } | null {
  if (!fredGraphLooksLikeCsv(csv)) return null;
  const { header, rows } = parseCsv(csv);
  const c = header.indexOf(id);
  if (c < 0) return null;
  return {
    observations: rows.flatMap((r) => (/^\d{4}-\d{2}-\d{2}$/.test(r[0] ?? "") ? [{ date: r[0]!, value: (r[c] ?? "").trim() || "." }] : [])),
  };
}

/** Per-series FRED payloads (USAFACTS_HOUSEHOLD_SERIES order; null = missing) → one row per quarter since 1990. */
export function householdQuarterly(payloads: (unknown | null)[]): Columnar {
  const byQuarter = new Map<string, (number | null)[]>();
  const n = USAFACTS_HOUSEHOLD_SERIES.length;
  payloads.forEach((p, i) => {
    if (i >= n) return;
    const scale = "scale" in USAFACTS_HOUSEHOLD_SERIES[i]! ? (USAFACTS_HOUSEHOLD_SERIES[i] as { scale: number }).scale : 1;
    for (const o of asArr(asObj(p).observations)) {
      const ob = asObj(o);
      const d = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(ob.date ?? ""));
      if (!d) continue;
      // Snap to the quarter's first month (FRED quarterly dates already are).
      const q = `${d[1]}-${String(Math.floor((Number(d[2]) - 1) / 3) * 3 + 1).padStart(2, "0")}`;
      const v = numOrNull(ob.value);
      const vals = byQuarter.get(q) ?? Array<number | null>(n).fill(null);
      vals[i] = v == null ? null : roundTo(v / scale, 100);
      byQuarter.set(q, vals);
    }
  });
  const priceAt = USAFACTS_HOUSEHOLD_SERIES.findIndex((s) => s.id === "MSPUS");
  const payAt = USAFACTS_HOUSEHOLD_SERIES.findIndex((s) => s.id === "LES1252881500Q");
  const rows = [...byQuarter.entries()]
    .filter(([q, vals]) => `${q}-01` >= USAFACTS_HOUSEHOLD_START && vals.some((v) => v != null))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([q, vals]) => {
      const price = vals[priceAt];
      const pay = vals[payAt];
      const yr = Number(q.slice(0, 4));
      return [
        `${q}-01`, yr, ...vals,
        price == null || pay == null || pay <= 0 ? null : roundTo(price / (pay * 52), 100),
        `${Math.floor(yr / 10) * 10}s`,
        quarterInRecession(q) ? "Recession" : "Expansion",
      ];
    });
  return { columns: USAFACTS_HOUSEHOLD_COLUMNS, rows };
}

// ---- BEA regional price parities, joined into usafacts_states ------------------------

/** BEA Regional calls (keyless through the gateway): RPP all items, RPP rents, real per-capita personal income. */
export const BEA_STATE_TABLES = [
  { key: "rpp", TableName: "SARPP", LineCode: "1" },
  { key: "rent", TableName: "SARPP", LineCode: "3" },
  { key: "rpi", TableName: "SARPI", LineCode: "2" },
] as const;

/** BEA Regional payload → state FIPS → year → value (US total and non-states dropped). */
export function beaStateYears(payload: unknown): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  const data = asArr(asObj(asObj(asObj(payload).BEAAPI).Results).Data);
  for (const d of data) {
    const dob = asObj(d);
    const fips = /^(\d{2})000$/.exec(String(dob.GeoFips ?? ""))?.[1];
    const y = numOrNull(dob.TimePeriod);
    const v = numOrNull(String(dob.DataValue ?? "").replace(/,/g, ""));
    if (!fips || fips === "00" || !STATE_BY_FIPS.has(fips) || y == null || v == null) continue;
    const byYear = out.get(fips) ?? new Map<number, number>();
    byYear.set(y, v);
    out.set(fips, byYear);
  }
  return out;
}

export function beaHasData(p: unknown): boolean {
  return asArr(asObj(asObj(asObj(p).BEAAPI).Results).Data).length > 0;
}

/**
 * The value for `year`, else the newest year before it — at most `carry` years back
 * (BEA publishes a year after ACS, so the newest vintage borrows last year's price level).
 */
export function beaValueFor(byYear: Map<number, number> | undefined, year: number, carry = 1): number | null {
  if (!byYear) return null;
  for (let y = year; y >= year - carry; y--) if (byYear.has(y)) return byYear.get(y)!;
  return null;
}

/** Keep only what `beaStateYears` reads (drops notes, units and the citation). */
export function compactBea(payload: unknown): { BEAAPI: { Results: { Data: { GeoFips: string; TimePeriod: string; DataValue: string }[] } } } {
  const data = asArr(asObj(asObj(asObj(payload).BEAAPI).Results).Data).flatMap((d) => {
    const dob = asObj(d);
    return typeof dob.GeoFips === "string" && dob.TimePeriod != null && dob.DataValue != null
      ? [{ GeoFips: dob.GeoFips, TimePeriod: String(dob.TimePeriod), DataValue: String(dob.DataValue) }]
      : [];
  });
  return { BEAAPI: { Results: { Data: data } } };
}

/** Keep only Fiscal Data `data` rows (drops meta / links / citation). */
export function compactFiscalData(payload: unknown): { data: unknown[] } {
  return { data: asArr(asObj(payload).data) };
}
