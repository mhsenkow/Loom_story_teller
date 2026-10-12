// =================================================================
// webgpuColor — shared RGB parsing for GPU renderers
// =================================================================

export function parseColorToRgb(c: string): [number, number, number] {
  const s = c.trim();
  if (s.startsWith("#") && s.length >= 7) {
    const r = parseInt(s.slice(1, 3), 16) / 255;
    const g = parseInt(s.slice(3, 5), 16) / 255;
    const b = parseInt(s.slice(5, 7), 16) / 255;
    return [r, g, b];
  }
  const rgb = s.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return [0.424, 0.361, 0.906];
}
