// =================================================================
// Explorer / table sort — null-aware, type-stable comparators
// =================================================================

type Cell = string | number | boolean | null;

export type SortDir = "asc" | "desc" | "none";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function cellSortRank(v: Cell): number {
  if (v === null || v === undefined || v === "") return 3;
  if (typeof v === "boolean") return 1;
  if (typeof v === "number" && Number.isFinite(v)) return 0;
  const n = Number(v);
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(n) && String(n) === v.trim()) return 0;
  return 2;
}

/** Compare two cells for one column; nulls/blank always sort last. */
export function compareExplorerCells(a: Cell, b: Cell, dir: 1 | -1): number {
  const ra = cellSortRank(a);
  const rb = cellSortRank(b);
  if (ra !== rb) {
    if (ra === 3) return 1;
    if (rb === 3) return -1;
  }
  if (ra === 0 && rb === 0) {
    const na = typeof a === "number" ? a : Number(a);
    const nb = typeof b === "number" ? b : Number(b);
    if (na !== nb) return (na - nb) * dir;
    return 0;
  }
  if (ra === 1 && rb === 1) {
    const ba = a === true ? 1 : 0;
    const bb = b === true ? 1 : 0;
    if (ba !== bb) return (ba - bb) * dir;
    return 0;
  }
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  return collator.compare(sa, sb) * dir;
}
