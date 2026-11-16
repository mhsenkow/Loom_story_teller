/** Every advertised capability must change real marks/readouts on a discriminating fixture. */
import { beforeAll, describe, expect, it } from "vitest";
import { chartCapabilities, type ChartCapabilities } from "../chartSupport";
import type { ChartRenderOpts } from "../chartRenderTypes";
import { auditKinds, auditRows, drawAuditChart, prepareChartAudit } from "./fixtures/chartAudit";
import { paintAuditStage } from "./fixtures/chartStageAudit";
import { recordChartPaint } from "./fixtures/chartRecording";
import { radiusFromPointSize } from "../chartInk";

beforeAll(async () => {
  if (!globalThis.Path2D) globalThis.Path2D = class {} as typeof Path2D;
  await prepareChartAudit();
});

describe.each(["chord", "mosaic"] as const)("%s aggregate values", kind => {
  it.each([
    ["sum", 10], ["mean", 5], ["min", 2], ["max", 8], ["count", 3],
  ] as const)("%s reaches the actual readout, beyond its label", (yAggregate, expected) => {
    const ctx = recordChartPaint().ctx;
    const opts = drawAuditChart(kind, ctx, 800, 500, [["A", "B", 2], ["A", "B", 8], ["A", "B", null]], { yAggregate });
    expect(opts.hits?.length).toBeGreaterThan(0);
    for (const hit of opts.hits!) expect(hit.summary?.row[kind === "chord" ? 1 : 2]).toBe(expected);
  });
});

type Probe = { name: string; capability?: keyof ChartCapabilities; from: Partial<ChartRenderOpts>; to: Partial<ChartRenderOpts> };
const probes: Probe[] = [
  { name: "palette", from: { colors: ["#123456", "#654321"], continuousStops: ["#123456", "#654321"] }, to: { colors: ["#ab2345", "#12abcd"], continuousStops: ["#ab2345", "#12abcd"] } },
  { name: "opacity", from: { opacity: .2, opacityUserSet: true }, to: { opacity: .9, opacityUserSet: true } },
  { name: "grid", capability: "grid", from: { showGrid: false }, to: { showGrid: true } },
  { name: "grid style", capability: "grid", from: { showGrid: true, gridStyle: "solid" }, to: { showGrid: true, gridStyle: "dashed" } },
  { name: "grid opacity", capability: "grid", from: { showGrid: true, gridOpacity: .2 }, to: { showGrid: true, gridOpacity: .8 } },
  { name: "aggregation", capability: "aggregate", from: { yAggregate: "sum", colorField: "value" }, to: { yAggregate: "count", colorField: "value" } },
  { name: "aggregation mean", capability: "aggregate", from: { yAggregate: "sum", colorField: "value" }, to: { yAggregate: "mean", colorField: "value" } },
  { name: "aggregation min", capability: "aggregate", from: { yAggregate: "sum", colorField: "value" }, to: { yAggregate: "min", colorField: "value" } },
  { name: "aggregation max", capability: "aggregate", from: { yAggregate: "sum", colorField: "value" }, to: { yAggregate: "max", colorField: "value" } },
  { name: "Top N", capability: "topN", from: { topN: 5 }, to: { topN: 10 } },
  { name: "legend", capability: "legend", from: { legendPosition: "none" }, to: { legendPosition: "top-right" } },
  { name: "value labels", capability: "dataLabels", from: { showDataLabels: false }, to: { showDataLabels: true } },
  { name: "point size", capability: "pointMarker", from: { pointSize: 8 }, to: { pointSize: 24 } },
  { name: "point shape", capability: "pointMarker", from: { markShape: "circle" }, to: { markShape: "square" } },
  { name: "direction", capability: "layoutDirection", from: { layoutDirection: "up" }, to: { layoutDirection: "left" } },
  { name: "Y scale", capability: "yScale", from: { yScale: "linear" }, to: { yScale: "log" } },
  { name: "tick rotation", capability: "tickLabelRotation", from: { tickRotation: 0 }, to: { tickRotation: 45 } },
  { name: "rounded bars", capability: "barMarks", from: { barCornerRadius: 0 }, to: { barCornerRadius: 8 } },
  { name: "line width", capability: "lineMarks", from: { lineWidth: 1 }, to: { lineWidth: 5 } },
  { name: "line dash", capability: "lineMarks", from: { lineStrokeStyle: "solid" }, to: { lineStrokeStyle: "dashed" } },
  { name: "line smoothing", capability: "lineMarks", from: { lineCurveSmooth: false }, to: { lineCurveSmooth: true } },
  { name: "rolling mean", capability: "rollingWindow", from: {}, to: { rollingWindow: 7 } },
  { name: "normalization", capability: "seriesNormalize", from: {}, to: { seriesNormalize: "index100" } },
  { name: "comparison measure", capability: "compareY", from: {}, to: { y2Field: "previous" } },
  { name: "previous period", capability: "comparePrevious", from: {}, to: { comparePrevious: true } },
  { name: "delta labels", capability: "deltaDisplay", from: { deltaDisplay: "off" }, to: { deltaDisplay: "pct" } },
  { name: "residuals", capability: "residualOverlay", from: {}, to: { residualOverlay: true } },
  { name: "rank mode", capability: "bumpMode", from: { bumpMode: "rank" }, to: { bumpMode: "delta" } },
  { name: "word cloud grouping", capability: "wordCloudMode", from: { wordCloudMode: "cloud" }, to: { wordCloudMode: "grid" } },
  { name: "pyramid scales", capability: "pyramidScaleMode", from: { pyramidScaleMode: "shared" }, to: { pyramidScaleMode: "independent" } },
];

describe.each(auditKinds)("$label parameter effects", ({ value: kind }) => {
  for (const probe of probes.filter(p => !p.capability || chartCapabilities(kind)[p.capability])) {
    it(probe.name, () => {
      const paint = (opts: Partial<ChartRenderOpts>) => {
        const recording = recordChartPaint();
        const rows = probe.name === "Top N" ? auditRows.map((r, i) => r.map((v, c) => c === 0 ? `C${i % 15}` : c === 1 ? `S${i % 15}` : v)) : auditRows;
        const result = paintAuditStage(kind, recording.ctx, opts, rows, probe.name === "previous period" ? { colorField: null, xField: "date" } : {});
        return { ink: recording.digest(), hits: JSON.stringify(result?.targets) };
      };
      const baseline = paint(probe.from);
      expect(paint(probe.from), "fixture must be deterministic").toEqual(baseline);
      expect(paint(probe.to), `${kind}: ${probe.name} has no visible/readout effect`).not.toEqual(baseline);
    });
  }
});

it("point size increases continuously across the full inspector range", () => {
  for (let size = 3; size <= 24; size++) expect(radiusFromPointSize(size, 3)).toBeGreaterThan(radiusFromPointSize(size - 1, 3));
  expect(radiusFromPointSize(3, 5, true)).toBe(3);
});
