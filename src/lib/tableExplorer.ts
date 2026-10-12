// =================================================================
// Explorer table helpers — formatting, filters, column order
// =================================================================

type Cell = string | number | boolean | null;

export function applyVisibleColumnOrder(
  allColumns: string[],
  visibleColumns: string[] | null,
  columnOrder: string[] | null,
): string[] {
  const list =
    visibleColumns != null && visibleColumns.length > 0
      ? allColumns.filter((c) => visibleColumns.includes(c))
      : [...allColumns];
  if (columnOrder != null && columnOrder.length > 0) {
    const order = new Map(columnOrder.map((c, i) => [c, i]));
    list.sort((a, b) => (order.get(a) ?? 9999) - (order.get(b) ?? 9999));
  }
  return list;
}

/** Human-readable numeric cell text (small decimals and large integers). */
export function formatExplorerNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v !== 0 && Math.abs(v) < 1) {
    return new Intl.NumberFormat("en", { maximumSignificantDigits: 6 }).format(v);
  }
  return new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(v);
}

/** Whether to skip thousands grouping (years, ids). */
export function explorerNumberUsesGrouping(columnName: string, v: number, isIntegerColumn: boolean): boolean {
  const n = columnName.toLowerCase();
  if (/^(year|yr|fips|geoid|zip|postal|sku|isbn|ssn|uuid|code)$/.test(n)) return false;
  if (n.endsWith("_id") || n === "id") return false;
  if (isIntegerColumn && Number.isInteger(v) && Math.abs(v) >= 1000 && Math.abs(v) <= 9999 && /year/.test(n)) return false;
  return true;
}

export function formatExplorerColumnNumber(columnName: string, v: number, isIntegerColumn: boolean): string {
  if (!explorerNumberUsesGrouping(columnName, v, isIntegerColumn)) {
    if (Number.isInteger(v)) return String(v);
    return formatExplorerNumber(v);
  }
  return formatExplorerNumber(v);
}

export type ExplorerNumericFilter =
  | { kind: "eq"; value: number }
  | { kind: "range"; min: number | null; max: number | null };

/** Parse numeric column filter text; null → substring match fallback. */
export function parseExplorerNumericFilter(filterVal: string): ExplorerNumericFilter | null {
  const f = filterVal.trim();
  if (!f) return null;

  const rangeSep = f.match(/^(-?\d+(?:\.\d+)?)\s*(?:\.\.|–|—|to)\s*(-?\d+(?:\.\d+)?)$/i);
  if (rangeSep) {
    return { kind: "range", min: Number(rangeSep[1]), max: Number(rangeSep[2]) };
  }

  if (/^-?\d+(?:\.\d+)?$/.test(f)) {
    return { kind: "eq", value: Number(f) };
  }

  const hyphen = f.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (hyphen) {
    return { kind: "range", min: Number(hyphen[1]), max: Number(hyphen[2]) };
  }

  return null;
}

export function cellMatchesExplorerNumericFilter(cell: Cell, parsed: ExplorerNumericFilter): boolean {
  const v = typeof cell === "number" ? cell : Number(cell);
  if (Number.isNaN(v)) return false;
  if (parsed.kind === "eq") return v === parsed.value;
  if (parsed.min != null && !Number.isNaN(parsed.min) && v < parsed.min) return false;
  if (parsed.max != null && !Number.isNaN(parsed.max) && v > parsed.max) return false;
  return true;
}

export function numericMinMaxForColumn(
  rows: (string | number | boolean | null)[][],
  columnName: string,
  allColumns: string[],
): { min: number; max: number; values: number[] } | null {
  const rawIdx = allColumns.indexOf(columnName);
  if (rawIdx < 0) return null;
  const values: number[] = [];
  for (const row of rows) {
    const n = Number(row[rawIdx]);
    if (!Number.isNaN(n)) values.push(n);
  }
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values), values };
}

/** Stable row key for selection across live sample refreshes. */
export function explorerRowIdentityKey(columns: string[], row: Cell[], maxFields = 4): string {
  const parts: string[] = [];
  for (let i = 0; i < Math.min(columns.length, maxFields); i++) {
    parts.push(`${columns[i]}=${String(row[i] ?? "")}`);
  }
  return parts.join("\u0001");
}

export function remapSelectedRowIndices(
  prevColumns: string[],
  prevRows: Cell[][],
  selectedIndices: number[],
  nextColumns: string[],
  nextRows: Cell[][],
): number[] {
  if (!selectedIndices.length) return selectedIndices;
  const keys = new Set(
    selectedIndices
      .filter((i) => i >= 0 && i < prevRows.length)
      .map((i) => explorerRowIdentityKey(prevColumns, prevRows[i]!)),
  );
  const out: number[] = [];
  nextRows.forEach((row, i) => {
    if (keys.has(explorerRowIdentityKey(nextColumns, row))) out.push(i);
  });
  return out;
}
