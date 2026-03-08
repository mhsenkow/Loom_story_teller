// =================================================================
// Loom — CSV export from table/query results
// =================================================================
// Converts QueryResult to CSV string and triggers browser download.
// =================================================================

import type { QueryResult } from "./store";

function escapeCsvCell(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function queryResultToCsv(result: QueryResult): string {
  const { columns, rows } = result;
  const header = columns.map(escapeCsvCell).join(",");
  const body = rows
    .map((row) => columns.map((_, i) => escapeCsvCell(row[i] ?? null)).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
