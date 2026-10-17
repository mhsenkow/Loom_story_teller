// Miniatures must preserve the statistic and flow cells shown by the full chart.
import { describe, expect, it } from "vitest";
import { aggregateThumbnailRows } from "../chartThumbnailAggregation";

describe("thumbnail aggregation", () => {
  const rows = [
    ["A", 10, "North"],
    ["A", 30, "South"],
    ["B", 25, "North"],
    ["B", null, "North"],
  ];
  it("keeps means and maxima distinct from sums without changing source rows", () => {
    const before = structuredClone(rows);
    const mean = aggregateThumbnailRows(rows, 0, 1, 2, "mean");
    const max = aggregateThumbnailRows(rows, 0, 1, 2, "max");
    expect(mean.rows.map((r) => r[mean.valueIndex])).toEqual([20, 25]);
    expect(max.rows.map((r) => r[max.valueIndex])).toEqual([30, 25]);
    expect(rows).toEqual(before);
  });
  it("counts records and preserves separate flow destinations", () => {
    const counts = aggregateThumbnailRows(rows, 0, -1, 2, "count");
    expect(counts.rows.map((r) => r[counts.valueIndex])).toEqual([2, 2]);
    const flows = aggregateThumbnailRows(rows, 0, 1, 2, "sum", true);
    expect(flows.rows).toHaveLength(3);
    expect(flows.rows.map((r) => r[flows.valueIndex])).toEqual([10, 30, 25]);
  });
});
