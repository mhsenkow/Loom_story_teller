import { describe, expect, it } from "vitest";
import { dataTableRowsFromHits } from "../chartDataTableFromHits";
import type { HitTarget } from "../chartTooltip";

describe("chartDataTableFromHits", () => {
  it("dedupes summary rows", () => {
    const t: HitTarget = {
      shape: "rect",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      match: [[0, "x"]],
      summary: { columns: ["a"], row: ["1"] },
    };
    const rows = dataTableRowsFromHits([t, t]);
    expect(rows).toHaveLength(1);
  });
  it("omits endpoint keys and preserves distinct schemas and cell types", () => {
    const base: HitTarget = { shape: "circle", cx: 1, cy: 1, r: 3, match: [], summary: { columns: ["day", "value"], row: ["Monday", 2] } };
    const auxiliary = { ...base, auxiliary: true, summary: { columns: ["series", "day", "value"], row: ["A", "Monday", 2] } };
    expect(dataTableRowsFromHits([base, auxiliary])).toHaveLength(1);
    expect(dataTableRowsFromHits([base, { ...base, summary: { columns: ["day", "other value"], row: ["Monday", 2] } }])).toHaveLength(2);
  });
});
