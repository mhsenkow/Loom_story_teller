// =================================================================
// Loom — Look system catalog (themes, chrome, fonts, chart looks)
// =================================================================
// Aligned with portfolio `theme/system.ts` + wordcounter suite look keys.
// Visual values live in globals.css (`data-theme` / `data-ui` / `data-font`).
// =================================================================

import type { ChartVisualOverrides } from "./store";

export const THEMES = [
  "light",
  "dark",
  "contrast",
  "paper",
  "glass",
  "frost",
  "brutal",
  "loom",
  "tank",
  "nes",
] as const;

export type LookTheme = (typeof THEMES)[number];

export const THEME_LABEL: Record<LookTheme, string> = {
  light: "Light",
  dark: "Dark",
  contrast: "Contrast",
  paper: "Paper",
  glass: "Glass",
  frost: "Frost",
  brutal: "Brutal",
  loom: "Loom",
  tank: "Tank",
  nes: "NES",
};

/** Legacy Loom AppTheme → current catalog */
export const THEME_LEGACY: Record<string, LookTheme> = {
  "high-contrast": "contrast",
  hc: "contrast",
  colorblind: "dark", // a11y flag separate; shell falls back to dark
  electric: "frost",
  forest: "tank",
};

export const UI_CHROMES = [
  "braun",
  "monocle",
  "bauhaus",
  "noyes",
  "ikea",
  "military",
  "terminal",
  "nyt",
] as const;

export type UiChrome = (typeof UI_CHROMES)[number];

export const UI_CHROME_LABEL: Record<UiChrome, string> = {
  braun: "Braun",
  monocle: "Monocle",
  bauhaus: "Bauhaus",
  noyes: "Noyes",
  ikea: "Ikea",
  military: "Military",
  terminal: "Terminal",
  nyt: "NYT",
};

export const APP_FONTS = [
  "libre-baskerville",
  "lora",
  "ibm-plex",
  "inter",
  "geist",
  "jetbrains-mono",
  "fira-code",
] as const;

export type AppFont = (typeof APP_FONTS)[number];

export const APP_FONT_LABEL: Record<AppFont, string> = {
  "libre-baskerville": "Libre Baskerville",
  lora: "Lora",
  "ibm-plex": "IBM Plex Sans",
  inter: "Inter",
  geist: "Geist",
  "jetbrains-mono": "JetBrains Mono",
  "fira-code": "Fira Code",
};

export const FONT_LEGACY: Record<string, AppFont> = {
  "work-sans": "inter",
  "space-grotesk": "geist",
  "dm-sans": "inter",
  manrope: "geist",
  "sf-pro": "geist",
  segoe: "inter",
  optimistic: "inter",
  Inter: "inter",
  "JetBrains Mono": "jetbrains-mono",
  "Instrument Serif": "libre-baskerville",
  "Space Grotesk": "geist",
  "DM Sans": "inter",
};

export const FACES_SOURCES = ["auto", "web", "local"] as const;
export type FacesSource = (typeof FACES_SOURCES)[number];

export const DEFAULT_THEME: LookTheme = "dark";
export const DEFAULT_UI: UiChrome = "noyes";
export const DEFAULT_FONT: AppFont = "inter";
export const DEFAULT_FACES: FacesSource = "auto";

export function normalizeTheme(raw: string | undefined | null): LookTheme {
  if (!raw) return DEFAULT_THEME;
  if ((THEMES as readonly string[]).includes(raw)) return raw as LookTheme;
  return THEME_LEGACY[raw] ?? DEFAULT_THEME;
}

export function normalizeUi(raw: string | undefined | null): UiChrome {
  if (raw && (UI_CHROMES as readonly string[]).includes(raw)) return raw as UiChrome;
  return DEFAULT_UI;
}

export function normalizeFont(raw: string | undefined | null): AppFont {
  if (!raw) return DEFAULT_FONT;
  if ((APP_FONTS as readonly string[]).includes(raw)) return raw as AppFont;
  return FONT_LEGACY[raw] ?? DEFAULT_FONT;
}

export function normalizeFaces(raw: string | undefined | null): FacesSource {
  if (raw && (FACES_SOURCES as readonly string[]).includes(raw)) return raw as FacesSource;
  return DEFAULT_FACES;
}

/** Chart Visual spectrum (wordcount-inspired, Loom names). */
export const CHART_DETAIL = ["plain", "viz", "deep"] as const;
export type ChartDetail = (typeof CHART_DETAIL)[number];

export const MARK_MOTIFS = ["dots", "squares", "ticks", "bar", "ring"] as const;
export type MarkMotif = (typeof MARK_MOTIFS)[number];

export const AXIS_STYLES = ["rule", "ladder", "mercury", "spine", "index", "tape"] as const;
export type AxisStyle = (typeof AXIS_STYLES)[number];

export const EMPHASIS_STYLES = ["tint", "wash", "dot", "alarm", "tag"] as const;
export type EmphasisStyle = (typeof EMPHASIS_STYLES)[number];

export const GHOST_WEIGHTS = ["whisper", "soft", "firm"] as const;
export type GhostWeight = (typeof GHOST_WEIGHTS)[number];

export const GHOST_PLACES = ["se", "sw", "ne", "nw"] as const;
export type GhostPlace = (typeof GHOST_PLACES)[number];

export const TITLE_LAYOUTS = ["pair", "stack", "spine", "caption", "ticket", "slab"] as const;
export type TitleLayout = (typeof TITLE_LAYOUTS)[number];

export const CHART_FRAMES = ["hero", "compact", "focus"] as const;
export type ChartFrame = (typeof CHART_FRAMES)[number];

export type VisualPresetId =
  | "tufte"
  | "bauhaus"
  | "newspaper"
  | "military"
  | "clarity"
  | "glass"
  | "high-contrast"
  | "terminal"
  | "nes"
  | "brutal";

/** Short blurbs for Visual UI tooltips — what the design system is aiming for. */
export const VISUAL_PRESET_BLURB: Record<VisualPresetId, string> = {
  tufte: "Max data-ink · no chartjunk · hairline axes",
  bauhaus: "Primary geometry · bold rails · flat color blocks",
  newspaper: "Broadsheet rules · paper grain · caption titles",
  military: "Carbon field · mercury baseline · operational type",
  clarity: "Dense-data rescue · tiny marks · soft grid",
  glass: "Soft glow · rings · atmospheric wash",
  "high-contrast": "Alarm emphasis · thick rails · readable labels",
  terminal: "Mono index ticks · dotted grid · HUD calm",
  nes: "Chunky squares · ticket title · solid grid",
  brutal: "Ladder rails · slab title · zero radius",
};

/**
 * Full-replace Visual presets. Each bundle sets every field that affects canvas
 * output so switching presets never leaves half-applied / clashing state.
 * Design systems (Tufte / Bauhaus / newspaper / military) must change
 * backgroundStyle + axisStyle — chartLooks draws those for real.
 */
export const VISUAL_PRESETS: Record<VisualPresetId, { name: string; overrides: ChartVisualOverrides }> = {
  tufte: {
    name: "Tufte",
    overrides: {
      colorPalette: "reference",
      opacity: 0.85,
      pointSize: 4,
      sizeScale: 0.7,
      chartPadding: 54,
      showGrid: false,
      gridStyle: "none",
      gridOpacity: 0,
      titleFontWeight: 500,
      titleItalic: false,
      axisFontSize: 9,
      axisLineWidth: 1,
      tickCount: 4,
      tickRotation: 0,
      legendPosition: "none",
      chartDetail: "plain",
      chartFrame: "focus",
      titleLayout: "caption",
      backgroundStyle: "tufte",
      blendMode: "source-over",
      glowEnabled: false,
      showDataLabels: false,
      axisStyle: "mercury",
      markMotif: "dots",
      markStroke: false,
      markJitter: 0,
      markShape: "circle",
      lineWidth: 1.25,
      lineCurveSmooth: false,
      barCornerRadius: 0,
      fontFamily: "Inter",
      animateEntrance: false,
      ghostEnabled: false,
    },
  },
  bauhaus: {
    name: "Bauhaus",
    overrides: {
      colorPalette: "categorical",
      opacity: 0.95,
      pointSize: 10,
      sizeScale: 1.05,
      chartPadding: 50,
      showGrid: true,
      gridStyle: "solid",
      gridOpacity: 0.35,
      titleFontWeight: 700,
      titleItalic: false,
      axisFontSize: 11,
      axisLineWidth: 2.5,
      tickCount: 5,
      tickRotation: 0,
      legendPosition: "none",
      chartDetail: "deep",
      chartFrame: "focus",
      titleLayout: "slab",
      backgroundStyle: "bauhaus",
      blendMode: "source-over",
      glowEnabled: false,
      showDataLabels: false,
      axisStyle: "ladder",
      markMotif: "squares",
      markShape: "square",
      markStroke: true,
      markStrokeWidth: 1.5,
      markJitter: 0,
      emphasisStyle: "tag",
      lineWidth: 2.5,
      lineCurveSmooth: false,
      barCornerRadius: 0,
      fontFamily: "IBM Plex Sans",
      animateEntrance: false,
      ghostEnabled: false,
    },
  },
  newspaper: {
    name: "Newspaper",
    overrides: {
      colorPalette: "reference",
      opacity: 0.8,
      pointSize: 7,
      sizeScale: 0.9,
      fontFamily: "Libre Baskerville",
      chartPadding: 52,
      titleFontWeight: 600,
      titleItalic: true,
      axisFontSize: 9,
      showGrid: true,
      gridStyle: "solid",
      gridOpacity: 0.22,
      axisLineWidth: 1,
      tickCount: 5,
      tickRotation: 0,
      barCornerRadius: 0,
      lineWidth: 1.5,
      lineCurveSmooth: false,
      lineStrokeStyle: "solid",
      chartDetail: "viz",
      chartFrame: "focus",
      titleLayout: "caption",
      axisStyle: "tape",
      backgroundStyle: "newsprint",
      blendMode: "source-over",
      markMotif: "ticks",
      markShape: "cross",
      markStroke: false,
      markJitter: 0,
      glowEnabled: false,
      showDataLabels: false,
      legendPosition: "none",
      ghostEnabled: false,
      animateEntrance: false,
    },
  },
  military: {
    name: "Military",
    overrides: {
      colorPalette: "semantic",
      opacity: 0.9,
      pointSize: 8,
      sizeScale: 1,
      fontFamily: "IBM Plex Sans",
      titleFontWeight: 700,
      titleItalic: false,
      tickRotation: 30,
      axisLineWidth: 2,
      chartPadding: 52,
      chartFrame: "focus",
      titleLayout: "stack",
      axisStyle: "mercury",
      markMotif: "bar",
      markShape: "diamond",
      markStroke: true,
      markStrokeWidth: 1,
      markJitter: 0,
      chartDetail: "viz",
      emphasisStyle: "wash",
      showGrid: true,
      gridStyle: "dotted",
      gridOpacity: 0.28,
      axisFontSize: 10,
      tickCount: 5,
      barCornerRadius: 0,
      lineWidth: 2,
      lineCurveSmooth: false,
      showDataLabels: false,
      backgroundStyle: "carbon",
      blendMode: "source-over",
      glowEnabled: false,
      legendPosition: "top-right",
      ghostEnabled: false,
      animateEntrance: false,
    },
  },
  clarity: {
    name: "Clarity",
    overrides: {
      colorPalette: "auto",
      // Dense-data friendly but still crisp circles (was too faint/tiny)
      opacity: 0.55,
      pointSize: 7,
      sizeScale: 0.85,
      chartPadding: 48,
      showGrid: true,
      gridStyle: "dotted",
      gridOpacity: 0.35,
      titleFontWeight: 600,
      titleItalic: false,
      axisFontSize: 10,
      axisLineWidth: 1,
      tickCount: 5,
      tickRotation: 0,
      legendPosition: "right",
      chartDetail: "viz",
      chartFrame: "focus",
      titleLayout: "pair",
      backgroundStyle: "default",
      blendMode: "source-over",
      glowEnabled: false,
      showDataLabels: false,
      axisStyle: "rule",
      markMotif: "dots",
      markStroke: false,
      markJitter: 0,
      markShape: "circle",
      lineWidth: 1.5,
      barCornerRadius: 2,
      animateEntrance: false,
      ghostEnabled: false,
    },
  },
  glass: {
    name: "Glass",
    overrides: {
      colorPalette: "categorical",
      opacity: 0.62,
      pointSize: 11,
      sizeScale: 1.05,
      backgroundStyle: "gradient",
      chartPadding: 50,
      glowEnabled: true,
      glowIntensity: 7,
      blendMode: "source-over",
      chartDetail: "viz",
      chartFrame: "focus",
      titleLayout: "pair",
      axisStyle: "rule",
      markMotif: "ring",
      markShape: "ring",
      markStroke: true,
      markStrokeWidth: 1.25,
      markJitter: 0,
      fontFamily: "Inter",
      titleFontWeight: 500,
      titleItalic: false,
      axisFontSize: 10,
      showGrid: true,
      gridStyle: "solid",
      gridOpacity: 0.22,
      axisLineWidth: 1,
      tickCount: 5,
      tickRotation: 0,
      barCornerRadius: 6,
      lineWidth: 1.5,
      lineCurveSmooth: true,
      showDataLabels: false,
      legendPosition: "none",
      ghostEnabled: false,
      animateEntrance: false,
    },
  },
  "high-contrast": {
    name: "High contrast",
    overrides: {
      colorPalette: "theme",
      opacity: 0.92,
      pointSize: 11,
      sizeScale: 1.1,
      chartPadding: 50,
      axisLineWidth: 2,
      axisFontSize: 11,
      showGrid: true,
      gridStyle: "solid",
      gridOpacity: 0.55,
      titleFontWeight: 700,
      titleItalic: false,
      tickCount: 6,
      tickRotation: 0,
      showDataLabels: true,
      chartDetail: "deep",
      chartFrame: "focus",
      titleLayout: "stack",
      emphasisStyle: "alarm",
      axisStyle: "ladder",
      markMotif: "squares",
      markShape: "square",
      markStroke: true,
      markStrokeWidth: 1.5,
      markJitter: 0,
      barCornerRadius: 0,
      lineWidth: 2.25,
      lineCurveSmooth: false,
      backgroundStyle: "default",
      blendMode: "source-over",
      glowEnabled: false,
      fontFamily: "IBM Plex Sans",
      legendPosition: "top-right",
      ghostEnabled: false,
      animateEntrance: false,
    },
  },
  terminal: {
    name: "Terminal",
    overrides: {
      colorPalette: "seq-teal",
      opacity: 0.85,
      pointSize: 7,
      sizeScale: 0.95,
      fontFamily: "JetBrains Mono",
      backgroundStyle: "blueprint",
      showGrid: true,
      gridStyle: "dotted",
      gridOpacity: 0.4,
      titleFontWeight: 400,
      titleItalic: false,
      chartPadding: 46,
      chartFrame: "focus",
      titleLayout: "pair",
      axisStyle: "index",
      markMotif: "dots",
      markStroke: false,
      markJitter: 0,
      chartDetail: "viz",
      emphasisStyle: "dot",
      axisFontSize: 9,
      axisLineWidth: 1,
      tickCount: 6,
      tickRotation: 0,
      barCornerRadius: 0,
      lineWidth: 1.25,
      lineStrokeStyle: "solid",
      lineCurveSmooth: false,
      showDataLabels: false,
      blendMode: "source-over",
      glowEnabled: false,
      legendPosition: "none",
      ghostEnabled: false,
      animateEntrance: false,
    },
  },
  nes: {
    name: "NES",
    overrides: {
      colorPalette: "theme",
      opacity: 1,
      pointSize: 10,
      sizeScale: 1,
      barCornerRadius: 0,
      axisLineWidth: 3,
      fontFamily: "JetBrains Mono",
      chartPadding: 44,
      showDataLabels: true,
      chartDetail: "deep",
      markMotif: "squares",
      markShape: "square",
      markStroke: true,
      markStrokeWidth: 2,
      markJitter: 0,
      axisStyle: "ladder",
      titleLayout: "ticket",
      titleFontWeight: 700,
      titleItalic: false,
      chartFrame: "compact",
      emphasisStyle: "alarm",
      showGrid: true,
      gridStyle: "solid",
      gridOpacity: 0.7,
      axisFontSize: 9,
      tickCount: 4,
      tickRotation: 0,
      lineWidth: 2,
      lineCurveSmooth: false,
      backgroundStyle: "default",
      blendMode: "source-over",
      glowEnabled: false,
      legendPosition: "none",
      ghostEnabled: false,
      animateEntrance: false,
    },
  },
  brutal: {
    name: "Brutal",
    overrides: {
      colorPalette: "categorical",
      opacity: 0.95,
      pointSize: 10,
      sizeScale: 1,
      barCornerRadius: 0,
      axisLineWidth: 2.5,
      showGrid: true,
      gridStyle: "solid",
      gridOpacity: 0.85,
      chartPadding: 48,
      titleFontWeight: 700,
      titleItalic: false,
      fontFamily: "JetBrains Mono",
      axisFontSize: 10,
      chartDetail: "deep",
      chartFrame: "focus",
      titleLayout: "slab",
      axisStyle: "ladder",
      markMotif: "squares",
      markShape: "square",
      markStroke: true,
      markStrokeWidth: 2,
      markJitter: 0,
      emphasisStyle: "tag",
      backgroundStyle: "ruled",
      blendMode: "source-over",
      lineWidth: 2.5,
      lineCurveSmooth: false,
      showDataLabels: true,
      tickCount: 5,
      tickRotation: 0,
      glowEnabled: false,
      legendPosition: "none",
      ghostEnabled: false,
      animateEntrance: false,
    },
  },
};

const SHUFFLE_POOL: VisualPresetId[] = [
  "tufte",
  "bauhaus",
  "newspaper",
  "military",
  "clarity",
  "glass",
  "terminal",
  "brutal",
];

export function shuffleVisualPreset(exclude?: VisualPresetId): VisualPresetId {
  const pool = exclude ? SHUFFLE_POOL.filter((p) => p !== exclude) : SHUFFLE_POOL;
  return pool[Math.floor(Math.random() * pool.length)] ?? "tufte";
}

/** Sections that can be locked while shuffling Visual look. */
export type VisualShuffleSection =
  | "color"
  | "design"
  | "marks"
  | "axes"
  | "atmosphere"
  | "type";

export const VISUAL_SHUFFLE_SECTIONS: { id: VisualShuffleSection; label: string }[] = [
  { id: "color", label: "Color" },
  { id: "design", label: "Design" },
  { id: "marks", label: "Marks" },
  { id: "axes", label: "Axes" },
  { id: "atmosphere", label: "Atmosphere" },
  { id: "type", label: "Type" },
];

export type VisualShuffleLocks = Partial<Record<VisualShuffleSection, boolean>>;

const SECTION_KEYS: Record<VisualShuffleSection, (keyof ChartVisualOverrides)[]> = {
  color: ["colorPalette", "colorScaleKind", "colorPaletteReverse", "opacity"],
  design: [
    "chartDetail", "markMotif", "axisStyle", "titleLayout", "chartFrame",
    "emphasisStyle", "backgroundStyle",
  ],
  marks: [
    "pointSize", "sizeScale", "markShape", "markStroke", "markStrokeWidth",
    "markStrokeColor", "markJitter", "barCornerRadius", "lineStrokeStyle",
    "lineCurveSmooth", "lineWidth", "showDataLabels",
  ],
  axes: [
    "showGrid", "gridStyle", "gridOpacity", "axisLineColor", "axisLineWidth",
    "axisLabelColor", "tickCount", "tickRotation", "axisFontSize", "chartPadding",
    "legendPosition",
  ],
  atmosphere: [
    "blendMode", "glowEnabled", "glowIntensity", "animateEntrance",
    "ghostEnabled", "ghostWeight", "ghostPlace",
  ],
  type: ["fontFamily", "titleFontWeight", "titleItalic"],
};

function pickOne<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Palette ids for shuffle (kept local to avoid circular import with chartPalettes). */
const SHUFFLE_COLOR_POOL: { id: string; kind: NonNullable<ChartVisualOverrides["colorScaleKind"]> }[] = [
  { id: "categorical", kind: "categorical" },
  { id: "semantic", kind: "semantic" },
  { id: "reference", kind: "reference" },
  { id: "seq-blue", kind: "sequential" },
  { id: "seq-teal", kind: "sequential" },
  { id: "seq-purple", kind: "sequential" },
  { id: "seq-pink", kind: "sequential" },
  { id: "seq-orange", kind: "sequential" },
  { id: "spectrum", kind: "spectrum" },
  { id: "div-cool-warm", kind: "diverging" },
  { id: "div-hot-cold", kind: "diverging" },
  { id: "div-pos-neg", kind: "diverging" },
  { id: "okabe", kind: "categorical" },
  { id: "viridis", kind: "sequential" },
  { id: "plasma", kind: "sequential" },
  { id: "cividis", kind: "sequential" },
  { id: "turbo", kind: "spectrum" },
  { id: "theme", kind: "categorical" },
];

function randomColorOverrides(): Pick<
  ChartVisualOverrides,
  "colorPalette" | "colorScaleKind" | "colorPaletteReverse" | "opacity"
> {
  const p = pickOne(SHUFFLE_COLOR_POOL);
  return {
    colorPalette: p.id,
    colorScaleKind: p.kind,
    colorPaletteReverse: Math.random() > 0.85,
    opacity: Math.round((0.35 + Math.random() * 0.6) * 100) / 100,
  };
}

/**
 * Shuffle Visual overrides. Locked sections keep `current` values;
 * unlocked sections are taken from a random design preset (color also
 * samples the palette catalog independently for more variety).
 */
export function shuffleVisualOverrides(
  current: ChartVisualOverrides,
  locks: VisualShuffleLocks = {},
  excludePreset?: VisualPresetId,
): ChartVisualOverrides {
  const presetId = shuffleVisualPreset(excludePreset);
  const donor = { ...VISUAL_PRESETS[presetId].overrides };

  // Enrich color from the full catalog when color isn't locked
  if (!locks.color) {
    Object.assign(donor, randomColorOverrides());
  }

  const next: ChartVisualOverrides = { ...current };
  for (const section of VISUAL_SHUFFLE_SECTIONS) {
    if (locks[section.id]) continue;
    for (const key of SECTION_KEYS[section.id]) {
      const v = donor[key];
      if (v !== undefined) (next as Record<string, unknown>)[key] = v;
    }
  }
  return next;
}

/** Suite sync key (same-origin with wordcount when applicable). */
export const IBM_TOOLS_SHARED_KEY = "ibm.tools.shared";

export interface IbmToolsShared {
  theme?: string;
  ui?: string;
  font?: string;
  faces?: string;
}

export function readIbmToolsShared(): IbmToolsShared | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(IBM_TOOLS_SHARED_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as IbmToolsShared;
  } catch {
    return null;
  }
}

export function writeIbmToolsShared(partial: IbmToolsShared): void {
  if (typeof localStorage === "undefined") return;
  try {
    const prev = readIbmToolsShared() ?? {};
    localStorage.setItem(IBM_TOOLS_SHARED_KEY, JSON.stringify({ ...prev, ...partial }));
  } catch {
    /* ignore */
  }
}
