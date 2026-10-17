import { describe, expect, it } from "vitest";
import {
  discoverFlowColumnCount,
  discoverFlowSpans,
} from "../discoverFlowLayout";

function rows(spans: number[], columns: number): number[][] {
  const packed: number[][] = [];
  let row: number[] = [];
  let used = 0;
  for (const span of spans) {
    row.push(span);
    used += span;
    if (used === columns) {
      packed.push(row);
      row = [];
      used = 0;
    }
  }
  if (row.length) packed.push(row);
  return packed;
}

describe("discoverFlowSpans", () => {
  it("stays single-column when the grid cannot hold a wide card", () => {
    expect(discoverFlowSpans(6, 1, [true, false, false, false, false, false])).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
  });

  it("opens a wide desktop row with large cards and still fills every row", () => {
    const featured = Array.from({ length: 18 }, (_, i) => i % 8 === 0);
    for (const columns of [4, 5, 6, 8, 12]) {
      const spans = discoverFlowSpans(18, columns, featured);
      expect(spans.some((span) => span === 2)).toBe(true);
      expect(spans.every((span) => span === 1 || span === 2)).toBe(true);
      const packed = rows(spans, columns);
      for (const row of packed.slice(0, -1)) {
        expect(row.reduce((sum, span) => sum + span, 0)).toBe(columns);
      }
      const wideIndexes = spans.flatMap((span, index) => (span === 2 ? [index] : []));
      expect(wideIndexes.length).toBeGreaterThan(2);
      expect(spans[0]).toBe(2);
    }
  });

  it("puts more than one large card in the first row of a wide desktop", () => {
    const plain = Array.from({ length: 16 }, () => false);
    const six = discoverFlowSpans(16, 6, plain);
    expect(six.slice(0, 4)).toEqual([2, 1, 2, 1]);
    const five = discoverFlowSpans(16, 5, plain);
    expect(five.slice(0, 3)).toEqual([2, 1, 2]);
    const twelve = discoverFlowSpans(16, 12, plain);
    expect(twelve.slice(0, 12).filter((span) => span === 2).length).toBe(3);
    for (const [spans, columns] of [
      [six, 6],
      [five, 5],
      [twelve, 12],
    ] as const) {
      for (const row of rows(spans, columns).slice(0, -1)) {
        expect(row.reduce((sum, span) => sum + span, 0)).toBe(columns);
      }
    }
  });

  it("keeps a spotlight wide when the row has room", () => {
    const spans = discoverFlowSpans(8, 6, [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(spans[0]).toBe(2);
    expect(spans.filter((span) => span === 2).length).toBeGreaterThan(1);
    for (const row of rows(spans, 6).slice(0, -1)) {
      expect(row.reduce((sum, span) => sum + span, 0)).toBe(6);
    }
  });
});

describe("discoverFlowColumnCount", () => {
  it("counts tracks and collapses the phone layout", () => {
    expect(discoverFlowColumnCount("200px 200px 200px 200px", false)).toBe(4);
    expect(discoverFlowColumnCount("200px 200px", true)).toBe(1);
    expect(discoverFlowColumnCount("none", false)).toBe(1);
  });
});
