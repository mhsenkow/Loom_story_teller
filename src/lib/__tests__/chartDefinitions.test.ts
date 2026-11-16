import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { CHART_DEFINITION_LIST, chartDefinition, chartFieldAllowed, findChartDefinition, type ChartChannelId } from "../chartDefinitions";
import { CHART_NUMBER_CONTROLS, chartNumberControls } from "../chartDefinitions/controls";
import { CHART_KIND_OPTIONS, type ChartKind } from "../recs/types";
import { chartCapabilities, encodingChannelLabels, defaultYAggregate, svgExportMode } from "../chartSupport";
import { chartSpecParity } from "../chartSpecParity";
import { isOddChartKind } from "../oddChartsRec";
import { isGpuSceneKind } from "../gpuScenesRec";
import { isGeoMapKind } from "../geoMapsRec";
import { usesScatterNavigation } from "../chartInteractionSurface";
import baseline from "./fixtures/chartContractBaseline.json";
import { prepareChartAudit } from "./fixtures/chartAudit";
import { paintAuditStage } from "./fixtures/chartStageAudit";
import { recordChartPaint } from "./fixtures/chartRecording";

beforeAll(async () => {
  if (!globalThis.Path2D) globalThis.Path2D = class {} as typeof Path2D;
  await prepareChartAudit();
});

it("catalog is exhaustive, unique, immutable, and rejects unknown/prototype keys", () => {
  expect(CHART_DEFINITION_LIST.map(d => d.kind)).toEqual(Object.keys(baseline));
  expect(new Set(CHART_DEFINITION_LIST.map(d => d.kind)).size).toBe(CHART_DEFINITION_LIST.length);
  for (const key of ["typo", "__proto__", "constructor"]) {
    expect(findChartDefinition(key)).toBeUndefined();
    expect(() => chartDefinition(key as ChartKind)).toThrow("Unregistered chart kind");
  }
  expect(() => { (chartDefinition("bar").capabilities as { grid: boolean }).grid = false; }).toThrow();
});

it("contract can bundle for Worker/Node without UI, store, canvas, or native bridges", async () => {
  const bundle = await build({ entryPoints: ["src/lib/chartDefinitions.ts"], bundle: true, write: false, platform: "node", metafile: true });
  expect(Object.keys(bundle.metafile!.inputs).filter(path => /components\/|store\/|store\.ts|canvasCharts|webgpu|tauri\.ts|node_modules\/react/.test(path))).toEqual([]);
});

describe.each(CHART_DEFINITION_LIST)("$kind chart contract", definition => {
  const { kind } = definition;
  it("preserves existing capabilities, field types, labels, aggregates and export policy", () => {
    const before = baseline[kind];
    const metadata = { kind, label: definition.label, family: definition.family,
      capabilities: chartCapabilities(kind), labels: encodingChannelLabels(kind), defaultAggregate: defaultYAggregate(kind), portable: chartSpecParity(kind),
      fields: Object.fromEntries((["x", "y", "color", "size", "z"] as const).map(id => [id, definition.channels[id].accepts])),
    };
    expect(createHash("sha256").update(JSON.stringify(metadata)).digest("hex")).toBe(before.metadata);
    expect(CHART_KIND_OPTIONS.find(o => o.value === kind)?.label).toBe(definition.label);
    expect(definition.family === "odd").toBe(isOddChartKind(kind));
    expect(definition.family === "scene").toBe(isGpuSceneKind(kind));
    expect(definition.family === "geo").toBe(isGeoMapKind(kind));
  });
  it("preserves actual painted marks and hit counts through production dispatch", () => {
    const rec = recordChartPaint();
    const hits = paintAuditStage(kind, rec.ctx);
    expect(rec.digest()).toBe(baseline[kind].paint);
    expect(hits?.targets?.length ?? 0).toBe(baseline[kind].hitCount);
  });
  it("declares valid channels, sections and explicit export limitations", () => {
    const sections = definition.inspector.visualSections;
    expect(new Set(sections.map(s => s.id)).size).toBe(sections.length);
    expect(sections.some(s => s.id === "axes")).toBe(definition.capabilities.cartesian);
    expect(sections.some(s => s.id === "marks")).toBe(definition.capabilities.pointMarker || definition.capabilities.barMarks || definition.capabilities.lineMarks);
    for (const [id, channel] of Object.entries(definition.channels)) {
      expect(channel.label.length).toBeGreaterThan(0);
      expect(channel.accepts.length).toBeGreaterThan(0);
      if (channel.required) expect(channel.enabled, id).toBe(true);
    }
    if (definition.exports.svg.portable !== "native") expect(definition.exports.svg.limitation).toBeTruthy();
    if (definition.exports.svg.portable === "none") expect(svgExportMode({ encoding: { x: {} } }, kind)).toBe("off");
  });
  for (const id of ["x", "y", "color", "size", "z"] as const) {
    it.each(["quantitative", "nominal", "temporal"] as const)(`${id} accepts only its declared %s field policy`, type => {
      const col = { name: "value", data_type: type === "quantitative" ? "DOUBLE" : type === "temporal" ? "DATE" : "VARCHAR", null_count: 0, distinct_count: 5, min_value: null, max_value: null };
      const channel = definition.channels[id];
      expect(chartFieldAllowed(kind, id as ChartChannelId, col).ok).toBe(channel.enabled && channel.accepts.includes(type));
      expect(chartFieldAllowed(kind, id, undefined).ok).toBe(false);
    });
  }
  for (const control of chartNumberControls(definition.capabilities)) {
    it(`${control.key} advertised range affects real paint`, () => {
      const paint = (value: number) => {
        const rec = recordChartPaint();
        paintAuditStage(kind, rec.ctx, { [control.key]: value, showGrid: true, opacityUserSet: true });
        return rec.digest();
      };
      expect(control.min).toBeLessThan(control.max);
      expect(control.defaultValue).toBeGreaterThanOrEqual(control.min);
      expect(control.defaultValue).toBeLessThanOrEqual(control.max);
      expect(paint(control.min)).not.toBe(paint(control.max));
    });
  }
});

it("scatter facets use marks while ordinary scatter retains pan/zoom", () => {
  expect(usesScatterNavigation({ kind: "scatter" })).toBe(true);
  expect(usesScatterNavigation({ kind: "scatter", rowField: "region" })).toBe(false);
  expect(usesScatterNavigation({ kind: "bar" })).toBe(false);
  expect(chartDefinition("scatter3d").interactions.camera).toBe(true);
  expect(chartDefinition("dataCube").interactions.picking).toBe("cube-ray");
  expect(CHART_NUMBER_CONTROLS.pointSize.defaultValue).toBe(12);
});
