/**
 * LOOM-141 / LOOM-142 — every extracted Canvas renderer draws against a
 * recording fake 2D context (module wiring + no throw + hit targets / paint).
 */
import { describe, expect, it } from "vitest";
import type { ChartRenderOpts } from "../chartRenderTypes";
import { buildBarFacetGrid, pickHitTarget, rowForHitTarget, type HitTarget } from "../chartTooltip";
import { renderFullBar, renderFullHistogram } from "../canvasCharts/bar";
import { renderFullScatter } from "../canvasCharts/scatter";
import { renderFullLine, renderFullHeatmap } from "../canvasCharts/lineHeatmap";
import { renderFullStrip, renderFullBox, renderFullArea } from "../canvasCharts/distributions";
import { renderFullPie, renderFullBubble } from "../canvasCharts/pieBubble";
import { renderFullViolin, renderFullRadar, renderFullWaterfall, renderFullLollipop } from "../canvasCharts/violinRadar";
import {
  renderFullTreemap,
  renderFullForceBubble,
  renderFullSankey,
  renderFullNetwork,
  renderFullArcDiagram,
} from "../canvasCharts/flowCharts";
import {
  renderFullPareto,
  renderFullCorrMatrix,
  renderFullDumbbell,
  renderFullRidgeline,
  renderFullHexbin,
  renderFullFunnel,
  renderFullParallel,
} from "../canvasCharts/statCharts";
import { renderFullSunburst } from "../canvasCharts/sunburst";

function fakeCtx() {
  const calls = { paint: 0, strokes: [] as { cap: unknown; join: unknown }[], labels: [] as { text: string; font: string }[], points: [] as { x: number; y: number }[] };
  const paintOps = new Set(["fill", "stroke", "fillRect", "strokeRect", "fillText", "strokeText", "drawImage"]);
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: String(s).length * 6 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getLineDash: () => [],
    font: "10px sans-serif",
  };
  const ctx = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      if (prop === "fillText" || prop === "strokeText") return (text: string) => {
        calls.paint += 1;
        calls.labels.push({ text, font: String(t.font) });
      };
      if (prop === "lineTo") return (x: number, y: number) => void calls.points.push({ x, y });
      if (prop === "stroke") return () => { calls.paint += 1; calls.strokes.push({ cap: t.lineCap, join: t.lineJoin }); };
      if (paintOps.has(prop)) return () => void (calls.paint += 1);
      return () => {};
    },
    set(t, prop: string, v) {
      t[prop] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const cats = ["East", "West", "North", "South", "Central"];
const rows: unknown[][] = Array.from({ length: 60 }, (_, i) => [
  cats[i % cats.length],
  (i * 7) % 41 + 1,
  ((i * 13) % 37) + 2,
  cats[(i + 2) % cats.length],
  `2024-0${(i % 9) + 1}-1${i % 9}`,
  (i * 5) % 29,
  (i * 3) % 23 + 1,
]);
const W = 640;
const H = 400;
const PAD = 48;

function opts(): ChartRenderOpts {
  return {
    colors: ["#6c5ce7", "#00d68f", "#ff6b6b", "#ffd93d", "#00b4d8", "#e77c5c", "#a29bfe", "#74b9ff"],
    opacity: 0.8,
    pointSize: 5,
    hits: [] as HitTarget[],
    fieldNames: ["region", "sales", "units", "other", "day"],
    themeBg: "#101014",
    themeText: "#ececf1",
    themeMuted: "#9a9aa6",
    themeBorder: "#2a2a30",
  };
}

describe("chart refinement regressions", () => {
  it.each(["heatmap", "hexbin"] as const)("%s aggregates signed measures instead of counting observations", kind => {
    const { ctx } = fakeCtx();
    const o: ChartRenderOpts = { ...opts(), fieldNames: ["x", "y", "value"], colorField: "value", yAggregate: "mean" };
    const data = kind === "heatmap" ? [["a", "r", -10], ["a", "r", 10], ["b", "r", null]] : [[1, 2, -10], [1, 2, 10], [5, 6, null]];
    (kind === "heatmap" ? renderFullHeatmap : renderFullHexbin)(ctx, data, 0, 1, W, H, PAD, o);
    expect(o.hits).toHaveLength(1);
    expect(o.hits![0]!.summary!.row).toContain("0");
    expect(o.hits![0]!.summary!.columns.join(" ")).toMatch(/average/i);
  });

  it.each(["grouped", "stacked", "percent"] as const)("%s bars retain signed segments in reversed horizontal layouts", mode => {
    const { ctx } = fakeCtx();
    const data = [["a", 10, "gain"], ["a", -5, "loss"], ["b", 20, "gain"], ["b", -10, "loss"]];
    const o: ChartRenderOpts = { ...opts(), fieldNames: ["category", "value", "series"], plotBounds: { left: 100, top: 40, right: 600, bottom: 340 } };
    const facet = buildBarFacetGrid(data, 0, 1, 2, "sum", mode);
    renderFullBar(ctx, data, 0, 1, 2, W, H, PAD, o, facet, true, undefined, false, true);
    expect(o.hits).toHaveLength(4);
    for (const hit of o.hits!) {
      expect(hit.shape).toBe("rect");
      if (hit.shape !== "rect") continue;
      expect(hit.x).toBeGreaterThanOrEqual(100);
      expect(hit.x + hit.w).toBeLessThanOrEqual(600.001);
      const positive = Number(hit.summary!.row[2]) > 0;
      const zero = o.scales!.x!(0);
      if (positive) expect(hit.x + hit.w).toBeCloseTo(zero);
      else expect(hit.x).toBeCloseTo(zero);
    }
  });

  it("keeps zero at the end of all-negative horizontal bars", () => {
    const { ctx } = fakeCtx();
    const o: ChartRenderOpts = { ...opts(), fieldNames: ["country", "change"] };
    renderFullBar(ctx, [["a", -0.05], ["b", -0.02], ["c", -0.01]], 0, 1, -1, W, H, PAD, o, null, true);
    const right = o.scales!.rect!.right;
    expect(Math.abs(o.scales!.x!(0) - right)).toBeLessThanOrEqual(2);
    expect(o.scales!.x!(-0.05)).toBeLessThan(right - 100);
  });

  it("keeps negative value labels clear of the category names", () => {
    const { ctx } = fakeCtx();
    const texts: { text: string; x: number; align: unknown }[] = [];
    const rec = new Proxy(ctx as unknown as Record<string, unknown>, {
      get(t, prop: string) {
        if (prop === "fillText") return (text: string, x: number) => void texts.push({ text, x, align: t.textAlign });
        return t[prop];
      },
      set(t, prop: string, v) {
        t[prop] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const o: ChartRenderOpts = { ...opts(), fieldNames: ["country", "change"] };
    renderFullBar(rec, [["neg", -50], ["pos", 30]], 0, 1, -1, W, H, PAD, o, null, true);
    const catX = Math.max(...texts.filter((t) => t.text === "neg" || t.text === "pos").map((t) => t.x));
    const neg = texts.find((t) => t.text === "-50")!;
    expect(neg.align).toBe("right");
    expect(neg.x - neg.text.length * 6).toBeGreaterThanOrEqual(catX);
  });

  it("positions bubble marks inside authored plot bounds", () => {
    const { ctx } = fakeCtx();
    const o: ChartRenderOpts = { ...opts(), plotBounds: { left: 180, top: 90, right: 480, bottom: 280 }, legendPosition: "none" };
    renderFullBubble(ctx, [[0, 0], [10, 10]], ["x", "y"], 0, 1, -1, -1, W, H, PAD, o);
    expect(o.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ cx: 180, cy: 280 }),
      expect.objectContaining({ cx: 480, cy: 90 }),
    ]));
  });

  it("hides the pie legend while honoring an explicit label choice in plain detail", () => {
    const { ctx, calls } = fakeCtx();
    const o: ChartRenderOpts = { ...opts(), legendPosition: "none", chartDetail: "plain", showDataLabels: true };
    renderFullPie(ctx, [["First category", 1], ["Second category", 1]], 0, 1, W, H, PAD, o);
    expect(calls.labels.some(l => l.text.includes("category"))).toBe(false);
    expect(calls.labels.filter(l => l.text === "50%")).toHaveLength(2);
    expect(o.legend).toEqual([]);
  });
});

it("renders mapped emoji in miniature scatter previews and keeps unknown codes geometric", () => {
  const { ctx, calls } = fakeCtx();
  const o = { ...opts(), mini: true, fieldNames: ["x", "y", "code"], emojiField: "code", emojiMap: { field: "code", values: { 0: "☀️", 95: "⛈️" } } };
  renderFullScatter(ctx, [[1, 2, 0], [2, 3, 95], [3, 4, 999]], 0, 1, -1, -1, W, H, PAD, o);
  expect(calls.labels.map((l) => l.text)).toEqual(["☀️", "⛈️"]);
  expect(o.hits).toHaveLength(3);
});

type Draw = (ctx: CanvasRenderingContext2D, data: unknown[][], o: ChartRenderOpts) => void;

const cols = ["region", "sales", "units", "other", "day", "a", "b"];

const renderers: [string, Draw][] = [
  ["bar", (c, d, o) => renderFullBar(c, d, 0, 1, -1, W, H, PAD, o)],
  ["histogram", (c, d, o) => renderFullHistogram(c, d, 1, W, H, PAD, o)],
  ["scatter", (c, d, o) => renderFullScatter(c, d, 1, 2, 0, -1, W, H, PAD, o)],
  ["line", (c, d, o) => renderFullLine(c, d, 4, 1, -1, W, H, PAD, o)],
  ["heatmap", (c, d, o) => renderFullHeatmap(c, d, 0, 3, W, H, PAD, o)],
  ["strip", (c, d, o) => renderFullStrip(c, d, 0, 1, -1, W, H, PAD, o)],
  ["box", (c, d, o) => renderFullBox(c, d, 0, 1, W, H, PAD, o)],
  ["area", (c, d, o) => renderFullArea(c, d, 4, 1, -1, W, H, PAD, o)],
  ["pie", (c, d, o) => renderFullPie(c, d, 0, 1, W, H, PAD, o)],
  ["bubble", (c, d, o) => renderFullBubble(c, d, cols, 1, 2, 0, 2, W, H, PAD, o)],
  ["violin", (c, d, o) => renderFullViolin(c, d, 0, 1, -1, W, H, PAD, o)],
  ["radar", (c, d, o) => renderFullRadar(c, d, cols, 0, 1, 0, W, H, PAD, o)],
  ["waterfall", (c, d, o) => renderFullWaterfall(c, d, 0, 1, W, H, PAD, o)],
  ["lollipop", (c, d, o) => renderFullLollipop(c, d, 0, 1, -1, W, H, PAD, o)],
  ["treemap", (c, d, o) => renderFullTreemap(c, d, 0, 1, -1, W, H, PAD, o)],
  ["forceBubble", (c, d, o) => renderFullForceBubble(c, d, 0, 1, -1, W, H, PAD, o)],
  ["sankey", (c, d, o) => renderFullSankey(c, d, 0, 3, -1, W, H, PAD, o)],
  ["network", (c, d, o) => renderFullNetwork(c, d, 0, 1, 3, W, H, PAD, o)],
  ["arcDiagram", (c, d, o) => renderFullArcDiagram(c, d, 0, 1, 3, W, H, PAD, o)],
  ["pareto", (c, d, o) => renderFullPareto(c, d, 0, 1, W, H, PAD, o)],
  ["corrMatrix", (c, d, o) => renderFullCorrMatrix(c, d, ["sales", "units"], W, H, PAD, o)],
  ["dumbbell", (c, d, o) => renderFullDumbbell(c, d, 0, 1, 2, 3, W, H, PAD, o)],
  ["ridgeline", (c, d, o) => renderFullRidgeline(c, d, 1, 0, W, H, PAD, o)],
  ["hexbin", (c, d, o) => renderFullHexbin(c, d, 1, 2, W, H, PAD, o)],
  ["funnel", (c, d, o) => renderFullFunnel(c, d, 0, 1, -1, W, H, PAD, o)],
  ["parallel", (c, d, o) => renderFullParallel(c, d, cols, -1, W, H, PAD, o)],
  ["sunburst", (c, d, o) => renderFullSunburst(c, d, 0, 1, -1, W, H, PAD, o)],
];

describe("extracted canvas renderers", () => {
  it.each(renderers)("%s supports a single custom color", (_name, render) => {
    const { ctx, calls } = fakeCtx();
    const o = { ...opts(), colors: ["#123456"], continuousStops: ["#123456"] };
    expect(() => render(ctx, rows, o)).not.toThrow();
    expect(calls.paint).toBeGreaterThan(0);
    expect(o.legend?.every((entry) => typeof entry.color === "string") ?? true).toBe(true);
  });

  it.each(renderers)("%s paints without throwing", (_name, render) => {
    const { ctx, calls } = fakeCtx();
    expect(() => render(ctx, rows, opts())).not.toThrow();
    expect(calls.paint).toBeGreaterThan(0);
  });

  it.each(renderers)("%s keeps rendered text at a readable size", (_name, render) => {
    const { ctx, calls } = fakeCtx();
    render(ctx, rows, opts());
    for (const label of calls.labels.filter((label) => label.text)) {
      const size = Number(label.font.match(/([\d.]+)px/)?.[1]);
      expect(size, `${_name}: ${label.text} (${label.font})`).toBeGreaterThanOrEqual(11);
    }
  });

  it.each(renderers)("%s honors the chosen family and larger chart text", (_name, render) => {
    const { ctx, calls } = fakeCtx();
    render(ctx, rows, { ...opts(), fontFamily: "Lora", axisFontSize: 16, showDataLabels: true });
    for (const label of calls.labels.filter((label) => label.text)) {
      expect(label.font, `${_name}: ${label.text}`).toContain('"Lora"');
      const size = Number(label.font.match(/([\d.]+)px/)?.[1]);
      expect(size, `${_name}: ${label.text} (${label.font})`).toBeGreaterThanOrEqual(14);
    }
  });

  it("registers hit targets for bar marks", () => {
    const { ctx } = fakeCtx();
    const o = opts();
    renderFullBar(ctx, rows, 0, 1, -1, W, H, PAD, o);
    expect(o.hits!.length).toBeGreaterThan(0);
  });

  it("renders complete emoji glyphs from a scatter column", () => {
    const { ctx, calls } = fakeCtx();
    const o = {
      ...opts(),
      fieldNames: ["x", "y", "mood"],
      emojiField: "mood",
    };
    renderFullScatter(ctx, [[1, 2, "👩🏽‍🔬"], [2, 3, "⚠️"]], 0, 1, -1, -1, W, H, PAD, o);
    expect(calls.labels.map((label) => label.text)).toEqual(expect.arrayContaining(["👩🏽‍🔬", "⚠️"]));
  });
});

describe("authored plot geometry", () => {
  it.each(renderers.filter(([name]) => ["bar", "histogram", "scatter", "line", "area", "bubble"].includes(name)))("%s keeps its scales inside the authored bounds", (_, render) => {
    const { ctx } = fakeCtx();
    const o = opts();
    o.plotBounds = { left: 100, top: 90, right: 500, bottom: 280 };
    render(ctx, rows, o);
    expect(o.scales?.rect).toBeDefined();
    expect(o.scales!.rect.left).toBeGreaterThanOrEqual(100);
    expect(o.scales!.rect.top).toBeGreaterThanOrEqual(90);
    expect(o.scales!.rect.right).toBeLessThanOrEqual(500);
    expect(o.scales!.rect.bottom).toBeLessThanOrEqual(280);
    if (o.scales?.x) expect(Number.isFinite(o.scales.x(12))).toBe(true);
  });
});

it.each(["round", "square", "butt"] as const)("line and area painters honor %s endings and explicit corners", (lineCap) => {
  for (const draw of [renderFullLine, renderFullArea]) {
    const { ctx, calls } = fakeCtx();
    draw(ctx, rows, 4, 1, -1, W, H, PAD, { ...opts(), lineCap, lineJoin: "bevel" });
    expect(calls.strokes).toContainEqual({ cap: lineCap, join: "bevel" });
  }
});

it("fits forecast bands inside the plot and keeps date events on the extended axis", () => {
  const { ctx } = fakeCtx();
  const o = opts();
  const data = Array.from({ length: 20 }, (_, i) => [new Date(Date.UTC(2026, 0, i + 1)).toISOString(), 10 + i + i % 3]);
  o.analysis = { scope: "test", forecast: { enabled: true, horizon: 7 }, anomaly: { enabled: true, window: 10, threshold: 3.5 }, events: [{ id: "launch", label: "Launch", start: "2026-01-10", end: "2026-01-12", visible: true }] };
  renderFullLine(ctx, data, 0, 1, -1, W, H, PAD, o);
  const predictions = o.hits!.filter(hit => hit.summary?.columns[0] === "Forecast");
  expect(predictions).toHaveLength(7);
  for (const hit of predictions) {
    expect(hit.shape).toBe("circle");
    if (hit.shape === "circle") {
      expect(hit.cx).toBeLessThanOrEqual(o.scales!.rect.right);
      expect(hit.cy).toBeGreaterThanOrEqual(o.scales!.rect.top);
      expect(hit.cy).toBeLessThanOrEqual(o.scales!.rect.bottom);
    }
  }
  const event = o.hits!.find(hit => hit.summary?.columns[0] === "Event")!;
  expect(event.shape).toBe("rect");
  if (event.shape === "rect") expect(event.x).toBeCloseTo(o.scales!.x!(Date.UTC(2026, 0, 10)) - 5);
  o.analysis.forecast!.enabled = false;
  o.hits = [];
  renderFullLine(ctx, data, 0, 1, -1, W, H, PAD, o);
  expect(o.hits.some(hit => hit.summary?.columns[0] === "Forecast")).toBe(false);
});

describe("stat chart geometry", () => {
  it("keeps the first ridgeline ridge inside the plot", () => {
    const { ctx, calls } = fakeCtx();
    const o = opts();
    renderFullRidgeline(ctx, rows, 1, 0, W, H, PAD, o);
    const rect = o.scales!.rect;
    expect(calls.points.length).toBeGreaterThan(0);
    for (const p of calls.points) {
      expect(p.y).toBeGreaterThanOrEqual(rect.top - 0.001);
    }
    const rects = o.hits!.filter((hit) => hit.shape === "rect");
    for (const hit of rects) {
      if (hit.shape !== "rect") continue;
      expect(hit.y).toBeGreaterThanOrEqual(rect.top);
      expect(hit.y + hit.h).toBeLessThanOrEqual(rect.bottom + 0.001);
    }
    // The first band owns the headroom its peak reaches into.
    expect(Math.min(...rects.map((hit) => (hit.shape === "rect" ? hit.y : Infinity)))).toBe(rect.top);
  });

  it("hits the parallel-coordinates line under the pointer, not the first one drawn", () => {
    const { ctx } = fakeCtx();
    const o = opts();
    // Coloured by region, so a shared category match would hide the row.
    renderFullParallel(ctx, rows, cols, 0, W, H, PAD, o);
    expect(o.hits!.length).toBeGreaterThan(0);
    expect(o.hits!.every((hit) => hit.shape === "circle")).toBe(true);
    const circles = o.hits!.flatMap((hit) => (hit.shape === "circle" ? [hit] : []));
    // A vertex no other line lands near, on a row that isn't its category's first.
    const target = circles.find(
      (hit) =>
        rows.findIndex((r) => r[0] === rows[hit.rowIndex!]![0]) < hit.rowIndex! &&
        !circles.some((c) => c.rowIndex !== hit.rowIndex && Math.hypot(c.cx - hit.cx, c.cy - hit.cy) <= c.r),
    )!;
    expect(target).toBeDefined();
    const picked = pickHitTarget(o.hits, target.cx, target.cy)!;
    expect(picked.rowIndex).toBe(target.rowIndex);
    // The tooltip resolves to that line's row, not the category's first row.
    expect(rowForHitTarget(picked, rows as (string | number | boolean | null)[][])).toBe(target.rowIndex);
  });
});
