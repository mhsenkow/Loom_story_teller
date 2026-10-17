import { describe, expect, it } from "vitest";
import {
  discoverFlowColumnCount,
  discoverFlowSpans,
  discoverFlowTiers,
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
      expect(spans.some((span) => span >= 2)).toBe(true);
      expect(spans.every((span) => span === 1 || span === 2 || span === 3)).toBe(true);
      const packed = rows(spans, columns);
      for (const row of packed.slice(0, -1)) {
        expect(row.reduce((sum, span) => sum + span, 0)).toBe(columns);
      }
      const wideIndexes = spans.flatMap((span, index) => (span >= 2 ? [index] : []));
      expect(wideIndexes.length).toBeGreaterThan(1);
      expect(spans[0]).toBeGreaterThanOrEqual(2);
    }
  });

  it("puts a lead span of 3 on wide desktops when featured", () => {
    const featured = Array.from({ length: 12 }, (_, i) => i === 0);
    const six = discoverFlowSpans(12, 6, featured);
    expect(six[0]).toBe(3);
    for (const row of rows(six, 6).slice(0, -1)) {
      expect(row.reduce((sum, span) => sum + span, 0)).toBe(6);
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
    expect(spans[0]).toBeGreaterThanOrEqual(2);
    expect(spans.filter((span) => span >= 2).length).toBeGreaterThan(0);
    for (const row of rows(spans, 6).slice(0, -1)) {
      expect(row.reduce((sum, span) => sum + span, 0)).toBe(6);
    }
  });
});

describe("discoverFlowTiers", () => {
  it("assigns lead, wide, standard, and brief roles", () => {
    const featured = Array.from({ length: 16 }, (_, i) => i % 7 === 0);
    const tiers = discoverFlowTiers(16, 6, featured);
    expect(tiers).toContain("lead");
    expect(tiers.some((t) => t === "wide" || t === "lead")).toBe(true);
    expect(tiers).toContain("standard");
    expect(new Set(tiers).size).toBeGreaterThan(1);
  });

  it("uses brief cards on a single column for rhythm", () => {
    const tiers = discoverFlowTiers(8, 1, Array(8).fill(false));
    expect(tiers.every((t) => t === "standard" || t === "brief")).toBe(true);
    expect(tiers).toContain("brief");
  });
});

describe("discoverFlowColumnCount", () => {
  it("counts tracks and collapses the phone layout", () => {
    expect(discoverFlowColumnCount("200px 200px 200px 200px", false)).toBe(4);
    expect(discoverFlowColumnCount("200px 200px", true)).toBe(1);
    expect(discoverFlowColumnCount("none", false)).toBe(1);
  });
});
