// Theme-level mark grammar. Explicit Visual edits always win over inheritance.
import { resolveRuntimeTheme } from "./resolveEffectiveTheme";
import { type LookTheme } from "./lookSystem";
import type { ChartVisualOverrides } from "./chartVisualTypes";

export const THEME_CHART_STYLE: Record<LookTheme, ChartVisualOverrides> = {
  light: { lineCap: "round", lineJoin: "round", lineWidth: 1.75, barCornerRadius: 2, markShape: "circle", axisLineWidth: 1 },
  dark: { lineCap: "round", lineJoin: "round", lineWidth: 2, barCornerRadius: 3, markShape: "circle", axisLineWidth: 1 },
  contrast: { lineCap: "butt", lineJoin: "bevel", lineWidth: 3, barCornerRadius: 0, markShape: "circle", axisLineWidth: 2 },
  paper: { lineCap: "butt", lineJoin: "bevel", lineWidth: 1.5, barCornerRadius: 0, markShape: "circle", axisLineWidth: 1 },
  glass: { lineCap: "round", lineJoin: "round", lineWidth: 2, barCornerRadius: 6, markShape: "circle", axisLineWidth: 1 },
  frost: { lineCap: "round", lineJoin: "round", lineWidth: 2, barCornerRadius: 4, markShape: "diamond", axisLineWidth: 1 },
  brutal: { lineCap: "square", lineJoin: "miter", lineWidth: 3, barCornerRadius: 0, markShape: "square", axisLineWidth: 2 },
  loom: { lineCap: "round", lineJoin: "round", lineWidth: 2, barCornerRadius: 2, markShape: "circle", axisLineWidth: 1 },
  tank: { lineCap: "square", lineJoin: "miter", lineWidth: 1.75, barCornerRadius: 0, markShape: "square", axisLineWidth: 1.5 },
  nes: { lineCap: "square", lineJoin: "miter", lineWidth: 3, barCornerRadius: 0, markShape: "square", axisLineWidth: 2 },
};

export function resolveThemeChartStyle(theme?: string | null, overrides: ChartVisualOverrides = {}): ChartVisualOverrides {
  const explicit = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
  return { ...THEME_CHART_STYLE[resolveRuntimeTheme(theme)], ...explicit };
}
