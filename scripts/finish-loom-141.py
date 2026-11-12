#!/usr/bin/env python3
"""Mechanically split ChartView.tsx for LOOM-141."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src/components/chartView/.ChartView.source.tsx"
OUT = ROOT / "src/components/chartView"
CHART = ROOT / "src/components/ChartView.tsx"

lines = SRC.read_text().splitlines(keepends=True)


def extract(start: int, end: int) -> str:
    return "".join(lines[start - 1 : end])


def indent(body: str, n: int = 2) -> str:
    pad = " " * n
    return "".join(pad + ln if ln.strip() else ln for ln in body.splitlines(keepends=True))


# --- write hook files (body uses closure vars; ChartView passes `d` alias) ---
def write_hook(name: str, start: int, end: int, header: str) -> None:
    body = extract(start, end)
    content = f"""// LOOM-141 — from ChartView.tsx:{start}-{end}
// @ts-nocheck
{header}
import type {{ ChartViewRuntime }} from "./chartViewRuntime";

export function {name}(d: ChartViewRuntime): void {{
{indent(body)}
}}
"""
    (OUT / f"{name}.ts").write_text(content)


write_hook("useChartShortcuts", 1355, 1486, 'import { useEffect } from "react";')
write_hook(
    "useChartExport",
    1660,
    1895,
    'import { useEffect } from "react";',
)
write_hook(
    "useGpuRenderers",
    1488,
    3940,
    'import { useEffect, useRef } from "react";',
)
write_hook(
    "useScatterInteractions",
    1921,
    2705,
    'import { useCallback, useEffect, useMemo, useRef, useState } from "react";',
)

# useChartStage: refs + resize + frame-related (selected ranges)
stage_parts = [
    (759, 912),
    (1567, 1631),
]
stage_body = "".join(extract(a, b) for a, b in stage_parts)
(OUT / "useChartStage.ts").write_text(
    f"""// LOOM-141 — stage refs, sizing, resize observers
// @ts-nocheck
import {{ useCallback, useEffect, useMemo, useRef, useState }} from "react";
import type {{ ChartViewRuntime }} from "./chartViewRuntime";

export function useChartStage(d: ChartViewRuntime): void {{
{indent(stage_body)}
}}
"""
)

# Suggestion rail JSX block
rail_start, rail_end = 3967, 4175
rail_body = extract(rail_start, rail_end)
(OUT / "SuggestionRail.tsx").write_text(
    f"""// LOOM-141 — Ideas / suggestions rail
// @ts-nocheck
"use client";
import type {{ ChartViewRuntime }} from "./chartViewRuntime";

export function SuggestionRail(d: ChartViewRuntime) {{
{indent(rail_body, 2)}
  return null;
}}
"""
)

# ChartToolbar desktop block from source
toolbar_body = extract(4961, 5033)
(OUT / "ChartToolbar.tsx").write_text(
    f"""// LOOM-141 — Desktop chart tool rail
// @ts-nocheck
"use client";
import type {{ ChartViewRuntime }} from "./chartViewRuntime";

export function ChartToolbar(d: ChartViewRuntime) {{
{indent(toolbar_body, 2)}
  return null;
}}
"""
)

tooltip_body = extract(5037, 5072)
(OUT / "ChartTooltip.tsx").write_text(
    f"""// LOOM-141 — Hover tooltip card
// @ts-nocheck
"use client";
import type {{ ChartViewRuntime }} from "./chartViewRuntime";

export function ChartTooltip(d: ChartViewRuntime) {{
{indent(tooltip_body, 2)}
  return null;
}}
"""
)

# Runtime type placeholder
(OUT / "chartViewRuntime.ts").write_text(
    """// Shared runtime bag for LOOM-141 hooks (intentionally loose during split).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChartViewRuntime = Record<string, any>;
"""
)

# Build new ChartView by removing extracted ranges (reverse order)
remove = [
    (5037, 5072),
    (4961, 5033),
    (3967, 4175),
    (2707, 3598),
    (1921, 2705),
    (1660, 1895),
    (1488, 1631),  # gpu through canvas resize; keep stage parts? we duplicated in useChartStage
    (1355, 1486),
    (122, 147),
]
new_lines = lines[:]
for start, end in sorted(remove, reverse=True):
    new_lines = new_lines[: start - 1] + new_lines[end:]

# Insert imports after "use client";
insert_at = next(i for i, ln in enumerate(new_lines) if '"use client"' in ln) + 2
imports = [
    'import { GPU_GLOBE_ENABLED, FRAMED_KINDS, OWN_FRAME_KINDS, SYMBOL_SERIES_KINDS, stageDpr } from "@/components/chartView/constants";\n',
    'import { useChartPaint } from "@/components/chartView/useChartPaint";\n',
    'import { useChartStage } from "@/components/chartView/useChartStage";\n',
    'import { useGpuRenderers } from "@/components/chartView/useGpuRenderers";\n',
    'import { useScatterInteractions } from "@/components/chartView/useScatterInteractions";\n',
    'import { useChartExport } from "@/components/chartView/useChartExport";\n',
    'import { useChartShortcuts } from "@/components/chartView/useChartShortcuts";\n',
    'import { SuggestionRail } from "@/components/chartView/SuggestionRail";\n',
    'import { ChartToolbar } from "@/components/chartView/ChartToolbar";\n',
    'import { ChartTooltip } from "@/components/chartView/ChartTooltip";\n',
    'import type { ChartViewRuntime } from "@/components/chartView/chartViewRuntime";\n',
]
new_lines[insert_at:insert_at] = imports

# Insert hook calls before "// --- Empty states ---"
hook_block = """
  const chartRuntime = {
    selectedFile, sampleRows, chartRecs, activeChart, setActiveChart, setPanelTab, columnStats,
    chartVisualOverrides, savedChartVisualOverrides, aiSuggestionReason, chartTitleOverrides, setChartTitleOverride,
    setPngExportHandler, setSvgExportHandler, setSvgExportLabel, vegaSpec, smartResults, appSettings,
    setSelectedRowIndices, setToast, chartAnnotations, setHoveredRowIndex, tooltipLink, setTooltipLink,
    pinnedTooltips, togglePinnedTooltip, setPinnedTooltips, customRefLines, chartInteractionMode, setChartInteractionMode,
    crosshairPos, setCrosshairPos, lassoPoints, setLassoPoints, barStackMode, connectScatterTrail, showMarginals,
    selectedRowIndices, rulerPins, setRulerPins, setPromptDialog, querySql, createStoryDashboard, setDashboardsExpanded,
    startDeepScan, chartChromeFocus, setChartChromeFocus, setChartPanelSection, setPanelOpen, setChartVisualOverrides,
    inspectingFilePath, suggestionsRailOpen, setSuggestionsRailOpen, tableColumnFilters, tableFilterRowIndices,
    tableSortColumn, tableSortDir, viewTimeField, viewTimeWindow, applyBrushSelection, monitorLines, chartMonitorCount,
    reducedMotion, effectiveTheme, isMobile, coarsePointer, panelOpen, readoutsObscured, arranging, setArranging,
    arrangeReady, setArrangeReady, finishArranging, toggleArranging, arrangementPreview, setArrangementPreview,
    arrangementLayout, setArrangementLayout, commitArrangement, resetArrangement, shellMode, liveEdit, hostSize, setHostSize,
    socialExportTarget, socialExportReady, devicePreset, hostIsNarrow, forceFillStage, chartAspect, chartDevice, openChartEditor,
    effectiveColorField, colors, continuousStops, opacity, pointSize, chartColorInfo, chartSampleRows, chartFootnoteText,
    saveActiveChartView, chartFontFamily, footnoteOpts, themeUi, containerSize, setContainerSize, containerWidth, isCompact,
    chartRenderOpts, renderIssue, sampleHonestyLabel, densityHint, applyClarity, aggregationHint, applyWorkingChart,
    canvasRef, canvas2DRef, axesOverlayRef, stageHostRef, containerRef, chartFrameMax, chartFrameSize, rendererRef,
    sceneRendererRef, cubeRendererRef, geoAtlasBundle, setGeoAtlasBundle, cubeHover, setCubeHover, chromeHover, setChromeHover,
    cubeSlice, setCubeSlice, cubeTableOpen, setCubeTableOpen, cubeTransitionRef, prevCubeRef, cubeAnim, setCubeAnim,
    cubeFrameRef, gpuReady, setGpuReady, sceneOrbit, setSceneOrbit, sceneOrbitDragRef, scenePinchRef, pointerDownAtRef,
    previewCaptureActive, forceCanvasCapture, useWebGPUScatter, useWebGpuScene, useWebGpuGlobe, useWebGpuCube, dataCube,
    pivotTable, applyCubeAxes, cubeAxes, swapCubeAxes, rotateCubeAxes, replaceCubeAxis, orbitEnabled, canvasSized, setCanvasSized,
    exportStateRef, sampleRowsRef, suggestionsExpanded, setSuggestionsExpanded, hideSuggestionsRail, showSuggestionsRail,
    getEffectiveScatterBounds, selectRecommendation, refreshKey, setRefreshKey, aiSuggesting, setAiSuggesting, scatterTooltip,
    setScatterTooltip, chartTooltip, setChartTooltip, scatterTooltipRef, chartTooltipRef, scatterView, setScatterView,
    scatterViewMoved, brushRect, setBrushRect, brushStartRef, brushRectRef, scatterDataRef, canvas2DHitRef, titleEditing,
    setTitleEditing, titleEditValue, setTitleEditValue, whyReasonOpen, setWhyReasonOpen, chartDataTableOpen, setChartDataTableOpen,
    keyboardMarkIndex, setKeyboardMarkIndex, markAnnouncement, setMarkAnnouncement, announceKeyStepRef, focusLayerRef, hoverMark,
    setHoverMark, hitsVersion, setHitsVersion, pinnedBoxesRef, chartDrawError, setChartDrawError, fontEpoch, setFontEpoch,
    bestSuggestion, topSuggestions, suggestCycleRef, tableName, displayTitle, chartA11yLabel, loadingSample, stageStatus,
    stageLiveMessage, dataTableRows, handleSuggestChart, handleTellStory, handleSuggestWithAI, handleTitleStartEdit, handleTitleSave,
    handleTitleKeyDown, handleRefresh, tooltipPresentation, stickyTooltip, hoverTip, footerBandPx, markIdentity, scatterHitForRow,
    resolveMarkHit, pinMark, hoverRef, resolvedPins, handleScatterPointer, handleScatterPointerLeave, handleCanvas2DPointerMove,
    handleMarkKeyDown, handleCanvas2DPointerLeave, panStartRef, overlayRef, isPanning, setIsPanning, pinchRef, lastPointerTypeRef,
    wasDrag, touchDistance, applyPinchZoom, handleScatterWheel, handleScatterMouseDown, handleScatterMouseMove, handleScatterMouseUp,
    extractScatterData, gpuScatterPack, refs: { canvasRef, canvas2DRef, axesOverlayRef, focusLayerRef, stageHostRef, containerRef,
    overlayRef, rendererRef, sceneRendererRef, cubeRendererRef, scatterDataRef, canvas2DHitRef, cubeFrameRef, cubeTransitionRef,
    exportStateRef, sampleRowsRef, scatterTooltipRef, chartTooltipRef, brushStartRef, brushRectRef, panStartRef, pinchRef,
    pointerDownAtRef, sceneOrbitDragRef, scenePinchRef, lastPointerTypeRef, pinnedBoxesRef, suggestCycleRef, prevChartSwapKeyRef: { current: null },
    chartSwapAnimsRef: { current: [] }, arrangePanelWasOpen: { current: false }, prevCubeRef, announceKeyStepRef },
  } satisfies ChartViewRuntime;

  useChartStage(chartRuntime);
  useChartShortcuts(chartRuntime);
  useChartExport(chartRuntime);
  useGpuRenderers(chartRuntime);
  useScatterInteractions(chartRuntime);
  useChartPaint({
    refs: chartRuntime.refs,
    canvasSized,
    activeChart: activeChart!,
    sampleRows: sampleRows!,
    chartSampleRows,
    chartFootnoteText,
    chartColorInfo,
    footnoteOpts,
    gpuReady,
    useWebGPUScatter,
    useWebGpuScene,
    useWebGpuGlobe,
    useWebGpuCube,
    extractScatterData,
    continuousStops,
    forceCanvasCapture,
    socialExportReady,
    getEffectiveScatterBounds,
    scatterView,
    chartRenderOpts,
    chartVisualOverrides,
    chartTitleOverrides,
    smartResults,
    themeUi,
    colors,
    opacity,
    pointSize,
    isCompact,
    isMobile,
    containerSize,
    sceneOrbit,
    dataCube,
    cubeHover,
    cubeSlice,
    cubeTableOpen,
    cubeAnim,
    connectScatterTrail,
    showMarginals,
    customRefLines,
    monitorLines,
    geoAtlasBundle,
    reducedMotion,
    fontEpoch,
    chartFontFamily,
    effectiveTheme,
    refreshKey,
    setHitsVersion,
    setChartDrawError,
    setCubeAnim,
  });

"""

for i, ln in enumerate(new_lines):
    if "// --- Empty states ---" in ln:
        new_lines.insert(i, hook_block)
        break

CHART.write_text("".join(new_lines))
print("Wrote ChartView.tsx lines:", len(new_lines))
