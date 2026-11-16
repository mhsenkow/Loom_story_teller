// Pure chart contract types. No React, store, renderer or browser imports.
import type { ChartKind } from "../recs/types";

export interface ChartCapabilities {
  cartesian: boolean;
  /** Configurable grid, separate from fixed cell/rank guides and axis labels. */
  grid: boolean;
  /** Primary category / X slot — false when canvas ignores encoding X (e.g. radar uses all numerics). */
  xChannel: boolean;
  yChannel: boolean;
  /** Third spatial axis (scatter3d Z, data cube depth). */
  zChannel: boolean;
  colorChannel: boolean;
  sizeChannel: boolean;
  aggregate: boolean;
  /** Row facet / small multiples (bar, line, area, scatter). */
  facetRow: boolean;
  /** Top-N category limit control (bar and other aggregated category charts). */
  topN: boolean;
  /** Group into N — chunk a discrete color or shape field. */
  groupChannels: boolean;
  /** Second Y measure overlay (line / area). */
  compareY: boolean;
  /** Overlay earlier half of ordered X (line / area / bar). */
  comparePrevious: boolean;
  /** Dual-measure Δ / % labels (dumbbell, slope, pyramid). */
  deltaDisplay: boolean;
  markPoints: boolean;
  /** Point size + one marker (shape or emoji) for every point. */
  pointMarker: boolean;
  /** Per-row category shapes or emoji glyphs. */
  symbolChannel: boolean;
  opacityChannel: boolean;
  glowOutline: boolean;
  markMotif: boolean;
  barMarks: boolean;
  lineMarks: boolean;
  dataLabels: boolean;
  legend: boolean;
  referenceLines: boolean;
  scatterExtras: boolean;
  /** emphasisStyle is stored but not applied by the canvas renderer yet */
  emphasis: boolean;
  /** Hover readout honors Encoding Tooltip fields (false for GPU scenes / most geo maps). */
  tooltipHover: boolean;
  /** Up / down / left / right layout (bar, lollipop, and similar band charts). */
  layoutDirection: boolean;
  /** Continuous measure axis transform (linear / log / symlog). */
  yScale: boolean;
  /**
   * `tickRotation` only rotates continuous X tick labels from `drawChartTicks`.
   * Category band labels and horizontal-bar tip labels ignore it — hide the control.
   */
  tickLabelRotation: boolean;
  /** Rolling mean window on line / area. */
  rollingWindow: boolean;
  /** Index-100 / z-score rebase for multi-series line / area. */
  seriesNormalize: boolean;
  /** Scatter residual stems vs linear fit. */
  residualOverlay: boolean;
  /** Scatter / line outlier rings. */
  anomalyHighlight: boolean;
  /** Bump chart Δrank vs absolute rank. */
  bumpMode: boolean;
  /** Word cloud: Cloud / Compare / Grid. */
  wordCloudMode: boolean;
  /** Mirror pyramid: same scale vs separate scales vs auto. */
  pyramidScaleMode: boolean;
}

export type ChartFamily = "classic" | "odd" | "scene" | "geo";
export type ChartFieldType = "quantitative" | "nominal" | "temporal";
export type ChartChannelId = "x" | "y" | "color" | "size" | "z";
export type ChartVisualSectionId = "personal" | "design" | "color" | "look" | "cloud" | "type" | "map" | "marks" | "axes" | "layout" | "atmosphere" | "notes";
export type ChartTransform = "aggregate" | "facetRow" | "topN" | "groupChannels" | "compareY" | "comparePrevious" | "deltaDisplay" | "layoutDirection" | "yScale" | "rollingWindow" | "seriesNormalize" | "residualOverlay" | "anomalyHighlight" | "bumpMode" | "wordCloudMode" | "pyramidScaleMode";
export interface ChartChannelDefinition {
  readonly label: string;
  readonly accepts: readonly ChartFieldType[];
  readonly enabled: boolean;
  readonly required: boolean;
  readonly primary: boolean;
}
export interface ChartSpecParity {
  readonly portable: "native" | "stand-in" | "none";
  readonly vegaMark: string | null;
  readonly limitation: string | null;
}
export interface ChartVisualSection {
  readonly id: ChartVisualSectionId;
  readonly title: string;
  readonly defaultOpen: boolean;
}
export type ChartEncodingAdaptation = "CATEGORY_X_KINDS" | "IDENTITY_X_KINDS" | "CATEGORY_Y_KINDS" | "ORDERED_X_KINDS" | "NUMERIC_XY_KINDS" | "NUMERIC_X_KINDS" | "NUMERIC_Y_KINDS" | "PART_TO_WHOLE_KINDS" | "CATEGORY_COLOR_KINDS";
export type ChartAnalysisBasis = "bars" | "series" | "coordinates" | "cells" | "rows";
export interface ChartDefinition {
  readonly kind: ChartKind;
  readonly label: string;
  readonly family: ChartFamily;
  readonly capabilities: Readonly<ChartCapabilities>;
  /** Statistical unit, independent of decorative renderer geometry. */
  readonly analysis: { readonly basis: ChartAnalysisBasis; readonly overlay: "marks" | "cube" | "none"; readonly forecast: "ordered-source" };
  readonly channels: Readonly<Record<ChartChannelId, ChartChannelDefinition>>;
  readonly transforms: readonly ChartTransform[];
  readonly adaptation: readonly ChartEncodingAdaptation[];
  readonly defaultAggregate: "sum" | "mean";
  readonly requirements: { readonly y: boolean; readonly numericColumns: number; readonly varyingNumericColumns: boolean; readonly target: boolean; readonly distinctEnd: boolean };
  readonly render: { readonly canvas: ChartFamily; readonly gpu: "none" | "scatter" | "scene" | "cube" | "gated-globe" };
  readonly interactions: { readonly navigation: "scatter" | "marks" | "cube"; readonly camera: boolean; readonly picking: "scatter" | "marks" | "cube-ray" | "geo" };
  readonly exports: { readonly png: "canvas-capture"; readonly svg: ChartSpecParity };
  readonly inspector: { readonly visualSections: readonly ChartVisualSection[]; readonly seriesTools: boolean };
}

export const CHART_CAPABILITY_KEYS = ["cartesian", "grid", "xChannel", "yChannel", "zChannel", "colorChannel", "sizeChannel", "aggregate", "facetRow", "topN", "groupChannels", "compareY", "comparePrevious", "deltaDisplay", "markPoints", "pointMarker", "symbolChannel", "opacityChannel", "glowOutline", "markMotif", "barMarks", "lineMarks", "dataLabels", "legend", "referenceLines", "scatterExtras", "emphasis", "tooltipHover", "layoutDirection", "yScale", "tickLabelRotation", "rollingWindow", "seriesNormalize", "residualOverlay", "anomalyHighlight", "bumpMode", "wordCloudMode", "pyramidScaleMode"] as const satisfies readonly (keyof ChartCapabilities)[];
// Adding a capability requires classifying it in the contract builder as well.
export const CHART_CAPABILITIES_COMPLETE = true satisfies (Exclude<keyof ChartCapabilities, typeof CHART_CAPABILITY_KEYS[number]> extends never ? true : never);
