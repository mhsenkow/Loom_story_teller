// =================================================================
// Loom — CSV export from table/query results
// =================================================================
// Converts QueryResult to CSV string and triggers browser download.
// =================================================================

import type { QueryResult } from "./store";

/**
 * Escape a CSV cell and neutralize spreadsheet formula injection.
 * Finite numbers are written as-is; strings starting with `=`, `+`, `-`, `@`,
 * tab, or CR are prefixed with `'` so Excel/Sheets won't execute them.
 */
export function escapeCsvCell(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** UTF-8 default; Excel adds BOM and CRLF line endings for spreadsheet tools. */
export type CsvExportProfile = "utf8" | "excel";

export function queryResultToCsv(result: QueryResult, profile: CsvExportProfile = "utf8"): string {
  const { columns, rows } = result;
  const header = columns.map(escapeCsvCell).join(",");
  const lineEnd = profile === "excel" ? "\r\n" : "\n";
  const body = rows
    .map((row) => columns.map((_, i) => escapeCsvCell(row[i] ?? null)).join(","))
    .join(lineEnd);
  const csv = `${header}${lineEnd}${body}`;
  return profile === "excel" ? `\uFEFF${csv}` : csv;
}

export { downloadCsv } from "./download";
