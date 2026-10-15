// =================================================================
// chartVisualSanitize — whitelist + clamp for #chart= visual overrides
// =================================================================

import type { ChartVisualOverrides } from "./chartVisualTypes";
import { CHART_VISUAL_OVERRIDE_KEYS } from "./lookSystem";

const WHITELIST = new Set<string>(CHART_VISUAL_OVERRIDE_KEYS);
const BOOLEAN_KEYS = new Set<keyof ChartVisualOverrides>([
  "showGrid", "titleItalic", "markStroke", "lineCurveSmooth", "showDataLabels",
  "glowEnabled", "animateEntrance", "ghostEnabled", "colorPaletteReverse",
]);

type ClampRule = { min?: number; max?: number; int?: boolean };

const CLAMPS: Partial<Record<keyof ChartVisualOverrides, ClampRule>> = {
  canvasWidth: { min: .35, max: 1 },
  canvasHeight: { min: .35, max: 1 },
  plotX: { min: 0, max: .9 },
  plotY: { min: 0, max: .9 },
  plotWidth: { min: .1, max: 1 },
  plotHeight: { min: .1, max: 1 },
  titleX: { min: 0, max: 1 },
  titleY: { min: 0, max: 1 },
  titleWidth: { min: .1, max: 1 },
  titleScale: { min: .7, max: 2.5 },
  legendWidth: { min: .1, max: 1 },
  legendHeight: { min: .1, max: 1 },
  pointSize: { min: 2, max: 24, int: true },
  // Ranges match the Visual panel sliders so a shared link renders as authored
  chartPadding: { min: 16, max: 96, int: true },
  opacity: { min: 0, max: 1 },
  gridOpacity: { min: 0, max: 1 },
  tickCount: { min: 2, max: 10, int: true },
  axisFontSize: { min: 8, max: 16, int: true },
  markJitter: { min: 0, max: 12, int: true },
  lineWidth: { min: 0.5, max: 4 },
  axisLineWidth: { min: 0.5, max: 4 },
  markStrokeWidth: { min: 0, max: 6 },
  barCornerRadius: { min: 0, max: 12, int: true },
  glowIntensity: { min: 0, max: 20 },
  sizeScale: { min: 0.5, max: 3 },
  tickRotation: { min: -90, max: 90 },
  titleFontWeight: { min: 100, max: 900, int: true },
  legendOffsetX: { min: 0, max: 1 },
  legendOffsetY: { min: 0, max: 1 },
};

type EnumKey<K extends keyof ChartVisualOverrides> = NonNullable<ChartVisualOverrides[K]> & string;
/** Exhaustive over the union: adding a value to ChartVisualOverrides fails to compile until listed here. */
const allOf = <K extends keyof ChartVisualOverrides>(values: Record<EnumKey<K>, true>): readonly string[] =>
  Object.keys(values);

const STRING_ENUMS: Partial<Record<keyof ChartVisualOverrides, readonly string[]>> = {
  colorScaleKind: allOf<"colorScaleKind">({
    auto: true, categorical: true, sequential: true, diverging: true, semantic: true, reference: true, spectrum: true,
  }),
  chartDetail: allOf<"chartDetail">({ plain: true, viz: true, deep: true }),
  markMotif: allOf<"markMotif">({ dots: true, squares: true, ticks: true, bar: true, ring: true }),
  axisStyle: allOf<"axisStyle">({ rule: true, ladder: true, mercury: true, spine: true, index: true, tape: true }),
  emphasisStyle: allOf<"emphasisStyle">({ tint: true, wash: true, dot: true, alarm: true, tag: true }),
  ghostWeight: allOf<"ghostWeight">({ whisper: true, soft: true, firm: true }),
  ghostPlace: allOf<"ghostPlace">({ se: true, sw: true, ne: true, nw: true }),
  titleLayout: allOf<"titleLayout">({ pair: true, stack: true, spine: true, caption: true, ticket: true, slab: true }),
  chartFrame: allOf<"chartFrame">({ hero: true, compact: true, focus: true }),
  sourceFootnote: allOf<"sourceFootnote">({ off: true, name: true, credit: true, full: true }),
  sourceFootnoteAlign: allOf<"sourceFootnoteAlign">({ left: true, center: true, right: true }),
  chromeInfoBand: allOf<"chromeInfoBand">({ footer: true, header: true }),
  tooltipMode: allOf<"tooltipMode">({ auto: true, hover: true, glass: true, dock: true, compact: true, off: true }),
  // Plain-string overrides: the values the Visual panel and look presets write
  legendPosition: ["auto", "none", "custom", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"],
  markShape: ["circle", "square", "diamond", "triangle", "cross", "star", "hexagon", "ring"],
  gridStyle: ["solid", "dashed", "dotted", "none"],
  lineStrokeStyle: ["solid", "dashed", "dotted"],
  backgroundStyle: ["default", "tufte", "newsprint", "bauhaus", "carbon", "blueprint", "ruled", "gradient", "paper", "transparent"],
  blendMode: ["source-over", "screen", "multiply", "lighten"],
};

function clampNum(v: number, rule: ClampRule): number {
  let n = v;
  if (rule.int) n = Math.round(n);
  if (rule.min != null) n = Math.max(rule.min, n);
  if (rule.max != null) n = Math.min(rule.max, n);
  return n;
}

/** Drop unknown keys and clamp numeric / enum visual overrides from shared links. */
export function sanitizeChartVisualOverrides(
  v: ChartVisualOverrides | Record<string, unknown> | undefined,
): ChartVisualOverrides | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: ChartVisualOverrides = {};
  for (const [k, val] of Object.entries(v)) {
    if (!WHITELIST.has(k)) continue;
    const key = k as keyof ChartVisualOverrides;
    if (typeof val === "boolean") {
      if (!BOOLEAN_KEYS.has(key)) continue;
      (out as Record<string, boolean>)[k] = val;
      continue;
    }
    if (typeof val === "string") {
      if (BOOLEAN_KEYS.has(key) || CLAMPS[key]) continue;
      const allowed = STRING_ENUMS[key];
      if (allowed && !allowed.includes(val)) continue;
      if (key === "fontFamily" && val.length > 80) continue;
      if (key === "colorPalette" && val.length > 40) continue;
      (out as Record<string, string>)[k] = val;
      continue;
    }
    if (typeof val === "number" && Number.isFinite(val)) {
      const rule = CLAMPS[key];
      if (rule) (out as Record<string, number>)[k] = clampNum(val, rule);
    }
  }
  if (out.legendPosition !== "custom") {
    delete out.legendOffsetX;
    delete out.legendOffsetY;
    delete out.legendWidth;
    delete out.legendHeight;
  }
  return Object.keys(out).length ? out : undefined;
}
