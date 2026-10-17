// =================================================================
// Loom — Chart visual override shape (no Zustand / DOM)
// =================================================================

export interface ChartVisualOverrides {
  /** Canvas arrangement, normalized to the chart frame. */
  canvasWidth?: number;
  canvasHeight?: number;
  plotX?: number;
  plotY?: number;
  plotWidth?: number;
  plotHeight?: number;
  titleX?: number;
  titleY?: number;
  titleWidth?: number;
  titleScale?: number;
  legendWidth?: number;
  legendHeight?: number;
  pointSize?: number;
  opacity?: number;
  colorPalette?: string;
  colorScaleKind?: "auto" | "categorical" | "sequential" | "diverging" | "semantic" | "reference" | "spectrum";
  colorPaletteReverse?: boolean;
  axisFontSize?: number;
  showGrid?: boolean;
  fontFamily?: string;
  titleFontWeight?: number;
  titleItalic?: boolean;
  tickRotation?: number;
  markShape?: string;
  markerMode?: "shape" | "emoji";
  markEmoji?: string;
  markStroke?: boolean;
  markStrokeWidth?: number;
  markStrokeColor?: string;
  markJitter?: number;
  sizeScale?: number;
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
  chartPadding?: number;
  /** How much optional space surrounds the chart; text keeps its necessary room. */
  spaceUse?: "auto" | "fill" | "roomy";
  legendPosition?: string;
  /** Normalized 0–1 offsets within the plot when legendPosition is `custom` (share-stable). */
  legendOffsetX?: number;
  legendOffsetY?: number;
  showDataLabels?: boolean;
  facetField?: string | null;
  backgroundStyle?: string;
  blendMode?: string;
  glowEnabled?: boolean;
  glowIntensity?: number;
  animateEntrance?: boolean;
  chartDetail?: "plain" | "viz" | "deep";
  markMotif?: "dots" | "squares" | "ticks" | "bar" | "ring";
  axisStyle?: "rule" | "ladder" | "mercury" | "spine" | "index" | "tape";
  emphasisStyle?: "tint" | "wash" | "dot" | "alarm" | "tag";
  ghostEnabled?: boolean;
  ghostWeight?: "whisper" | "soft" | "firm";
  ghostPlace?: "se" | "sw" | "ne" | "nw";
  titleLayout?: "pair" | "stack" | "spine" | "caption" | "ticket" | "slab";
  chartFrame?: "hero" | "compact" | "focus";
  sourceFootnote?: "off" | "name" | "credit" | "full";
  sourceFootnoteAlign?: "left" | "center" | "right";
  /** Where source / time / color-ramp chrome sits on the canvas. */
  chromeInfoBand?: "footer" | "header";
  tooltipMode?: "auto" | "hover" | "glass" | "dock" | "compact" | "off";
  /** Geographic basemap; `auto` picks from the region column / chart kind. */
  geoAtlas?: "auto" | "world" | "worldDetail" | "us" | "usCounties";
}
