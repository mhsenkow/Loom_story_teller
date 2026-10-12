// =================================================================
// formatChartNumber — shared cube/dive numeric labels (LOOM-573)
// =================================================================

const compactFmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const detailFmt = new Intl.NumberFormat("en", { maximumSignificantDigits: 6 });
const groupedFmt = new Intl.NumberFormat("en", { maximumFractionDigits: 3, useGrouping: true });

export function formatChartNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 10_000) return compactFmt.format(n);
  if (n !== 0 && Math.abs(n) < 1) return detailFmt.format(n);
  // Integers under 10k (years, counts, bins): no grouping — "2022" not "2,022".
  if (Number.isInteger(n)) return String(n);
  return groupedFmt.format(n).replace(/\.?0+$/, "");
}
