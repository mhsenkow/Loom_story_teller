// =================================================================
// Loom — Formatting Utilities
// =================================================================
// Human-readable formatting for file sizes, row counts, etc.
// =================================================================

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 1,
});

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) < 1000) return n.toLocaleString();
  const sign = n < 0 ? "-" : "";
  const compact = compactNumber.format(Math.abs(n));
  return sign + compact.replace(/\.0(?=[KMBT])/, "");
}

export function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len - 1) + "\u2026" : s;
}

export function extensionIcon(ext: string): string {
  switch (ext) {
    case "parquet": return "PQ";
    case "csv": return "CSV";
    case "tsv":
    case "tab": return "TSV";
    case "json": return "JSON";
    case "ndjson": return "NDJSON";
    case "jsonl": return "JSONL";
    case "xlsx": return "XLSX";
    case "sqlite": return "SQLite";
    default: return ext.toUpperCase().slice(0, 6) || "?";
  }
}
