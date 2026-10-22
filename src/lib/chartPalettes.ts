// Shared color system for chart visual overrides (right panel + ChartView).
// Primary catalog: Loom data-viz palettes. "theme" follows look-system tokens.

import { parseCustomColors } from "./chartCustomColors";

import { resolveRuntimeTheme } from "./resolveEffectiveTheme";
import { type LookTheme } from "./lookSystem";

/** Dark-theme series stops — bumped luminance for AA on #0a0a0c (LOOM-071). */
const LOOM_DEFAULT = ["#8b7cf8", "#34e0a1", "#ff8585", "#ffe066", "#4dcae8", "#f09578", "#c4b5fd", "#93c5fd"];

/** Okabe–Ito colorblind-safe categorical (research adjunct / a11y). */
const OKABE_ITO = ["#4477AA", "#EE7733", "#009988", "#CC3311", "#BBBB00", "#66BBEE", "#AA3377", "#888888"];

/** Default categorical set — apply in order. */
export const VIZ_CATEGORICAL = [
  "#1877F2", // blue
  "#F0701A", // orange
  "#5A24C7", // purple
  "#E42C87", // pink
  "#00487C", // darkblue
  "#3EA096", // teal
  "#A87CFF", // lightpurple
  "#850550", // burgundy
  "#0099B8", // cyan
  "#220855", // darkpurple
  "#783301", // brown
];

export const VIZ_SEMANTIC = {
  positive: "#32A84F",
  warning: "#F7B60B",
  negative: "#D31E3C",
  neutral: "#9A9D91",
} as const;

export const VIZ_REFERENCE = ["#444C4F", "#6E7175", "#9A9D91", "#B4A7B8", "#CBC0D1"];

export const AXIS_LINE_COLOR_SWATCHES = [
  { value: "theme", label: "Theme border", color: "theme" },
  { value: "#2a2a30", label: "Graphite", color: "#2a2a30" },
  { value: "#6b6b78", label: "Muted", color: "#6b6b78" },
  { value: "#000000", label: "Black", color: "#000000" },
  { value: "#ffffff", label: "White", color: "#ffffff" },
  { value: "#c8c8c4", label: "Light gray", color: "#c8c8c4" },
] as const;

export const AXIS_LABEL_COLOR_SWATCHES = [
  { value: "theme", label: "Theme muted", color: "theme" },
  { value: "#6b6b78", label: "Muted gray", color: "#6b6b78" },
  { value: "#000000", label: "Black", color: "#000000" },
  { value: "#ffffff", label: "White", color: "#ffffff" },
  { value: "#e8e8ec", label: "Near white", color: "#e8e8ec" },
  { value: "#1a1a1f", label: "Near black", color: "#1a1a1f" },
] as const;

export type PaletteKind =
  | "categorical"
  | "sequential"
  | "diverging"
  | "semantic"
  | "reference"
  | "spectrum";

export type PaletteSource = "system" | "theme" | "research";

export type ColorPalette = {
  id: string;
  name: string;
  kind: PaletteKind;
  colors: string[];
  blurb?: string;
  source: PaletteSource;
};

export type ThemeUiColors = {
  bg: string;
  text: string;
  muted: string;
  /** Stronger than muted — axes, footnotes, captions that must stay AA. */
  label: string;
  border: string;
  accent: string;
};

/** Canonical UI colors per look theme (keep in sync with globals.css). */
export const THEME_UI: Record<LookTheme, ThemeUiColors> = {
  light: { bg: "#f0efeb", text: "#141414", muted: "#5a5a5a", label: "#3d3d3d", border: "#c4c4be", accent: "#b84e1f" },
  dark: { bg: "#0a0a0c", text: "#ececf1", muted: "#9e9eac", label: "#b4b4c0", border: "#2e2e36", accent: "#6a5ce0" },
  contrast: { bg: "#000000", text: "#ffffff", muted: "#c8c8c8", label: "#ffffff", border: "#ffffff", accent: "#ffff00" },
  paper: { bg: "#e6dfd2", text: "#1a1610", muted: "#5c5548", label: "#3f3a32", border: "#bdb3a0", accent: "#7a3d0f" },
  glass: { bg: "#dce6f4", text: "#0b1220", muted: "#4b5b70", label: "#334155", border: "#64748b", accent: "#6d28d9" },
  frost: { bg: "#060a14", text: "#f1f5f9", muted: "#a8b8cc", label: "#c8d4e4", border: "#64748b", accent: "#c4b5fd" },
  brutal: { bg: "#ffffff", text: "#000000", muted: "#2a2a2a", label: "#111111", border: "#000000", accent: "#e00000" },
  loom: { bg: "#0a0a0f", text: "#f0ede8", muted: "#b0aca4", label: "#d0ccc4", border: "#2e2e3c", accent: "#e0b45a" },
  tank: { bg: "#0a161c", text: "#d4eef2", muted: "#7eb4c4", label: "#a8d4e0", border: "#2a5266", accent: "#6bb866" },
  // Charts paint on light surface so axis/footnote text stays AA (chrome bg stays blue).
  nes: { bg: "#f7f7f7", text: "#0a0a0a", muted: "#1a1a1a", label: "#0a0a0a", border: "#000000", accent: "#d40028" },
};

/** First 8 categorical stops — dark/frost/glass shell chart tokens. */
const VIZ_CAT_8 = VIZ_CATEGORICAL.slice(0, 8);

/** Chart series colors per look theme (keep in sync with globals.css --chart-*). */
export const THEME_CHART: Record<LookTheme, string[]> = {
  light: ["#b84e1f", "#008f62", "#b71c1c", "#c49200", "#007a96", "#6b5fd4", "#4a8fc0", "#5c574e"],
  dark: ["#74b9ff", "#00d68f", "#ff7675", "#ffeaa7", "#00cec9", "#fab1a0", "#a29bfe", "#fd79a8"],
  contrast: ["#ffff00", "#00ff9d", "#ff5555", "#00ccff", "#ff8844", "#bb99ff", "#66bbff", "#ffffff"],
  paper: ["#7a3d0f", "#2f5a40", "#8a2424", "#8a6800", "#24526a", "#5c4068", "#4e5e3e", "#5c5548"],
  glass: ["#6d28d9", "#047857", "#b91c1c", "#b45309", "#1d4ed8", "#be185d", "#0e7490", "#4b5b70"],
  frost: ["#c4b5fd", "#34d399", "#f87171", "#fbbf24", "#38bdf8", "#fb7185", "#a78bfa", "#94a3b8"],
  brutal: ["#e00000", "#0000cc", "#006600", "#cc8800", "#000000", "#cc00cc", "#008888", "#555555"],
  loom: ["#e0b45a", "#a78bfa", "#ef8a8a", "#7ed687", "#74b9ff", "#ff8a65", "#ce93d8", "#b0aca4"],
  tank: ["#6bb866", "#f0d44a", "#ef8a8a", "#64b5f6", "#8ed07a", "#ff8a65", "#4dd0e1", "#7eb4c4"],
  nes: ["#d40028", "#e8c800", "#1a8ad4", "#008800", "#000000", "#e88828", "#88d8b0", "#881400"],
};

/** Full palette catalog — system primary, then research adjuncts. */
export const COLOR_PALETTES: ColorPalette[] = [
  {
    id: "auto",
    name: "Auto",
    kind: "categorical",
    colors: VIZ_CATEGORICAL,
    blurb: "Picks scale from chart kind / color field",
    source: "system",
  },
  {
    id: "theme-sequential",
    name: "Theme magnitude",
    kind: "sequential",
    colors: VIZ_CAT_8,
    blurb: "An ordered lightness ramp from the active theme",
    source: "theme",
  },
  {
    id: "theme",
    name: "Theme (app)",
    kind: "categorical",
    colors: VIZ_CAT_8,
    blurb: "Follows active look theme",
    source: "theme",
  },
  {
    id: "categorical",
    name: "Categorical",
    kind: "categorical",
    colors: VIZ_CATEGORICAL,
    blurb: "Default discrete series — apply in order",
    source: "system",
  },
  {
    id: "semantic",
    name: "Semantic",
    kind: "semantic",
    colors: [VIZ_SEMANTIC.positive, VIZ_SEMANTIC.warning, VIZ_SEMANTIC.negative, VIZ_SEMANTIC.neutral],
    blurb: "Positive / warning / negative / neutral",
    source: "system",
  },
  {
    id: "reference",
    name: "Reference",
    kind: "reference",
    colors: VIZ_REFERENCE,
    blurb: "Gray ramp for chrome & secondary series",
    source: "system",
  },
  {
    id: "seq-blue",
    name: "Sequential Blue",
    kind: "sequential",
    colors: ["#05214D", "#083E89", "#1877F2", "#5FAAFF", "#ABD1FF"],
    source: "system",
  },
  {
    id: "seq-teal",
    name: "Sequential Teal",
    kind: "sequential",
    colors: ["#006E5F", "#0B8E89", "#30C8B4", "#79DADD", "#B5F1E8"],
    source: "system",
  },
  {
    id: "seq-purple",
    name: "Sequential Purple",
    kind: "sequential",
    colors: ["#310F75", "#4B1AA0", "#7B3EE8", "#A87CFF", "#C6B2F7"],
    source: "system",
  },
  {
    id: "seq-pink",
    name: "Sequential Pink",
    kind: "sequential",
    colors: ["#850550", "#BF0F78", "#E42C87", "#FF84D6", "#FFBDE9"],
    source: "system",
  },
  {
    id: "seq-orange",
    name: "Sequential Orange",
    kind: "sequential",
    colors: ["#A83A02", "#D44E06", "#EB630E", "#FF9052", "#FFBAB0"],
    source: "system",
  },
  {
    id: "spectrum",
    name: "Spectrum",
    kind: "spectrum",
    colors: [
      "#FFF9D1", "#DCF8E5", "#BCF3CB", "#8BE39F", "#2A99A7",
      "#0088D0", "#00628E", "#083E89", "#05214D", "#000818",
    ],
    blurb: "Full-hue continuous ramp",
    source: "system",
  },
  {
    id: "div-cool-warm",
    name: "Diverging Cool–Warm",
    kind: "diverging",
    colors: ["#5A24C7", "#1877F2", "#5FAAFF", "#FCC12B", "#FF9821", "#EB630E", "#D31E3C"],
    blurb: "7-stop via yellow midpoint",
    source: "system",
  },
  {
    id: "div-hot-cold",
    name: "Diverging Hot–Cold",
    kind: "diverging",
    colors: [
      "#AA2312", "#D4311C", "#EB630E", "#FFB973", "#FFF2A6",
      "#F0F2F5",
      "#CDE5FF", "#7EBBFF", "#1877F2", "#083E89", "#07316D",
    ],
    blurb: "Temperature association",
    source: "system",
  },
  {
    id: "div-pos-neg",
    name: "Diverging Pos–Neg",
    kind: "diverging",
    colors: [
      "#850550", "#BF0F78", "#FC7BD6", "#FFAED4", "#FFD9F2",
      "#F0F2F5",
      "#D3F9D7", "#A3E8B5", "#4FB36D", "#2A9142", "#1D632E",
    ],
    blurb: "Pink ↔ green through neutral",
    source: "system",
  },
  {
    id: "okabe",
    name: "Okabe–Ito",
    kind: "categorical",
    colors: OKABE_ITO,
    blurb: "Colorblind-safe categorical",
    source: "research",
  },
  {
    id: "loom",
    name: "Loom classic",
    kind: "categorical",
    colors: LOOM_DEFAULT,
    source: "research",
  },
  {
    id: "viridis",
    name: "Viridis",
    kind: "sequential",
    colors: ["#440154", "#482878", "#3e4a89", "#31688e", "#26838f", "#1f9e89", "#35b779", "#6dcd59", "#b4de2c", "#fde725"],
    source: "research",
  },
  {
    id: "plasma",
    name: "Plasma",
    kind: "sequential",
    colors: ["#0d0887", "#47039f", "#7301a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"],
    source: "research",
  },
  {
    id: "cividis",
    name: "Cividis",
    kind: "sequential",
    colors: ["#00224e", "#123570", "#3b496c", "#575d6d", "#707173", "#8a8678", "#a59c74", "#c3b369", "#e1cc55", "#fee838"],
    blurb: "CVD-friendly sequential",
    source: "research",
  },
  {
    id: "turbo",
    name: "Turbo",
    kind: "spectrum",
    colors: ["#30123b", "#4662d7", "#36aaf9", "#1bcfd4", "#49f070", "#a4fc3c", "#efe403", "#f8a530", "#ef5a11", "#7a0403"],
    source: "research",
  },
];

/** Map older saved palette ids → current ids (session / localStorage). */
const LEGACY_PALETTE_IDS: Record<string, string> = {
  xds: "categorical",
  "xds-semantic": "semantic",
  "xds-reference": "reference",
  "xds-seq-blue": "seq-blue",
  "xds-seq-teal": "seq-teal",
  "xds-seq-purple": "seq-purple",
  "xds-seq-pink": "seq-pink",
  "xds-seq-orange": "seq-orange",
  "xds-spectrum": "spectrum",
  "xds-div-seq": "div-cool-warm",
  "xds-div-hot-cold": "div-hot-cold",
  "xds-div-pos-neg": "div-pos-neg",
};

export type ResolvedChartColors = {
  kind: PaletteKind;
  paletteId: string;
  colors: string[];
  continuous: boolean;
};

export type ResolveChartColorsOpts = {
  customColors?: string | null;
  paletteId?: string | null;
  theme?: string | null;
  colorblind?: boolean;
  chartKind?: string | null;
  /** "nominal" | "quantitative" | "ordinal" | null */
  colorFieldType?: string | null;
  reverse?: boolean;
  /** Force kind filter when UI chip selected (still respects explicit palette id) */
  scaleKind?: "auto" | PaletteKind | null;
};

function normalizePaletteId(id: string): string {
  return LEGACY_PALETTE_IDS[id] ?? id;
}

export function getPaletteById(id: string | undefined | null): ColorPalette | undefined {
  if (!id) return undefined;
  const nid = normalizePaletteId(id);
  return COLOR_PALETTES.find((p) => p.id === nid);
}

/** Theme-aware chart series colors. Prefer `theme` id so we never lag CSS paint. */
export function getThemeChartColors(theme?: string | null): string[] {
  const t = resolveRuntimeTheme(theme);
  return THEME_CHART[t] ?? VIZ_CAT_8;
}

function stopsForPalette(p: ColorPalette, theme?: string | null): string[] {
  if (p.id === "theme") return getThemeChartColors(theme);
  if (p.id === "theme-sequential") {
    const ink = getThemeChartColors(theme)[0]!;
    const dark = sampleContinuous(["#000000", ink], 0.45);
    const light = sampleContinuous([ink, "#ffffff"], 0.78);
    return Array.from({ length: 7 }, (_, i) => sampleContinuous([dark, ink, light], i / 6));
  }
  return p.colors.slice();
}

/** Discrete sample — ordered cycle; reverse flips stop order. */
export function sampleCategorical(colors: string[], n: number, reverse = false): string[] {
  const src = reverse ? [...colors].reverse() : colors;
  if (n <= 0 || src.length === 0) return [];
  if (n <= src.length) return src.slice(0, n);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(src[i % src.length]!);
  return out;
}

function parseHexRgb(hex: string): [number, number, number] | null {
  const s = hex.trim();
  if (!s.startsWith("#") || (s.length !== 7 && s.length !== 4)) return null;
  if (s.length === 4) {
    return [
      parseInt(s[1]! + s[1]!, 16),
      parseInt(s[2]! + s[2]!, 16),
      parseInt(s[3]! + s[3]!, 16),
    ];
  }
  return [
    parseInt(s.slice(1, 3), 16),
    parseInt(s.slice(3, 5), 16),
    parseInt(s.slice(5, 7), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear RGB interpolate across stops at t∈[0,1]. */
export function sampleContinuous(colors: string[], t: number, reverse = false): string {
  const src = reverse ? [...colors].reverse() : colors;
  if (src.length === 0) return "#888888";
  if (src.length === 1) return src[0]!;
  const u = Math.max(0, Math.min(1, t));
  const scaled = u * (src.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;
  const a = parseHexRgb(src[i]!) ?? [136, 136, 136];
  const b = parseHexRgb(src[Math.min(i + 1, src.length - 1)]!) ?? a;
  return rgbToHex(
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  );
}

export function sampleSequential(colors: string[], t: number, reverse = false): string {
  return sampleContinuous(colors, t, reverse);
}

export function sampleDiverging(colors: string[], t: number, reverse = false): string {
  return sampleContinuous(colors, t, reverse);
}

/** Discretize a continuous palette into n evenly spaced colors. */
export function discretizeContinuous(colors: string[], n: number, reverse = false): string[] {
  if (n <= 0) return [];
  if (n === 1) return [sampleContinuous(colors, 0.5, reverse)];
  return Array.from({ length: n }, (_, i) => sampleContinuous(colors, i / (n - 1), reverse));
}

function pickAutoPaletteId(
  chartKind?: string | null,
  colorFieldType?: string | null,
): string {
  const kind = chartKind ?? "";
  if (
    kind === "contour" ||
    kind === "heatmap" ||
    kind === "choropleth" ||
    kind === "dataCube" ||
    kind === "treemap" ||
    kind === "sunburst" ||
    kind === "forceBubble" ||
    kind === "hexbin"
  ) {
    return "theme-sequential";
  }
  if (kind === "waterfall") return "semantic";
  // r runs −1…+1 around a meaningful zero
  if (kind === "corrMatrix") return "div-cool-warm";
  if (colorFieldType === "quantitative" || colorFieldType === "ordinal") return "theme-sequential";
  return "theme";
}

function isContinuousKind(kind: PaletteKind): boolean {
  return kind === "sequential" || kind === "diverging" || kind === "spectrum";
}

/**
 * Resolve chart series / fill colors from palette id, theme, a11y, and encoding.
 */
export function resolveChartColors(opts: ResolveChartColorsOpts = {}): ResolvedChartColors {
  const reverse = !!opts.reverse;
  let id = normalizePaletteId(opts.paletteId ?? "auto");

  const inherited = id === "auto" || id === "theme" || id === "theme-sequential";
  if (id === "auto") {
    id = pickAutoPaletteId(opts.chartKind, opts.colorFieldType);
    if (opts.scaleKind && opts.scaleKind !== "auto") {
      id = opts.scaleKind === "categorical" ? "theme"
        : opts.scaleKind === "sequential" ? "theme-sequential"
        : COLOR_PALETTES.find((p) => p.kind === opts.scaleKind && p.source === "system" && p.id !== "auto")?.id ?? id;
    }
  }
  // Accessibility follows the resolved scale; explicit palettes remain intentional choices.
  if (opts.colorblind && inherited) {
    const kind = getPaletteById(id)?.kind;
    if (kind === "sequential" || kind === "spectrum") id = "cividis";
    else if (kind === "categorical") id = "okabe";
  }
  let palette = getPaletteById(id);
  if (!palette) {
    palette = getPaletteById("categorical")!;
    id = "categorical";
  }

  // Correlation cells interpolate a ramp — a categorical set reads as random hues
  if (opts.chartKind === "corrMatrix" && !isContinuousKind(palette.kind)) {
    palette = getPaletteById("div-cool-warm") ?? palette;
    id = palette.id;
  }

  let colors = parseCustomColors(opts.customColors) ?? stopsForPalette(palette, opts.theme);
  if (reverse) colors = [...colors].reverse();

  const continuous =
    isContinuousKind(palette.kind) ||
    opts.chartKind === "heatmap" ||
    opts.chartKind === "choropleth" ||
    opts.chartKind === "dataCube" ||
    opts.chartKind === "treemap" ||
    opts.chartKind === "sunburst" ||
    opts.chartKind === "forceBubble";

  return {
    kind: palette.kind,
    paletteId: id,
    colors,
    continuous,
  };
}

/** Eight discrete slots for WebGPU / canvas series (bins continuous palettes). */
export function discreteSeriesColors(resolved: ResolvedChartColors, n = 8): string[] {
  if (resolved.continuous) return discretizeContinuous(resolved.colors, n);
  return sampleCategorical(resolved.colors, n);
}

/** Chart kinds that paint a continuous ramp from the measure when Color isn’t set. */
const VALUE_RAMP_KINDS = new Set([
  "treemap",
  "sunburst",
  "heatmap",
  "hexbin",
  "choropleth",
  "dataCube",
  "forceBubble",
  "geoBubbles",
  "geoHex",
]);

/** Value-ramp kinds whose color is a row count per cell, not the Y measure. */
const COUNT_RAMP_KINDS = new Set(["heatmap", "hexbin", "geoHex"]);

export type ChartColorStatusHints = {
  kind: string;
  colorField?: string | null;
  yField?: string | null;
  sizeField?: string | null;
  xField?: string | null;
};

export type ChartColorStatusInfo = {
  /** Encoding role + field, e.g. `nest: views` (no palette name). */
  fieldLabel: string;
  /** Human palette name for a11y / status text fallback. */
  paletteName: string;
  /** Stops for a glanceable ramp (continuous or categorical). */
  stops: string[];
  continuous: boolean;
  /** Legacy one-liner: `nest: views · Diverging Hot–Cold`. */
  line: string;
};

type ChartColorStatusOpts = {
  customColors?: string | null;
  paletteId?: string | null;
  scaleKind?: ResolveChartColorsOpts["scaleKind"];
  reverse?: boolean;
  theme?: string | null;
  colorblind?: boolean;
  colorFieldType?: "quantitative" | "nominal" | "ordinal" | null;
  /** Encoding panel name for the color slot (“Nest” on treemap, “Heat” on heatmap…). */
  channelLabel?: string | null;
};

/**
 * Structured color status for footnotes (ramp on the right) and the status bar.
 * Null only when color isn’t meaningfully in play.
 */
export function describeChartColorStatus(
  chart: ChartColorStatusHints | null | undefined,
  opts: ChartColorStatusOpts = {},
): ChartColorStatusInfo | null {
  if (!chart?.kind) return null;
  const paletteId = opts.paletteId ?? "auto";
  const scaleKind = opts.scaleKind ?? "auto";
  const userPicked =
    (paletteId !== "auto" && paletteId !== "theme") || (scaleKind != null && scaleKind !== "auto");

  const colorField = chart.colorField?.trim() || null;
  const measureField =
    COUNT_RAMP_KINDS.has(chart.kind)
      ? "rows"
      : VALUE_RAMP_KINDS.has(chart.kind)
        ? chart.yField || chart.sizeField || null
        : null;
  const field = colorField || measureField;

  const resolved = resolveChartColors({
    paletteId,
    customColors: opts.customColors,
    theme: opts.theme,
    colorblind: opts.colorblind,
    chartKind: chart.kind,
    colorFieldType:
      opts.colorFieldType ??
      (colorField ? null : field ? "quantitative" : null),
    reverse: opts.reverse,
    scaleKind,
  });

  const atPlay =
    !!colorField ||
    resolved.continuous ||
    VALUE_RAMP_KINDS.has(chart.kind) ||
    userPicked || !!parseCustomColors(opts.customColors);
  if (!atPlay) return null;

  const palette = getPaletteById(resolved.paletteId);
  const name = parseCustomColors(opts.customColors) ? "Custom colors" : palette?.name ?? resolved.paletteId;
  const rev = opts.reverse ? " ↺" : "";
  const role = (opts.channelLabel?.trim() || "color").toLowerCase();
  const fieldLabel = field ? `${role}: ${field}` : role;
  const paletteName = `${name}${rev}`;
  const stops = resolved.continuous
    ? discretizeContinuous(resolved.colors, Math.min(12, Math.max(5, resolved.colors.length)))
    : sampleCategorical(resolved.colors, Math.min(8, Math.max(3, resolved.colors.length)));

  return {
    fieldLabel,
    paletteName,
    stops,
    continuous: resolved.continuous,
    line: `${fieldLabel} · ${paletteName}`,
  };
}

/**
 * Label for what color is doing — e.g. `nest: rank · Diverging Hot–Cold`.
 * Prefer `describeChartColorStatus` when you need a visual ramp.
 */
export function formatChartColorStatus(
  chart: ChartColorStatusHints | null | undefined,
  opts: ChartColorStatusOpts = {},
): string | null {
  return describeChartColorStatus(chart, opts)?.line ?? null;
}

/** Back-compat: discrete color list for a palette id (theme-aware). */
export function getPaletteColors(paletteId: string | undefined, theme?: string | null): string[] {
  const resolved = resolveChartColors({ paletteId: paletteId ?? "auto", theme });
  if (resolved.continuous) return discretizeContinuous(resolved.colors, 8);
  return resolved.colors.length >= 8
    ? resolved.colors.slice(0, Math.max(8, resolved.colors.length))
    : sampleCategorical(resolved.colors, 8);
}

/** Theme UI colors for chart background, title, axes. */
export function getThemeUiColors(theme?: string | null): ThemeUiColors {
  return THEME_UI[resolveRuntimeTheme(theme)] ?? THEME_UI.dark;
}

/** Parse hex color to 0–1 RGB for WebGPU clear value. */
export function hexToRgb01(hex: string): [number, number, number] {
  const rgb = parseHexRgb(hex);
  if (!rgb) return [0.039, 0.039, 0.047];
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

/** Relative luminance contrast ink for labels on fills. */
export function contrastingInk(hex: string): string {
  const rgb = parseHexRgb(hex);
  if (!rgb) return "#ffffff";
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.42 ? "#0a0a0c" : "#ffffff";
}

export function palettesByKind(kind: PaletteKind | "all"): ColorPalette[] {
  if (kind === "all") return COLOR_PALETTES.filter((p) => p.id !== "auto");
  return COLOR_PALETTES.filter((p) => p.kind === kind && p.id !== "auto");
}

export function palettesGrouped(): { system: ColorPalette[]; research: ColorPalette[]; theme: ColorPalette[] } {
  const list = COLOR_PALETTES.filter((p) => p.id !== "auto");
  return {
    system: list.filter((p) => p.source === "system"),
    research: list.filter((p) => p.source === "research"),
    theme: list.filter((p) => p.source === "theme"),
  };
}
