// =================================================================
// Validate durable IndexedDB web file payloads (LOOM-199)
// =================================================================

import type { ColumnInfo, QueryResult } from "./store";
import type { WebFilePersist } from "./webFileStore";

export const WEB_FILE_PAYLOAD_VERSION = 2;

function isColumnInfo(v: unknown): v is ColumnInfo {
  if (!v || typeof v !== "object") return false;
  const c = v as ColumnInfo;
  return (
    typeof c.name === "string" &&
    typeof c.data_type === "string" &&
    typeof c.null_count === "number" &&
    typeof c.distinct_count === "number" &&
    (c.min_value === null || typeof c.min_value === "string") &&
    (c.max_value === null || typeof c.max_value === "string")
  );
}

function isQueryResult(v: unknown): v is QueryResult {
  if (!v || typeof v !== "object") return false;
  const q = v as QueryResult;
  if (!Array.isArray(q.columns) || !Array.isArray(q.types) || !Array.isArray(q.rows)) return false;
  if (q.columns.length !== q.types.length) return false;
  for (const name of q.columns) if (typeof name !== "string") return false;
  for (const type of q.types) if (typeof type !== "string") return false;
  if (!Number.isSafeInteger(q.total_rows) || q.total_rows < q.rows.length) return false;
  const w = q.columns.length;
  for (const row of q.rows) {
    if (!Array.isArray(row) || row.length !== w) return false;
    for (const cell of row) {
      if (
        cell !== null &&
        typeof cell !== "string" &&
        typeof cell !== "boolean" &&
        !(typeof cell === "number" && Number.isFinite(cell))
      ) return false;
    }
  }
  return true;
}

/** Returns null when the row is corrupt or unsupported — caller skips without wiping DB. */
export function parseWebFilePersist(raw: unknown): WebFilePersist | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    "payloadVersion" in r &&
    r.payloadVersion !== 1 &&
    r.payloadVersion !== WEB_FILE_PAYLOAD_VERSION
  ) return null;
  if (typeof r.path !== "string" || !r.path) return null;
  if (typeof r.name !== "string" || typeof r.extension !== "string") return null;
  if (typeof r.sizeBytes !== "number" || !Number.isFinite(r.sizeBytes)) return null;
  if (typeof r.updatedAt !== "number" || !Number.isFinite(r.updatedAt)) return null;
  if (!Array.isArray(r.stats) || !r.stats.every(isColumnInfo)) return null;
  if (!isQueryResult(r.sample)) return null;
  return {
    path: r.path,
    name: r.name,
    extension: r.extension,
    sizeBytes: r.sizeBytes,
    stats: r.stats,
    sample: r.sample,
    updatedAt: r.updatedAt,
    ...(typeof r.revision === "number" && Number.isFinite(r.revision)
      ? { revision: r.revision }
      : {}),
  };
}
