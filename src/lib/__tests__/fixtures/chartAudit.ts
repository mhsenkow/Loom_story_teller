/** Deterministic, valid encodings for every shipped renderer; shared by visual and geometry audits. */
import { CHART_KIND_OPTIONS, type ChartKind } from "../../recs/types";
import type { ChartRenderOpts } from "../../chartRenderTypes";
import { renderFullBar, renderFullHistogram } from "../../canvasCharts/bar";
import { renderFullScatter } from "../../canvasCharts/scatter";
import { renderFullLine, renderFullHeatmap } from "../../canvasCharts/lineHeatmap";
import { renderFullStrip, renderFullBox, renderFullArea } from "../../canvasCharts/distributions";
import { renderFullPie, renderFullBubble } from "../../canvasCharts/pieBubble";
import { renderFullViolin, renderFullRadar, renderFullWaterfall, renderFullLollipop } from "../../canvasCharts/violinRadar";
import { renderFullTreemap, renderFullForceBubble, renderFullSankey, renderFullNetwork, renderFullArcDiagram } from "../../canvasCharts/flowCharts";
import { renderFullPareto, renderFullCorrMatrix, renderFullDumbbell, renderFullRidgeline, renderFullHexbin, renderFullFunnel, renderFullParallel } from "../../canvasCharts/statCharts";
import { renderFullSunburst } from "../../canvasCharts/sunburst";
import { isOddChartKind, renderOddChart } from "../../oddCharts";
import { isGpuSceneKind, extractGpuScenePoints, renderGpuSceneCanvas } from "../../gpuScenes";
import { isGeoMapKind, renderGeoMapCanvas } from "../../geoMaps";
import { loadAtlas } from "../../geoAtlas";
import { buildDataCube, renderDataCubeCanvas } from "../../dataCube";

export const auditKinds = CHART_KIND_OPTIONS;
export const auditColumns = ["region", "series", "value", "previous", "depth", "longitude", "latitude", "date"];
export const auditRows: unknown[][] = Array.from({ length: 90 }, (_, i) => [
  ["United States", "France", "Japan", "Brazil", "Australia"][i % 5],
  ["North", "South", "West"][i % 3],
  10 + (i * 37) % 90,
  5 + (i * 13) % 40,
  1 + (i * 7) % 9,
  [-100, 2, 138, -51, 134][i % 5] + (i % 7) * 0.2,
  [40, 46, 36, -14, -25][i % 5] + (i % 11) * 0.2,
  new Date(Date.UTC(2026, 0, Math.floor(i / 3) + 1)).toISOString().slice(0, 10),
]);

const oddEnc: Partial<Record<ChartKind, [number, number, number, number]>> = {
  bump: [7, 2, 1, -1], stream: [7, 2, 1, -1], horizon: [7, 2, -1, -1],
  calendar: [7, 2, -1, -1], ecdf: [2, -1, 1, -1], sparkGrid: [7, 2, 1, -1],
  density: [2, -1, 1, -1], qq: [2, -1, -1, -1], connectedScatter: [2, 3, -1, 7],
  stripes: [7, 2, -1, -1], spiral: [7, 2, -1, -1], voronoi: [2, 3, 1, -1],
  contour: [2, 3, -1, -1], isoScatter: [2, 3, 1, 4], chord: [0, 2, 1, -1],
  mosaic: [0, 2, 1, -1], pyramid: [0, 2, -1, 3], slope: [0, 2, -1, 3],
};

export async function prepareChartAudit() { await loadAtlas("world"); }

export function drawAuditChart(kind: ChartKind, ctx: CanvasRenderingContext2D, w: number, h: number, rows = auditRows, overrides: Partial<ChartRenderOpts> = {}) {
  const pad = Math.min(48, w * 0.12, h * 0.2);
  const o: ChartRenderOpts = {
    colors: ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#e69f00"],
    themeBg: "#f8f9fb", themeText: "#18202c", themeMuted: "#596778", themeBorder: "#ccd3dc",
    fontFamily: "Inter", opacity: 0.85, pointSize: 12, fieldNames: auditColumns, hits: [], ...overrides,
  };
  if (kind === "dataCube") {
    const cube = buildDataCube(rows, auditColumns, { xField: "region", yField: "series", zField: "depth", valueField: "value", aggregate: "sum" });
    if (cube) renderDataCubeCanvas(ctx, cube, w, h, { ...o, ramp: o.colors, opacity: 0.85, camera: { yaw: 0.6, pitch: 0.4, zoom: 1 } });
  } else if (isOddChartKind(kind)) {
    const [xi, yi, ci, si] = oddEnc[kind] ?? [0, 2, 1, 3];
    renderOddChart(kind, ctx, rows, auditColumns, xi, yi, ci, si, w, h, pad, o);
  } else if (isGeoMapKind(kind) || kind === "choropleth") {
    renderGeoMapCanvas(kind, ctx, rows, auditColumns, { xField: kind === "choropleth" ? "region" : "longitude", yField: kind === "choropleth" ? "value" : "latitude", colorField: "series", sizeField: "value" }, w, h, pad, o);
  } else if (isGpuSceneKind(kind)) {
    const packed = extractGpuScenePoints(rows, auditColumns, { xField: "value", yField: "previous", zField: "depth", colorField: "series", sizeField: "depth", timeField: "date", trailId: "series" });
    if (packed) renderGpuSceneCanvas(kind, ctx, packed, w, h, pad, o);
  } else {
    switch (kind) {
      case "bar": renderFullBar(ctx, rows, 0, 2, -1, w, h, pad, o); break;
      case "histogram": renderFullHistogram(ctx, rows, 2, w, h, pad, o); break;
      case "scatter": renderFullScatter(ctx, rows, 2, 3, 1, -1, w, h, pad, o); break;
      case "line": renderFullLine(ctx, rows, 7, 2, 1, w, h, pad, o); break;
      case "heatmap": renderFullHeatmap(ctx, rows, 0, 1, w, h, pad, o); break;
      case "strip": renderFullStrip(ctx, rows, 2, 0, 1, w, h, pad, o); break;
      case "box": renderFullBox(ctx, rows, 0, 2, w, h, pad, o); break;
      case "area": renderFullArea(ctx, rows, 7, 2, 1, w, h, pad, o); break;
      case "pie": renderFullPie(ctx, rows, 0, 2, w, h, pad, o); break;
      case "bubble": renderFullBubble(ctx, rows, auditColumns, 2, 3, 1, 4, w, h, pad, o); break;
      case "violin": renderFullViolin(ctx, rows, 0, 2, 1, w, h, pad, o); break;
      case "radar": renderFullRadar(ctx, rows, auditColumns, 0, 2, 1, w, h, pad, o); break;
      case "waterfall": renderFullWaterfall(ctx, rows, 0, 2, w, h, pad, o); break;
      case "lollipop": renderFullLollipop(ctx, rows, 0, 2, 1, w, h, pad, o); break;
      case "dumbbell": renderFullDumbbell(ctx, rows, 0, 2, 3, -1, w, h, pad, o); break;
      case "ridgeline": renderFullRidgeline(ctx, rows, 2, 0, w, h, pad, o); break;
      case "hexbin": renderFullHexbin(ctx, rows, 2, 3, w, h, pad, o); break;
      case "funnel": renderFullFunnel(ctx, rows, 0, 2, -1, w, h, pad, o); break;
      case "parallel": renderFullParallel(ctx, rows, auditColumns, 1, w, h, pad, o); break;
      case "treemap": renderFullTreemap(ctx, rows, 0, 2, 1, w, h, pad, o); break;
      case "sunburst": renderFullSunburst(ctx, rows, 0, 2, 1, w, h, pad, o); break;
      case "forceBubble": renderFullForceBubble(ctx, rows, 0, 2, 1, w, h, pad, o); break;
      case "sankey": renderFullSankey(ctx, rows, 0, 2, 1, w, h, pad, o); break;
      case "network": renderFullNetwork(ctx, rows, 0, 2, 1, w, h, pad, o); break;
      case "arcDiagram": renderFullArcDiagram(ctx, rows, 0, 2, 1, w, h, pad, o); break;
      case "pareto": renderFullPareto(ctx, rows, 0, 2, w, h, pad, o); break;
      case "corrMatrix": renderFullCorrMatrix(ctx, rows, auditColumns, w, h, pad, o); break;
      default: { const missing: never = kind; throw new Error(`Missing audit renderer: ${missing}`); }
    }
  }
  return o;
}
