// =================================================================
// discoverFlowLayout — newspaper spans for the Discover Flow grid.
// =================================================================
// Flow is "a mix of large and small stories." Spotlight cards are the
// leads. On a wide desktop a single double-wide card disappears into a
// long equal row, so this also promotes a card every few singles,
// and only when the rest of the row can still be filled.

/** 1 = ordinary card, 2 = a wider story. */
export function discoverFlowSpans(
  count: number,
  columns: number,
  featured: readonly boolean[],
): number[] {
  const spans = new Array<number>(count).fill(1);
  if (columns < 2 || count === 0) return spans;
  let used = 0;
  let sinceWide = 99;
  // Wider screens keep more than one large card in view. A 6-column
  // desktop fits two; a very wide row fits three.
  const gap = Math.max(1, Math.floor(columns / 4));
  for (let i = 0; i < count; i++) {
    const room = columns - used;
    const due = Boolean(featured[i]) || sinceWide >= gap;
    if (due && room >= 2) {
      spans[i] = 2;
      used += 2;
      sinceWide = 0;
    } else {
      used += 1;
      sinceWide += 1;
    }
    if (used >= columns) used = 0;
  }
  return spans;
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
