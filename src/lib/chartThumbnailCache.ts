// =================================================================
// Shared downsample + bitmap cache for ChartCard thumbs (LOOM-054)
// =================================================================

import type { QueryResult } from "./store";
import { applyChartTimeWindow } from "./chartTime";
import type { ChartRecommendation } from "./recommendations";

const rowCache = new Map<string, unknown[][]>();
const bitmapCache = new Map<string, ImageBitmap | null>();

function datasetKey(data: QueryResult, rec: ChartRecommendation): string {
  return `${data.columns.join("\0")}|${data.rows.length}|${rec.timeWindow ?? ""}|${rec.xField}`;
}

export function downsampledRowsForThumb(
  data: QueryResult,
  rec: ChartRecommendation,
  maxPoints = 1500,
): unknown[][] {
  const key = datasetKey(data, rec);
  const hit = rowCache.get(key);
  if (hit) return hit;
  const timed = applyChartTimeWindow(data.rows, data.columns, rec).rows;
  const stride = Math.max(1, Math.ceil(timed.length / maxPoints));
  const rows = stride === 1 ? timed : timed.filter((_, i) => i % stride === 0);
  rowCache.set(key, rows);
  if (rowCache.size > 24) {
    const first = rowCache.keys().next().value;
    if (first) rowCache.delete(first);
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
