// =================================================================
// chartEntranceOnce — play entrance animation once per chart (LOOM-136)
// =================================================================

const played = new Set<string>();

export function chartEntranceKey(chartId: string | undefined, kind: string | undefined): string {
  return `${chartId ?? ""}\u0001${kind ?? ""}`;
}

export function shouldPlayChartEntrance(key: string, animateEntrance: boolean): boolean {
  if (!animateEntrance || !key) return false;
  return !played.has(key);
}

export function markChartEntrancePlayed(key: string): void {
  if (key) played.add(key);
}

/** Test helper */
export function resetChartEntrancePlayedForTests(): void {
  played.clear();
}
