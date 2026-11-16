import { describe, expect, it } from "vitest";
import { CHART_KIND_CATALOG } from "../chartKindSearch";
import { gridMove, groupChartKindsByFamily } from "../chartKindGallery";

describe("chart kind gallery", () => {
  it("places every kind in exactly one family", () => {
    const fams = groupChartKindsByFamily(CHART_KIND_CATALOG);
    expect(fams.reduce((n, f) => n + f.entries.length, 0)).toBe(CHART_KIND_CATALOG.length);
    expect(fams.every((f) => f.entries.length > 0)).toBe(true);
  });

  it("moves through a family-by-family grid like the eye does", () => {
    // Family A: 5 tiles (rows of 3 → 3 + 2), family B: 4 tiles.
    const fams = [{ entries: [1, 2, 3, 4, 5] }, { entries: [1, 2, 3, 4] }];
    expect(gridMove(fams, 0, 3, "ArrowDown")).toBe(3);
    // Short last row: drop into the next family at the same column.
    expect(gridMove(fams, 2, 3, "ArrowDown")).toBe(5 + 2);
    expect(gridMove(fams, 4, 3, "ArrowDown")).toBe(5 + 1);
    // Up from the next family's first row lands on the family above's last row.
    expect(gridMove(fams, 5, 3, "ArrowUp")).toBe(3);
    expect(gridMove(fams, 7, 3, "ArrowUp")).toBe(4);
    expect(gridMove(fams, 8, 3, "ArrowRight")).toBe(8);
    expect(gridMove(fams, 0, 3, "ArrowLeft")).toBe(0);
  });
});
