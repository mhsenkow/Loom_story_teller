// Pre-aggregate miniature category charts using the opened recipe's statistic.
// The small renderers can sum these cells without silently changing a mean/max.
import type { YAggregateOption } from "./recs/types";

export function aggregateThumbnailRows(
  rows: unknown[][],
  x: number,
  y: number,
  color: number,
  aggregate: YAggregateOption,
  splitColor = false,
): { rows: unknown[][]; valueIndex: number } {
  const valueIndex = rows[0]?.length ?? Math.max(x, y, color) + 1;
  const groups = new Map<
    string,
    { first: unknown[]; count: number; sum: number; min: number; max: number }
  >();
  for (const row of rows) {
    const raw = row[y];
    const value =
      y < 0 || aggregate === "count"
        ? 1
        : raw == null || raw === ""
          ? NaN
          : Number(raw);
    if (!Number.isFinite(value) || row[x] == null) continue;
    const key = JSON.stringify(splitColor ? [row[x], row[color]] : [row[x]]);
    const group = groups.get(key) ?? {
      first: row,
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
    };
    group.count++;
    group.sum += value;
    group.min = Math.min(group.min, value);
    group.max = Math.max(group.max, value);
    groups.set(key, group);
  }
  return {
    valueIndex,
    rows: [...groups.values()].map((g) => {
      const row = [...g.first];
      row[valueIndex] =
        aggregate === "mean"
          ? g.sum / g.count
          : aggregate === "min"
            ? g.min
            : aggregate === "max"
              ? g.max
              : aggregate === "count"
                ? g.count
                : g.sum;
      return row;
    }),
  };
}
