// =================================================================
// chartSpecParity — what each ChartKind's portable Vega-Lite spec means
// =================================================================
// Vega-Lite JSON is Loom's portable chart definition; pixels come from
// Canvas 2D / gated WebGPU. Not every kind can be expressed in Vega-Lite, so
// each ChartKind declares one of three honest tiers (LOOM-543):
//
//   native   — `spec.mark` is the chart's real Vega-Lite mark and the
//              x / y / color encodings round-trip (SVG export is faithful
//              modulo theme).
//   stand-in — `spec` carries the encoding fields plus the nearest Vega-Lite
//              mark so links, export gating and field pickers work, but the
//              geometry (layout, simulation, 3D, map projection …) is drawn
//              only by Loom's custom renderer. `limitation` says what an
//              SVG/Vega consumer would lose.
//   none     — `spec` is `{}`; fields live on the recommendation only.
//
// `src/lib/__tests__/chartSpecParity.test.ts` builds a real recommendation for
// every kind and fails when the registry and `createChartRec` drift apart.
// `src/lib/vega.ts` (generateScatterSpec / generateBarSpec / …) currently has
// no importers; it is kept as reference builders, not part of this contract.
// =================================================================

import type { ChartKind } from "./recommendations";

export type SpecParityTier = "native" | "stand-in" | "none";

export interface ChartSpecParity {
  portable: SpecParityTier;
  /** Vega-Lite mark type `createChartRec` emits (null when `portable` is `none`). */
  vegaMark: string | null;
  /** Required for stand-in / none: what the portable spec cannot represent. */
  limitation: string | null;
}

const native = (vegaMark: string): ChartSpecParity => ({ portable: "native", vegaMark, limitation: null });
const standIn = (vegaMark: string, limitation: string): ChartSpecParity => ({
  portable: "stand-in",
  vegaMark,
  limitation,
});

const LAYOUT_NOT_IN_VEGA = "Layout is computed by Loom's canvas renderer; the spec only carries encoding fields.";
const NO_VEGA_MARK = "No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields.";
const GPU_SCENE = "3D / particle scene drawn by WebGPU or the Canvas fallback; the spec is a 2D circle stand-in.";
const GEO_CUSTOM = "Map projection and geometry are drawn by Loom's map renderer; the spec is a circle stand-in.";

export const CHART_SPEC_PARITY = {
  scatter: native("circle"),
  bubble: native("circle"),
  line: native("line"),
  area: native("area"),
  bar: native("bar"),
  histogram: native("bar"),
  heatmap: native("rect"),
  box: native("boxplot"),
  strip: native("tick"),
  pie: native("arc"),

  hexbin: standIn("rect", "Hex binning is done by Loom; Vega-Lite has no hexbin mark, so the spec shows square cells."),
  lollipop: standIn("circle", "Stems are drawn by Loom; the spec only encodes the dots."),
  dumbbell: standIn("rule", "End-point dots are drawn by Loom; the spec only encodes the connecting rule."),
  funnel: standIn("bar", "Centered, tapering stages are drawn by Loom; the spec is plain bars."),
  waterfall: standIn("bar", "Running-total offsets are computed by Loom; the spec is plain bars."),
  violin: standIn("area", "Kernel density and mirroring are computed by Loom."),
  ridgeline: standIn("area", "Density and row overlap are computed by Loom."),
  radar: standIn("line", "Polar axes are drawn by Loom; the spec is a Cartesian line."),
  parallel: standIn("line", "Per-axis normalisation is done by Loom; the spec is a plain line."),
  treemap: standIn("rect", LAYOUT_NOT_IN_VEGA),
  sunburst: standIn("arc", LAYOUT_NOT_IN_VEGA),
  forceBubble: standIn("circle", LAYOUT_NOT_IN_VEGA),
  sankey: standIn("rect", LAYOUT_NOT_IN_VEGA),
  network: standIn("rect", LAYOUT_NOT_IN_VEGA),
  arcDiagram: standIn("rect", LAYOUT_NOT_IN_VEGA),
  pareto: standIn("bar", "The cumulative-percent line layer is added by Loom; the spec is the bar layer only."),
  choropleth: standIn("geoshape", GEO_CUSTOM),
  bucketField: standIn("circle", NO_VEGA_MARK),
  beeswarm: standIn("circle", "Collision-free packing is computed by Loom."),
  chernoff: standIn("circle", NO_VEGA_MARK),
  glyphStar: standIn("circle", NO_VEGA_MARK),
  waffle: standIn("circle", NO_VEGA_MARK),
  isotype: standIn("circle", NO_VEGA_MARK),
  pyramid: standIn("circle", NO_VEGA_MARK),
  slope: standIn("circle", NO_VEGA_MARK),
  bump: standIn("circle", NO_VEGA_MARK),
  stream: standIn("circle", NO_VEGA_MARK),
  horizon: standIn("circle", NO_VEGA_MARK),
  spiral: standIn("circle", NO_VEGA_MARK),
  radialBar: standIn("circle", NO_VEGA_MARK),
  chord: standIn("circle", NO_VEGA_MARK),
  voronoi: standIn("circle", NO_VEGA_MARK),
  isoBars: standIn("circle", NO_VEGA_MARK),
  isoScatter: standIn("circle", NO_VEGA_MARK),
  flower: standIn("circle", NO_VEGA_MARK),
  mosaic: standIn("circle", NO_VEGA_MARK),
  contour: standIn("circle", NO_VEGA_MARK),
  calendar: standIn("circle", "The week × weekday grid is laid out by Loom; the spec is plain day cells."),
  rose: standIn("circle", "Area-true polar wedges are drawn by Loom; the spec is a plain arc."),
  ecdf: standIn("circle", "Cumulative shares are computed by Loom; the spec is a plain line."),
  density: standIn("circle", "Kernel density is computed by Loom; the spec only encodes the values."),
  qq: standIn("circle", "Normal quantiles are computed by Loom; the spec only encodes the values."),
  connectedScatter: standIn("circle", "The ordered path and arrows are drawn by Loom; the spec encodes the points."),
  stripes: standIn("circle", "Stripe coloring around the average is computed by Loom."),
  wordCloud: standIn("circle", "Word layout is computed by Loom; the spec only encodes the values."),
  errorBars: standIn("circle", "Means and confidence intervals are computed by Loom."),
  sparkGrid: standIn("circle", "Per-panel scales are drawn by Loom; the spec is a single line."),
  scatter3d: standIn("circle", GPU_SCENE),
  trailRibbon: standIn("circle", GPU_SCENE),
  quakeTerrain: standIn("circle", GPU_SCENE),
  firefly: standIn("circle", GPU_SCENE),
  loomWeave: standIn("circle", GPU_SCENE),
  dataCube: standIn("rect", "Voxel cube is drawn by WebGPU or the Canvas fallback; the spec is a 2D rect grid."),
  geoPoints: standIn("circle", GEO_CUSTOM),
  geoBubbles: standIn("circle", GEO_CUSTOM),
  geoHex: standIn("circle", GEO_CUSTOM),
  globe: standIn("circle", GEO_CUSTOM),
  globeTrail: standIn("circle", GEO_CUSTOM),
  arcMap: standIn("circle", GEO_CUSTOM),

  corrMatrix: {
    portable: "none",
    vegaMark: null,
    limitation: "Correlation matrix is drawn by Loom from numeric columns; `spec` is empty (no SVG export).",
  },
} as const satisfies Record<ChartKind, ChartSpecParity>;

export function chartSpecParity(kind: ChartKind): ChartSpecParity {
  return CHART_SPEC_PARITY[kind];
}

/** Kinds whose portable spec is a faithful Vega-Lite chart. */
export function isNativeVegaKind(kind: ChartKind): boolean {
  return CHART_SPEC_PARITY[kind].portable === "native";
}
