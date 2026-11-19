// =================================================================
// Shared constants and hit/geometry helpers for the Canvas chart renderers.
// (extracted from ChartView.tsx — LOOM-141 / LOOM-142)
// =================================================================

import { discreteSeriesColors, resolveChartColors } from "../chartPalettes";
import { type HitTarget } from "../chartTooltip";
import { type YScaleKind, scaleDomain } from "../dsTransforms";

export const DEFAULT_COLORS = discreteSeriesColors(
  resolveChartColors({ paletteId: "categorical" }),
  8,
);

/** Display domain for Y — log needs a positive span before scaleY / invScaleY. */
export function scatterYDomain(yMin: number, yMax: number, kind: YScaleKind): { min: number; max: number } {
  return kind === "linear" ? { min: yMin, max: yMax } : scaleDomain(yMin, yMax, kind);
}

/** Shift hit targets after painting a facet cell into a translated clip. */
export function offsetHitTargets(targets: HitTarget[], dx: number, dy: number) {
  for (const t of targets) {
    if (t.shape === "rect") {
      t.x += dx;
      t.y += dy;
    } else {
      t.cx += dx;
      t.cy += dy;
    }
  }
}

export function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const DEFAULT_PAD = 56;

export function isNumericType(dt: string): boolean {
  const t = dt.toUpperCase();
  return ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT", "TINYINT", "SMALLINT", "UBIGINT", "UINTEGER", "USMALLINT", "UTINYINT"].some(n => t.includes(n));
}

/** Numeric-looking columns that aren't measures: codes ("01" FIPS), ids, years, coordinates. */
export const NOT_A_MEASURE_NAME = /(^|_)(id|ids|code|fips|key|uuid|zip|rank|yr|year|month|day|date|ts|time|lat|lon|lng|latitude|longitude)($|_)/i;

/**
 * Auto-picked axes (radar spokes, parallel axes): drop code / id / time columns when at least
 * `min` real measures remain — a "state fips" spoke or a "year" axis compares nothing.
 */
export function preferMeasureAxes(indices: number[], columnNames: string[], min = 3): number[] {
  const measures = indices.filter((i) => !NOT_A_MEASURE_NAME.test(columnNames[i] ?? ""));
  return measures.length >= min ? measures : indices;
}
