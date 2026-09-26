// =================================================================
// Loom MCP — CSV/JSON → ColumnInfo profiler (Workers-safe)
// =================================================================

import type { ColumnInfo } from "../../src/lib/store";

const MAX_ROWS = 500;
const MAX_BYTES = 400_000;

export interface ProfileResult {
  columns: ColumnInfo[];
  sampleRows: (string | number | boolean | null)[][];
  columnNames: string[];
  rowCount: number;
  truncated: boolean;
}

function detectType(values: string[]): { data_type: string; nums: number; dates: number } {
  let nums = 0;
  let dates = 0;
  let nonEmpty = 0;
  for (const v of values) {
    if (v === "" || v == null) continue;
    nonEmpty++;
    const n = Number(v);
    if (!isNaN(n) && v.trim() !== "") nums++;
    if (/^\d{4}-\d{2}-\d{2}/.test(v) || !isNaN(Date.parse(v))) dates++;
  }
  if (nonEmpty === 0) return { data_type: "VARCHAR", nums: 0, dates: 0 };
  if (nums / nonEmpty >= 0.8) return { data_type: "DOUBLE", nums, dates };
  if (dates / nonEmpty >= 0.7) return { data_type: "DATE", nums, dates };
  return { data_type: "VARCHAR", nums, dates };
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
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
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
  const headers = splitLine(nonEmpty[0]!).map((h, i) => h || `col_${i + 1}`);
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
      truncated: false,
    };
  }

  let headers: string[] = [];
  let rawRows: string[][] = [];
  let truncated = false;

  if (input.csv) {
    let text = input.csv;
    if (text.length > MAX_BYTES) {
      text = text.slice(0, MAX_BYTES);
      truncated = true;
    }
    const parsed = parseCsv(text);
    headers = parsed.headers;
    rawRows = parsed.rows.slice(0, MAX_ROWS);
    if (parsed.rows.length > MAX_ROWS) truncated = true;
  } else if (input.json) {
    let text = input.json;
    if (text.length > MAX_BYTES) {
      text = text.slice(0, MAX_BYTES);
      truncated = true;
    }
    const data = JSON.parse(text) as unknown;
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
      const objs = data.slice(0, MAX_ROWS) as Record<string, unknown>[];
      if (data.length > MAX_ROWS) truncated = true;
      const keySet = new Set<string>();
      for (const o of objs) Object.keys(o).forEach((k) => keySet.add(k));
      headers = [...keySet];
      rawRows = objs.map((o) => headers.map((h) => (o[h] == null ? "" : String(o[h]))));
    } else {
      throw new Error("JSON must be an array of objects");
    }
  } else {
    throw new Error("Provide csv, json, or columns");
  }

  if (headers.length === 0) {
    return { columns: [], sampleRows: [], columnNames: [], rowCount: 0, truncated };
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
    rowCount: rawRows.length,
    truncated,
  };
}
