// =================================================================
// Loom — Browser Mock Data
// =================================================================
// When running outside Tauri (plain browser via `make thread`),
// provides synthetic data so the full UI is functional for
// development and demos without the Rust backend.
// =================================================================

import type { FileEntry, ColumnInfo, QueryResult } from "./store";

/** Deterministic demo RNG (LOOM-153) — not used for production ingest. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number, mean: number, std: number): number {
  const u = 1 - rng();
  const v = rng();
  return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

const CATEGORIES = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
const CITIES = ["San Francisco", "New York", "London", "Tokyo", "Berlin", "Paris", "Sydney", "Toronto"];

function generateScatterData(
  n: number,
  rng: () => number,
): { columns: string[]; types: string[]; rows: (string | number | null)[][] } {
  const centers = [
    [20, 30], [-15, 25], [10, -20], [-30, -10],
    [35, -15], [-5, 40], [25, 5], [-20, 35],
  ];
  const rows: (string | number | null)[][] = [];
  for (let i = 0; i < n; i++) {
    const [cx, cy] = centers[i % centers.length];
    const x = Math.round((cx + gaussian(rng, 0, 8)) * 1000) / 1000;
    const y = Math.round((cy + gaussian(rng, 0, 8)) * 1000) / 1000;
    const mag = Math.round(Math.sqrt(x * x + y * y) * 100) / 100;
    rows.push([x, y, CATEGORIES[i % CATEGORIES.length], mag, `pt_${i}`]);
  }
  return {
    columns: ["x", "y", "cluster", "magnitude", "label"],
    types: ["DOUBLE", "DOUBLE", "VARCHAR", "DOUBLE", "VARCHAR"],
    rows,
  };
}

function generateSalesData(
  n: number,
  rng: () => number,
): { columns: string[]; types: string[]; rows: (string | number | null)[][] } {
  const products = ["Widget A", "Widget B", "Gadget Pro", "Sensor V1", "Module X", "Board Rev3"];
  const rows: (string | number | null)[][] = [];
  const base = new Date("2023-01-01").getTime();
  for (let i = 0; i < n; i++) {
    const date = new Date(base + rng() * 63072000000).toISOString().split("T")[0];
    const city = CITIES[Math.floor(rng() * CITIES.length)];
    const product = products[Math.floor(rng() * products.length)];
    const units = Math.floor(rng() * 500) + 1;
    const revenue = Math.round(units * (rng() * 200 + 10) * 100) / 100;
    rows.push([date, city, product, units, revenue]);
  }
  return {
    columns: ["date", "city", "product", "units", "revenue"],
    types: ["DATE", "VARCHAR", "VARCHAR", "INTEGER", "DOUBLE"],
    rows,
  };
}

const DEMO_SEED = 0x10_00_0153;

type DemoBundle = {
  files: FileEntry[];
  data: Record<string, { columns: string[]; types: string[]; rows: (string | number | null)[][] }>;
};

let demoBundle: DemoBundle | null = null;

/** Lazy demo datasets — production import never touches this (LOOM-153). */
export function getDemoBundle(): DemoBundle {
  if (demoBundle) return demoBundle;
  const rng = mulberry32(DEMO_SEED);
  const scatterData = generateScatterData(2000, rng);
  const salesData = generateSalesData(1000, rng);
  demoBundle = {
    files: [
      { path: "mock://scatter.csv", name: "scatter_demo.csv", extension: "csv", row_count: 2000, size_bytes: 98000 },
      { path: "mock://sales.csv", name: "sales_demo.csv", extension: "csv", row_count: 1000, size_bytes: 52000 },
    ],
    data: {
      "mock://scatter.csv": scatterData,
      "mock://sales.csv": salesData,
    },
  };
  return demoBundle;
}

export function getMockFiles(): FileEntry[] {
  return getDemoBundle().files;
}

export function statsFromData(data: {
  columns: string[];
  types: string[];
  rows: (string | number | null)[][];
}): ColumnInfo[] {
  return data.columns.map((name, i) => {
    const type = data.types[i]!;
    const values = data.rows.map((r) => r[i]);
    const nonNull = values.filter((v) => v !== null);
    const distinct = new Set(nonNull.map(String)).size;
    const isNum = ["DOUBLE", "INTEGER", "BIGINT", "FLOAT"].includes(type);
    // One linear pass: numeric order for number columns, string order otherwise
    // (ISO dates sort correctly as strings). Avoids spreading 60k args into Math.min.
    let min: number | string | null = null;
    let max: number | string | null = null;
    for (const v of nonNull) {
      const k = isNum ? Number(v) : String(v);
      if (isNum && Number.isNaN(k)) continue;
      if (min === null || k < min) min = k;
      if (max === null || k > max) max = k;
    }

    return {
      name,
      data_type: type,
      null_count: values.length - nonNull.length,
      distinct_count: distinct,
      min_value: min === null ? null : String(min),
      max_value: max === null ? null : String(max),
    };
  });
}

/**
 * Keep leading-zero codes, oversized digit strings, and named identifier
 * columns as text so ZIP/FIPS/IDs survive ingest → chart → export.
 */
export function looksLikeIdentifierString(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (/^0\d+$/.test(s)) return true;
  // Beyond Number.MAX_SAFE_INTEGER precision (~15–16 digits)
  if (/^\d{16,}$/.test(s)) return true;
  return false;
}

export function columnSuggestsIdentifier(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (/(^|_)(zip|zipcode|postal|fips|geoid|ssn|iban|uuid|guid)(_|$)/i.test(n)) return true;
  if (/(^|_)id$/i.test(n) || /^id(_|$)/i.test(n)) return true;
  if (/(^|_)code$/i.test(n) || /_code_/i.test(n)) return true;
  return false;
}

/**
 * Stable unique column keys for tabular import: trim, blank → col_1…col_n,
 * duplicate names → name_2, name_3 (first occurrence keeps the base name).
 */
export function normalizeTabularHeaders(
  raw: (string | number | null | undefined)[],
): string[] {
  const used = new Set<string>();
  return raw.map((cell, i) => {
    let base = cell == null ? "" : String(cell).trim();
    if (!base) base = `col_${i + 1}`;
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let n = 2;
    while (used.has(`${base}_${n}`)) n += 1;
    const key = `${base}_${n}`;
    used.add(key);
    return key;
  });
}

/** Scalar after parse stage — booleans become 0/1 for numeric inference. */
export type TabularLexeme = string | number | null;

export type TabularIncompatibleCell = {
  row: number;
  column: string;
  value: string;
  inferred_type: "DOUBLE";
};

export type TabularInspectDiagnostics = {
  incompatible_cells: TabularIncompatibleCell[];
  incompatible_count: number;
};

const INCOMPATIBLE_CELL_CAP = 8;

const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Strict ISO date (no epoch heuristics for bare numbers). */
export function looksLikeIsoDateOnly(v: string): boolean {
  const m = v.trim().match(ISO_DATE_ONLY);
  if (!m) return false;
  return isValidCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function looksLikeIsoTimestamp(v: string): boolean {
  const t = v.trim();
  if (looksLikeIsoDateOnly(t)) return true;
  const m = t.match(ISO_TIMESTAMP);
  if (!m) return false;
  return isValidCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** Parse one cell: null/empty rules, finite numbers, booleans → 0/1, trimmed strings. */
export function parseTabularCell(
  raw: string | number | boolean | null | undefined,
): TabularLexeme {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  const v = String(raw).trim();
  if (v === "" || v.toLowerCase() === "null") return null;
  return v;
}

/** Build lexeme matrix without column-type coercion. */
export function parseTabularLexemes(
  columns: string[],
  rawRows: (string | number | boolean | null | undefined)[][],
): TabularLexeme[][] {
  return rawRows.map((values) =>
    columns.map((_, c) => parseTabularCell(values[c])),
  );
}

/** Infer DuckDB-style column types from parsed lexemes. */
export function inferTabularColumnTypes(
  columns: string[],
  lexemes: TabularLexeme[][],
): string[] {
  const idCols = columns.map((name) => columnSuggestsIdentifier(name));
  return columns.map((name, i) => {
    const cells = lexemes.map((r) => r[i] ?? null);
    const nonNull = cells.filter((v) => v !== null);
    if (nonNull.length === 0) return "VARCHAR";
    if (idCols[i]) return "VARCHAR";
    const hasIdentifier = nonNull.some(
      (v) => typeof v === "string" && looksLikeIdentifierString(v),
    );
    if (hasIdentifier) return "VARCHAR";
    const nums = nonNull.filter((v): v is number => typeof v === "number");
    const stringNums = nonNull.filter(
      (v): v is string => typeof v === "string" && coerceCsvNumber(v) != null,
    );
    if (nums.length + stringNums.length > nonNull.length * 0.5) return "DOUBLE";
    const strings = nonNull.filter((v): v is string => typeof v === "string");
    const dateOnlyHits = strings.filter((s) => looksLikeIsoDateOnly(s)).length;
    const timestampHits = strings.filter(
      (s) => looksLikeIsoTimestamp(s) && !looksLikeIsoDateOnly(s),
    ).length;
    if (dateOnlyHits >= nonNull.length * 0.7 && timestampHits === 0) return "DATE";
    if (dateOnlyHits + timestampHits >= nonNull.length * 0.7) return "TIMESTAMP";
    const n = name.toLowerCase();
    if (
      /(amount|award|budget|count|latitude|longitude|lat|lon|year|rate|percent|proportion|households)/i.test(
        n,
      )
    ) {
      if (nums.length + stringNums.length > nonNull.length * 0.4) return "DOUBLE";
    }
    return "VARCHAR";
  });
}

/** Normalize lexemes to output row; track cells that stay text in DOUBLE columns. */
export function normalizeTabularCells(
  columns: string[],
  lexemes: TabularLexeme[][],
  types: string[],
): { rows: (string | number | null)[][]; diagnostics: TabularInspectDiagnostics } {
  const incompatible_cells: TabularIncompatibleCell[] = [];
  let incompatible_count = 0;

  const rows = lexemes.map((values, rowIndex) => {
    const row: (string | number | null)[] = [];
    for (let c = 0; c < columns.length; c++) {
      const raw = values[c];
      if (raw === null) {
        row.push(null);
        continue;
      }
      if (types[c] !== "VARCHAR" && typeof raw === "string" && isNullishCsvToken(raw)) {
        row.push(null);
        continue;
      }
      if (types[c] === "VARCHAR") {
        row.push(String(raw));
        continue;
      }
      if (typeof raw === "number") {
        row.push(raw);
        continue;
      }
      const num = coerceCsvNumber(String(raw));
      if (num !== null) {
        row.push(num);
        continue;
      }
      incompatible_count += 1;
      if (incompatible_cells.length < INCOMPATIBLE_CELL_CAP) {
        incompatible_cells.push({
          row: rowIndex,
          column: columns[c]!,
          value: String(raw),
          inferred_type: "DOUBLE",
        });
      }
      row.push(String(raw));
    }
    return row;
  });

  return {
    rows,
    diagnostics: { incompatible_cells, incompatible_count },
  };
}

/** Cap rows by cell budget, infer types lightly, return inspect payload. */
export function inspectFromTabular(
  columns: string[],
  rawRows: (string | number | boolean | null | undefined)[][],
  maxRows?: number,
): {
  stats: ColumnInfo[];
  sample: QueryResult;
  diagnostics: TabularInspectDiagnostics;
} {
  columns = normalizeTabularHeaders(columns);
  const totalRows = rawRows.length;
  const rowCap =
    maxRows ??
    Math.min(
      WEB_CSV_MAX_ROWS,
      Math.max(1000, Math.floor(WEB_CSV_CELL_BUDGET / Math.max(1, columns.length))),
    );
  const slice = rawRows.slice(0, rowCap);

  const lexemes = parseTabularLexemes(columns, slice);
  const types = inferTabularColumnTypes(columns, lexemes);
  const { rows, diagnostics } = normalizeTabularCells(columns, lexemes, types);

  const data = { columns, types, rows };
  return {
    stats: statsFromData(data),
    sample: { columns, types, rows, total_rows: totalRows },
    diagnostics,
  };
}

export function mockInspect(filePath: string): { stats: ColumnInfo[]; sample: QueryResult } {
  const data = getDemoBundle().data[filePath];
  if (!data) {
    throw new Error(
      `Unknown demo path “${filePath}”. Upload a file or open a sample from Start here.`,
    );
  }
  const stats = statsFromData(data);
  const sample: QueryResult = {
    columns: data.columns,
    types: data.types,
    // Demo files are small — chart every row so sums and counts are true totals
    rows: data.rows,
    total_rows: data.rows.length,
  };
  return { stats, sample };
}

export function mockQuery(filePath: string, limit: number): QueryResult {
  const data = getDemoBundle().data[filePath];
  if (!data) {
    throw new Error(
      `Unknown demo path “${filePath}”. Upload a file or open a sample from Start here.`,
    );
  }
  return {
    columns: data.columns,
    types: data.types,
    rows: data.rows.slice(0, limit),
    total_rows: Math.min(limit, data.rows.length),
  };
}

/** True when bytes look like Excel/OOXML (often mislabeled as .csv on open-data portals). */
export function looksLikeSpreadsheetBinary(text: string): boolean {
  if (!text || text.length < 4) return false;
  // PK zip signature (xlsx/ods) — also catches UTF-8 BOM then PK
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return s.charCodeAt(0) === 0x50 && s.charCodeAt(1) === 0x4b;
}

export type CsvDelimiter = "," | "\t" | ";";

/**
 * Guess the field delimiter from the header line (outside quotes): tab for TSV
 * (TidyTuesday ships a few), semicolon for EU-style exports, else comma.
 */
export function sniffCsvDelimiter(text: string): CsvDelimiter {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let commas = 0;
  let tabs = 0;
  let semis = 0;
  let inQuotes = false;
  const end = Math.min(src.length, 64 * 1024);
  for (let i = 0; i < end; i++) {
    const ch = src[i]!;
    if (ch === '"') inQuotes = !inQuotes;
    else if (inQuotes) continue;
    else if (ch === "\n" || ch === "\r") break;
    else if (ch === ",") commas++;
    else if (ch === "\t") tabs++;
    else if (ch === ";") semis++;
  }
  if (tabs > 0 && tabs >= commas) return "\t";
  if (semis > commas) return ";";
  return ",";
}

/**
 * RFC4180-ish CSV split that keeps delimiters/newlines inside quotes.
 * Returns rows of string cells (header included as row 0).
 */
export function parseCsvRecords(
  text: string,
  delimiter: CsvDelimiter = ",",
  maxRecords?: number,
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  const src = trimToCompleteCsvRecords(text);
  const cap = maxRecords != null && maxRecords > 0 ? maxRecords : Infinity;

  for (let i = 0; i < src.length; i++) {
    if (rows.length >= cap) break;
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cur);
      cur = "";
      if (row.some((c) => c.trim() !== "")) {
        rows.push(row);
        if (rows.length >= cap) break;
      }
      row = [];
      continue;
    }
    if (ch === "\r") continue;
    cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/**
 * Drop a trailing incomplete record (common when the Worker Range-truncates
 * mid-row / mid-quoted-field). Without this, later cells shift and lat/lon
 * become garbage like 30405 / -87878.
 */
export function trimToCompleteCsvRecords(text: string): string {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let inQuotes = false;
  let lastSafe = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '"') {
      if (inQuotes && src[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      // Treat \r\n as one boundary; mark end after the linebreak(s)
      let end = i + 1;
      if (ch === "\r" && src[i + 1] === "\n") end = i + 2;
      lastSafe = end;
    }
  }
  return lastSafe > 0 ? src.slice(0, lastSafe) : src;
}

const NULLISH_TOKENS = new Set(["n/a", "na", "#n/a", "..", "—", "-", "null", "nan"]);

export function isNullishCsvToken(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return t === "" || NULLISH_TOKENS.has(t);
}

/** Coerce CSV cell → number when it looks numeric (gov data often uses "1,203,514" / " 10.9 "). */
export function coerceCsvNumber(raw: string): number | null {
  // U+2212 (typographic minus) shows up in exported finance sheets.
  let s = raw.trim().replace(/\u2212/g, "-");
  if (!s || isNullishCsvToken(s)) return null;
  let accountingNeg = false;
  if (/^\(\s*[$£€]?[0-9,.\s]+\)$/.test(s)) {
    accountingNeg = true;
    s = s.slice(1, -1).trim();
  }
  if (/^0x[0-9a-f]+$/i.test(s) || /^[+-]?0[0-7]+$/i.test(s)) return null;
  // A sign may sit before or after the currency symbol: -$1,234 / $-1,234 / +€5.
  const signed = /^([+-]?)\s*[$£€]?\s*([+-]?)([\s\S]*)$/.exec(s)!;
  if (signed[1] && signed[2]) return null;
  const sign = signed[1] || signed[2];
  s = signed[3]!.replace(/%$/, "").replace(/\u00a0/g, "").replace(/ /g, "").trim();
  // US thousands: 1,234,567.89 (a leading "0," group is a decimal comma, e.g. EU 0,125)
  if (/^(?!0,)\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(s)) {
    // EU thousands with ≥2 groups: 1.234.567 or 1.234.567,89
    // (do NOT treat 72.923 / 30.405 as thousands — those are US decimals)
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    // EU: 1.234,56
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d+$/.test(s)) {
    // Decimal comma without thousands grouping: 10,9
    s = s.replace(",", ".");
  }
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(s)) return null;
  const n = Number(sign === "-" ? `-${s}` : s);
  if (!Number.isFinite(n)) return null;
  return accountingNeg ? -Math.abs(n) : n;
}

/**
 * Rows kept in the browser are bounded by cells (rows × columns), not a fixed row
 * count, so a narrow 4-column series loads whole while a 79-column file still fits
 * in phone memory. Charts aggregate over every kept row.
 */
export const WEB_CSV_CELL_BUDGET = 1_500_000;
export const WEB_CSV_MAX_ROWS = 60_000;

export function parseCsvToInspectResult(
  _name: string,
  text: string,
  maxRows?: number,
): { stats: ColumnInfo[]; sample: QueryResult; diagnostics: TabularInspectDiagnostics } {
  if (looksLikeSpreadsheetBinary(text)) {
    throw new Error(
      "This download is an Excel workbook (xlsx), not CSV. Pick a CSV resource, or export CSV from the portal.",
    );
  }

  const delimiter = sniffCsvDelimiter(text);
  const previewRows = parseCsvRecords(text, delimiter, 2);
  const colCount = Math.max(1, previewRows[0]?.length ?? 1);
  const rowCap =
    maxRows ??
    Math.min(WEB_CSV_MAX_ROWS, Math.max(1, Math.floor(WEB_CSV_CELL_BUDGET / colCount)) + 1);
  const records = parseCsvRecords(text, delimiter, rowCap);
  if (records.length === 0) {
    return {
      stats: [],
      sample: { columns: [], types: [], rows: [], total_rows: 0 },
      diagnostics: { incompatible_cells: [], incompatible_count: 0 },
    };
  }

  const columns = records[0]!.map((c) => c.trim());
  return inspectFromTabular(columns, records.slice(1), maxRows);
}
