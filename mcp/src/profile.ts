// =================================================================
// Loom MCP — CSV/JSON → ColumnInfo profiler (Workers-safe)
// =================================================================

import type { ColumnInfo } from "../../src/lib/queryTypes";

const MAX_ROWS = 500;
const MAX_BYTES = 400_000;

export interface ProfileResult {
  columns: ColumnInfo[];
  sampleRows: (string | number | boolean | null)[][];
  columnNames: string[];
  /** Rows in the input (CSV rows after any byte trim, or JSON array length). */
  rowCount: number;
  /** Rows actually profiled (capped at MAX_ROWS). */
  sampledRows: number;
  truncated: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

function detectType(values: string[]): { data_type: string; nums: number; dates: number } {
  let nums = 0;
  let ints = 0;
  let dates = 0;
  let nonEmpty = 0;
  for (const v of values) {
    if (v === "" || v == null) continue;
    nonEmpty++;
    const t = v.trim();
    if (t === "true" || t === "false") continue;
    if (/^-?\d+$/.test(t)) ints++;
    const n = Number(t);
    if (!isNaN(n) && t !== "") nums++;
    if (ISO_DATE.test(t) || ISO_TIMESTAMP.test(t)) dates++;
  }
  if (nonEmpty === 0) return { data_type: "VARCHAR", nums: 0, dates: 0 };
  if (ints / nonEmpty >= 0.8) return { data_type: "INTEGER", nums, dates };
  if (nums / nonEmpty >= 0.8) return { data_type: "DOUBLE", nums, dates };
  if (dates / nonEmpty >= 0.7) return { data_type: "DATE", nums, dates };
  return { data_type: "VARCHAR", nums, dates };
}

function trimCsvToLastNewline(text: string): string {
  const last = text.lastIndexOf("\n");
  if (last <= 0) return text;
  return text.slice(0, last + 1);
}

/** Rename repeated headers to `a`, `a_2`, `a_3`, … so every column name is unique. */
function dedupeHeaders(headers: string[]): string[] {
  const seen = new Set<string>();
  return headers.map((h) => {
    let name = h;
    for (let n = 2; seen.has(name); n++) name = `${h}_${n}`;
    seen.add(name);
    return name;
  });
}

/** JSON cell → string for profiling; nested objects/arrays keep their JSON form. */
function jsonCellText(v: unknown): string {
  if (v == null) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** Minimal CSV splitter — handles quoted fields. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        cur += '"';
      }
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      lines.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.length) lines.push(cur);

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cell = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = !q;
        continue;
      }
      if (ch === "," && !q) {
        out.push(cell.trim());
        cell = "";
        continue;
      }
      cell += ch;
    }
    out.push(cell.trim());
    return out;
  };

  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = dedupeHeaders(splitLine(nonEmpty[0]!).map((h, i) => h || `col_${i + 1}`));
  const rows = nonEmpty.slice(1).map(splitLine);
  return { headers, rows };
}

function coerceCell(raw: string, dataType: string): string | number | boolean | null {
  if (raw === "" || raw == null) return null;
  if (dataType === "DOUBLE" || dataType === "INTEGER") {
    const n = Number(raw);
    return isNaN(n) ? raw : n;
  }
  if (raw === "true" || raw === "TRUE") return true;
  if (raw === "false" || raw === "FALSE") return false;
  return raw;
}

/** Profile CSV text or JSON array-of-objects / columnar payload. */
export function profilePayload(input: {
  csv?: string;
  json?: string;
  columns?: { name: string; data_type?: string; distinct_count?: number }[];
}): ProfileResult {
  if (input.columns && input.columns.length > 0 && !input.csv && !input.json) {
    const columns: ColumnInfo[] = input.columns.map((c) => ({
      name: c.name,
      data_type: c.data_type ?? "VARCHAR",
      null_count: 0,
      distinct_count: c.distinct_count ?? 10,
      min_value: null,
      max_value: null,
    }));
    return {
      columns,
      sampleRows: [],
      columnNames: columns.map((c) => c.name),
      rowCount: 0,
      sampledRows: 0,
      truncated: false,
    };
  }

  let headers: string[] = [];
  let rawRows: string[][] = [];
  let totalRows = 0;
  let truncated = false;

  if (input.csv) {
    let text = input.csv;
    if (text.length > MAX_BYTES) {
      text = trimCsvToLastNewline(text.slice(0, MAX_BYTES));
      truncated = true;
    }
    const parsed = parseCsv(text);
    headers = parsed.headers;
    rawRows = parsed.rows.slice(0, MAX_ROWS);
    totalRows = parsed.rows.length;
    if (parsed.rows.length > MAX_ROWS) truncated = true;
  } else if (input.json) {
    const text = input.json;
    if (text.length > MAX_BYTES) {
      throw new Error(`JSON exceeds ${MAX_BYTES} byte cap (${text.length} chars)`);
    }
    const data = JSON.parse(text) as unknown;
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
      const objs = data.slice(0, MAX_ROWS) as Record<string, unknown>[];
      if (data.length > MAX_ROWS) truncated = true;
      totalRows = data.length;
      const keySet = new Set<string>();
      for (const o of objs) Object.keys(o).forEach((k) => keySet.add(k));
      headers = [...keySet];
      rawRows = objs.map((o) => headers.map((h) => jsonCellText(o[h])));
    } else {
      throw new Error("JSON must be an array of objects");
    }
  } else {
    throw new Error("Provide csv, json, or columns");
  }

  if (headers.length === 0) {
    return { columns: [], sampleRows: [], columnNames: [], rowCount: 0, sampledRows: 0, truncated };
  }

  const columns: ColumnInfo[] = headers.map((name, i) => {
    const vals = rawRows.map((r) => r[i] ?? "");
    const { data_type } = detectType(vals);
    const nonNull = vals.filter((v) => v !== "");
    const distinct = new Set(nonNull).size;
    let min_value: string | null = null;
    let max_value: string | null = null;
    if (data_type === "DOUBLE" || data_type === "INTEGER") {
      const nums = nonNull.map(Number).filter((n) => !isNaN(n));
      if (nums.length) {
        min_value = String(Math.min(...nums));
        max_value = String(Math.max(...nums));
      }
    }
    return {
      name,
      data_type,
      null_count: vals.length - nonNull.length,
      distinct_count: Math.max(1, distinct),
      min_value,
      max_value,
    };
  });

  const sampleRows = rawRows.map((r) =>
    columns.map((c, i) => coerceCell(r[i] ?? "", c.data_type)),
  );

  return {
    columns,
    sampleRows,
    columnNames: headers,
    rowCount: totalRows,
    sampledRows: rawRows.length,
    truncated,
  };
}

export function profilePayloadSafe(
  input: Parameters<typeof profilePayload>[0],
): { ok: true; result: ProfileResult } | { ok: false; error: string } {
  try {
    return { ok: true, result: profilePayload(input) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Profile failed" };
  }
}
