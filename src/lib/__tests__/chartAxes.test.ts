import { describe, expect, it } from "vitest";
import {
  aggregateAxisTitle,
  buildXModel,
  classifyKeys,
  formatAxisValue,
  formatDataValue,
  histogramBins,
  niceTicks,
  niceZeroScale,
  timeTicks,
} from "../chartAxes";
import { pickHitTarget, rowForHitTarget, type HitTarget } from "../chartTooltip";

describe("niceTicks", () => {
  it("lands on round numbers and extends the domain outward", () => {
    const s = niceTicks(3.7, 96.2, 5);
    expect(s.step).toBe(20);
    expect(s.ticks).toEqual([0, 20, 40, 60, 80, 100]);
    expect(s.min).toBe(0);
    expect(s.max).toBe(100);
  });

  it("keeps ticks inside the data when not extending", () => {
    const s = niceTicks(3.7, 96.2, 5, false);
    expect(s.ticks).toEqual([20, 40, 60, 80]);
    expect(s.min).toBe(3.7);
  });

  it("has no float fuzz on decimal steps", () => {
    const s = niceTicks(0, 0.7, 7);
    expect(s.ticks).toContain(0.3);
    expect(s.ticks.every((t) => String(t).length <= 4)).toBe(true);
  });

  it("handles a flat domain", () => {
    const s = niceTicks(5, 5);
    expect(s.min).toBeLessThan(5);
    expect(s.max).toBeGreaterThan(5);
  });

  it("zero-based scale includes zero for negative data", () => {
    const s = niceZeroScale(-12, -3);
    expect(s.max).toBe(0);
    expect(s.min).toBeLessThanOrEqual(-12);
  });
});

describe("formatting", () => {
  it("matches precision to the step", () => {
    expect(formatAxisValue(2500, 500)).toBe("2.5k");
    expect(formatAxisValue(3000, 1000)).toBe("3k");
    expect(formatAxisValue(0.25, 0.05)).toBe("0.25");
    expect(formatAxisValue(2020, 1)).toBe("2020");
    expect(formatAxisValue(1_500_000, 500_000)).toBe("1.5M");
  });

  it("formats data labels compactly", () => {
    expect(formatDataValue(12345)).toBe("12.3k");
    expect(formatDataValue(152)).toBe("152");
    expect(formatDataValue(3.14159)).toBe("3.1");
    expect(formatDataValue(0.0123)).toBe("0.012");
  });

  it("titles aggregated axes", () => {
    expect(aggregateAxisTitle("count", "revenue")).toBe("Count");
    expect(aggregateAxisTitle("sum", "revenue")).toBe("Sum of revenue");
    expect(aggregateAxisTitle("mean", "price")).toBe("Average price");
    expect(aggregateAxisTitle("sum", null)).toBe("Count");
  });
});

describe("x models", () => {
  it("sorts numeric keys numerically, not lexically", () => {
    expect(classifyKeys(["10", "9", "100"]).sorted).toEqual(["9", "10", "100"]);
  });

  it("detects ISO dates and positions them by time", () => {
    const m = buildXModel(["2024-03-01", "2024-01-01", "2024-02-01"]);
    expect(m.kind).toBe("time");
    expect(m.keys[0]).toBe("2024-01-01");
    expect(m.pos[0]).toBe(0);
    expect(m.pos[2]).toBe(1);
  });

  it("centers plain categories in bands", () => {
    const m = buildXModel(["b", "a"]);
    expect(m.kind).toBe("band");
    expect(m.keys).toEqual(["a", "b"]);
    expect(m.pos).toEqual([0.25, 0.75]);
  });

  it("does not treat free text with digits as dates", () => {
    expect(classifyKeys(["Widget 2", "Widget 10"]).kind).toBe("band");
  });
});

describe("timeTicks", () => {
  it("uses month ticks for a one-year span", () => {
    const t = timeTicks(Date.UTC(2023, 0, 1), Date.UTC(2023, 11, 31), 6);
    expect(t.ticks.length).toBeGreaterThanOrEqual(4);
    expect(t.format(t.ticks[0]!)).toBe("Jan 2023");
    expect(t.format(Date.UTC(2023, 3, 1))).toBe("Apr");
  });

  it("uses year ticks for a decade", () => {
    const t = timeTicks(Date.UTC(2010, 0, 1), Date.UTC(2020, 0, 1), 6);
    expect(t.ticks.map(t.format)).toContain("2014");
  });
});

describe("histogramBins", () => {
  it("bins on round edges and counts every value", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 0.5);
    const b = histogramBins(values)!;
    expect(b.lo).toBe(0);
    expect(b.counts.reduce((s, c) => s + c, 0)).toBe(100);
    expect(Number.isInteger(b.step)).toBe(true);
  });

  it("keeps the max value in the last bin", () => {
    const b = histogramBins([0, 5, 10])!;
    expect(b.counts.reduce((s, c) => s + c, 0)).toBe(3);
  });

  it("returns null when nothing is numeric", () => {
    expect(histogramBins([NaN, NaN])).toBeNull();
  });
});

describe("hit targets", () => {
  const rows = [
    ["a", 1],
    ["b", 2],
    ["b", 3],
  ];
  const targets: HitTarget[] = [
    { shape: "rect", x: 0, y: 0, w: 10, h: 10, match: [[0, "a"]] },
    { shape: "rect", x: 10, y: 0, w: 10, h: 10, match: [[0, "b"]], summary: { columns: ["k", "n"], row: ["b", 2] } },
    { shape: "arc", cx: 100, cy: 100, r0: 10, r1: 20, a0: -Math.PI / 2, a1: 0, match: [], rowIndex: 2 },
  ];

  it("picks the rect under the pointer and resolves its row", () => {
    const t = pickHitTarget(targets, 15, 5)!;
    expect(t.summary?.row[0]).toBe("b");
    expect(rowForHitTarget(t, rows)).toBe(1);
  });

  it("respects the allowed set", () => {
    const t = pickHitTarget(targets, 15, 5)!;
    expect(rowForHitTarget(t, rows, new Set([2]))).toBe(2);
  });

  it("hits arcs by angle and radius", () => {
    // Up-right quadrant of the arc (between -90° and 0°)
    const t = pickHitTarget(targets, 110, 90);
    expect(t?.shape).toBe("arc");
    expect(rowForHitTarget(t!, rows)).toBe(2);
    expect(pickHitTarget(targets, 90, 110)).toBeNull();
  });

  it("misses empty space", () => {
    expect(pickHitTarget(targets, 50, 50)).toBeNull();
  });
});
