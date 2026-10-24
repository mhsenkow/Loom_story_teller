// =================================================================
// Random encodings, shuffle locks and per-kind data-support checks.
// (split from recommendations.ts — LOOM-195; public API re-exported there)
// =================================================================

import { type ChartTimeRange, pickDefaultTimeField, suggestedChartTimeWindows } from "../chartTime";
import { inferType, measureColumns, yFieldSupportsLogScale } from "./columns";
import { createChartRec } from "./createChartRec";
import { isGeoRegionField } from "../geoFields";
import { geoMapDataSupport, getGeoMapRandomEncoding, isGeoMapKind } from "../geoMapsRec";
import { getGpuRandomEncoding, gpuSceneDataSupport, isGpuSceneKind } from "../gpuScenesRec";
import { getOddRandomEncoding, isOddChartKind, oddChartDataSupport } from "../oddChartsRec";
import { type ColumnInfo } from "../queryTypes";
import { recommend } from "./recommend";
import { CHART_KIND_OPTIONS, type ChartKind, type ChartRecommendation } from "./types";

export type EncodingShuffleLocks = {
  kind?: boolean;
  x?: boolean;
  y?: boolean;
  color?: boolean;
  size?: boolean;
  z?: boolean;
};

export type RandomEncoding = {
  xField: string;
  yField: string | null;
  colorField: string | null;
  sizeField?: string | null;
  zField?: string | null;
  /** Small-multiples facet (bar / line / area / scatter). */
  rowField?: string | null;
  /** Category cap for ranked bars. */
  topN?: number | null;
  /** Second Y overlay (line / area). */
  y2Field?: string | null;
  /** Overlay earlier half of a time series (line / area). */
  comparePrevious?: boolean | null;
  rollingWindow?: 7 | 30 | null;
  yScale?: "linear" | "log" | "symlog" | null;
  seriesNormalize?: "index100" | "zscore" | null;
  residualOverlay?: boolean | null;
  anomalyHighlight?: boolean | null;
  bumpMode?: "rank" | "delta" | null;
  pyramidScaleMode?: "auto" | "shared" | "independent" | null;
  barStackMode?: "grouped" | "stacked" | "percent" | null;
  timeWindowField?: string | null;
  timeWindow?: ChartTimeRange | null;
  /** Encoding → Direction (bar grow / iso floor). */
  layoutDirection?: "auto" | "up" | "down" | "right" | "left" | null;
};

const DIRECTION_RANDOM_KINDS = new Set<ChartKind>([
  "bar",
  "pareto",
  "lollipop",
  "waterfall",
  "isoBars",
  "isoScatter",
  "quakeTerrain",
]);
const DIRECTION_RANDOM_PICKS = ["up", "down", "right", "left"] as const;

export const FACET_RANDOM_KINDS = new Set<ChartKind>(["bar", "line", "area", "scatter", "bubble"]);
export const TOP_N_RANDOM_KINDS = new Set<ChartKind>(["bar", "pareto", "lollipop", "treemap", "sunburst", "forceBubble", "funnel", "waffle", "isotype", "radialBar", "isoBars", "pyramid", "rose"]);
export const COMPARE_RANDOM_KINDS = new Set<ChartKind>(["line", "area"]);
export const TOP_N_RANDOM_PICKS = [10, 15, 20, 30] as const;

/** Apply channel locks: keep pinned fields, fill the rest from a fresh random draw. */
export function applyEncodingLocks(
  drawn: RandomEncoding,
  locks: EncodingShuffleLocks | undefined,
  keep: Partial<RandomEncoding> | undefined,
): RandomEncoding {
  if (!locks || !keep) return drawn;
  return {
    xField: locks.x && keep.xField != null ? keep.xField : drawn.xField,
    yField: locks.y ? (keep.yField ?? null) : drawn.yField,
    colorField: locks.color ? (keep.colorField ?? null) : drawn.colorField,
    sizeField: locks.size ? (keep.sizeField ?? null) : drawn.sizeField,
    zField: locks.z ? (keep.zField ?? null) : drawn.zField,
    // Facet / Top N / Compare / DS always reshuffle with the draw (no lock chips yet).
    rowField: drawn.rowField,
    topN: drawn.topN,
    y2Field: drawn.y2Field,
    comparePrevious: drawn.comparePrevious,
    rollingWindow: drawn.rollingWindow,
    yScale: drawn.yScale,
    seriesNormalize: drawn.seriesNormalize,
    residualOverlay: drawn.residualOverlay,
    anomalyHighlight: drawn.anomalyHighlight,
    bumpMode: drawn.bumpMode,
    pyramidScaleMode: drawn.pyramidScaleMode,
    barStackMode: drawn.barStackMode,
    timeWindowField: keep.timeWindowField ?? drawn.timeWindowField ?? null,
    timeWindow: keep.timeWindow ?? drawn.timeWindow ?? null,
    layoutDirection: drawn.layoutDirection,
  };
}

/** Sprinkle Facet / Top N / Compare onto a base random encoding when the kind supports them. */
export function withRandomEncodingExtras(
  kind: ChartKind,
  columns: ColumnInfo[],
  base: RandomEncoding,
): RandomEncoding {
  const numCols = measureColumns(columns);
  const nomCols = columns.filter((c) => inferType(c.data_type, c.name, c.min_value, c.max_value) === "nominal");
  const pick = <T>(arr: T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)];
  const used = new Set(
    [base.xField, base.yField, base.colorField, base.sizeField].filter((v): v is string => !!v),
  );
  let rowField: string | null = null;
  let topN: number | null = null;
  let y2Field: string | null = null;
  let comparePrevious: boolean | null = null;
  let rollingWindow: 7 | 30 | null = null;
  let yScale: "linear" | "log" | "symlog" | null = null;
  let seriesNormalize: "index100" | "zscore" | null = null;
  let residualOverlay: boolean | null = null;
  let anomalyHighlight: boolean | null = null;
  let bumpMode: "rank" | "delta" | null = null;
  let pyramidScaleMode: "auto" | "shared" | "independent" | null = null;
  let timeWindowField: string | null = null;
  let timeWindow: ChartTimeRange | null = null;
  let layoutDirection: "auto" | "up" | "down" | "right" | "left" | null = null;

  if (FACET_RANDOM_KINDS.has(kind)) {
    const facetPool = nomCols.filter(
      (c) =>
        c.distinct_count >= 2 &&
        c.distinct_count <= 12 &&
        c.name !== base.xField &&
        // Prefer a second split dimension; allow reusing color for “both”
        (c.name !== base.colorField || Math.random() > 0.55),
    );
    if (facetPool.length > 0 && Math.random() < 0.48) {
      rowField = pick(facetPool)!.name;
      // Sometimes facet-only (clear color) so Split → Facet shows up in the shuffle
      if (base.colorField && rowField === base.colorField && Math.random() < 0.45) {
        base = { ...base, colorField: null };
      } else if (base.colorField && rowField !== base.colorField && Math.random() < 0.25) {
        // Color within facets
      } else if (!base.colorField && Math.random() < 0.3) {
        // leave facet alone
      }
    }
  }

  if (TOP_N_RANDOM_KINDS.has(kind) && Math.random() < 0.65) {
    topN = pick([...TOP_N_RANDOM_PICKS]) ?? 20;
  }

  if (COMPARE_RANDOM_KINDS.has(kind)) {
    const y2Pool = numCols.filter((c) => c.name !== base.yField && c.name !== base.xField && !used.has(c.name));
    if (y2Pool.length > 0 && base.yField && Math.random() < 0.36) {
      y2Field = pick(y2Pool)!.name;
    }
    if (Math.random() < 0.28) comparePrevious = true;
    if (Math.random() < 0.32) rollingWindow = Math.random() < 0.55 ? 7 : 30;
    if (Math.random() < 0.22) seriesNormalize = Math.random() < 0.65 ? "index100" : "zscore";
    if (Math.random() < 0.18) {
      const pickLog = Math.random() < 0.7 ? "log" : "symlog";
      yScale = pickLog === "log" && !yFieldSupportsLogScale(base.yField, columns) ? "symlog" : pickLog;
    }
    if (Math.random() < 0.2) anomalyHighlight = true;
  }

  if (kind === "scatter") {
    if (Math.random() < 0.28) residualOverlay = true;
    if (Math.random() < 0.22) anomalyHighlight = true;
    if (Math.random() < 0.14 && yFieldSupportsLogScale(base.yField, columns)) yScale = "log";
  }

  if (yScale === "log" && !yFieldSupportsLogScale(base.yField, columns)) yScale = null;

  if (kind === "bump" && Math.random() < 0.4) bumpMode = "delta";
  if (kind === "pyramid" && Math.random() < 0.55) {
    pyramidScaleMode = pick(["shared", "independent", "auto"] as const) ?? "auto";
  }

  if (DIRECTION_RANDOM_KINDS.has(kind) && Math.random() < 0.38) {
    layoutDirection = pick([...DIRECTION_RANDOM_PICKS]) ?? "up";
  }

  const timeCol = pickDefaultTimeField(columns, base);
  if (timeCol && Math.random() < 0.42) {
    const windows = suggestedChartTimeWindows(timeCol);
    if (windows.length) {
      timeWindowField = timeCol;
      timeWindow = pick(windows) ?? windows[0]!;
    }
  }

  return {
    ...base,
    rowField,
    topN,
    y2Field,
    comparePrevious,
    rollingWindow,
    yScale,
    seriesNormalize,
    residualOverlay,
    anomalyHighlight,
    bumpMode,
    pyramidScaleMode,
    timeWindowField,
    timeWindow,
    layoutDirection,
  };
}

/** Pick a random valid encoding for the given chart kind. Returns null if no valid combo.
 *  Often includes a colorField when nominal columns exist (scatter/bar/line/bubble/…).
 *  Also may set Facet / Top N / Compare Y when the kind supports them. */
export function getRandomEncoding(
  columns: ColumnInfo[],
  kind: ChartKind,
): RandomEncoding | null {
  const numCols = measureColumns(columns);
  const nomCols = columns.filter((c) => inferType(c.data_type, c.name, c.min_value, c.max_value) === "nominal");
  const timeCols = columns.filter((c) => inferType(c.data_type, c.name, c.min_value, c.max_value) === "temporal");
  const pick = <T>(arr: T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)];
  const finish = (enc: RandomEncoding) => withRandomEncodingExtras(kind, columns, enc);

  switch (kind) {
    case "scatter": {
      if (numCols.length < 2) return null;
      const x = pick(numCols)!;
      const y = pick(numCols.filter(c => c.name !== x.name)) ?? pick(numCols)!;
      if (x.name === y.name) return null;
      const color = nomCols.length > 0 && nomCols.some(c => c.distinct_count <= 20) ? pick(nomCols.filter(c => c.distinct_count <= 20)) ?? null : null;
      const sizeCol = numCols.length >= 3 && Math.random() > 0.5 ? pick(numCols.filter(c => c.name !== x.name && c.name !== y.name)) ?? null : null;
      return finish({ xField: x.name, yField: y.name, colorField: color?.name ?? null, sizeField: sizeCol?.name ?? null });
    }
    case "bar":
    case "pareto": {
      const xBar = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= (kind === "pareto" ? 40 : 50)));
      if (!xBar) return null;
      const yBar = numCols.length > 0 && Math.random() > 0.3 ? pick(numCols)! : null;
      const colorBar =
        kind === "bar" && nomCols.length > 0 && nomCols.some(c => c.name !== xBar.name)
          ? pick(nomCols.filter(c => c.name !== xBar.name)) ?? null
          : null;
      return finish({ xField: xBar.name, yField: yBar?.name ?? null, colorField: colorBar?.name ?? null });
    }
    case "corrMatrix": {
      if (numCols.length < 3) return null;
      const shuffled = [...numCols].sort(() => Math.random() - 0.5).slice(0, 8);
      return finish({ xField: shuffled[0]!.name, yField: shuffled[1]!.name, colorField: null });
    }
    case "histogram": {
      const xHist = pick(numCols);
      if (!xHist) return null;
      return finish({ xField: xHist.name, yField: null, colorField: null });
    }
    case "line":
    case "area": {
      if (timeCols.length === 0) return null;
      const xTime = pick(timeCols);
      if (!xTime) return null;
      // Prefer a numeric Y; count-only series still render when yField is null.
      const yVal = numCols.length > 0 ? pick(numCols)! : null;
      const colorLine = nomCols.length > 0 && nomCols.some(c => c.distinct_count <= 15) ? pick(nomCols.filter(c => c.distinct_count <= 15 && c.name !== xTime.name)) ?? null : null;
      return finish({ xField: xTime.name, yField: yVal?.name ?? null, colorField: colorLine?.name ?? null });
    }
    case "heatmap": {
      if (numCols.length >= 2 && Math.random() > 0.4) {
        const a = pick(numCols)!;
        const b = pick(numCols.filter((c) => c.name !== a.name)) ?? numCols.find((c) => c.name !== a.name);
        if (a && b) return finish({ xField: a.name, yField: b.name, colorField: null });
      }
      const a = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 20));
      const b = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 20 && c.name !== a?.name));
      if (!a || !b) return null;
      return finish({ xField: a.name, yField: b.name, colorField: null });
    }
    case "strip": {
      const xStrip = pick(numCols);
      const yStrip = pick(nomCols);
      if (!xStrip || !yStrip) return null;
      const colorStrip = nomCols.length > 0 && Math.random() > 0.4 ? pick(nomCols.filter(c => c.distinct_count <= 15)) ?? null : null;
      return finish({ xField: xStrip.name, yField: yStrip.name, colorField: colorStrip?.name ?? null });
    }
    case "box": {
      const xBox = pick(nomCols.filter(c => c.distinct_count >= 2));
      const yBox = pick(numCols);
      if (!xBox || !yBox) return null;
      return finish({ xField: xBox.name, yField: yBox.name, colorField: null });
    }
    case "pie": {
      const xPie = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 15));
      if (!xPie) return null;
      const yPie = numCols.length > 0 && Math.random() > 0.4 ? pick(numCols)! : null;
      return finish({ xField: xPie.name, yField: yPie?.name ?? null, colorField: null });
    }
    case "bubble": {
      if (numCols.length < 2) return null;
      const shuffled = [...numCols].sort(() => Math.random() - 0.5);
      const color = nomCols.length > 0 && nomCols.some(c => c.distinct_count <= 15) ? pick(nomCols.filter(c => c.distinct_count <= 15)) ?? null : null;
      return finish({
        xField: shuffled[0]!.name,
        yField: shuffled[1]!.name,
        colorField: color?.name ?? null,
        sizeField: shuffled[2]?.name ?? null,
      });
    }
    case "violin": {
      const xViolin = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 12));
      const yViolin = pick(numCols);
      if (!xViolin || !yViolin) return null;
      const colorViolin = nomCols.length > 1 && Math.random() > 0.5 ? pick(nomCols.filter(c => c.name !== xViolin.name && c.distinct_count <= 8)) ?? null : null;
      return finish({ xField: xViolin.name, yField: yViolin.name, colorField: colorViolin?.name ?? null });
    }
    case "radar": {
      if (numCols.length < 3) return null;
      const x = pick(numCols)!;
      const y = pick(numCols.filter(c => c.name !== x.name));
      const color = nomCols.length > 0 && nomCols.some(c => c.distinct_count >= 2 && c.distinct_count <= 8) ? pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 8)) ?? null : null;
      return finish({ xField: x.name, yField: y?.name ?? null, colorField: color?.name ?? null });
    }
    case "waterfall": {
      const xWf = pick(nomCols.filter(c => c.distinct_count >= 3 && c.distinct_count <= 20));
      if (!xWf) return null;
      const yWf = numCols.length > 0 ? pick(numCols)! : null;
      return finish({ xField: xWf.name, yField: yWf?.name ?? null, colorField: null });
    }
    case "lollipop": {
      const xLol = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 30));
      if (!xLol) return null;
      const yLol = numCols.length > 0 ? pick(numCols)! : null;
      const colorLol = nomCols.length > 1 && Math.random() > 0.6 ? pick(nomCols.filter(c => c.name !== xLol.name && c.distinct_count <= 10)) ?? null : null;
      return finish({ xField: xLol.name, yField: yLol?.name ?? null, colorField: colorLol?.name ?? null });
    }
    case "dumbbell": {
      if (numCols.length < 2) return null;
      const xDb = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 24));
      if (!xDb) return null;
      const shuffled = [...numCols].sort(() => Math.random() - 0.5);
      const colorDb = nomCols.length > 1 && Math.random() > 0.6
        ? pick(nomCols.filter(c => c.name !== xDb.name && c.distinct_count <= 8)) ?? null
        : null;
      return finish({
        xField: xDb.name,
        yField: shuffled[0]!.name,
        colorField: colorDb?.name ?? null,
        sizeField: shuffled[1]!.name,
      });
    }
    case "ridgeline": {
      const yRidge = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 10));
      const xRidge = pick(numCols);
      if (!xRidge || !yRidge) return null;
      return finish({ xField: xRidge.name, yField: yRidge.name, colorField: null });
    }
    case "hexbin": {
      if (numCols.length < 2) return null;
      const a = pick(numCols)!;
      const b = pick(numCols.filter(c => c.name !== a.name)) ?? numCols.find(c => c.name !== a.name);
      if (!b) return null;
      return finish({ xField: a.name, yField: b.name, colorField: null });
    }
    case "funnel": {
      const xFun = pick(nomCols.filter(c => c.distinct_count >= 3 && c.distinct_count <= 12));
      if (!xFun) return null;
      const yFun = numCols.length > 0 ? pick(numCols)! : null;
      return finish({ xField: xFun.name, yField: yFun?.name ?? null, colorField: null });
    }
    case "parallel": {
      if (numCols.length < 3) return null;
      const x = pick(numCols)!;
      const y = pick(numCols.filter(c => c.name !== x.name));
      const color = nomCols.find(c => c.distinct_count >= 2 && c.distinct_count <= 10) ?? null;
      return finish({ xField: x.name, yField: y?.name ?? null, colorField: color?.name ?? null });
    }
    case "treemap": {
      const xTree = pick(nomCols.filter(c => c.distinct_count >= 3 && c.distinct_count <= 30));
      if (!xTree) return null;
      const yTree = numCols.length > 0 ? pick(numCols)! : null;
      const colorTree = nomCols.length > 1 ? pick(nomCols.filter(c => c.name !== xTree.name && c.distinct_count <= 10)) ?? null : null;
      return finish({ xField: xTree.name, yField: yTree?.name ?? null, colorField: colorTree?.name ?? null });
    }
    case "sunburst": {
      const xSun = pick(nomCols.filter(c => c.distinct_count >= 3 && c.distinct_count <= 20));
      if (!xSun) return null;
      const ySun = numCols.length > 0 ? pick(numCols)! : null;
      const innerSun = nomCols.length > 1 ? pick(nomCols.filter(c => c.name !== xSun.name && c.distinct_count <= 8)) ?? null : null;
      return finish({ xField: xSun.name, yField: ySun?.name ?? null, colorField: innerSun?.name ?? null });
    }
    case "choropleth": {
      const geoCols = nomCols.filter(c => isGeoRegionField(c.name) && c.distinct_count >= 3);
      const geoCol = geoCols.length > 0 ? pick(geoCols)! : pick(nomCols.filter(c => c.distinct_count >= 3));
      if (!geoCol) return null;
      const yGeo = numCols.length > 0 ? pick(numCols)! : null;
      return finish({ xField: geoCol.name, yField: yGeo?.name ?? null, colorField: null });
    }
    case "forceBubble": {
      const xForce = pick(nomCols.filter(c => c.distinct_count >= 3 && c.distinct_count <= 40));
      if (!xForce) return null;
      const yForce = numCols.length > 0 ? pick(numCols)! : null;
      const colorForce = nomCols.length > 1 ? pick(nomCols.filter(c => c.name !== xForce.name && c.distinct_count <= 12)) ?? null : null;
      return finish({ xField: xForce.name, yField: yForce?.name ?? null, colorField: colorForce?.name ?? null });
    }
    case "sankey":
    case "network":
    case "arcDiagram": {
      if (nomCols.length < 2) return null;
      const flowNom = nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 20);
      const a = pick(flowNom);
      if (!a) return null;
      const b = pick(flowNom.filter(c => c.name !== a.name));
      if (!b) return null;
      const yVal = numCols.length > 0 && Math.random() > 0.3 ? pick(numCols)! : null;
      return finish({ xField: a.name, yField: yVal?.name ?? null, colorField: b.name });
    }
    default:
      if (isGpuSceneKind(kind)) return getGpuRandomEncoding(columns, kind);
      if (isGeoMapKind(kind)) return getGeoMapRandomEncoding(columns, kind);
      if (isOddChartKind(kind)) return getOddRandomEncoding(columns, kind);
      return null;
  }
}

export const ALL_CHART_KINDS: ChartKind[] = CHART_KIND_OPTIONS.map(o => o.value);

/** Whether the schema can ever satisfy this chart type (deterministic; for UI disabling). */
export function chartKindDataSupport(columns: ColumnInfo[], kind: ChartKind): { ok: boolean; reason: string } {
  const numCols = measureColumns(columns);
  const nomCols = columns.filter((c) => inferType(c.data_type, c.name, c.min_value, c.max_value) === "nominal");
  const timeCols = columns.filter((c) => inferType(c.data_type, c.name, c.min_value, c.max_value) === "temporal");
  const nom = (min: number, max: number) => nomCols.filter(c => c.distinct_count >= min && c.distinct_count <= max);

  switch (kind) {
    case "scatter":
      return numCols.length >= 2 ? { ok: true, reason: "" } : { ok: false, reason: "Need ≥2 numeric columns" };
    case "bubble":
      return numCols.length >= 2 ? { ok: true, reason: "" } : { ok: false, reason: "Need ≥2 numeric columns" };
    case "histogram":
      return numCols.length >= 1 ? { ok: true, reason: "" } : { ok: false, reason: "Need a numeric column" };
    case "bar":
    case "pareto":
    case "lollipop":
      return nom(2, kind === "lollipop" ? 30 : kind === "pareto" ? 40 : 50).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (2–" + (kind === "lollipop" ? "30" : kind === "pareto" ? "40" : "50") + " distinct values)" };
    case "corrMatrix":
      return numCols.length >= 3
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need ≥3 numeric columns" };
    case "dumbbell":
      return nom(2, 24).length >= 1 && numCols.length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (2–24) + two numeric columns" };
    case "ridgeline":
      return nomCols.some(c => c.distinct_count >= 2 && c.distinct_count <= 10) && numCols.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need category (2–10 groups) + numeric" };
    case "hexbin":
      return numCols.length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need ≥2 numeric columns" };
    case "funnel":
      return nom(3, 12).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (3–12 stages)" };
    case "parallel":
      return numCols.length >= 3
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need ≥3 numeric columns" };
    case "line":
    case "area":
      return (timeCols.length > 0 || nomCols.length > 0)
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a date/time or text column for X" };
    case "pie":
      return nom(2, 15).length >= 1 ? { ok: true, reason: "" } : { ok: false, reason: "Need a category (2–15 distinct)" };
    case "heatmap":
      return numCols.length >= 2 || nom(2, 20).length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need two numeric columns (density) or two categories (2–20 distinct)" };
    case "strip":
      return numCols.length >= 1 && nomCols.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need one numeric + one category" };
    case "box":
      return nomCols.some(c => c.distinct_count >= 2) && numCols.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need category + numeric" };
    case "violin":
      return nomCols.some(c => c.distinct_count >= 2 && c.distinct_count <= 12) && numCols.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need category (2–12 groups) + numeric" };
    case "radar":
      return numCols.length >= 3 ? { ok: true, reason: "" } : { ok: false, reason: "Need ≥3 numeric columns" };
    case "waterfall":
      return nom(3, 20).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (3–20 distinct values)" };
    case "treemap":
      return nom(3, 30).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (3–30 distinct values)" };
    case "sunburst":
      return nom(3, 20).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (3–20 distinct values)" };
    case "forceBubble":
      return nom(3, 40).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (3–40 distinct values)" };
    case "choropleth": {
      // A filled map needs countries / states — any other category matches nothing
      const geo = nomCols.filter(c => isGeoRegionField(c.name) && c.distinct_count >= 3);
      return geo.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a country or state column" };
    }
    case "sankey":
    case "network":
    case "arcDiagram":
      return nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 20).length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need two categories (2–20 distinct each)" };
    default:
      if (isGpuSceneKind(kind)) return gpuSceneDataSupport(columns, kind);
      if (isGeoMapKind(kind)) return geoMapDataSupport(columns, kind);
      if (isOddChartKind(kind)) return oddChartDataSupport(columns, kind);
      return { ok: true, reason: "" };
  }
}

/**
 * Random chart that passes createChartRec + schema support. Retries encodings;
 * falls back to top recommend() result. Optional locks keep kind / channels.
 */
export function tryBuildRandomChartRec(
  columns: ColumnInfo[],
  tableName: string,
  opts?: {
    locks?: EncodingShuffleLocks;
    keep?: Partial<RandomEncoding> & { kind?: ChartKind };
  },
): ChartRecommendation | null {
  if (columns.length === 0) return null;
  const locks = opts?.locks ?? {};
  const keep = opts?.keep;
  const supported = ALL_CHART_KINDS.filter((k) => chartKindDataSupport(columns, k).ok);
  let pool = supported.length > 0 ? supported : ALL_CHART_KINDS;
  if (locks.kind && keep?.kind && pool.includes(keep.kind)) {
    pool = [keep.kind];
  }
  for (let round = 0; round < 4; round++) {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    for (const kind of shuffled) {
      for (let att = 0; att < 14; att++) {
        const drawn = getRandomEncoding(columns, kind);
        if (!drawn) break;
        const enc = applyEncodingLocks(drawn, locks, keep);
        const extra = randomEncodingToExtra(enc);
        const rec = createChartRec(kind, columns, enc.xField, enc.yField, enc.colorField, tableName, extra);
        if (rec) return rec;
      }
    }
  }
  const recs = recommend(columns, null, tableName);
  return recs[0] ?? null;
}

/** Pick a random chart kind and valid encoding. */
export function getRandomChartAndEncoding(
  columns: ColumnInfo[],
  tableName = "data",
): RandomEncoding & { kind: ChartKind } | null {
  const rec = tryBuildRandomChartRec(columns, tableName);
  if (!rec) return null;
  return {
    kind: rec.kind,
    xField: rec.xField,
    yField: rec.yField,
    colorField: rec.colorField,
    sizeField: rec.sizeField ?? undefined,
    rowField: rec.rowField ?? undefined,
    topN: rec.topN ?? undefined,
    y2Field: rec.y2Field ?? undefined,
    comparePrevious: rec.comparePrevious ?? undefined,
    rollingWindow: rec.rollingWindow ?? undefined,
    yScale: rec.yScale ?? undefined,
    seriesNormalize: rec.seriesNormalize ?? undefined,
    residualOverlay: rec.residualOverlay ?? undefined,
    anomalyHighlight: rec.anomalyHighlight ?? undefined,
    bumpMode: rec.bumpMode ?? undefined,
    pyramidScaleMode: rec.pyramidScaleMode ?? undefined,
    barStackMode: rec.barStackMode ?? undefined,
  };
}

/** Extra encoding fields from a random draw — for createChartRec / DetailPanel shuffle. */
export function randomEncodingToExtra(enc: RandomEncoding): NonNullable<Parameters<typeof createChartRec>[6]> {
  return {
    sizeField: enc.sizeField ?? null,
    zField: enc.zField ?? null,
    rowField: enc.rowField ?? null,
    topN: enc.topN ?? null,
    y2Field: enc.y2Field ?? null,
    comparePrevious: enc.comparePrevious ?? null,
    rollingWindow: enc.rollingWindow ?? null,
    yScale: enc.yScale ?? null,
    seriesNormalize: enc.seriesNormalize ?? null,
    residualOverlay: enc.residualOverlay ?? null,
    anomalyHighlight: enc.anomalyHighlight ?? null,
    bumpMode: enc.bumpMode ?? null,
    pyramidScaleMode: enc.pyramidScaleMode ?? null,
    barStackMode: enc.barStackMode ?? undefined,
    timeWindowField: enc.timeWindowField ?? null,
    timeWindow: enc.timeWindow && enc.timeWindow !== "all" ? enc.timeWindow : null,
    // Omit when unset so field shuffle keeps the current Direction from extraFromChart.
    ...(enc.layoutDirection && enc.layoutDirection !== "auto"
      ? { layoutDirection: enc.layoutDirection }
      : {}),
  };
}
