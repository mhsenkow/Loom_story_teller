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

export function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len - 1) + "\u2026" : s;
}

export function extensionIcon(ext: string): string {
  switch (ext) {
    case "parquet": return "PQ";
    case "csv": return "CSV";
    case "json": return "JSON";
    case "ndjson": return "NDJSON";
    case "jsonl": return "JSONL";
    case "xlsx": return "XLSX";
    case "sqlite": return "SQLite";
    default: return ext.toUpperCase().slice(0, 6) || "?";
  }
}
