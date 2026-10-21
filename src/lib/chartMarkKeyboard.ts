// =================================================================
// chartMarkKeyboard — step through registered marks (LOOM-349)
// =================================================================

import type { HitTarget } from "./chartTooltip";

/**
 * Every registered mark, in reading order (left → right, then top → bottom),
 * minus exact duplicates and analysis-overlay readouts that have no data row.
 */
export function keyboardNavigableHits(targets: HitTarget[] | undefined): HitTarget[] {
  if (!targets?.length) return [];
  const anchor = (t: HitTarget) =>
    t.shape === "rect"
      ? [t.x + t.w / 2, t.y + t.h / 2]
      : t.shape === "circle"
        ? [t.cx, t.cy]
        : [t.cx + Math.cos((t.a0 + t.a1) / 2) * t.r1, t.cy + Math.sin((t.a0 + t.a1) / 2) * t.r1];
  const seen = new Set<string>();
  const out: { t: HitTarget; x: number; y: number }[] = [];
  for (const t of targets) {
    if (!t.match.length && t.rowIndex == null && !t.summary?.columns?.length) continue;
    const [x, y] = anchor(t);
    const key = `${Math.round(x)}:${Math.round(y)}:${t.shape}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ t, x: x!, y: y! });
  }
  return out.sort((a, b) => a.x - b.x || a.y - b.y).map((o) => o.t);
}

export function nextMarkIndex(current: number, len: number, dir: -1 | 1): number {
  if (len <= 0) return -1;
  if (current < 0) return dir > 0 ? 0 : len - 1;
  const next = current + dir;
  if (next < 0) return len - 1;
  if (next >= len) return 0;
  return next;
}
