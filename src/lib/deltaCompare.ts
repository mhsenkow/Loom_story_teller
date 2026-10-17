// =================================================================
// Delta comparison — shared A→B / Left↔Right change labels
// =================================================================
// Dual-measure charts (dumbbell, slope, pyramid) and period overlays
// share one formatting contract so Encoding “Delta” means the same
// thing everywhere: signed difference or percent change.
// =================================================================

import { formatDataValue } from "./chartAxes";

export type DeltaDisplay = "off" | "diff" | "pct";

export function isDeltaDisplay(v: unknown): v is DeltaDisplay {
  return v === "off" || v === "diff" || v === "pct";
}

/** Signed change from `from` → `to`. */
export function deltaDiff(from: number, to: number): number {
  return to - from;
}

/** Percent change from `from` → `to` (null when base is ~0). */
export function deltaPct(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (Math.abs(from) < 1e-12) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

/** Compact label for on-chart delta ink (`+1.2M`, `−12%`, or empty). */
export function formatDeltaLabel(
  from: number,
  to: number,
  mode: DeltaDisplay | null | undefined,
): string {
  if (!mode || mode === "off") return "";
  if (mode === "pct") {
    const p = deltaPct(from, to);
    if (p == null || !Number.isFinite(p)) return "";
    const rounded = Math.abs(p) >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
    const sign = rounded > 0 ? "+" : "";
    return `${sign}${rounded}%`;
  }
  const d = deltaDiff(from, to);
  if (!Number.isFinite(d) || d === 0) return d === 0 ? "0" : "";
  const sign = d > 0 ? "+" : "";
  return `${sign}${formatDataValue(d)}`;
}
