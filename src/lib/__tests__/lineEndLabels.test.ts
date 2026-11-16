import { describe, expect, it } from "vitest";
import { layoutLineEndLabels } from "../lineEndLabels";

describe("line endpoint label layout", () => {
  it("separates coincident endpoints and preserves identity and vertical order", () => {
    const positions = layoutLineEndLabels([95, 5, 95, 50], 0, 160, 28)!;
    expect(positions[1]).toBeLessThan(positions[3]);
    expect(positions[3]).toBeLessThan(positions[0]);
    expect(positions[0]).toBeLessThan(positions[2]);
    const sorted = [...positions].sort((a, b) => a - b);
    expect(sorted[0]).toBeGreaterThanOrEqual(14);
    expect(sorted.at(-1)).toBeLessThanOrEqual(146);
    sorted.slice(1).forEach((y, i) => expect(y - sorted[i]).toBeGreaterThanOrEqual(36));
  });
  it("keeps uncluttered labels at their endpoints", () => {
    expect(layoutLineEndLabels([30, 100, 180], 0, 200, 24)).toEqual([30, 100, 180]);
  });
  it("falls back instead of shrinking type or dropping series", () => {
    expect(layoutLineEndLabels([10, 10, 10], 0, 60, 24)).toBeNull();
    expect(layoutLineEndLabels([NaN], 0, 100, 24)).toBeNull();
    expect(layoutLineEndLabels([10], 0, 100, -1)).toBeNull();
  });
});
