// Shared color system for chart visual overrides (right panel + ChartView).
// Primary catalog: Loom data-viz palettes. "theme" follows look-system tokens.

import { normalizeTheme, type LookTheme } from "./lookSystem";

const LOOM_DEFAULT = ["#6c5ce7", "#00d68f", "#ff6b6b", "#ffd93d", "#00b4d8", "#e77c5c", "#a29bfe", "#74b9ff"];

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

export type ThemeUiColors = { bg: string; text: string; muted: string; border: string; accent: string };

/** Canonical UI colors per look theme (keep in sync with globals.css). */
export const THEME_UI: Record<LookTheme, ThemeUiColors> = {
  light: { bg: "#f2f2f0", text: "#111111", muted: "#757575", border: "#c8c8c4", accent: "#c45c26" },
  dark: { bg: "#0a0a0c", text: "#e8e8ec", muted: "#6b6b78", border: "#2a2a30", accent: "#1877F2" },
  contrast: { bg: "#000000", text: "#ffffff", muted: "#b0b0b0", border: "#ffffff", accent: "#ffff00" },
  paper: { bg: "#e8e2d6", text: "#1c1914", muted: "#6e685c", border: "#c4bbaa", accent: "#8b4510" },
  glass: { bg: "#e8eef8", text: "#0f172a", muted: "#64748b", border: "#94a3b8", accent: "#5A24C7" },
  frost: { bg: "#070b16", text: "#e2e8f0", muted: "#94a3b8", border: "#475569", accent: "#A87CFF" },
  brutal: { bg: "#ffffff", text: "#000000", muted: "#333333", border: "#000000", accent: "#ff0000" },
  loom: { bg: "#0a0a0f", text: "#e8e6e3", muted: "#a8a5a0", border: "#2a2a35", accent: "#d4a84b" },
  tank: { bg: "#0b1a22", text: "#c5e2e7", muted: "#69a1b3", border: "#23475a", accent: "#32A84F" },
  nes: { bg: "#209cee", text: "#000000", muted: "#1a1a1a", border: "#000000", accent: "#e4002b" },
};

/** First 8 categorical stops — dark/frost/glass shell chart tokens. */
const VIZ_CAT_8 = VIZ_CATEGORICAL.slice(0, 8);

/** Chart series colors per look theme (keep in sync with globals.css --chart-*). */
export const THEME_CHART: Record<LookTheme, string[]> = {
  light: ["#c45c26", "#00b87c", "#c62828", "#d4a017", "#0096b7", "#7c71d8", "#5a9fd4", "#6e685c"],
  dark: VIZ_CAT_8,
  contrast: ["#ffff00", "#00ff9d", "#ff5555", "#00ccff", "#ff8844", "#bb99ff", "#66bbff", "#ffffff"],
  paper: ["#8b4510", "#3d6b4f", "#9b2c2c", "#a67c00", "#2c5f7c", "#6b4c7a", "#5c6e4a", "#6e685c"],
  glass: VIZ_CAT_8,
  frost: ["#A87CFF", "#3EA096", "#E42C87", "#F0701A", "#5FAAFF", "#850550", "#0099B8", "#94a3b8"],
  brutal: ["#ff0000", "#0000ff", "#008000", "#ffaa00", "#000000", "#ff00ff", "#00ffff", "#808080"],
  loom: ["#d4a84b", "#A87CFF", "#E42C87", "#3EA096", "#1877F2", "#F0701A", "#5A24C7", "#a8a5a0"],
  tank: ["#32A84F", "#F7B60B", "#D31E3C", "#1877F2", "#3EA096", "#F0701A", "#0099B8", "#69a1b3"],
  nes: ["#e4002b", "#fce100", "#209cee", "#00a800", "#000000", "#fc9838", "#b8f8d8", "#881400"],
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
  const t = normalizeTheme(theme);
  return THEME_CHART[t] ?? VIZ_CAT_8;
}

function stopsForPalette(p: ColorPalette, theme?: string | null): string[] {
  if (p.id === "theme") return getThemeChartColors(theme);
  return p.colors.slice();
}

/** Discrete sample — ordered cycle; reverse flips stop order. */
export function sampleCategorical(colors: string[], n: number, reverse = false): string[] {
  const src = reverse ? [...colors].reverse() : colors;
  if (n <= 0) return [];
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
  if (kind === "heatmap" || kind === "choropleth") return "seq-blue";
  if (kind === "waterfall") return "semantic";
  if (colorFieldType === "quantitative" || colorFieldType === "ordinal") return "seq-blue";
  return "categorical";
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

  // Colorblind override when still on auto / theme / default system palettes
  if (opts.colorblind) {
    const locked = id !== "auto" && id !== "theme" && id !== "categorical" && id !== "seq-blue";
    if (!locked) {
      const autoId = pickAutoPaletteId(opts.chartKind, opts.colorFieldType);
      const autoP = getPaletteById(autoId);
      id = autoP && isContinuousKind(autoP.kind) ? "cividis" : "okabe";
    }
  }

  if (id === "auto") {
    id = pickAutoPaletteId(opts.chartKind, opts.colorFieldType);
  }

  let palette = getPaletteById(id);
  if (!palette) {
    palette = getPaletteById("categorical")!;
    id = "categorical";
  }

  if (opts.scaleKind && opts.scaleKind !== "auto" && (opts.paletteId === "auto" || !opts.paletteId)) {
    const match = COLOR_PALETTES.find((p) => p.kind === opts.scaleKind && p.source === "system" && p.id !== "auto");
    if (match) {
      palette = match;
      id = match.id;
    }
  }

  let colors = stopsForPalette(palette, opts.theme);
  if (reverse) colors = [...colors].reverse();

  const continuous =
    isContinuousKind(palette.kind) ||
    opts.chartKind === "heatmap" ||
    opts.chartKind === "choropleth";

  if (!continuous && colors.length < 8) {
    colors = sampleCategorical(colors, 8, false);
  }

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
  return THEME_UI[normalizeTheme(theme)] ?? THEME_UI.dark;
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
  return L > 0.45 ? "#0a0a0c" : "#ffffff";
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
