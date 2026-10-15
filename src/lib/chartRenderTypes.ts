// =================================================================
// ChartRenderOpts — per-paint canvas renderer configuration
// =================================================================
// Shared by ChartView and extracted canvas chart modules (LOOM-142).
// =================================================================

import type { PlotRect } from "./chartLooks";
import type { HitTarget } from "./chartTooltip";
import type { YAggregateOption } from "./recommendations";

export interface ChartRenderOpts {
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
  markStroke?: boolean;
  markStrokeWidth?: number;
  markStrokeColor?: string;
  markJitter?: number;
  sizeScale?: number;
  barCornerRadius?: number;
  lineStrokeStyle?: string;
  lineCurveSmooth?: boolean;
  lineWidth?: number;
  axisLineColor?: string;
  axisLineWidth?: number;
  gridStyle?: string;
  gridOpacity?: number;
  tickCount?: number;
  axisLabelColor?: string;
  showGrid?: boolean;
  chartPadding?: number;
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
  hits?: HitTarget[];
  fieldNames?: string[];
  legend?: { label: string; color: string }[] | null;
  scales?: { x?: (v: number) => number; y?: (v: number) => number; valueAxis?: "x" | "y"; rect: PlotRect } | null;
  connectTrail?: boolean;
  showMarginals?: boolean;
  /** Facet panels: one shared measure domain (LOOM-116). */
  sharedValueDomain?: { min: number; max: number };
  /** Facet scatter/bubble: shared numeric bounds (LOOM-116). */
  sharedScatterBounds?: { xMin: number; xMax: number; yMin: number; yMax: number };
}
