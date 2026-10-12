// =================================================================
// wcagColor — shared contrast helpers (LOOM-072)
// =================================================================

import { parseColor, relativeLuminance } from "./chartInk";

/** WCAG 2.x contrast ratio for two sRGB colors. */
export function contrastRatio(fg: string, bg: string): number {
  const lf = relativeLuminance(fg);
  const lb = relativeLuminance(bg);
  const lighter = Math.max(lf, lb);
  const darker = Math.min(lf, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsWcagAa(fg: string, bg: string, largeText = false): boolean {
  const need = largeText ? 3 : 4.5;
  return contrastRatio(fg, bg) >= need;
}

/** Nudge fg toward bg edge until AA or max steps. */
export function ensureContrast(fg: string, bg: string, largeText = false): string {
  if (meetsWcagAa(fg, bg, largeText)) return fg;
  const target = largeText ? 3 : 4.5;
  const lift = relativeLuminance(bg) > 0.4;
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    const candidate = lift
      ? mixRgb(fg, "#000000", t)
      : mixRgb(fg, "#ffffff", t);
    if (contrastRatio(candidate, bg) >= target) return candidate;
  }
  return lift ? "#141414" : "#ffffff";
}

function mixRgb(a: string, b: string, t: number): string {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return a;
  const u = Math.max(0, Math.min(1, t));
  const r = pa[0] + (pb[0] - pa[0]) * u;
  const g = pa[1] + (pb[1] - pa[1]) * u;
  const bl = pa[2] + (pb[2] - pa[2]) * u;
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(bl)}`;
}
