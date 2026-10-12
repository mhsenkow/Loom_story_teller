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
});
