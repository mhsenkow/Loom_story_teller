/**
 * LOOM-141 / LOOM-142 — every extracted Canvas renderer draws against a
 * recording fake 2D context (module wiring + no throw + hit targets / paint).
 */
import { describe, expect, it } from "vitest";
import type { ChartRenderOpts } from "../chartRenderTypes";
import type { HitTarget } from "../chartTooltip";
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
  const calls = { paint: 0, strokes: [] as { cap: unknown; join: unknown }[], labels: [] as { text: string; font: string }[] };
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
