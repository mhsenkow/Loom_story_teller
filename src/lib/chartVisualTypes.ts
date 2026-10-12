// =================================================================
// Loom — Chart visual override shape (no Zustand / DOM)
// =================================================================

export interface ChartVisualOverrides {
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
  chartPadding?: number;
  legendPosition?: string;
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
  tooltipMode?: "auto" | "hover" | "glass" | "dock" | "compact" | "off";
}
