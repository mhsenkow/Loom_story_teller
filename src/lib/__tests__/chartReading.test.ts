import { describe, expect, it } from "vitest";
import { buildChartReading } from "../chartReading";
import type { ChartRecommendation } from "../recommendations";
import type { HitTarget } from "../chartTooltip";
const chart = (kind: ChartRecommendation["kind"], extra = {}) => ({ id: "test", kind, title: "Sales", xField: "day", yField: "sales", spec: {}, ...extra }) as ChartRecommendation;
const hit = (label: string, value: number, order?: number, series?: string): HitTarget => ({
  shape: "circle", cx: 0, cy: 0, r: 5, match: [[0, label]],
  reading: { label, value, order, series, measure: "Average sales" },
  summary: { columns: ["day", "Average sales"], row: [label, String(value)] },
});

describe("chart readings", () => {
  it("preserves significant whole-number digits in large totals", () => {
    expect(buildChartReading(chart("bar"), [hit("Tokyo", 4039437)])!.facts[0].value).toBe((4039437).toLocaleString());
  });
  it("ranks exact numbers, not rounded or localized tooltip strings", () => {
    const points = [hit("East", 100.1), hit("West", 100.2)];
    points.forEach(p => { p.summary!.row[1] = "100"; });
    const reading = buildChartReading(chart("bar"), points)!;
    expect(reading.headline).toContain("West is highest");
    expect(reading.facts[0].hit).toBe(points[1]);
    expect(reading.context).toContain("Average sales");
  });
  it("reports ties without inventing a winner", () => {
    expect(buildChartReading(chart("bar"), [hit("A", 8), hit("B", 8), hit("C", 1)])!.headline).toContain("2 categories share");
    expect(buildChartReading(chart("bar"), [hit("A", 0), hit("B", 0)])!.headline).toContain("same value");
  });
  it("sorts line observations by their plotted X order", () => {
    const reading = buildChartReading(chart("line"), [hit("Mar", 180, 2), hit("Jan", 120, 0), hit("Feb", 200, 1)])!;
    expect(reading.headline).toContain("120 to 180 (50% higher)");
    expect(reading.facts.map(f => f.label)).toEqual(["Jan", "Mar", "Feb"]);
    expect(reading.guide).toContain("does not describe every change");
  });
  it("does not invent a percent change from zero or a negative baseline", () => {
    for (const start of [0, -12]) {
      const reading = buildChartReading(chart("line"), [hit("A", start, 0), hit("B", 6, 1)])!;
      expect(reading.headline).not.toContain("%");
      expect(reading.headline).toContain("rose");
    }
    expect(buildChartReading(chart("line", { seriesNormalize: "zscore" }), [hit("A", 1, 0), hit("B", 2, 1)])!.headline).not.toContain("%");
  });
  it("handles flat endpoints without claiming a flat series", () => {
    const reading = buildChartReading(chart("line"), [hit("A", 4, 0), hit("B", 9, 1), hit("C", 4, 2)])!;
    expect(reading.headline).toContain("starts and ends at 4");
    expect(reading.facts[2].value).toBe("9");
  });
  it("qualifies series ending at different X values", () => {
    const reading = buildChartReading(chart("line"), [hit("Jan", 200, 0, "East"), hit("Mar", 50, 2, "West")])!;
    expect(reading.headline).toContain("different ending");
    expect(reading.headline).not.toContain("highest");
  });
  it("compares aligned series endpoints and includes their date", () => {
    const reading = buildChartReading(chart("line"), [hit("Mar", 200, 2, "East"), hit("Mar", 50, 2, "West")])!;
    expect(reading.headline).toBe("East finishes highest at 200 (Mar).");
  });
  it("uses the displayed pie total and names combined Other slices honestly", () => {
    expect(buildChartReading(chart("pie"), [hit("A", 30), hit("Other (4)", 70)])!.headline).toBe("Other (4) is the largest slice: 70% of the displayed total.");
  });
  it("explains a histogram as counts", () => {
    const reading = buildChartReading(chart("histogram"), [hit("0 – 10", 5), hit("10 – 20", 20)])!;
    expect(reading.headline).toContain("20 observations");
    expect(reading.guide).toContain("not larger individual values");
  });
  it("ignores duplicate keys and non-finite observations", () => {
    const auxiliary = { ...hit("duplicate", 999), auxiliary: true };
    const reading = buildChartReading(chart("bar"), [hit("A", 2), hit("missing", NaN), auxiliary])!;
    expect(reading.headline).toBe("A is highest at 2.");
  });
  it("does not explain unsupported or ambiguous recipes", () => {
    for (const rec of [chart("scatter"), chart("line", { rowField: "city" }), chart("line", { y2Field: "profit" }), chart("line", { comparePrevious: true })]) {
      expect(buildChartReading(rec, [hit("A", 3, 0)])).toBeNull();
    }
    expect(buildChartReading(chart("bar"), [])).toBeNull();
    expect(buildChartReading(chart("line"), [hit("A", 3)])).toBeNull();
  });
});
