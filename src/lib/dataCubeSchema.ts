// =================================================================
// Loom — Data cube encoding heuristics (schema-only, no render)
// =================================================================
// Shared by recommendations, GPU scenes, and Canvas/WebGPU renderers.
// =================================================================

import type { ColumnInfo } from "./queryTypes";
import type { YAggregateOption } from "./recommendations";

export const CUBE_MAX_BINS = 12;

export function isNumericColumnType(dt: string): boolean {
  const t = dt.toUpperCase();
  return ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT", "TINYINT", "SMALLINT", "UBIGINT"].some((n) =>
    t.includes(n),
  );
}

function isNumericType(dt: string): boolean {
  return isNumericColumnType(dt);
}

function isTimeColumn(c: ColumnInfo): boolean {
  const t = c.data_type.toUpperCase();
  return t.includes("DATE") || t.includes("TIMESTAMP") || /^(ts|time|date|timestamp|year|month)$/i.test(c.name);
}

function isIdLike(name: string): boolean {
  return /\b(id|uuid|key|index)\b/i.test(name) || /(_id|_key)$/i.test(name);
}

/** How well a column works as a cube dimension (higher = better, ≤0 = unusable). */
function dimensionScore(c: ColumnInfo): number {
  const d = c.distinct_count ?? 0;
  if (d < 2 || isIdLike(c.name)) return 0;
  if (isTimeColumn(c)) return 8;
  if (!isNumericType(c.data_type)) {
    if (d <= CUBE_MAX_BINS) return 10;
    if (d <= 40) return 6;
    return 2;
  }
  // Low-cardinality numerics (ratings, years, floors) behave like ordered categories.
  if (d <= CUBE_MAX_BINS) return 7;
  return 3;
}

/** Columns that can span a cube axis, best first. */
export function rankCubeDimensions(columns: ColumnInfo[]): ColumnInfo[] {
  return columns
    .map((c) => ({ c, s: dimensionScore(c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

/** Best rows / columns / depth / value encoding for a schema, or null. */
export function pickDataCubeEncoding(
  columns: ColumnInfo[],
): { xField: string; yField: string; zField: string; valueField: string | null; aggregate: YAggregateOption } | null {
  const dims = rankCubeDimensions(columns);
  if (dims.length < 3) return null;
  // Put time on depth when present so slices read as "pages" through time.
  const time = dims.find(isTimeColumn);
  const flat = dims.filter((c) => c !== time);
  const [x, y, z] = time ? [flat[0], flat[1], time] : [dims[0], dims[1], dims[2]];
  if (!x || !y || !z) return null;
  const used = new Set([x.name, y.name, z.name]);
  const measure = columns.find((c) => isNumericType(c.data_type) && !used.has(c.name) && !isIdLike(c.name) && (c.distinct_count ?? 0) > CUBE_MAX_BINS);
  const rateLike = measure && /(percent|pct|rate|ratio|%|avg|mean|score|temp)/i.test(measure.name);
  return {
    xField: x.name,
    yField: y.name,
    zField: z.name,
    valueField: measure?.name ?? null,
    aggregate: measure ? (rateLike ? "mean" : "sum") : "count",
  };
}
