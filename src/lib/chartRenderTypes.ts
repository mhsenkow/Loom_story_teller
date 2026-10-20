// =================================================================
// ChartRenderOpts — per-paint canvas renderer configuration
// =================================================================
// Shared by ChartView and extracted canvas chart modules (LOOM-142).
// =================================================================

import type { PlotRect } from "./chartLooks";
import type { HitTarget } from "./chartTooltip";
import type { YAggregateOption } from "./recommendations";

export interface ChartRenderOpts {
  analysis?: import("./timeSeriesAnalysis").TimeSeriesAnalysis;
  /** Thumbnail paint uses the same marks without axis/grid chrome. */
  mini?: boolean;
  plotBounds?: PlotRect;
  plotX?: number;
  plotY?: number;
  plotWidth?: number;
  plotHeight?: number;
  legendOffsetX?: number;
  legendOffsetY?: number;
  legendWidth?: number;
  legendHeight?: number;
  titleX?: number;
  titleY?: number;
  titleWidth?: number;
  titleScale?: number;
  colors: string[];
  continuousStops?: string[];
  opacity: number;
  opacityUserSet?: boolean;
  pointSize: number;
  fontFamily?: string;
  titleFontWeight?: number;
  titleItalic?: boolean;
  tickRotation?: number;
  axisFontSize?: number;
  markShape?: string;
  markerMode?: "shape" | "emoji";
  markEmoji?: string;
  shapeField?: string | null;
  emojiField?: string | null;
  emojiMap?: import("./chartEmoji").ChartEmojiMap | null;
  markMaterial?: "flat" | "glaze" | "satin" | "ink" | "etched";
  markStroke?: boolean;
  markStrokeWidth?: number;
  markStrokeColor?: string;
  markJitter?: number;
  sizeScale?: number;
  /** High values draw as the low end of the named channels. */
  channelInvert?: import("./channelInvert").ChannelInvert;
  barCornerRadius?: number;
  lineStrokeStyle?: string;
  lineCurveSmooth?: boolean;
  lineWidth?: number;
  lineCap?: "round" | "butt" | "square";
  lineJoin?: "round" | "bevel" | "miter";
  axisLineColor?: string;
  axisLineWidth?: number;
  gridStyle?: string;
  gridOpacity?: number;
  tickCount?: number;
  axisLabelColor?: string;
  showGrid?: boolean;
  chartPadding?: number;
  spaceUse?: "auto" | "fill" | "roomy";
  rowSourceIndices?: number[];
  legendPosition?: string;
  showDataLabels?: boolean;
  backgroundStyle?: string;
  blendMode?: string;
  glowEnabled?: boolean;
  glowIntensity?: number;
  chartDetail?: string;
  markMotif?: string;
  axisStyle?: string;
  emphasisStyle?: string;
  ghostEnabled?: boolean;
  ghostWeight?: string;
  ghostPlace?: string;
  titleLayout?: string;
  chartFrame?: string;
  sourceFootnote?: boolean;
  chromeInfoBand?: "footer" | "header";
  sourceFootnoteAlign?: "left" | "center" | "right";
  themeBg?: string;
  themeText?: string;
  themeMuted?: string;
  themeBorder?: string;
  yAggregate?: YAggregateOption | null;
  barStackMode?: "grouped" | "stacked" | "percent";
  topN?: number | null;
  y2Field?: string | null;
  comparePrevious?: boolean | null;
  rollingWindow?: 7 | 30 | null;
  yScale?: "linear" | "log" | "symlog" | null;
  seriesNormalize?: "index100" | "zscore" | null;
  residualOverlay?: boolean | null;
  anomalyHighlight?: boolean | null;
  layoutDirection?: "auto" | "up" | "down" | "right" | "left" | null;
  bumpMode?: "rank" | "delta" | null;
  pyramidScaleMode?: "auto" | "shared" | "independent" | null;
  /** Dual-measure delta ink: off / signed diff / percent. */
  deltaDisplay?: "off" | "diff" | "pct" | null;
  hits?: HitTarget[];
  fieldNames?: string[];
  /** Numeric heat measure for heatmap / hexbin; absent means row count. */
  colorField?: string | null;
  legend?: { label: string; color: string; shape?: string; glyph?: string }[] | null;
  scales?: { x?: (v: number) => number; y?: (v: number) => number; valueAxis?: "x" | "y"; rect: PlotRect } | null;
  connectTrail?: boolean;
  showMarginals?: boolean;
  /** Facet panels: one shared measure domain (LOOM-116). */
  sharedValueDomain?: { min: number; max: number };
  /** Facet scatter/bubble: shared numeric bounds (LOOM-116). */
  sharedScatterBounds?: { xMin: number; xMax: number; yMin: number; yMax: number };
}
