/**
 * Every odd-chart renderer registers hit targets for the marks it actually
 * draws (focus rings + pinning read hit geometry), inside the canvas.
 */
import { describe, it, expect } from "vitest";
import { ODD_CHART_KINDS, renderOddChart } from "../oddCharts";
import type { HitTarget } from "../chartTooltip";

function mockCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const state: Record<string, unknown> = { font: "10px sans-serif" };
  return new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "measureText") return (s: string) => ({ width: String(s).length * 6 });
        if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
        if (prop in state) return state[prop];
        return () => {};
      },
      set(_t, prop: string, value) {
        state[prop] = value;
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
}

const columns = ["region", "group", "value", "other", "third", "longitude", "latitude", "when"];
const regions = ["North", "South", "East", "West", "Central"];
const groups = ["A", "B", "C"];
const rows: unknown[][] = Array.from({ length: 60 }, (_, i) => [
  regions[i % regions.length],
  groups[i % groups.length],
  10 + ((i * 37) % 90),
  5 + ((i * 13) % 40),
  1 + ((i * 7) % 9),
  -74 + ((i % 10) - 5) * 0.02,
  40.7 + ((i % 7) - 3) * 0.02,
  `2024-${String((i % 12) + 1).padStart(2, "0")}-01`,
]);

const enc: Record<string, [number, number, number, number]> = {
  bump: [7, 2, 1, -1],
  stream: [7, 2, 1, -1],
  horizon: [7, 2, -1, -1],
  calendar: [7, 2, -1, -1],
  ecdf: [2, -1, 1, -1],
  sparkGrid: [7, 2, 1, -1],
  density: [2, -1, 1, -1],
  qq: [2, -1, -1, -1],
  connectedScatter: [2, 3, -1, 7],
  stripes: [7, 2, -1, -1],
  spiral: [7, 2, -1, -1],
  voronoi: [2, 3, 1, -1],
  contour: [2, 3, -1, -1],
  isoScatter: [2, 3, 1, 4],
  chord: [0, 2, 1, -1],
  mosaic: [0, 2, 1, -1],
  pyramid: [0, 2, -1, 3],
  slope: [0, 2, -1, 3],
};

const W = 640;
const H = 420;

function bounds(t: HitTarget): { x0: number; y0: number; x1: number; y1: number } {
  if (t.shape === "rect") return { x0: t.x, y0: t.y, x1: t.x + t.w, y1: t.y + t.h };
  if (t.shape === "circle") return { x0: t.cx - t.r, y0: t.cy - t.r, x1: t.cx + t.r, y1: t.cy + t.r };
  // Arc: check the outer-radius endpoints + mid angle.
  const pts = [t.a0, (t.a0 + t.a1) / 2, t.a1].map((a) => [t.cx + Math.cos(a) * t.r1, t.cy + Math.sin(a) * t.r1]);
  return {
    x0: Math.min(...pts.map((p) => p[0]!)),
    y0: Math.min(...pts.map((p) => p[1]!)),
    x1: Math.max(...pts.map((p) => p[0]!)),
    y1: Math.max(...pts.map((p) => p[1]!)),
  };
}

describe("odd chart hit targets", () => {
  for (const kind of ODD_CHART_KINDS) {
    for (const mini of [false, true]) {
      it(`${kind}${mini ? " (mini)" : ""} registers in-bounds hits for drawn marks`, () => {
        const [xi, yi, ci, si] = enc[kind] ?? [0, 2, 1, 3];
        const hits: HitTarget[] = [];
        const w = mini ? 180 : W;
        const h = mini ? 120 : H;
        renderOddChart(kind, mockCtx(), rows, columns, xi, yi, ci, si, w, h, mini ? 6 : 56, { colors: ["#3366cc", "#dc3912", "#ff9900"], hits }, mini);
        expect(hits.length).toBeGreaterThan(0);
        for (const t of hits) {
          const b = bounds(t);
          for (const v of [b.x0, b.y0, b.x1, b.y1]) expect(Number.isFinite(v)).toBe(true);
          // Allow a couple px of slop for halos / extrusion rounding.
          expect(b.x0).toBeGreaterThanOrEqual(-2);
          expect(b.y0).toBeGreaterThanOrEqual(-2);
          expect(b.x1).toBeLessThanOrEqual(w + 2);
          expect(b.y1).toBeLessThanOrEqual(h + 2);
          expect(t.match.length > 0 || t.summary != null || t.rowIndex != null).toBe(true);
          for (const [col] of t.match) expect(col).toBeGreaterThanOrEqual(0);
        }
      });
    }
  }

  it("caps dense kinds at 2000 hits per render", () => {
    const big: unknown[][] = Array.from({ length: 6000 }, (_, i) => ["R" + (i % 4), "G", i % 97, (i * 7) % 53, 1, 0, 0, ""]);
    const hits: HitTarget[] = [];
    renderOddChart("isoScatter", mockCtx(), big, columns, 2, 3, -1, -1, W, H, 56, { colors: ["#3366cc"], hits }, false);
    renderOddChart("beeswarm", mockCtx(), big, columns, 0, 2, -1, -1, W, H, 56, { colors: ["#3366cc"], hits }, false);
    expect(hits.length).toBeLessThanOrEqual(4000);
    expect(hits.length).toBeGreaterThan(0);
  });
});
