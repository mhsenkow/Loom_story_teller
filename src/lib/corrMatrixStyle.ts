// =================================================================
// corrMatrixStyle — diverging fill + readable cell ink (LOOM-119, 120)
// =================================================================

import { mixColor, parseColor } from "./chartInk";
import { ensureContrast } from "./wcagColor";

export const DEFAULT_CORR_DIVERGING = ["#2166ac", "#f7f7f7", "#b2182b"];

/** Map r in [-1, 1] to [0, 1] for a diverging ramp. */
export function corrFillT(r: number): number {
  return (Math.max(-1, Math.min(1, r)) + 1) / 2;
}

export function sampleCorrDiverging(stops: string[], t: number): string {
  const u = Math.max(0, Math.min(1, t));
  if (stops.length === 0) return "#888";
  if (stops.length === 1) return stops[0]!;
  const mid = (stops.length - 1) * u;
  const i = Math.floor(mid);
  const f = mid - i;
  const a = stops[i] ?? stops[0]!;
  const b = stops[Math.min(i + 1, stops.length - 1)]!;
  return mixColor(a, b, f);
}

/** Text color for a correlation value on its cell fill. */
export function corrCellInk(_r: number, fill: string, bg: string, text: string, opacity = 1): string {
  const pFill = parseColor(fill);
  const pBg = parseColor(bg);
  const painted = pFill && pBg && opacity < 1 ? mixColor(bg, fill, Math.max(0, opacity)) : fill;
  return ensureContrast(text, painted);
}
