// =================================================================
// chartMarkKeyboard — step through registered marks (LOOM-349)
// =================================================================

import type { HitTarget } from "./chartTooltip";

export function keyboardNavigableHits(targets: HitTarget[] | undefined): HitTarget[] {
  if (!targets?.length) return [];
  return targets.filter((t) => t.summary?.columns?.length);
}

export function nextMarkIndex(current: number, len: number, dir: -1 | 1): number {
  if (len <= 0) return -1;
  if (current < 0) return dir > 0 ? 0 : len - 1;
  const next = current + dir;
  if (next < 0) return len - 1;
  if (next >= len) return 0;
  return next;
}
