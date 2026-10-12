// =================================================================
// webMemoryBudget — resident browser dataset caps (LOOM-079)
// =================================================================

import type { QueryResult } from "./store";

/** Soft cap on in-memory sample rows across inactive web files. */
export const WEB_MEMORY_MAX_CELLS = 4_000_000;
export const WEB_MEMORY_MAX_BYTES = 64 * 1024 * 1024;

export function estimateSampleBytes(sample: QueryResult): number {
  let bytes = 0;
  for (const row of sample.rows) {
    for (const cell of row) {
      if (cell == null) bytes += 1;
      else if (typeof cell === "number") bytes += 8;
      else bytes += String(cell).length * 2;
    }
  }
  return bytes + sample.columns.length * 32;
}

export function estimateSampleCells(sample: QueryResult): number {
  return sample.rows.length * Math.max(1, sample.columns.length);
}

export function shouldEvictWebSample(stats: {
  cells: number;
  bytes: number;
  activePath: string | null;
  path: string;
}): boolean {
  if (stats.path === stats.activePath) return false;
  return stats.cells > WEB_MEMORY_MAX_CELLS || stats.bytes > WEB_MEMORY_MAX_BYTES;
}
