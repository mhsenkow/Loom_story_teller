// =================================================================
// Shared downsample + bitmap cache for ChartCard thumbs (LOOM-054)
// =================================================================

import type { QueryResult } from "./store";
import { applyChartTimeWindow } from "./chartTime";
import type { ChartRecommendation } from "./recommendations";

const rowCache = new WeakMap<QueryResult, Map<string, unknown[][]>>();
const bitmapCache = new Map<string, ImageBitmap | null>();

function datasetKey(rec: ChartRecommendation): string {
  return `${rec.timeWindow ?? ""}|${rec.timeWindowField ?? ""}`;
}

export function downsampledRowsForThumb(
  data: QueryResult,
  rec: ChartRecommendation,
  maxPoints = 1500,
): unknown[][] {
  const key = `${datasetKey(rec)}|${maxPoints}`;
  const datasetCache = rowCache.get(data) ?? new Map<string, unknown[][]>();
  const hit = datasetCache.get(key);
  if (hit) return hit;
  const timed = applyChartTimeWindow(data.rows, data.columns, rec).rows;
  const stride = Math.max(1, Math.ceil(timed.length / Math.max(1, maxPoints)));
  const rows = stride === 1 ? timed : timed.filter((_, i) => i % stride === 0);
  datasetCache.set(key, rows);
  rowCache.set(data, datasetCache);
  if (datasetCache.size > 24) {
    const first = datasetCache.keys().next().value;
    if (first) datasetCache.delete(first);
  }
  return rows;
}

export function thumbBitmapCacheKey(recId: string, theme: string, w: number, h: number): string {
  return `${recId}|${theme}|${w}x${h}`;
}

export function getCachedThumbBitmap(key: string): ImageBitmap | null | undefined {
  if (!bitmapCache.has(key)) return undefined;
  return bitmapCache.get(key) ?? null;
}

export function setCachedThumbBitmap(key: string, bmp: ImageBitmap | null): void {
  bitmapCache.set(key, bmp);
  if (bitmapCache.size > 48) {
    const first = bitmapCache.keys().next().value;
    if (first) {
      bitmapCache.get(first)?.close?.();
      bitmapCache.delete(first);
    }
  }
}
