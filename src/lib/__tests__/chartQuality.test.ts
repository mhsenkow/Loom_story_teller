import { describe, expect, it } from "vitest";
import { computeBarModel } from "../canvasCharts/bar";
import { pieSlices } from "../canvasCharts/pieBubble";
import { drawSizeKey, resolveChartInk } from "../chartInk";
import { getChartRenderIssue } from "../chartSupport";
import { groupSum, wordTotalsByGroup } from "../oddChartsRec";
import { drawProjectedAxis, type AxisLabelBox } from "../projectedAxis";
import type { ChartKind, ChartRecommendation } from "../recommendations";
import { drawAuditChart } from "./fixtures/chartAudit";

function canvas() {
  const circles: { x: number; y: number; r: number }[] = [];
  const ctx = new Proxy({ font: "12px sans-serif" } as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === "measureText") return (text: string) => ({ width: String(text).length * 7 });
      if (key === "createLinearGradient") return () => ({ addColorStop() {} });
      if (key === "arc") return (x: number, y: number, r: number) => circles.push({ x, y, r });
      return () => {};
    },
    set(target, key: string, value) { target[key] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, circles };
}

describe("honest aggregation", () => {
  const rows = [["A", "North", null], ["A", "North", ""], ["A", "North", 4], ["B", "North", -5]];
  it.each<ChartKind>(["bar", "pie", "waterfall", "lollipop", "funnel", "treemap", "forceBubble", "sunburst", "pareto"])("%s Count includes rows without a numeric measure", kind => {
    const { ctx } = canvas();
    const o = drawAuditChart(kind, ctx, 640, 420, rows, { yAggregate: "count" });
    const hit = o.hits!.find(h => h.match.some(([i, v]) => i === 0 && v === "A"));
    expect(hit, kind).toBeDefined();
    expect(hit!.summary!.row.map(String)).toContain("3");
  });
  it.each<ChartKind>(["pie", "treemap", "forceBubble", "sunburst"])("%s excludes negative totals from positive area", kind => {
    const o = drawAuditChart(kind, canvas().ctx, 640, 420, rows, { yAggregate: "sum" });
    expect(o.hits!.some(h => h.match.some(([i, v]) => i === 0 && v === "B"))).toBe(false);
  });
  it("distinguishes missing groups from real zero totals", () => {
    const values = [["missing", null], ["zero", 0], ["valid", 4]];
    expect(computeBarModel(values, 0, 1, "sum").entries).toEqual([["valid", 4], ["zero", 0]]);
    expect(groupSum(values, 0, 1, "sum")).toEqual([["valid", 4], ["zero", 0]]);
    expect(pieSlices(values, 0, 1, "count")).toHaveLength(3);
  });
  it("creative charts and word-cloud comparisons count all grouped rows", () => {
    expect(groupSum(rows, 0, 2, "count")).toEqual([["A", 3], ["B", 1]]);
    expect(wordTotalsByGroup(rows, 0, 2, 1, "count").byWord.get("A")!.get("North")).toBe(3);
  });
});

describe("multi-measure chart validation", () => {
  const sample = { columns: ["a", "b", "c"], rows: [[1, 2, 3], [2, 4, 8], [3, 6, 12]] };
  it.each<ChartKind>(["radar", "parallel", "corrMatrix"])("%s works without hidden X and Y fields", kind => {
    const rec = { kind, xField: "", yField: "stale" } as ChartRecommendation;
    expect(getChartRenderIssue(rec, sample as never)).toBeNull();
  });
  it("does not count blanks and booleans as numeric measures", () => {
    const rec = { kind: "parallel", xField: "a" } as ChartRecommendation;
    expect(getChartRenderIssue(rec, { ...sample, rows: [[1, null, false], [2, "", true]] } as never)?.code).toBe("insufficient_numeric");
  });
  it("explains why constant measures cannot be correlated", () => {
    const rec = { kind: "corrMatrix", xField: "a" } as ChartRecommendation;
    expect(getChartRenderIssue(rec, { ...sample, rows: [[1, 2, 3], [2, 2, 3]] } as never)?.code).toBe("insufficient_numeric");
  });
});

describe("compact chart keys", () => {
  it("keeps size circles within their key without changing the size scale", () => {
    const { ctx, circles } = canvas();
    const box = drawSizeKey(ctx, { x: 100, bottom: 180, min: 1, max: 9, radiusOf: v => v * 4, ink: resolveChartInk({}), maxWidth: 90, anchor: "right" })!;
    expect(circles.length).toBeGreaterThan(0);
    expect(circles.length).toBeLessThan(3);
    for (const circle of circles) {
      expect(circle.x - circle.r).toBeGreaterThanOrEqual(box.x);
      expect(circle.x + circle.r).toBeLessThanOrEqual(box.x + box.w);
    }
  });
  it("thins projected ticks using their actual label boxes", () => {
    const occupied: AxisLabelBox[] = [];
    drawProjectedAxis(canvas().ctx, { start: { x: 50, y: 100 }, end: { x: 170, y: 160 }, center: { x: 140, y: 80 },
      ticks: [0, 20, 40, 60, 80, 100], pointOf: v => ({ x: 50 + v * 1.2, y: 100 + v * 0.6 }), format: v => `${v}k`,
      title: "Revenue", width: 240, height: 220, text: "black", muted: "gray", rule: "gray", fontFamily: "Inter", axisFontSize: 16, occupied });
    expect(occupied.length).toBeGreaterThan(2);
    for (let i = 0; i < occupied.length; i++) for (let j = i + 1; j < occupied.length; j++) {
      const a = occupied[i]!, b = occupied[j]!;
      expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false);
    }
  });
});
