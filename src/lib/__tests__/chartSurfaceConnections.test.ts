// Exercise the real stage dispatcher, including grouping, facets and source-row identity.
import { describe, expect, it, vi } from "vitest";
import { paintActiveChart, type ChartPaintParams } from "@/components/chartView/paintActiveChart";
import { canvasHitReadout, type Canvas2DHitContext, type HitTarget } from "../chartTooltip";
import { groupedChannelsForThumb } from "../chartThumbnailCache";
import { usesScatterNavigation } from "../chartInteractionSurface";
import { markRefForHit, sameMark } from "../markFocus";
import type { QueryResult } from "../queryTypes";
import type { ChartRecommendation } from "../recommendations";
import { recommendSourceStory } from "../recommendations";
import { SOURCE_DEFS } from "../sourceRegistry";
import * as symbols from "../markSymbols";

const recipe = (patch: Partial<ChartRecommendation> = {}): ChartRecommendation => ({
  id: "test", kind: "scatter", title: "Connected chart", subtitle: "", score: 90,
  xField: "x", yField: "y", colorField: null, spec: {}, ...patch,
});
const sample: QueryResult = {
  columns: ["x", "y", "group", "label"], types: ["DOUBLE", "DOUBLE", "VARCHAR", "VARCHAR"], total_rows: 8,
  rows: Array.from({ length: 8 }, (_, i) => [i + 1, (i + 1) * 10, i % 2 ? "West" : "East", `row ${i}`]),
};

function paint(chart: ChartRecommendation, data = sample, raw = data) {
  const texts: string[] = [];
  const state: Record<string, unknown> = {
    measureText: (s: string) => ({ width: String(s).length * 7 }),
    fillText: (s: string) => texts.push(s),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getLineDash: () => [],
  };
  const ctx = new Proxy(state, { get: (t, k: string) => t[k] ?? (() => {}), set: (t, k: string, v) => { t[k] = v; return true; } });
  const canvas = { width: 800, height: 500, getContext: () => ctx };
  const refs = {
    canvas2DRef: { current: canvas }, canvasRef: { current: canvas }, axesOverlayRef: { current: canvas },
    rendererRef: { current: null }, sceneRendererRef: { current: null }, cubeRendererRef: { current: null },
    scatterDataRef: { current: { stale: true } }, canvas2DHitRef: { current: null as Canvas2DHitContext | null },
    cubeFrameRef: { current: null }, cubeTransitionRef: { current: null },
  };
  const error = vi.fn();
  paintActiveChart({
    refs, canvasSized: true, activeChart: chart, sampleRows: raw, chartSampleRows: data,
    chartFootnoteText: null, chartColorInfo: null, footnoteOpts: () => ({}),
    chartRenderOpts: { ...chart, colors: ["#123456", "#678901", "#abcdef"], opacity: .8, pointSize: 8, legendPosition: "none" },
    colors: ["#123456"], opacity: .8, pointSize: 8, continuousStops: ["#123456", "#abcdef"],
    chartVisualOverrides: {}, chartTitleOverrides: {}, smartResults: null,
    themeUi: { bg: "#fff", text: "#111", label: "#555", border: "#ccc" },
    containerSize: { w: 800, h: 500 }, sceneOrbit: { yaw: 0, pitch: 0, zoom: 1 },
    scatterView: { scale: 1, panX: 0, panY: 0 }, extractScatterData: () => null,
    customRefLines: {}, monitorLines: [], reducedMotion: true,
    reportArrangementLayout: vi.fn(), setHitsVersion: vi.fn(), setChartDrawError: error,
  } as unknown as ChartPaintParams);
  expect(error.mock.calls.filter(([message]) => message != null)).toEqual([]);
  return { frame: refs.canvas2DHitRef.current!, scatter: refs.scatterDataRef.current, texts };
}

describe("connected chart surfaces", () => {
  it("uses painted scatter facets for picking, keyboard focus and pin identity after filtering", () => {
    const rec = recipe({ rowField: "group", tooltipFields: ["label"] });
    const filtered = { ...sample, rows: [sample.rows[7], sample.rows[4], sample.rows[3]], rowSourceIndices: [7, 4, 3] };
    const { frame, scatter } = paint(rec, filtered, sample);
    expect(usesScatterNavigation(rec)).toBe(false);
    expect(usesScatterNavigation({ ...rec, rowField: null })).toBe(true);
    expect(scatter).toBeNull();
    expect(frame.targets).toHaveLength(3);
    const sourceRows = frame.targets!.map(hit => canvasHitReadout(frame, hit, sample, rec)!);
    expect(sourceRows.map(t => t.rowIndex).sort()).toEqual([3, 4, 7]);
    for (const tip of sourceRows) expect(tip.row).toContain(`row ${tip.rowIndex}`);
    const refs = frame.targets!.map(hit => markRefForHit(hit, frame.columns, frame.rows, ["x", "y"]));
    expect(sameMark(refs[0], refs[1])).toBe(false);
  });

  it("keeps a single scatter facet connected to original rows too", () => {
    const rec = recipe({ rowField: "group", tooltipFields: ["label"] });
    const data = { ...sample, rows: [sample.rows[7], sample.rows[3]], rowSourceIndices: [7, 3] };
    const { frame } = paint(rec, data, sample);
    expect(frame.targets!.map(t => canvasHitReadout(frame, t, sample, rec)!.rowIndex)).toEqual([7, 3]);
  });

  it("uses grouped shapes and original axis values in the full stage and previews", () => {
    const spy = vi.spyOn(symbols, "markSymbols");
    const rec = recipe({ shapeField: "x", colorField: "x", groupInto: 2, rowField: "group" });
    const { frame } = paint(rec);
    expect(frame.columns).toContain("\u0000x");
    expect(frame.rows.map(r => r[0])).toEqual(sample.rows.map(r => r[0]));
    for (const [opts, columns] of spy.mock.calls) {
      expect(opts?.shapeField).toBe("\u0000x");
      expect(columns).toContain("\u0000x");
    }
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    const preview = groupedChannelsForThumb(sample, rec, 3);
    expect(preview.shapeField).toBe("\u0000x");
    expect(preview.colorField).toBe(preview.shapeField);
    expect(preview.rows.map(r => r[4])).toEqual(["1–4", "1–4", "5–8"]);
    expect(groupedChannelsForThumb(sample, rec, 3)).toBe(preview);
    expect(groupedChannelsForThumb(sample, { ...rec, groupInto: null }, 3).columns).toEqual(sample.columns);
  });

  it("shares colors and symbols across facets even when their row order differs", () => {
    const spy = vi.spyOn(symbols, "markSymbols");
    const rec = recipe({ rowField: "group", colorField: "group", shapeField: "group" });
    paint(rec);
    const domains = spy.mock.calls.map(([opts]) => opts?.symbolIndices);
    expect(domains).toHaveLength(2);
    expect(domains[0]).toBe(domains[1]);
    expect([...domains[0]!.keys()]).toEqual(["East", "West"]);
    const east = spy.mock.results[0].value as symbols.MarkSymbols;
    const west = spy.mock.results[1].value as symbols.MarkSymbols;
    expect(east.of(sample.rows[0]).shape).not.toBe(west.of(sample.rows[1]).shape);
    spy.mockRestore();
  });

  it("resolves grouped bar readouts against the grouped data but links to the raw row", () => {
    const rec = recipe({ kind: "bar", xField: "group", colorField: "x", groupInto: 2, tooltipFields: ["x", "label"] });
    const { frame, texts } = paint(rec);
    const target = frame.targets!.find(t => t.match.some(([, value]) => value === "5–8"))!;
    expect(target).toBeDefined();
    const tip = canvasHitReadout(frame, target, sample, rec)!;
    expect(tip.rowIndex).toBeGreaterThanOrEqual(4);
    expect(tip.row).toContain(`row ${tip.rowIndex}`);
    expect(canvasHitReadout(frame, target, sample, rec, { field: "label", value: "row 0" })).toBeNull();
    expect(texts.join(" ")).not.toContain("\u0000");
  });

  it("maps thinned point readouts back to raw values instead of the same local offset", () => {
    const target: HitTarget = { shape: "circle", cx: 20, cy: 20, r: 6, match: [], rowIndex: 1 };
    const frame = { rows: [sample.rows[1], sample.rows[7]], columns: sample.columns, rowSourceIndices: [1, 7] } as Canvas2DHitContext;
    const rec = recipe({ kind: "bubble", tooltipFields: ["label"] });
    expect(canvasHitReadout(frame, target, sample, rec)).toMatchObject({ rowIndex: 7, row: ["row 7"] });
    expect(canvasHitReadout(frame, target, sample, rec, { field: "label", value: "row 7" })?.rowIndex).toBe(7);
  });
});

describe("source chart dispatch", () => {
  const kinds = new Set(["bar", "line", "area", "scatter", "bubble", "histogram", "pie", "heatmap", "hexbin", "box", "strip", "violin", "radar", "parallel", "lollipop", "dumbbell", "pareto", "treemap", "forceBubble", "waterfall"]);
  it.each(SOURCE_DEFS)("paints the opening chart surfaces for $kind", def => {
    const rows = Array.from({ length: 24 }, (_, i) => def.columns.map((name, j) => {
      if (def.types[j] === "BOOLEAN") return i % 2 === 0;
      if (def.types[j] === "DATE" || def.types[j] === "TIMESTAMP") return `2026-10-${String(i + 1).padStart(2, "0")}T12:00:00Z`;
      if (def.types[j] === "VARCHAR") return ["A", "B", "C"][i % 3];
      return name === "year" ? 2000 + i : 1 + (i * (j + 1)) % 20;
    }));
    const data: QueryResult = { columns: def.columns, types: def.types, rows, total_rows: rows.length };
    const stats = def.columns.map((name, j) => ({ name, data_type: def.types[j], null_count: 0, distinct_count: new Set(rows.map(row => row[j])).size, min_value: null, max_value: null }));
    const recs = recommendSourceStory(def.kind, stats, data).charts.filter(c => kinds.has(c.kind)).slice(0, 8);
    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) {
      const { frame } = paint(rec, data);
      expect(frame?.targets?.length, `${def.kind}: ${rec.kind} ${rec.title}`).toBeGreaterThan(0);
    }
  });
});
