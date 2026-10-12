import { describe, it, expect } from "vitest";
import { aggregateValues } from "../canvasCharts/plumbing";
import { renderFullSunburst } from "../canvasCharts/sunburst";
import type { ChartRenderOpts } from "../chartRenderTypes";

describe("canvasCharts sunburst (LOOM-118)", () => {
  it("mean aggregate averages values instead of summing", () => {
    expect(aggregateValues([10, 20], "mean")).toBe(15);
    expect(aggregateValues([10, 20], "sum")).toBe(30);
  });

  it("renders a non-empty sunburst for mean-aggregated slices", () => {
    const rows = [
      ["A", 10],
      ["A", 20],
    ];
    const rec = { fills: 0, texts: [] as string[] };
    const ctx = {
      measureText: (s: string) => ({ width: s.length * 6 }),
      font: "10px sans-serif",
      fillText: (s: string) => {
        rec.texts.push(String(s));
      },
      fill() {
        rec.fills++;
      },
      stroke() {},
      beginPath() {},
      arc() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      arcTo() {},
      save() {},
      restore() {},
    } as unknown as CanvasRenderingContext2D;
    const opts: ChartRenderOpts = {
      colors: ["#6c5ce7"],
      opacity: 1,
      pointSize: 8,
      yAggregate: "mean",
      fieldNames: ["cat", "val"],
    };
    renderFullSunburst(ctx, rows, 0, 1, -1, 400, 400, 48, opts);
    expect(rec.fills).toBeGreaterThan(0);
    expect(rec.texts.some((t) => t === "15" || t.includes("15"))).toBe(true);
  });
});
