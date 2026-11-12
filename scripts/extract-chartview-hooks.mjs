#!/usr/bin/env node
/**
 * Extract hook bodies from .ChartView.source.tsx into chartView/*.ts(x).
 * Leaves a stub — run merge step separately.
 */
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const srcPath = path.join(root, "src/components/chartView/.ChartView.source.tsx");
const outDir = path.join(root, "src/components/chartView");
const lines = fs.readFileSync(srcPath, "utf8").split("\n");

function extract(start, end) {
  return lines.slice(start - 1, end).join("\n");
}

function writeHook(name, start, end, extraImports = "") {
  const body = extract(start, end);
  const content = `// LOOM-141 — extracted from ChartView.tsx (${start}-${end})
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartViewHookCtx } from "./chartViewHookCtx";
${extraImports}

export function ${name}(ctx: ChartViewHookCtx): void {
${body.split("\n").map((l) => "  " + l).join("\n")}
}
`;
  fs.writeFileSync(path.join(outDir, `${name}.ts`), content);
}

writeHook(
  "useChartExport",
  1660,
  1895,
  `import { useLoomStore } from "@/lib/store";
import { canUseWebGpuScatter } from "@/lib/webGpuScatterEligibility";
import { getThemeUiColors, hexToRgb01 } from "@/lib/chartPalettes";
import { resolveRuntimeTheme } from "@/lib/resolveEffectiveTheme";
import { resolveThemeChartStyle } from "@/lib/themeChartStyle";
import { stageDpr } from "./constants";
import { drawCanvasAnnotations } from "@/lib/canvasAnnotationDraw";
import { resolveChartPad } from "@/lib/chartLayout";
import { DEFAULT_PAD } from "@/lib/canvasCharts/shared";
import { isGpuSceneKind, isWebGpuGlobeKind, extractGpuScenePoints, renderGpuSceneCanvas, type GpuSceneKind } from "@/lib/gpuScenes";
import { hasCanvasArrangement } from "@/lib/canvasArrangement";
import { renderDataCubeCanvas } from "@/lib/dataCube";
import { resolveChartFontFamily } from "@/lib/fontCatalog";
import { resolveChartAxisFontSize } from "@/lib/chartType";
import { applyChartSpecColors } from "@/lib/chartSpecColors";
import { svgExportMode } from "@/lib/chartSupport";
import { ARRANGEMENT_KEYS } from "@/lib/canvasArrangement";
`,
);

writeHook("useChartShortcuts", 1355, 1486);

writeHook(
  "useGpuRenderers",
  1488,
  3940,
  `import { acquireSharedGpuDevice } from "@/lib/gpuDevice";
import { isWebGpuDrawableScene, isWebGpuGlobeKind } from "@/lib/gpuScenes";
import { isGeoFamilyKind, pickAtlasKind, type AtlasKind } from "@/lib/geoMaps";
import { loadAtlas } from "@/lib/geoAtlas";
import { stageDpr } from "./constants";
import { useLoomStore } from "@/lib/store";
import { playChartSwap } from "@/lib/motion";
import { notifyChartPainted } from "@/lib/chartPaintSignal";
import { resolveGpuScatterPads } from "@/lib/chartPlotRect";
import { densityAwarePointMarks } from "@/lib/chartLayout";
import { DEFAULT_PAD } from "@/lib/canvasCharts/shared";
import { hexToRgb01, getThemeUiColors } from "@/lib/chartPalettes";
import { scaleDomain, scaleY, type YScaleKind } from "@/lib/dsTransforms";
import { drawAxisFieldLabels, drawAxisFrame, drawChartSourceFootnote, drawChartTitleBlock } from "@/lib/chartLooks";
import { resolveChartPad } from "@/lib/chartLayout";
import { groupChartChannels } from "@/lib/channelGroups";
import { buildCategoricalLegendEntries, drawLegend } from "@/lib/chartLegend";
import { drawAxisTicks, drawGridLines } from "@/lib/canvasCharts/primitives";
import { plotOf } from "@/lib/canvasCharts/plumbing";
import { drawFireflyChrome, extractGpuScenePoints as extractScenePts } from "@/lib/gpuScenes";
import { FOOTNOTE_BAND_PX } from "@/lib/chartLayout";
import type { ChartRenderOpts } from "@/lib/chartRenderTypes";
`,
);

writeHook(
  "useScatterInteractions",
  1921,
  2705,
  `import { useLoomStore } from "@/lib/store";
import type { GPUScatterPoint } from "@/lib/webgpu";
import { groupChartChannels } from "@/lib/channelGroups";
import { chartNumber } from "@/lib/chartNumbers";
import { gpuCategoryIndex } from "@/lib/gpuPalette";
import { densityPointBudget } from "@/lib/chartStagePixels";
import { subsampleRowsForDensity } from "@/lib/chartLayout";
import { scaleDomain, scaleY, invScaleY, type YScaleKind } from "@/lib/dsTransforms";
import { scatterYDomain, pointInPolygon } from "@/lib/canvasCharts/shared";
import { allowedRowIndices, mergeChartTooltip, pickCanvasTooltipRowIndex, pickHitTarget, projectRowForTooltip, resolveTooltipFieldNames, rowForHitTarget, rowMatchesTooltipLink, type HitTarget } from "@/lib/chartTooltip";
import { sameMark, markRefForRow, markRefForHit, findHitForMark, type MarkRef } from "@/lib/markFocus";
import { pickChartChromeRegion, chromeSectionFor } from "@/lib/chartChromeLink";
import { cubeCellTooltip, dataCubeChartView, pickDataCubeCell } from "@/lib/dataCube";
import { keyboardNavigableHits, nextMarkIndex } from "@/lib/chartMarkKeyboard";
import { calloutLines, drawMarkFocus, drawPinnedCallout, markFocusStyle } from "@/lib/markFocus";
import { chartFontStack } from "@/lib/fontCatalog";
import { stageDpr } from "./constants";
`,
);

console.log("Extracted useChartExport, useChartShortcuts, useGpuRenderers, useScatterInteractions");
