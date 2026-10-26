// =================================================================
// channelGroups — chunk a crowded color or shape into fewer groups
// =================================================================
// Numbers become contiguous ranges (100 values → 10 bands). Categories
// keep the most common names and roll the rest into Other. Axes and
// measures keep their raw values; a grouped copy is appended when the
// same column also positions a mark.

import type { ChartKind, ChartRecommendation } from "./recs/types";
import { OTHER_CATEGORY_LABEL } from "./chartCategoryFold";

export const GROUP_INTO_CHOICES = [5, 8, 10, 12, 20] as const;

export const GROUP_MISSING_LABEL = "Missing";

const SYNTH = "\u0000";

export function clampGroupInto(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 2) return null;
  return Math.min(24, rounded);
}

export function isSyntheticGroupColumn(name: string): boolean {
  return name.includes(SYNTH);
}

/** Column name renderers should read for a grouped channel. */
function synthName(field: string): string {
  return `${SYNTH}${field}`;
}

function rawKey(v: unknown): string {
  if (v == null || v === "") return "";
  return String(v);
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || v == null) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function formatBinEdge(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n) && Math.abs(n) < 1e7) return String(n);
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : 3;
  return String(Number(n.toFixed(digits)));
}

/**
 * Map each raw cell to a group label. Null when the column already has
 * `groups` or fewer values — nothing to chunk.
 */
export function groupLabelMap(values: unknown[], groups: number): Map<string, string> | null {
  const cap = clampGroupInto(groups);
  if (!cap) return null;
  const freq = new Map<string, number>();
  const nums: number[] = [];
  let numeric = 0;
  let other = 0;
  for (const v of values) {
    const k = rawKey(v);
    freq.set(k, (freq.get(k) ?? 0) + 1);
    if (!k) continue;
    const n = asNumber(v);
    if (n == null) other += 1;
    else {
      numeric += 1;
      nums.push(n);
    }
  }
  let present = 0;
  for (const k of freq.keys()) if (k !== "") present += 1;
  if (present <= cap) return null;

  const out = new Map<string, string>();
  if (other === 0 && numeric > 0) {
    const byValue = numericBands(nums, cap);
    for (const v of values) {
      const k = rawKey(v);
      if (!k) {
        out.set("", GROUP_MISSING_LABEL);
        continue;
      }
      const n = asNumber(v);
      out.set(k, n == null ? GROUP_MISSING_LABEL : (byValue.get(n) ?? GROUP_MISSING_LABEL));
    }
    return out;
  }

  const ranked = [...freq.entries()]
    .filter(([k]) => k !== "")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const keep = cap - 1;
  ranked.forEach(([k], i) => out.set(k, i < keep ? k : OTHER_CATEGORY_LABEL));
  if (freq.has("")) out.set("", GROUP_MISSING_LABEL);
  return out;
}

function numericBands(nums: number[], groups: number): Map<number, string> {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const n = Math.min(groups, sorted.length);
  const bands = new Map<number, string>();
  const base = Math.floor(sorted.length / n);
  let extra = sorted.length % n;
  let i = 0;
  const used = new Set<string>();
  for (let g = 0; g < n; g++) {
    const size = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    const slice = sorted.slice(i, i + size);
    i += size;
    const lo = slice[0]!;
    const hi = slice[slice.length - 1]!;
    let label = lo === hi ? formatBinEdge(lo) : `${formatBinEdge(lo)}–${formatBinEdge(hi)}`;
    if (used.has(label)) {
      let k = 2;
      while (used.has(`${label} (${k})`)) k += 1;
      label = `${label} (${k})`;
    }
    used.add(label);
    for (const v of slice) bands.set(v, label);
  }
  return bands;
}

export interface GroupedChannels<T = unknown> {
  rows: T[][];
  columns: string[];
  /** Column to read for discrete color. Unchanged for heat ramps. */
  colorField: string | null;
  shapeField: string | null;
}

type GroupChart = Pick<
  ChartRecommendation,
  | "kind"
  | "groupInto"
  | "colorField"
  | "shapeField"
  | "xField"
  | "yField"
  | "y2Field"
  | "sizeField"
  | "zField"
  | "rowField"
  | "timeField"
  | "glowField"
  | "outlineField"
  | "opacityField"
  | "emojiField"
>;

const HEAT: ChartKind[] = ["heatmap", "hexbin"];

/**
 * Copy rows so color and shape show `groupInto` chunks. Position and
 * measure columns are left intact; when color is also an axis, the
 * grouped labels live in an extra column.
 */
export function groupChartChannels<T>(
  rows: T[][],
  columns: string[],
  chart: GroupChart,
): GroupedChannels<T> {
  const same: GroupedChannels<T> = {
    rows,
    columns,
    colorField: chart.colorField ?? null,
    shapeField: chart.shapeField ?? null,
  };
  const cap = clampGroupInto(chart.groupInto);
  if (!cap || rows.length === 0) return same;

  const heat = HEAT.includes(chart.kind);
  const fields: string[] = [];
  if (!heat && chart.colorField && columns.includes(chart.colorField)) fields.push(chart.colorField);
  if (chart.shapeField && columns.includes(chart.shapeField) && !fields.includes(chart.shapeField)) {
    fields.push(chart.shapeField);
  }
  if (fields.length === 0) return same;

  const preserve = new Set(
    [
      chart.xField,
      chart.yField,
      chart.y2Field,
      chart.sizeField,
      chart.zField,
      chart.rowField,
      chart.timeField,
      chart.glowField,
      chart.outlineField,
      chart.opacityField,
      chart.emojiField,
    ].filter((f): f is string => !!f),
  );

  let nextRows: T[][] = rows;
  let nextCols = columns;
  let cloned = false;
  const remap = new Map<string, string>();

  for (const field of fields) {
    const idx = nextCols.indexOf(field);
    if (idx < 0) continue;
    const labels = groupLabelMap(nextRows.map((r) => r[idx]), cap);
    if (!labels) continue;
    if (!cloned) {
      nextRows = nextRows.map((r) => r.slice());
      cloned = true;
    }
    if (preserve.has(field)) {
      const name = synthName(field);
      nextCols = nextCols.slice();
      nextCols.push(name);
      const src = nextCols.indexOf(field);
      for (const row of nextRows) {
        const cell = labels.get(rawKey(row[src])) ?? rawKey(row[src]);
        (row as unknown[]).push(cell);
      }
      remap.set(field, name);
    } else {
      for (const row of nextRows) {
        const k = rawKey(row[idx]);
        (row as unknown[])[idx] = labels.get(k) ?? k;
      }
      remap.set(field, field);
    }
  }

  if (!cloned) return same;
  const colorField = heat
    ? (chart.colorField ?? null)
    : chart.colorField
      ? (remap.get(chart.colorField) ?? chart.colorField)
      : null;
  const shapeField = chart.shapeField ? (remap.get(chart.shapeField) ?? chart.shapeField) : null;
  return { rows: nextRows, columns: nextCols, colorField, shapeField };
}
