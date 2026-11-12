// =================================================================
// socialRank — how community votes move stories on the main screen
// =================================================================
// Recommended keeps Loom's own editorial score and adds a bounded
// community nudge: a well-liked chart rises a few places, a widely
// disliked one sinks out of the way, and a handful of votes can't
// overturn the editorial order. The community sorts (favorites, most
// discussed, divisive, least liked) rank by votes outright.
// =================================================================

export type Counts = readonly [up: number, down: number, comments: number];

export type CommunitySort = "community" | "discussed" | "divisive" | "leastLiked";

export const COMMUNITY_SORTS: readonly CommunitySort[] = ["community", "discussed", "divisive", "leastLiked"];

export const COMMUNITY_SORT_LABELS: Record<CommunitySort, string> = {
  community: "Community favorites",
  discussed: "Most discussed",
  divisive: "Divisive",
  leastLiked: "Least liked",
};

/** Lower bound of the Wilson interval (80%): many positive votes beat a lucky few. */
export function wilsonLower(up: number, down: number, z = 1.28): number {
  const n = up + down;
  if (!n) return 0;
  const p = up / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
}

/** Widely disliked: enough votes, and most of them down. */
export function isBuried(c: Counts | undefined): boolean {
  if (!c) return false;
  const n = c[0] + c[1];
  return n >= 5 && c[1] / n >= 0.75;
}

/**
 * Points added to a story's editorial score in Recommended (editorial
 * scores span roughly 40–110). At most +8.5 for loved and talked-about
 * charts; buried charts drop 30 so they leave the first screens.
 */
export function communityBoost(c: Counts | undefined): number {
  if (!c) return 0;
  if (isBuried(c)) return -30;
  const [up, down, comments] = c;
  return 7 * Math.tanh((up - down) / 4) + 1.5 * Math.tanh(comments / 4);
}

/** Sort value for a community sort; null means "no community signal yet" (listed after). */
export function communitySortValue(mode: CommunitySort, c: Counts | undefined, latestAt = 0): number | null {
  if (!c) return null;
  const [up, down, comments] = c;
  const n = up + down;
  switch (mode) {
    case "community":
      return up > down ? wilsonLower(up, down) * 1000 + up : null;
    case "discussed":
      return comments > 0 ? comments * 1e13 + latestAt : null;
    case "divisive":
      return n >= 3 && up > 0 && down > 0 ? (Math.min(up, down) / Math.max(up, down)) * Math.log2(n + 1) : null;
    case "leastLiked":
      return down > up ? wilsonLower(down, up) * 1000 + down : null;
  }
}

/** Order by a community sort; items without a signal keep their incoming order at the end. */
export function sortByCommunity<T>(
  items: readonly T[],
  mode: CommunitySort,
  countsOf: (item: T) => Counts | undefined,
  latestOf: (item: T) => number = () => 0,
): T[] {
  const ranked = items.map((item, i) => ({ item, i, v: communitySortValue(mode, countsOf(item), latestOf(item)) }));
  ranked.sort((a, b) => {
    if (a.v == null && b.v == null) return a.i - b.i;
    if (a.v == null) return 1;
    if (b.v == null) return -1;
    return b.v - a.v || a.i - b.i;
  });
  return ranked.map((r) => r.item);
}

/** "just now", "5m", "3h", "2d", or a short date for older comments. */
export function formatSocialAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "12" / "1.2k" for vote and comment counts. */
export function formatSocialCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
}
