// Shared color palettes for chart visual overrides (right panel + ChartView).
// "theme" uses CSS variables (--chart-1 … --chart-8) so charts follow app theme.

const LOOM_DEFAULT = ["#6c5ce7", "#00d68f", "#ff6b6b", "#ffd93d", "#00b4d8", "#e77c5c", "#a29bfe", "#74b9ff"];

export const COLOR_PALETTES: { id: string; name: string; colors?: string[] }[] = [
  { id: "theme", name: "Theme (app)" },
  { id: "loom", name: "Loom", colors: LOOM_DEFAULT },
  { id: "viridis", name: "Viridis", colors: ["#440154", "#482878", "#3e4a89", "#31688e", "#26838f", "#1f9e89", "#35b779", "#6dcd59"] },
  { id: "plasma", name: "Plasma", colors: ["#0d0887", "#47039f", "#7301a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a"] },
  { id: "cool", name: "Cool", colors: ["#2e3192", "#5054a8", "#6d72bd", "#8a90d2", "#a7afe6", "#c4cffa", "#e1e6ff", "#ffffff"] },
  { id: "warm", name: "Warm", colors: ["#6b0000", "#a01700", "#d02c00", "#ff4d00", "#ff7a00", "#ffa600", "#ffd300", "#ffff00"] },
];

/** Read --chart-1 through --chart-8 from the document. Use for theme-aware charts. */
export function getThemeChartColors(): string[] {
  if (typeof document === "undefined") return LOOM_DEFAULT;
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const out: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const v = style.getPropertyValue(`--chart-${i}`).trim();
    out.push(v || LOOM_DEFAULT[i - 1]!);
  }
  return out;
}

export function getPaletteColors(paletteId: string | undefined): string[] {
  const id = paletteId ?? "theme";
  if (id === "theme") return getThemeChartColors();
  const p = COLOR_PALETTES.find((x) => x.id === id);
  return p?.colors ?? getThemeChartColors();
}

/** Read UI colors from theme (--loom-bg, --loom-text, etc.) for chart background, title, axes. */
export function getThemeUiColors(): { bg: string; text: string; muted: string; border: string } {
  if (typeof document === "undefined") {
    return { bg: "#0a0a0c", text: "#e8e8ec", muted: "#6b6b78", border: "#2a2a30" };
  }
  const root = document.documentElement;
  const style = getComputedStyle(root);
  return {
    bg: style.getPropertyValue("--loom-bg").trim() || "#0a0a0c",
    text: style.getPropertyValue("--loom-text").trim() || "#e8e8ec",
    muted: style.getPropertyValue("--loom-muted").trim() || "#6b6b78",
    border: style.getPropertyValue("--loom-border").trim() || "#2a2a30",
  };
}

/** Parse hex color to 0–1 RGB for WebGPU clear value. */
export function hexToRgb01(hex: string): [number, number, number] {
  const s = hex.trim();
  if (s.startsWith("#") && s.length >= 7) {
    return [
      parseInt(s.slice(1, 3), 16) / 255,
      parseInt(s.slice(3, 5), 16) / 255,
      parseInt(s.slice(5, 7), 16) / 255,
    ];
  }
  return [0.039, 0.039, 0.047];
}
