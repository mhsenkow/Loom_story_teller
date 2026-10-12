// =================================================================
// Column typing helpers, shared constants and result diversification.
// (split from recommendations.ts — LOOM-195; public API re-exported there)
// =================================================================

import { VIZ_CATEGORICAL } from "../chartPalettes";
import { inferColumnType } from "../columnClassify";
import { isLatField, isLatLonFieldPair, isLonField } from "../geoFields";
import { type ColumnInfo, type QueryResult } from "../queryTypes";
import { type ChartKind, type ChartRecommendation, type YAggregateOption } from "./types";

export const COLORS = VIZ_CATEGORICAL;

export type ColType = "quantitative" | "nominal" | "temporal";

export function inferType(dt: string, colName?: string, minVal?: string | null, maxVal?: string | null): ColType {
  return inferColumnType(dt, colName, minVal, maxVal);
}

export function defaultLineAreaAggregate(yField: string | null, columns: ColumnInfo[]): YAggregateOption {
  if (!yField) return "count";
  if (isRateLikeField(yField)) return "mean";
  if (/(count|total|amount|sum|volume|qty|quantity|num_|_num|sales|revenue|population)/i.test(yField)) {
    return "sum";
  }
  const col = columns.find((c) => c.name === yField);
  if (col && inferType(col.data_type, col.name) === "quantitative" && col.distinct_count <= 24) {
    return "mean";
  }
  return "mean";
}

/** Numeric columns suitable as measures (excludes ids, ranks, zip codes, etc.). */
export function isMeasureColumn(c: ColumnInfo, rowCount?: number): boolean {
  if (inferType(c.data_type, c.name, c.min_value, c.max_value) !== "quantitative") return false;
  const n = c.name.toLowerCase();
  if (/^(id|uuid|guid|objectid|fid|fips|zip|zipcode|postal|rank|rownum|seq|index)$/.test(n)) return false;
  if (/(^|_)(id|code|key|ref|rank|fips|zipcode)($|_)/.test(n)) return false;
  if (rowCount != null && rowCount > 0 && c.distinct_count >= Math.max(20, Math.floor(rowCount * 0.92))) {
    if (/id|code|key|num|no|index|rank|fips|zip/i.test(n)) return false;
  }
  return true;
}

export function measureColumns(columns: ColumnInfo[], rowCount?: number): ColumnInfo[] {
  return columns.filter((c) => isMeasureColumn(c, rowCount));
}

export function yFieldSupportsLogScale(yField: string | null, columns: ColumnInfo[]): boolean {
  if (!yField) return false;
  const col = columns.find((c) => c.name === yField);
  if (!col) return false;
  const min = Number(col.min_value);
  return Number.isFinite(min) && min > 0;
}

/** Stable chart id for live/stream recs (survives reopen / discover reruns). */
export function stableLiveChartId(
  prefix: string,
  kind: ChartKind,
  xField: string,
  yField: string | null,
  colorField: string | null,
  suffix = "",
): string {
  const base = `${prefix}-${kind}-${xField}-${yField ?? "n"}-${colorField ?? "n"}${suffix}`;
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

/** Rates/% should use mean (or median), not sum — summing 10.9% across regions is nonsense. */
export function isRateLikeField(name: string): boolean {
  return /(percent|percentage|proportion|ratio|rate|pct|\(%\)|%)/i.test(name);
}

/** Prefer human labels over opaque codes when both exist as categories. */
export function nominalQualityBoost(name: string): number {
  const n = name.toLowerCase();
  if (/\b(name|title|label|region|state|city|county|country)\b/.test(n)) return 8;
  if (/\b(code|id|uuid|key|ref|index)\b/.test(n) || /(_id|_code)$/.test(n)) return -12;
  return 0;
}

/** Geographic coordinate pair — prefer as map-like scatter even when Pearson r is low. */
export function isLatLonPair(a: string, b: string): boolean {
  return isLatLonFieldPair(a, b);
}

export function columnsHaveLatLon(columns: ColumnInfo[]): boolean {
  const lat = columns.some((c) => isLatField(c.name));
  const lon = columns.some((c) => isLonField(c.name));
  return lat && lon;
}

/** Prefer 3–12 categories for color legends; avoid one-hot noise and binary-only when better options exist. */
export function pickColorColumn(nomCols: ColumnInfo[]): ColumnInfo | null {
  const candidates = nomCols.filter((c) => c.distinct_count >= 2 && c.distinct_count <= 20);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const score = (c: ColumnInfo) => {
      let s = 0;
      const d = c.distinct_count;
      if (d >= 3 && d <= 12) s += 30;
      else if (d >= 2 && d <= 16) s += 15;
      else s += 5;
      // Mild preference for denser (less null-heavy) columns when stats exist
      if (c.null_count === 0) s += 4;
      return s;
    };
    return score(b) - score(a);
  });
  return candidates[0] ?? null;
}

export function colIndex(data: QueryResult, name: string): number {
  return data.columns.indexOf(name);
}

/** Sample paired numeric values from a QueryResult (cap for speed). */
export function sampleNumericPair(
  data: QueryResult | null,
  xName: string,
  yName: string,
  maxPoints = 800,
): { xs: number[]; ys: number[] } | null {
  if (!data?.rows?.length) return null;
  const xi = colIndex(data, xName);
  const yi = colIndex(data, yName);
  if (xi < 0 || yi < 0) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  const rows = data.rows;
  const step = Math.max(1, Math.floor(rows.length / maxPoints));
  for (let i = 0; i < rows.length && xs.length < maxPoints; i += step) {
    const xv = Number(rows[i][xi]);
    const yv = Number(rows[i][yi]);
    if (Number.isFinite(xv) && Number.isFinite(yv)) {
      xs.push(xv);
      ys.push(yv);
    }
  }
  return xs.length >= 12 ? { xs, ys } : null;
}

/** Absolute Pearson correlation in [0, 1]; 0 when undefined. */
export function pearsonAbs(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 12) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 0 || vy <= 0) return 0;
  const r = cov / Math.sqrt(vx * vy);
  return Number.isFinite(r) ? Math.min(1, Math.abs(r)) : 0;
}

/**
 * Re-rank recommendations for variety: keep high scores but avoid flooding
 * the list with the same kind / field pair. Used for Suggest chart top picks
 * and the Suggestions rail.
 */
export function diversifyRecommendations(
  recs: ChartRecommendation[],
  limit = 40,
): ChartRecommendation[] {
  if (recs.length <= 1) return recs.slice(0, limit);
  const sorted = [...recs].sort((a, b) => b.score - a.score);
  const out: ChartRecommendation[] = [];
  const kindCount = new Map<ChartKind, number>();
  const fieldKeys = new Set<string>();

  const fieldKey = (r: ChartRecommendation) =>
    `${r.kind}|${r.xField}|${r.yField ?? ""}|${r.colorField ?? ""}|${r.rowField ?? ""}|${r.topN ?? ""}|${r.y2Field ?? ""}|${r.comparePrevious ? "cp" : ""}`;

  // Pass 0: sprinkle rare kinds without crowding out high-scoring bar/line recs (LOOM-188)
  const topScore = sorted[0]?.score ?? 0;
  const bestByKind = new Map<ChartKind, ChartRecommendation>();
  for (const r of sorted) {
    if (!bestByKind.has(r.kind)) bestByKind.set(r.kind, r);
  }
  let kindPass = 0;
  for (const r of [...bestByKind.values()].sort((a, b) => b.score - a.score)) {
    if (out.length >= limit || kindPass >= 8) break;
    if (r.score < topScore - 25 && kindPass >= 4) continue;
    if (r.score < 50) continue;
    const fk = fieldKey(r);
    out.push(r);
    kindCount.set(r.kind, 1);
    fieldKeys.add(fk);
    kindPass += 1;
  }

  // Pass 1: prefer new encodings / more of popular kinds (capped)
  for (const r of sorted) {
    if (out.length >= limit) break;
    const kc = kindCount.get(r.kind) ?? 0;
    const fk = fieldKey(r);
    if (fieldKeys.has(fk)) continue;
    if (kc >= 4 && out.length >= Math.min(12, limit)) continue;
    out.push(r);
    kindCount.set(r.kind, kc + 1);
    fieldKeys.add(fk);
  }
  // Pass 2: fill remaining slots by score
  for (const r of sorted) {
    if (out.length >= limit) break;
    if (out.some((o) => o.id === r.id)) continue;
    out.push(r);
  }
  return out;
}
