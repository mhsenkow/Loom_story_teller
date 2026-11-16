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

  it("keeps inner-ring children inside their parent wedge under mean", () => {
    // A's mean is 20, but its children's means (10 + 30) add up to 40.
    const rows = [
      ["A", 10, "x"],
      ["A", 30, "y"],
      ["B", 5, "x"],
      ["B", 15, "y"],
    ];
    const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), font: "10px sans-serif" } as Record<string, unknown>, {
      get: (t, p: string) => (p in t ? t[p] : () => {}),
      set: (t, p: string, v) => ((t[p] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    const opts: ChartRenderOpts = {
      colors: ["#6c5ce7", "#00d68f"],
      opacity: 1,
      pointSize: 8,
      yAggregate: "mean",
      fieldNames: ["cat", "val", "kind"],
      hits: [],
    };
    renderFullSunburst(ctx, rows, 0, 1, 2, 400, 400, 48, opts);
    const arcs = opts.hits!.filter((h) => h.shape === "arc");
    for (const parent of arcs.filter((h) => h.match.length === 1)) {
      if (parent.shape !== "arc") continue;
      const kids = arcs.filter((h) => h.match.length === 2 && h.match[0]![1] === parent.match[0]![1]);
      expect(kids.length).toBe(2);
      for (const k of kids) {
        if (k.shape !== "arc") continue;
        expect(k.a0).toBeGreaterThanOrEqual(parent.a0 - 1e-9);
        expect(k.a1).toBeLessThanOrEqual(parent.a1 + 1e-9);
      }
    }
  });
});
