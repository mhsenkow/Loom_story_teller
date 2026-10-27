// Main chart stage layout — canvases, overlays, status bar (LOOM-141).
// @ts-nocheck
"use client";
import { ViewCohortBar } from "@/components/ViewCohortBar";
import { ScatterModeBar, ChartToolRail } from "./ChartToolbar";
import { ChartHoverTooltip, CrosshairTooltip } from "./ChartTooltip";
import { CanvasArrangeOverlay } from "@/components/CanvasArrangeOverlay";
import { DataCubePivotBar, DataCubePivotTable } from "@/components/DataCubePivot";
import { FOOTNOTE_BAND_PX } from "@/lib/chartLayout";
import { ARRANGE_PLOT_KINDS, hasCanvasArrangement } from "@/lib/canvasArrangement";
import { chromeHighlightRect } from "@/lib/chartChromeLink";
import { formatAxisValue } from "@/lib/chartAxes";
import { aspectLabel } from "@/lib/chartViewport";
import { chartFontStack } from "@/lib/fontCatalog";
import { chartTypeRamp } from "@/lib/chartType";
import { CHART_KIND_CATALOG } from "@/lib/chartKindSearch";
import { sameMark } from "@/lib/markFocus";
import { useLoomStore } from "@/lib/store";
import type { ChartViewRuntime } from "./chartViewRuntime";


export function ChartStage({ d }: { d: ChartViewRuntime }) {
  const {
    socialExportReady,
    liveEdit,
    suggestionsExpanded,
    titleEditing,
    titleEditValue,
    setTitleEditValue,
    handleTitleSave,
    handleTitleKeyDown,
    displayTitle,
    activeChart,
    isMobile,
    chartInteractionMode,
    densityHint,
    setChartInteractionMode,
    applyClarity,
    stageHostRef,
    chartAspect,
    socialExportTarget,
    arranging,
    resetArrangement,
    finishArranging,
    stageLiveMessage,
    markAnnouncement,
    loadingSample,
    chartDrawError,
    chartDataTableOpen,
    dataTableRows,
    setChartDataTableOpen,
    chartToolRailProps,
    containerRef,
    chartA11yLabel,
    handleMarkKeyDown,
    orbitEnabled,
    sceneOrbit,
    sceneOrbitDragRef,
    setSceneOrbit,
    cubeHover,
    setCubeSlice,
    scenePinchRef,
    touchDistance,
    chartFrameSize,
    themeUi,
    canvasRef,
    canvas2DRef,
    axesOverlayRef,
    focusLayerRef,
    useWebGPUScatter,
    useWebGpuScene,
    useWebGpuGlobe,
    useWebGpuCube,
    renderIssue,
    applyWorkingChart,
    setPanelTab,
    overlayRef,
    isPanning,
    handleScatterMouseMove,
    handleScatterPointerLeave,
    brushStartRef,
    panStartRef,
    setIsPanning,
    setCrosshairPos,
    handleScatterMouseDown,
    handleScatterMouseUp,
    pinchRef,
    applyPinchZoom,
    scatterDataRef,
    setScatterView,
    lastPointerTypeRef,
    wasDrag,
    scatterTooltip,
    chartTooltip,
    chartFootnoteText,
    chartColorInfo,
    pinMark,
    hoverMark,
    handleCanvas2DPointerMove,
    pointerDownAtRef,
    handleCanvas2DPointerLeave,
    canvas2DHitRef,
    chromeHover,
    chartChromeFocus,
    dataCube,
    previewCaptureActive,
    chartFontFamily,
    chartRenderOpts,
    continuousStops,
    chartVisualOverrides,
    cubeSlice,
    cubeTableOpen,
    pivotTable,
    swapCubeAxes,
    rotateCubeAxes,
    replaceCubeAxis,
    setCubeTableOpen,
    setCubeHover,
    setChartTooltip,
    containerSize,
    brushRect,
    lassoPoints,
    crosshairPos,
    sampleRows,
    footerBandPx,
    rulerPins,
    setRulerPins,
    pinnedTooltips,
    setPinnedTooltips,
    scatterViewMoved,
    scatterView,
    getEffectiveScatterBounds,
    chartAnnotations,
    arrangementPreview,
    setArrangementPreview,
    arrangeReady,
    arrangementLayout,
    commitArrangement,
    chartFrameMax,
    showMarginals,
    readoutsObscured,
    tooltipPresentation,
    hoverTip,
    tooltipLink,
    hoverRef,
    stickyTooltip,
    setScatterTooltip,
    setHoveredRowIndex,
    appSettings,
    chartDevice,
    sampleHonestyLabel,
    aggregationHint,
    setTooltipLink,
  } = d;

  return (
      <div
        className={`
          flex flex-col min-w-0 overflow-hidden transition-[width,height] duration-200 ease-out
          ${suggestionsExpanded
            ? "w-0 h-0 flex-shrink-0 overflow-hidden pointer-events-none"
            : isMobile
              ? "order-1 flex-1 min-h-0"
              : "flex-1"}
        `}
      >
        {!socialExportReady && !liveEdit && <ViewCohortBar surface="chart" />}
        {!socialExportReady && titleEditing && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-loom-border bg-loom-surface/60">
            <input
              type="text"
              value={titleEditValue}
              onChange={(e) => setTitleEditValue(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={handleTitleKeyDown}
              className="flex-1 min-w-0 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-loom-accent focus:border-loom-accent"
              placeholder="Chart title"
              autoFocus
              aria-label="Chart title"
            />
          </div>
        )}
        {!socialExportReady && activeChart?.kind === "scatter" && (
          <ScatterModeBar
            isMobile={isMobile}
            chartInteractionMode={chartInteractionMode}
            densityHint={densityHint}
            onSetMode={setChartInteractionMode}
            onApplyClarity={applyClarity}
          />
        )}

        <div
          ref={stageHostRef}
          className={`flex-1 relative min-h-0 min-h-[200px] flex items-center justify-center ${socialExportReady ? "overflow-auto" : ""}`}
          style={{
            // Letterbox matte — reads as a stage, not a broken black void
            backgroundColor: socialExportReady
              ? "var(--loom-bg)"
              : "color-mix(in srgb, var(--loom-bg) 88%, var(--loom-border))",
            backgroundImage: socialExportReady
              ? "none"
              : "radial-gradient(color-mix(in srgb, var(--loom-border) 55%, transparent) 0.6px, transparent 0.6px)",
            backgroundSize: "10px 10px",
          }}
        >
          {arranging && !socialExportReady && !socialExportTarget && activeChart && (
            <div
              className="absolute top-2 left-1/2 z-30 -translate-x-1/2 flex max-w-[min(36rem,calc(100%-1rem))] flex-wrap items-center justify-center gap-1.5 rounded-lg border border-loom-accent/40 bg-loom-surface/95 px-2 py-1 shadow-sm backdrop-blur-md"
              role="status"
              aria-live="polite"
            >
              <span className="text-2xs font-medium text-loom-text px-1">Arranging</span>
              <span className="hidden sm:inline text-2xs text-loom-muted">
                Drag · resize handles · Esc done · Alt skips snap
              </span>
              <button
                type="button"
                className="loom-btn-ghost min-h-8 px-2 text-2xs"
                title="Restore automatic frame, plot, title and legend placement"
                onClick={resetArrangement}
              >
                Auto layout
              </button>
              <button
                type="button"
                className="min-h-8 px-2.5 text-2xs rounded-md border border-loom-accent/50 bg-loom-accent/15 text-loom-text"
                onClick={finishArranging}
              >
                Done
              </button>
            </div>
          )}
          <div
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          >
            {stageLiveMessage}
          </div>
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {markAnnouncement}
          </div>
          <p id="loom-chart-keys-hint" className="sr-only">
            Arrow keys move between marks, Enter pins, Escape clears.
          </p>
          {loadingSample && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-loom-bg/70" role="status">
              <p className="text-sm text-loom-text">Loading chart data…</p>
            </div>
          )}
          {chartDrawError && (
            <div className="absolute top-2 left-2 right-2 z-20 rounded border border-loom-warning/40 bg-loom-warning/10 px-3 py-2 text-2xs text-loom-text" role="alert">
              {chartDrawError}
            </div>
          )}
          {chartDataTableOpen && !socialExportReady && (
            <div
              className="absolute z-20 left-3 right-3 sm:right-16 bottom-3 max-h-[min(42%,18rem)] overflow-auto rounded-lg border border-loom-border bg-[color-mix(in_srgb,var(--loom-surface)_94%,transparent)] backdrop-blur-md shadow-lg"
              role="region"
              aria-label="Chart data table"
            >
              <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-loom-border/80 bg-loom-surface/90">
                <span className="text-2xs font-medium text-loom-text truncate">
                  Chart data{dataTableRows.length ? ` · ${dataTableRows.length}` : ""}
                </span>
                <button
                  type="button"
                  className="text-loom-muted hover:text-loom-text text-xs px-1.5 py-0.5 rounded"
                  onClick={() => setChartDataTableOpen(false)}
                  aria-label="Close data table"
                >
                  ×
                </button>
              </div>
              {dataTableRows.length === 0 ? (
                <p className="px-3 py-3 text-2xs text-loom-muted leading-relaxed">
                  No mark summaries yet — wait for the chart to finish painting, then try Refresh.
                </p>
              ) : (
                <table className="w-full text-2xs font-mono text-loom-text">
                  <caption className="sr-only">{displayTitle} data</caption>
                  <thead>
                    <tr className="border-b border-loom-border/60 text-loom-muted">
                      {dataTableRows[0]!.columns.map((c) => (
                        <th key={c} scope="col" className="px-2 py-1 text-left font-medium whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataTableRows.map((row) => (
                      <tr key={row.key} className="border-b border-loom-border/40 last:border-0">
                        {row.cells.map((cell, ci) => (
                          <td key={`${row.key}-${ci}`} className="px-2 py-1 whitespace-nowrap max-w-[10rem] truncate">
                            {cell == null ? "—" : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          <div
            className={`relative flex max-w-full max-h-full ${
              isMobile ? "flex-col items-stretch gap-1.5" : "flex-row items-start gap-1.5"
            }`}
          >
          {!socialExportReady && activeChart && isMobile && !liveEdit && (
            <ChartToolRail orientation="horizontal" {...chartToolRailProps} />
          )}
          <div
            ref={containerRef}
            // Not role=img: the stage holds real buttons, and arrow keys must reach handleMarkKeyDown.
            role={arranging ? "group" : activeChart && activeChart.kind !== "scatter" ? "application" : "group"}
            aria-roledescription="chart"
            aria-describedby="loom-chart-keys-hint"
            aria-label={chartA11yLabel}
            tabIndex={activeChart && activeChart.kind !== "scatter" ? 0 : undefined}
            onKeyDown={(e) => {
              if (activeChart?.kind === "scatter") return;
              handleMarkKeyDown(e);
            }}
            className={`relative overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-loom-accent/60 ${
              !socialExportReady
                ? "rounded-lg border border-loom-border/90 shadow-[0_1px_0_color-mix(in_srgb,var(--loom-border)_40%,transparent),0_18px_40px_-28px_rgba(0,0,0,0.45)]"
                : ""
            } ${orbitEnabled ? "cursor-grab active:cursor-grabbing" : ""}`}
            onPointerDown={(e) => {
              if (!orbitEnabled || arranging) return;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              sceneOrbitDragRef.current = {
                x: e.clientX,
                y: e.clientY,
                yaw: sceneOrbit.yaw,
                pitch: sceneOrbit.pitch,
              };
            }}
            onPointerMove={(e) => {
              const drag = sceneOrbitDragRef.current;
              if (!drag) return;
              const dx = e.clientX - drag.x;
              const dy = e.clientY - drag.y;
              setSceneOrbit((o) => ({
                ...o,
                yaw: drag.yaw + dx * 0.008,
                pitch: Math.max(-1.2, Math.min(1.2, drag.pitch + dy * 0.008)),
              }));
            }}
            onPointerUp={(e) => {
              const drag = sceneOrbitDragRef.current;
              sceneOrbitDragRef.current = null;
              // A click (not a drag) on the cube slices to that voxel's depth layer; empty space clears.
              if (activeChart?.kind === "dataCube" && drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) {
                const hz = cubeHover?.zi;
                setCubeSlice((s) => (hz == null ? null : s === hz ? null : hz));
              }
            }}
            onPointerCancel={() => {
              sceneOrbitDragRef.current = null;
            }}
            onWheel={(e) => {
              if (!orbitEnabled || arranging) return;
              e.preventDefault();
              e.stopPropagation();
              setSceneOrbit((o) => ({
                ...o,
                zoom: Math.max(0.4, Math.min(3, o.zoom * (e.deltaY > 0 ? 0.92 : 1.08))),
              }));
            }}
            onTouchStart={(e) => {
              if (!orbitEnabled || e.touches.length !== 2) return;
              sceneOrbitDragRef.current = null;
              const [a, b] = [e.touches[0]!, e.touches[1]!];
              scenePinchRef.current = {
                dist: touchDistance(a, b),
                zoom: sceneOrbit.zoom,
              };
            }}
            onTouchMove={(e) => {
              if (!orbitEnabled || e.touches.length !== 2 || !scenePinchRef.current) return;
              e.preventDefault();
              const [a, b] = [e.touches[0]!, e.touches[1]!];
              const dist = touchDistance(a, b);
              if (scenePinchRef.current.dist < 1) return;
              const factor = dist / scenePinchRef.current.dist;
              const base = scenePinchRef.current.zoom;
              setSceneOrbit((o) => ({
                ...o,
                zoom: Math.max(0.4, Math.min(3, base * factor)),
              }));
            }}
            onTouchEnd={() => {
              scenePinchRef.current = null;
            }}
            style={{
              width: chartFrameSize.width,
              height: chartFrameSize.height,
              maxWidth: socialExportTarget ? undefined : "100%",
              maxHeight: socialExportTarget ? undefined : "100%",
              flexShrink: 0,
              background: themeUi.bg,
            }}
          >
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{
              zIndex: useWebGPUScatter || useWebGpuScene || useWebGpuGlobe || useWebGpuCube ? 1 : 0,
              // Default WebGPU clear is near-black; hide when Canvas 2D owns the frame
              // so aspect/device resizes never flash a black slab through a cleared 2D layer.
              visibility: useWebGPUScatter || useWebGpuScene || useWebGpuGlobe || useWebGpuCube ? "visible" : "hidden",
              pointerEvents: useWebGPUScatter || useWebGpuScene || useWebGpuGlobe || useWebGpuCube ? "auto" : "none",
            }}
          />
          <canvas
            ref={canvas2DRef}
            data-loom-chart-canvas2d
            className="absolute inset-0 w-full h-full"
            style={{ zIndex: useWebGPUScatter || useWebGpuScene || useWebGpuCube ? 0 : 1 }}
          />
          <canvas
            ref={axesOverlayRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: useWebGPUScatter || useWebGpuCube || useWebGpuScene || useWebGpuGlobe ? 2 : 0 }}
          />
          {/* Mark focus + pinned readouts (markFocus.ts) — above every chart layer, in exports too. */}
          <canvas
            ref={focusLayerRef}
            data-loom-focus-layer
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: 3 }}
          />
          {socialExportReady &&
            (chartAspect === "9:16" || socialExportTarget?.presetId === "stories") && (
            <div className="absolute inset-0 z-[5] pointer-events-none" aria-hidden>
              <div
                className="absolute inset-x-0 top-0 border-b border-dashed border-amber-400/40 bg-amber-400/10"
                style={{ height: "14%" }}
              />
              <div
                className="absolute inset-x-0 bottom-0 border-t border-dashed border-amber-400/40 bg-amber-400/10"
                style={{ height: "20%" }}
              />
              <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[9px] font-mono text-amber-500/80 bg-loom-bg/70 px-1 rounded">
                Stories safe zone
              </span>
            </div>
          )}
          {renderIssue && activeChart && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-loom-bg/85 backdrop-blur-sm">
              <div className="loom-card max-w-md w-full p-4 space-y-3 border border-loom-accent/30 shadow-lg">
                <p className="text-sm font-semibold text-loom-text">{renderIssue.title}</p>
                <p className="text-2xs text-loom-muted leading-relaxed">{renderIssue.message}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={applyWorkingChart}
                    className="loom-btn-primary text-2xs py-1.5 px-3"
                  >
                    Pick a working suggestion
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPanelTab("chart");
                      if (!useLoomStore.getState().panelOpen) useLoomStore.getState().togglePanel();
                    }}
                    className="text-2xs py-1.5 px-3 rounded border border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-text"
                  >
                    Open Encoding
                  </button>
                </div>
              </div>
            </div>
          )}
          {activeChart?.kind === "scatter" && (
            <div
              ref={overlayRef}
              className="absolute inset-0 w-full h-full outline-none focus-visible:ring-2 focus-visible:ring-loom-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-loom-bg"
              tabIndex={0}
              role="application"
              aria-label="Scatter chart. Two-finger scroll pans, pinch or mouse wheel zooms toward cursor. Arrows pan, plus and minus zoom, zero resets. V pan, C crosshair, G lasso. Shift-drag to brush."
              style={{
                zIndex: 3,
                touchAction: "none",
                cursor:
                  chartInteractionMode === "crosshair"
                    ? "crosshair"
                    : chartInteractionMode === "lasso"
                      ? "crosshair"
                      : isPanning
                        ? "grabbing"
                        : "grab",
              }}
              onMouseMove={handleScatterMouseMove}
              onMouseLeave={() => {
                handleScatterPointerLeave();
                if (!brushStartRef.current) {
                  panStartRef.current = null;
                  setIsPanning(false);
                  setCrosshairPos(null);
                }
              }}
              onMouseDown={handleScatterMouseDown}
              onMouseUp={handleScatterMouseUp}
              onTouchStart={(e) => {
                if (e.touches.length === 2) {
                  panStartRef.current = null;
                  setIsPanning(false);
                  const [a, b] = [e.touches[0], e.touches[1]];
                  pinchRef.current = {
                    dist: touchDistance(a, b),
                    scale: scatterView.scale,
                    midX: (a.clientX + b.clientX) / 2,
                    midY: (a.clientY + b.clientY) / 2,
                  };
                } else if (e.touches.length === 1 && chartInteractionMode === "pan") {
                  const t = e.touches[0];
                  panStartRef.current = { x: t.clientX, y: t.clientY };
                  setIsPanning(true);
                }
              }}
              onTouchMove={(e) => {
                if (e.touches.length === 2 && pinchRef.current) {
                  e.preventDefault();
                  const [a, b] = [e.touches[0], e.touches[1]];
                  const dist = touchDistance(a, b);
                  if (pinchRef.current.dist < 1) return;
                  const factor = dist / pinchRef.current.dist;
                  const midX = (a.clientX + b.clientX) / 2;
                  const midY = (a.clientY + b.clientY) / 2;
                  applyPinchZoom(midX, midY, pinchRef.current.scale * factor, pinchRef.current.scale);
                } else if (e.touches.length === 1 && panStartRef.current) {
                  e.preventDefault();
                  const t = e.touches[0];
                  const dx = t.clientX - panStartRef.current.x;
                  const dy = t.clientY - panStartRef.current.y;
                  panStartRef.current = { x: t.clientX, y: t.clientY };
                  const d = scatterDataRef.current;
                  if (d) {
                    const cw = d.plot ? d.plot.right - d.plot.left : d.w - 2 * d.pad;
                    const ch = d.plot ? d.plot.bottom - d.plot.top : d.h - 2 * d.pad;
                    const dataPerPxX = cw > 0 ? (d.xMax - d.xMin) / cw : 0;
                    const dataPerPxY = ch > 0 ? (d.yMax - d.yMin) / ch : 0;
                    setScatterView((v) => ({
                      ...v,
                      panX: v.panX + (dx * dataPerPxX) / v.scale,
                      panY: v.panY - (dy * dataPerPxY) / v.scale,
                    }));
                  }
                }
              }}
              onTouchEnd={() => {
                if (pinchRef.current) pinchRef.current = null;
                panStartRef.current = null;
                setIsPanning(false);
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                setScatterView({ scale: 1, panX: 0, panY: 0 });
              }}
              onPointerDown={(e) => {
                lastPointerTypeRef.current = e.pointerType;
              }}
              onClick={(e) => {
                if (lastPointerTypeRef.current === "touch" || wasDrag(e)) return;
                if (chartInteractionMode === "pan" && scatterTooltip && activeChart) {
                  pinMark(hoverMark, scatterTooltip);
                }
              }}
            />
          )}
          {activeChart && activeChart.kind !== "scatter" && (
            <div
              className="absolute inset-0 w-full h-full"
              // Pointer events + touch-action:none let a finger drag scrub the tooltip
              // (and orbit 3D scenes) instead of the browser claiming the gesture.
              style={{ zIndex: 2, cursor: activeChart.kind === "dataCube" ? "grab" : "crosshair", touchAction: "none" }}
              onPointerMove={(e) => handleCanvas2DPointerMove(e, "move")}
              onPointerDown={(e) => {
                lastPointerTypeRef.current = e.pointerType;
                pointerDownAtRef.current = { x: e.clientX, y: e.clientY, brush: false };
                handleCanvas2DPointerMove(e, "down");
              }}
              onClick={(e) => {
                // Click pins the hovered mark (touch pins from the readout's Pin button).
                if (lastPointerTypeRef.current === "touch" || wasDrag(e)) return;
                pinMark(hoverMark, chartTooltip);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType !== "touch") handleCanvas2DPointerLeave();
              }}
              aria-hidden
            />
          )}
          {(() => {
            const hit = canvas2DHitRef.current;
            const outline = chromeHover ?? chartChromeFocus?.target ?? null;
            if (!outline || !hit || hit.w <= 0 || hit.h <= 0) return null;
            const r = chromeHighlightRect(outline, hit.w, hit.h, hit.pad);
            if (!r) return null;
            return (
              <div
                className="absolute pointer-events-none rounded-md border-2 border-loom-accent/70 bg-loom-accent/10 transition-[left,top,width,height,opacity] duration-150 z-[3]"
                style={{
                  left: `${(r.x / hit.w) * 100}%`,
                  top: `${(r.y / hit.h) * 100}%`,
                  width: `${(r.w / hit.w) * 100}%`,
                  height: `${(r.h / hit.h) * 100}%`,
                }}
                aria-hidden
              />
            );
          })()}
          {activeChart?.kind === "dataCube" && dataCube && !socialExportReady && !previewCaptureActive && (
            <>
              <DataCubePivotBar
                fontFamily={chartFontFamily}
                axisFontSize={chartRenderOpts.axisFontSize}
                cube={dataCube}
                ramp={continuousStops}
                showLegend={chartVisualOverrides.legendPosition !== "none"}
                slice={cubeSlice}
                tableOpen={cubeTableOpen}
                onSlice={setCubeSlice}
                onToggleTable={() => setCubeTableOpen((o) => !o)}
                onSwap={swapCubeAxes}
                onRotate={rotateCubeAxes}
                onReplace={replaceCubeAxis}
              />
              {cubeTableOpen && pivotTable && (
                <DataCubePivotTable
                  fillStage={isMobile && containerSize.h < 440}
                  fontFamily={chartFontFamily}
                  axisFontSize={chartRenderOpts.axisFontSize}
                  themeBg={themeUi.bg}
                  themeText={themeUi.text}
                  table={pivotTable}
                  ramp={continuousStops}
                  hover={cubeHover}
                  onHover={(cell) => {
                    setCubeHover(cell ? { ...cell, zi: cubeSlice } : null);
                    if (!cell) setChartTooltip(null);
                  }}
                />
              )}
            </>
          )}
          {brushRect && (
            <div
              className="fixed pointer-events-none border-2 border-loom-accent bg-loom-accent/10 z-[90]"
              style={{
                left: Math.min(brushRect.x1, brushRect.x2),
                top: Math.min(brushRect.y1, brushRect.y2),
                width: Math.abs(brushRect.x2 - brushRect.x1),
                height: Math.abs(brushRect.y2 - brushRect.y1),
              }}
            />
          )}
          {/* Lasso polygon overlay */}
          {lassoPoints.length > 1 && (
            <svg className="fixed inset-0 w-full h-full pointer-events-none z-[90]">
              <polyline
                points={lassoPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="var(--loom-accent)"
                strokeWidth={2}
                strokeDasharray="4 2"
              />
            </svg>
          )}
          {/* Crosshair overlay */}
          {crosshairPos && chartInteractionMode === "crosshair" && containerRef.current && (() => {
            const rect = containerRef.current!.getBoundingClientRect();
            const sx = crosshairPos.screenX - rect.left;
            const sy = crosshairPos.screenY - rect.top;
            const xType = activeChart?.xField ? (sampleRows?.types?.[sampleRows.columns.indexOf(activeChart.xField)] ?? "").toLowerCase() : "";
            return (
              <CrosshairTooltip
                crosshairPos={crosshairPos}
                sx={sx}
                sy={sy}
                xField={activeChart?.xField}
                yField={activeChart?.yField}
                xTypeHint={xType}
                fontFamily={chartFontFamily}
                axisFontSize={chartRenderOpts.axisFontSize}
              />
            );
          })()}
          {/* Ruler measurement */}
          {rulerPins.length === 2 && (
            <div className="absolute left-2 z-[6] max-w-[calc(100%-1rem)] tabular-nums text-loom-text bg-loom-surface/90 border border-loom-border rounded px-1.5 py-0.5" style={{ bottom: footerBandPx + 32, fontFamily: chartFontStack(chartFontFamily), fontSize: chartRenderOpts.axisFontSize, lineHeight: 1.5 }}>
              Δx={formatAxisValue(Math.abs(rulerPins[1].x - rulerPins[0].x))} Δy={formatAxisValue(Math.abs(rulerPins[1].y - rulerPins[0].y))}
              <button type="button" onClick={() => setRulerPins([])} aria-label="Clear ruler measurement" className="ml-1 text-loom-label hover:text-loom-text">×</button>
            </div>
          )}
          {/* Pinned readouts are drawn on the focus layer; this chip clears them. */}
          {activeChart && pinnedTooltips.some((t) => t.chartId === activeChart.id) && (
            <div
              className="absolute right-2 z-[6] flex items-center gap-1.5 text-2xs text-loom-text bg-loom-surface/90 border border-loom-border rounded-full pl-2.5 pr-1 py-0.5"
              style={{ bottom: footerBandPx + (scatterViewMoved ? 40 : 8) }}
            >
              <span>
                {pinnedTooltips.filter((t) => t.chartId === activeChart.id).length} pinned
                <span className="hidden sm:inline text-loom-muted"> · in exports &amp; links</span>
              </span>
              <button
                type="button"
                onClick={() => setPinnedTooltips(pinnedTooltips.filter((t) => t.chartId !== activeChart.id))}
                className="px-1.5 py-0.5 rounded-full text-loom-muted hover:text-loom-text hover:bg-loom-elevated"
                aria-label="Clear pinned readouts"
              >
                Clear
              </button>
            </div>
          )}
          {/* Mini-map when zoomed */}
          {activeChart?.kind === "scatter" && scatterView.scale > 1.5 && scatterDataRef.current && (() => {
            const MH = 60, MW = 80;
            const sd = scatterDataRef.current;
            const xRange = sd.xMax - sd.xMin || 1, yRange = sd.yMax - sd.yMin || 1;
            const eff = getEffectiveScatterBounds(sd, scatterView);
            const vw = Math.max(2, ((eff.xMax - eff.xMin) / xRange) * MW);
            const vh = Math.max(2, ((eff.yMax - eff.yMin) / yRange) * MH);
            const vx0 = ((eff.xMin - sd.xMin) / xRange) * MW;
            const vy0 = MH - ((eff.yMax - sd.yMin) / yRange) * MH;
            return (
              <div className="absolute top-2 right-2 z-[6] border border-loom-border rounded bg-loom-surface/80 overflow-hidden" style={{ width: MW, height: MH }}>
                <svg width={MW} height={MH}>
                  {sd.points.slice(0, 500).map((p, i) => (
                    <circle key={i} cx={((p.x - sd.xMin) / xRange) * MW} cy={MH - ((p.y - sd.yMin) / yRange) * MH} r={1} fill="var(--loom-accent)" opacity={0.4} />
                  ))}
                  <rect x={vx0} y={vy0} width={vw} height={vh} fill="none" stroke="var(--loom-accent)" strokeWidth={1} />
                </svg>
              </div>
            );
          })()}
          {scatterViewMoved && (
            <button
              type="button"
              onClick={() => setScatterView({ scale: 1, panX: 0, panY: 0 })}
              className="absolute bottom-2 right-2 z-10 px-2 py-1 text-2xs rounded border border-loom-border bg-loom-surface text-loom-text hover:bg-loom-elevated"
            >
              Reset view
            </button>
          )}
          {activeChart && (chartAnnotations[activeChart.id] ?? []).map((saved) => {
            const a = arrangementPreview && "annotation" in arrangementPreview && arrangementPreview.annotation.id === saved.id ? { ...saved, ...arrangementPreview.annotation } : saved;
            return (
            <div
              key={a.id}
              className="absolute text-2xs font-mono px-1.5 py-0.5 rounded bg-loom-surface/95 border border-loom-border text-loom-text pointer-events-none z-[4]"
              style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${(a.width ?? .25) * 100}%`, fontFamily: chartFontStack(chartFontFamily), fontSize: a.fontSize ?? chartTypeRamp(chartRenderOpts.axisFontSize).mark, lineHeight: 1.4, padding: "4px 6px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", transform: "translate(-50%, -50%)" }}
            >
              {a.text}
            </div>
          ); })}
          {arranging && arrangeReady && arrangementLayout && activeChart && !socialExportReady && !socialExportTarget && (
            <CanvasArrangeOverlay
              key={activeChart.id}
              width={containerSize.w}
              height={containerSize.h}
              frameInset={2}
              contentHeight={
                containerSize.h -
                ((chartFootnoteText || chartColorInfo?.stops?.length) &&
                (chartVisualOverrides.chromeInfoBand ?? "footer") === "footer"
                  ? FOOTNOTE_BAND_PX
                  : 0)
              }
              frameMax={chartFrameMax}
              layout={arrangementLayout}
              visual={chartVisualOverrides}
              annotations={chartAnnotations[activeChart.id] ?? []}
              allowPlot={ARRANGE_PLOT_KINDS.has(activeChart.kind) && !activeChart.rowField && !showMarginals}
              onPreview={setArrangementPreview}
              onCommit={commitArrangement}
              onDone={finishArranging}
            />
          )}
          </div>
          {!socialExportReady && activeChart && !isMobile && (
            <ChartToolRail
              orientation="vertical"
              {...chartToolRailProps}
              whyPanelClassName="w-[11.5rem] rounded-lg border border-loom-border bg-[color-mix(in_srgb,var(--loom-surface)_95%,transparent)] backdrop-blur-md p-2.5 shadow-sm"
            />
          )}
          </div>
        </div>
        <ChartHoverTooltip
          visible={!readoutsObscured && tooltipPresentation !== "off" && !!hoverTip}
          tip={hoverTip!}
          presentation={tooltipPresentation}
          fontFamily={chartFontFamily}
          axisFontSize={chartRenderOpts.axisFontSize}
          tooltipLink={tooltipLink}
          hoverMark={hoverMark}
          hoverRef={hoverRef}
          activeChartId={activeChart?.id}
          pinnedTooltips={pinnedTooltips}
          stickyTooltip={stickyTooltip}
          stageRect={containerRef.current?.getBoundingClientRect() ?? null}
          onPin={() => {
            if (!hoverMark || !hoverTip) return;
            const wasPinned = !!hoverRef && pinnedTooltips.some((t) => t.chartId === activeChart?.id && sameMark(t.ref, hoverRef));
            pinMark(hoverMark, hoverTip);
            if (stickyTooltip && !wasPinned) {
              setScatterTooltip(null);
              setChartTooltip(null);
              setHoveredRowIndex(null);
            }
          }}
          onDismiss={
            stickyTooltip
              ? () => {
                  setScatterTooltip(null);
                  setChartTooltip(null);
                  setHoveredRowIndex(null);
                }
              : undefined
          }
        />

        {activeChart && !liveEdit && (
          <div
            className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 border-t border-loom-border text-2xs text-loom-muted font-mono ${
              isMobile
                ? "min-h-7 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]"
                : "min-h-[var(--statusbar-height)] py-0.5"
            }`}
          >
            <span
              className={`truncate ${isMobile ? "max-w-[min(18rem,70vw)]" : "max-w-[min(28rem,45vw)]"}`}
              title={activeChart.subtitle ?? undefined}
            >
              {CHART_KIND_CATALOG.find((e) => e.value === activeChart.kind)?.label ?? activeChart.kind}
              {" · "}
              {activeChart.xField}
              {activeChart.yField ? ` × ${activeChart.yField}` : ""}
            </span>
            {!isMobile && (
              <>
                <span className="text-loom-border">·</span>
                <span title={aggregationHint || undefined}>
                  {useWebGPUScatter || useWebGpuScene || useWebGpuCube ? "Accelerated" : "Standard"}
                </span>
              </>
            )}
            {sampleHonestyLabel && (
              <>
                <span className="text-loom-border">·</span>
                <span className="tabular-nums" title={`${sampleHonestyLabel}${aggregationHint ? ` · ${aggregationHint}` : ""}`}>
                  {sampleHonestyLabel}
                </span>
              </>
            )}
            {!isMobile && (activeChart.kind === "scatter" || activeChart.kind === "bubble") && (
              <>
                <span className="text-loom-border">·</span>
                <span title="Press L while hovering to lock tooltip across charts">L = link</span>
              </>
            )}
            {tooltipLink && (
              <>
                <span className="text-loom-accent truncate max-w-[160px]">
                  {tooltipLink.field}={tooltipLink.value}
                </span>
                <button
                  type="button"
                  onClick={() => setTooltipLink(null)}
                  className="text-loom-muted hover:text-loom-text underline"
                >
                  Clear
                </button>
              </>
            )}
            {!isMobile &&
              !socialExportReady &&
              (chartAspect !== "free" ||
                chartDevice !== "desktop" ||
                (appSettings.chartDevice ?? "auto") !== "auto") && (
              <span
                className="ml-auto text-2xs font-mono text-loom-muted/80 tabular-nums"
                title="Chart frame aspect · device · pixel size"
              >
                {aspectLabel(chartAspect)}
                {" · "}
                {chartFrameSize.width}×{chartFrameSize.height}
              </span>
            )}
          </div>
        )}
      </div>
  );
}
