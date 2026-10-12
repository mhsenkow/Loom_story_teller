// =================================================================
// chartVisualSanitize — whitelist + clamp for #chart= visual overrides
// =================================================================

import type { ChartVisualOverrides } from "./store";
import { CHART_VISUAL_OVERRIDE_KEYS } from "./lookSystem";

const WHITELIST = new Set<string>(CHART_VISUAL_OVERRIDE_KEYS);

type ClampRule = { min?: number; max?: number; int?: boolean };

const CLAMPS: Partial<Record<keyof ChartVisualOverrides, ClampRule>> = {
  pointSize: { min: 2, max: 24, int: true },
  chartPadding: { min: 24, max: 96, int: true },
  opacity: { min: 0, max: 1 },
  gridOpacity: { min: 0, max: 1 },
  tickCount: { min: 2, max: 10, int: true },
  axisFontSize: { min: 8, max: 16, int: true },
  markJitter: { min: 0, max: 12, int: true },
  lineWidth: { min: 0.5, max: 4 },
  markStrokeWidth: { min: 0, max: 6 },
  barCornerRadius: { min: 0, max: 12, int: true },
  glowIntensity: { min: 0, max: 3 },
  sizeScale: { min: 0.5, max: 3 },
};

const STRING_ENUMS: Partial<Record<keyof ChartVisualOverrides, readonly string[]>> = {
  legendPosition: ["auto", "none", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"],
  markShape: ["circle", "square", "diamond", "triangle", "cross"],
  gridStyle: ["solid", "dashed", "dotted"],
  axisStyle: ["ladder", "minimal", "hidden"],
  titleLayout: ["stacked", "inline", "corner"],
  chartFrame: ["none", "hairline", "boxed"],
  backgroundStyle: ["flat", "paper", "newsprint", "gradient"],
  ghostWeight: ["whisper", "soft", "firm"],
  ghostPlace: ["se", "sw", "ne", "nw"],
  lineStrokeStyle: ["solid", "dashed", "dotted"],
  blendMode: ["source-over", "multiply", "screen", "overlay"],
  chartDetail: ["compact", "standard", "rich"],
  markMotif: ["plain", "rounded", "soft"],
  emphasisStyle: ["none", "glow", "outline"],
  colorScaleKind: ["auto", "categorical", "sequential", "diverging", "spectrum", "semantic", "reference"],
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
      (out as Record<string, boolean>)[k] = val;
      continue;
    }
    if (typeof val === "string") {
      const allowed = STRING_ENUMS[key];
      if (allowed && !allowed.includes(val)) continue;
      if (key === "fontFamily" && val.length > 80) continue;
      if (key === "colorPalette" && val.length > 40) continue;
      (out as Record<string, string>)[k] = val;
      continue;
    }
    if (typeof val === "number" && Number.isFinite(val)) {
      const rule = CLAMPS[key];
      (out as Record<string, number>)[k] = rule ? clampNum(val, rule) : val;
    }
  }
  return Object.keys(out).length ? out : undefined;
}
