/**
 * Smoke tests for the canvas renderers that draw their own chrome:
 * odd charts, geo maps, GPU-scene fallbacks. A recording 2D context
 * checks that every kind paints something (marks or an empty-state
 * message), never throws, and keeps text at a legible size.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ODD_CHART_KINDS, renderOddChart } from "../oddCharts";
import { GEO_MAP_KINDS, renderGeoMapCanvas } from "../geoMaps";
import { GPU_SCENE_KINDS, extractGpuScenePoints, renderGpuSceneCanvas } from "../gpuScenes";
import { sequentialStops, resolveChartInk, relativeLuminance } from "../chartInk";

type Rec = { fills: number; strokes: number; texts: string[]; fonts: Set<string> };

function mockCtx(): { ctx: CanvasRenderingContext2D; rec: Rec } {
  const rec: Rec = { fills: 0, strokes: 0, texts: [], fonts: new Set() };
  const gradient = { addColorStop: () => {} };
  const state: Record<string, unknown> = { font: "10px sans-serif" };
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      if (prop === "measureText") return (s: string) => ({ width: String(s).length * 6 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
      if (prop === "fillText") return (s: string) => {
        rec.texts.push(String(s));
        rec.fonts.add(String(state.font));
      };
      if (prop === "fill" || prop === "fillRect") return () => void rec.fills++;
      if (prop === "stroke" || prop === "strokeRect") return () => void rec.strokes++;
      if (prop in state) return state[prop];
      return () => {};
    },
    set(_t, prop: string, value) {
      state[prop] = value;
      return true;
    },
  };
  return { ctx: new Proxy({}, handler) as CanvasRenderingContext2D, rec };
}

beforeAll(() => {
  const g = globalThis as unknown as { Path2D?: unknown };
  if (!g.Path2D) g.Path2D = class {};
});

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

function minFontPx(fonts: Set<string>): number {
  let min = Infinity;
  for (const f of fonts) {
    const m = f.match(/(\d+(?:\.\d+)?)px/);
    if (m) min = Math.min(min, Number(m[1]));
  }
  return min;
}

const theme = { themeBg: "#f0efeb", themeText: "#141414", themeMuted: "#5a5a5a", themeBorder: "#c4c4be" };

describe("odd chart renderers", () => {
  const enc: Record<string, [number, number, number, number]> = {
    bump: [7, 2, 1, -1],
    stream: [7, 2, 1, -1],
    horizon: [7, 2, -1, -1],
    spiral: [7, 2, -1, -1],
    voronoi: [2, 3, 1, -1],
    contour: [2, 3, -1, -1],
    isoScatter: [2, 3, 1, 4],
    chord: [0, 2, 1, -1],
    mosaic: [0, 2, 1, -1],
    pyramid: [0, 2, -1, 3],
    slope: [0, 2, -1, 3],
  };
  for (const kind of ODD_CHART_KINDS) {
    it(`${kind} paints marks + legible text`, () => {
      const [xi, yi, ci, si] = enc[kind] ?? [0, 2, 1, 3];
      const { ctx, rec } = mockCtx();
      renderOddChart(kind, ctx, rows, columns, xi, yi, ci, si, 640, 420, 56, { colors: ["#3366cc", "#dc3912", "#ff9900"], ...theme }, false);
      expect(rec.fills + rec.strokes).toBeGreaterThan(3);
      expect(minFontPx(rec.fonts)).toBeGreaterThanOrEqual(9);
      const { ctx: mctx, rec: mrec } = mockCtx();
      renderOddChart(kind, mctx, rows, columns, xi, yi, ci, si, 180, 120, 6, { colors: ["#3366cc"] }, true);
      expect(mrec.fills + mrec.strokes).toBeGreaterThan(0);
    });
    it(`${kind} shows a message for empty data`, () => {
      const { ctx, rec } = mockCtx();
      renderOddChart(kind, ctx, [], columns, 0, 2, 1, 3, 640, 420, 56, { colors: ["#3366cc"], ...theme }, false);
      expect(rec.texts.length).toBeGreaterThan(0);
    });
  }
});

describe("geo map renderers", () => {
  for (const kind of [...GEO_MAP_KINDS, "choropleth" as const]) {
    it(`${kind} draws basemap + marks (regional data)`, () => {
      const { ctx, rec } = mockCtx();
      renderGeoMapCanvas(kind, ctx, rows, columns, {
        xField: kind === "choropleth" ? "region" : "longitude",
        yField: kind === "choropleth" ? "value" : "latitude",
        colorField: "group",
        sizeField: "value",
      }, 640, 420, 56, { colors: ["#3366cc", "#dc3912"], opacity: 0.85, ...theme });
      expect(rec.fills).toBeGreaterThan(5);
      expect(minFontPx(rec.fonts)).toBeGreaterThanOrEqual(9);
    });
  }
});

describe("gpu scene canvas fallbacks", () => {
  for (const kind of GPU_SCENE_KINDS.filter((k) => k !== "dataCube")) {
    it(`${kind} paints and labels`, () => {
      const packed = extractGpuScenePoints(rows, columns, { xField: "value", yField: "other", zField: "third", colorField: "group", sizeField: "third" });
      expect(packed).not.toBeNull();
      const { ctx, rec } = mockCtx();
      renderGpuSceneCanvas(kind, ctx, packed!, 640, 420, 56, { colors: ["#3366cc", "#dc3912"], opacity: 0.85, ...theme });
      expect(rec.fills + rec.strokes).toBeGreaterThan(5);
      expect(minFontPx(rec.fonts)).toBeGreaterThanOrEqual(9);
    });
  }
});

describe("sequential ramps", () => {
  it("run from background-like to high contrast in both themes", () => {
    const blues = ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"];
    for (const bg of ["#0a0a0c", "#f0efeb"]) {
      const ink = resolveChartInk({ themeBg: bg, themeText: bg === "#0a0a0c" ? "#ececf1" : "#141414" });
      const stops = sequentialStops(ink, blues);
      const bgL = relativeLuminance(bg);
      expect(Math.abs(relativeLuminance(stops[0]!) - bgL)).toBeLessThan(Math.abs(relativeLuminance(stops[stops.length - 1]!) - bgL));
    }
  });
  it("ignores categorical palettes passed as continuous stops", () => {
    const ink = resolveChartInk({ themeBg: "#0a0a0c", themeText: "#ececf1" });
    const cat = ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00"];
    expect(sequentialStops(ink, cat)).not.toEqual(cat);
  });
});
