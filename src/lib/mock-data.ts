// =================================================================
// Loom — Browser Mock Data
// =================================================================
// When running outside Tauri (plain browser via `make thread`),
// provides synthetic data so the full UI is functional for
// development and demos without the Rust backend.
// =================================================================

import type { FileEntry, ColumnInfo, QueryResult } from "./store";

function gaussian(mean: number, std: number): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

const CATEGORIES = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
const CITIES = ["San Francisco", "New York", "London", "Tokyo", "Berlin", "Paris", "Sydney", "Toronto"];

function generateScatterData(n: number): { columns: string[]; types: string[]; rows: (string | number | null)[][] } {
  const centers = [
    [20, 30], [-15, 25], [10, -20], [-30, -10],
    [35, -15], [-5, 40], [25, 5], [-20, 35],
  ];
  const rows: (string | number | null)[][] = [];
  for (let i = 0; i < n; i++) {
    const [cx, cy] = centers[i % centers.length];
    const x = Math.round((cx + gaussian(0, 8)) * 1000) / 1000;
    const y = Math.round((cy + gaussian(0, 8)) * 1000) / 1000;
    const mag = Math.round(Math.sqrt(x * x + y * y) * 100) / 100;
    rows.push([x, y, CATEGORIES[i % CATEGORIES.length], mag, `pt_${i}`]);
  }
  return {
    columns: ["x", "y", "cluster", "magnitude", "label"],
    types: ["DOUBLE", "DOUBLE", "VARCHAR", "DOUBLE", "VARCHAR"],
    rows,
  };
}

function generateSalesData(n: number): { columns: string[]; types: string[]; rows: (string | number | null)[][] } {
  const products = ["Widget A", "Widget B", "Gadget Pro", "Sensor V1", "Module X", "Board Rev3"];
  const rows: (string | number | null)[][] = [];
  const base = new Date("2023-01-01").getTime();
  for (let i = 0; i < n; i++) {
    const date = new Date(base + Math.random() * 63072000000).toISOString().split("T")[0];
    const city = CITIES[Math.floor(Math.random() * CITIES.length)];
    const product = products[Math.floor(Math.random() * products.length)];
    const units = Math.floor(Math.random() * 500) + 1;
    const revenue = Math.round(units * (Math.random() * 200 + 10) * 100) / 100;
    rows.push([date, city, product, units, revenue]);
  }
  return {
    columns: ["date", "city", "product", "units", "revenue"],
    types: ["DATE", "VARCHAR", "VARCHAR", "INTEGER", "DOUBLE"],
    rows,
  };
}

const scatterData = generateScatterData(2000);
const salesData = generateSalesData(1000);

const MOCK_FILES: FileEntry[] = [
  { path: "mock://scatter.csv", name: "scatter_demo.csv", extension: "csv", row_count: 2000, size_bytes: 98000 },
  { path: "mock://sales.csv", name: "sales_demo.csv", extension: "csv", row_count: 1000, size_bytes: 52000 },
];

const MOCK_DATA: Record<string, { columns: string[]; types: string[]; rows: (string | number | null)[][] }> = {
  "mock://scatter.csv": scatterData,
  "mock://sales.csv": salesData,
};

function statsFromData(data: typeof scatterData): ColumnInfo[] {
  return data.columns.map((name, i) => {
    const type = data.types[i];
    const values = data.rows.map(r => r[i]);
    const nonNull = values.filter(v => v !== null);
    const distinct = new Set(nonNull.map(String)).size;
    const isNum = ["DOUBLE", "INTEGER", "BIGINT", "FLOAT"].includes(type);
    const nums = isNum ? nonNull.map(Number).filter(n => !isNaN(n)) : [];

    return {
      name,
      data_type: type,
      null_count: values.length - nonNull.length,
      distinct_count: distinct,
      min_value: isNum && nums.length > 0 ? String(Math.min(...nums)) : nonNull.length > 0 ? String(nonNull[0]) : null,
      max_value: isNum && nums.length > 0 ? String(Math.max(...nums)) : nonNull.length > 0 ? String(nonNull[nonNull.length - 1]) : null,
    };
  });
}

export const mockFiles = MOCK_FILES;

export function mockInspect(filePath: string): { stats: ColumnInfo[]; sample: QueryResult } {
  const data = MOCK_DATA[filePath] ?? scatterData;
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
  const data = MOCK_DATA[filePath] ?? scatterData;
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

/**
 * RFC4180-ish CSV split that keeps commas/newlines inside quotes.
 * Returns rows of string cells (header included as row 0).
 */
export function parseCsvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  const src = trimToCompleteCsvRecords(text);

  for (let i = 0; i < src.length; i++) {
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
    if (ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cur);
      cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
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

/** Coerce CSV cell → number when it looks numeric (gov data often uses "1,203,514" / " 10.9 "). */
export function coerceCsvNumber(raw: string): number | null {
  let s = raw.trim();
  if (!s || s === "null" || s === "NULL" || s === "NaN" || s === "-") return null;
  s = s.replace(/^[$£€]/, "").replace(/%$/, "").replace(/\u00a0/g, "").replace(/ /g, "").trim();
  // US thousands: 1,234,567.89
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, "");
  } else if (/^-?\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(s)) {
    // EU thousands with ≥2 groups: 1.234.567 or 1.234.567,89
    // (do NOT treat 72.923 / 30.405 as thousands — those are US decimals)
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    // EU: 1.234,56
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d+,\d+$/.test(s)) {
    // Decimal comma without thousands grouping: 10,9
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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
): { stats: ColumnInfo[]; sample: QueryResult } {
  if (looksLikeSpreadsheetBinary(text)) {
    throw new Error(
      "This download is an Excel workbook (xlsx), not CSV. Pick a CSV resource, or export CSV from the portal.",
    );
  }

  const records = parseCsvRecords(text);
  if (records.length === 0) {
    return { stats: [], sample: { columns: [], types: [], rows: [], total_rows: 0 } };
  }

  const columns = records[0]!.map((c) => c.trim());
  const dataRows = records.slice(1);
  const totalRows = dataRows.length;
  const rowCap =
    maxRows ?? Math.min(WEB_CSV_MAX_ROWS, Math.max(1000, Math.floor(WEB_CSV_CELL_BUDGET / Math.max(1, columns.length))));
  const slice = dataRows.slice(0, rowCap);

  const rows: (string | number | null)[][] = slice.map((values) => {
    const row: (string | number | null)[] = [];
    for (let c = 0; c < columns.length; c++) {
      const v = (values[c] ?? "").trim();
      if (v === "" || v.toLowerCase() === "null") {
        row.push(null);
        continue;
      }
      const num = coerceCsvNumber(v);
      row.push(num !== null ? num : v);
    }
    return row;
  });

  const types = columns.map((name, i) => {
    const cells = rows.map((r) => r[i]);
    const nonNull = cells.filter((v) => v !== null);
    if (nonNull.length === 0) return "VARCHAR";
    const nums = nonNull.filter((v): v is number => typeof v === "number");
    if (nums.length > nonNull.length * 0.5) return "DOUBLE";
    // Name hints for years / amounts when sample was mostly null-ish strings
    const n = name.toLowerCase();
    if (/(amount|award|budget|count|latitude|longitude|lat|lon|year|rate|percent|proportion|households)/i.test(n)) {
      const coerced = nonNull
        .map((v) => (typeof v === "number" ? v : coerceCsvNumber(String(v))))
        .filter((v): v is number => v != null);
      if (coerced.length > nonNull.length * 0.4) {
        for (let r = 0; r < rows.length; r++) {
          const cell = rows[r]![i];
          if (typeof cell === "string") {
            const n2 = coerceCsvNumber(cell);
            if (n2 != null) rows[r]![i] = n2;
          }
        }
        return "DOUBLE";
      }
    }
    return "VARCHAR";
  });

  const data = { columns, types, rows };
  const stats = statsFromData(data);
  const sample: QueryResult = {
    columns,
    types,
    rows,
    total_rows: totalRows,
  };
  return { stats, sample };
}
