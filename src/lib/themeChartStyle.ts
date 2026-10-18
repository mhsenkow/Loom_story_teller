// Theme-level mark grammar. Explicit Visual edits always win over inheritance.
import { resolveRuntimeTheme } from "./resolveEffectiveTheme";
import { type LookTheme } from "./lookSystem";
import type { ChartVisualOverrides } from "./chartVisualTypes";

export const THEME_CHART_STYLE: Record<LookTheme, ChartVisualOverrides> = {
  light: { markMaterial: "flat", gridStyle: "solid", gridOpacity: 0.23, titleFontWeight: 600, lineCap: "round", lineJoin: "round", lineWidth: 1.75, barCornerRadius: 2, markShape: "circle", axisLineWidth: 1 },
  dark: { markMaterial: "flat", gridStyle: "solid", gridOpacity: 0.25, titleFontWeight: 600, lineCap: "round", lineJoin: "round", lineWidth: 2, barCornerRadius: 3, markShape: "circle", axisLineWidth: 1 },
  contrast: { markMaterial: "flat", gridStyle: "solid", gridOpacity: 0.5, titleFontWeight: 700, lineCap: "butt", lineJoin: "bevel", lineWidth: 3, barCornerRadius: 0, markShape: "circle", axisLineWidth: 2 },
  paper: { markMaterial: "ink", gridStyle: "solid", gridOpacity: 0.18, titleFontWeight: 600, lineCap: "butt", lineJoin: "bevel", lineWidth: 1.5, barCornerRadius: 0, markShape: "circle", axisLineWidth: 1 },
  glass: { markMaterial: "glaze", gridStyle: "solid", gridOpacity: 0.18, titleFontWeight: 600, lineCap: "round", lineJoin: "round", lineWidth: 2, barCornerRadius: 6, markShape: "circle", axisLineWidth: 1 },
  frost: { markMaterial: "glaze", gridStyle: "dotted", gridOpacity: 0.27, titleFontWeight: 600, lineCap: "round", lineJoin: "round", lineWidth: 2, barCornerRadius: 4, markShape: "diamond", axisLineWidth: 1 },
  brutal: { markMaterial: "ink", gridStyle: "solid", gridOpacity: 0.35, titleFontWeight: 700, lineCap: "square", lineJoin: "miter", lineWidth: 3, barCornerRadius: 0, markShape: "square", axisLineWidth: 2 },
  loom: { markMaterial: "satin", gridStyle: "solid", gridOpacity: 0.2, titleFontWeight: 600, lineCap: "round", lineJoin: "round", lineWidth: 2, barCornerRadius: 2, markShape: "circle", axisLineWidth: 1 },
  tank: { markMaterial: "etched", gridStyle: "dotted", gridOpacity: 0.3, titleFontWeight: 600, lineCap: "square", lineJoin: "miter", lineWidth: 1.75, barCornerRadius: 0, markShape: "square", axisLineWidth: 1.5 },
  nes: { markMaterial: "ink", gridStyle: "solid", gridOpacity: 0.35, titleFontWeight: 700, lineCap: "square", lineJoin: "miter", lineWidth: 3, barCornerRadius: 0, markShape: "square", axisLineWidth: 2 },
};

export function resolveThemeChartStyle(theme?: string | null, overrides: ChartVisualOverrides = {}): ChartVisualOverrides {
  const explicit = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
  return { ...THEME_CHART_STYLE[resolveRuntimeTheme(theme)], ...explicit };
}
