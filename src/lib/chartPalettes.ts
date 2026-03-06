// Shared color palettes for chart visual overrides (right panel + ChartView).

export const COLOR_PALETTES: { id: string; name: string; colors: string[] }[] = [
  { id: "loom", name: "Loom", colors: ["#6c5ce7", "#00d68f", "#ff6b6b", "#ffd93d", "#00b4d8", "#e77c5c", "#a29bfe", "#74b9ff"] },
  { id: "viridis", name: "Viridis", colors: ["#440154", "#482878", "#3e4a89", "#31688e", "#26838f", "#1f9e89", "#35b779", "#6dcd59"] },
  { id: "plasma", name: "Plasma", colors: ["#0d0887", "#47039f", "#7301a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a"] },
  { id: "cool", name: "Cool", colors: ["#2e3192", "#5054a8", "#6d72bd", "#8a90d2", "#a7afe6", "#c4cffa", "#e1e6ff", "#ffffff"] },
  { id: "warm", name: "Warm", colors: ["#6b0000", "#a01700", "#d02c00", "#ff4d00", "#ff7a00", "#ffa600", "#ffd300", "#ffff00"] },
];

const DEFAULT_PALETTE = COLOR_PALETTES[0]!;

export function getPaletteColors(paletteId: string | undefined): string[] {
  const p = COLOR_PALETTES.find((x) => x.id === (paletteId ?? "loom"));
  return p ? p.colors : DEFAULT_PALETTE.colors;
}
