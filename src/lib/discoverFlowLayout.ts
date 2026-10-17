// =================================================================
// discoverFlowLayout — newspaper spans for the Discover Flow grid.
// =================================================================
// Flow is "a mix of large and small stories." Spotlight cards are the
// leads. On a wide desktop a single double-wide card disappears into a
// long equal row, so this also promotes a card every few singles,
// and only when the rest of the row can still be filled.

export type DiscoverFlowTier = "lead" | "wide" | "standard" | "brief";

/** 1 = ordinary card, 2 = a wider story, 3 = broadsheet lead. */
export function discoverFlowSpans(
  count: number,
  columns: number,
  featured: readonly boolean[],
): number[] {
  return discoverFlowTiers(count, columns, featured).map((tier) =>
    tier === "lead" ? (columns >= 5 ? 3 : 2) : tier === "wide" ? 2 : 1,
  );
}

/**
 * Newspaper tiers: lead (3-col when room), wide (2-col), standard, brief.
 * Spans always pack to fill complete rows when possible.
 */
export function discoverFlowTiers(
  count: number,
  columns: number,
  featured: readonly boolean[],
): DiscoverFlowTier[] {
  const tiers = new Array<DiscoverFlowTier>(count).fill("standard");
  if (columns < 2 || count === 0) {
    for (let i = 0; i < count; i++) {
      if (i > 0 && i % 4 === 3) tiers[i] = "brief";
    }
    return tiers;
  }
  const leadSpan = columns >= 5 ? 3 : 2;
  let used = 0;
  let sinceWide = 99;
  let briefsInRow = 0;
  // Wider screens keep more than one large card in view. A 6-column
  // desktop fits two; a very wide row fits three.
  const gap = Math.max(1, Math.floor(columns / 4));
  for (let i = 0; i < count; i++) {
    const room = columns - used;
    const wantLead =
      Boolean(featured[i]) &&
      room >= leadSpan &&
      (i === 0 || sinceWide >= gap);
    const wantWide = !wantLead && (Boolean(featured[i]) || sinceWide >= gap) && room >= 2;
    if (wantLead) {
      tiers[i] = "lead";
      used += leadSpan;
      sinceWide = 0;
      briefsInRow = 0;
    } else if (wantWide) {
      tiers[i] = "wide";
      used += 2;
      sinceWide = 0;
      briefsInRow = 0;
    } else {
      // Prefer a brief when the row already has a standard, to vary rhythm.
      const makeBrief =
        room === 1 ||
        (briefsInRow === 0 && used > 0 && sinceWide > 0 && i % 3 === 2);
      tiers[i] = makeBrief ? "brief" : "standard";
      used += 1;
      sinceWide += 1;
      if (makeBrief) briefsInRow += 1;
      else briefsInRow = 0;
    }
    if (used >= columns) {
      used = 0;
      briefsInRow = 0;
    }
  }
  return tiers;
}

/** Parsed `grid-template-columns`, ignoring the phone layout that stays single-width. */
export function discoverFlowColumnCount(template: string, narrow: boolean): number {
  if (narrow) return 1;
  const columns = template
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0 && part !== "none").length;
  return columns > 0 ? columns : 1;
}
