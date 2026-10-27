// LOOM-141
// @ts-nocheck — LOOM-141: ChartViewRuntime bag until typed
import { useEffect } from "react";
import { useLoomStore } from "@/lib/store";
import { canUseWebGpuScatter } from "@/lib/webGpuScatterEligibility";
import { getThemeUiColors } from "@/lib/chartPalettes";
import { resolveRuntimeTheme } from "@/lib/resolveEffectiveTheme";
import { resolveThemeChartStyle } from "@/lib/themeChartStyle";
import { stageDpr } from "./constants";
import { drawCanvasAnnotations } from "@/lib/canvasAnnotationDraw";
import { resolveChartPad } from "@/lib/chartLayout";
import { DEFAULT_PAD } from "@/lib/canvasCharts/shared";
import { isGpuSceneKind, extractGpuScenePoints, renderGpuSceneCanvas, type GpuSceneKind } from "@/lib/gpuScenes";
import { isWebGpuGlobeKind } from "@/lib/geoMaps";
import { hasCanvasArrangement } from "@/lib/canvasArrangement";
import { renderDataCubeCanvas } from "@/lib/dataCube";
import { resolveChartFontFamily } from "@/lib/fontCatalog";
import { resolveChartAxisFontSize } from "@/lib/chartType";
import { applyChartSpecColors } from "@/lib/chartSpecColors";
import { svgExportMode } from "@/lib/chartSupport";
import { ARRANGEMENT_KEYS } from "@/lib/canvasArrangement";

export function useChartExport(ctx: {
  setPngExportHandler?: unknown;
  setSvgExportHandler?: unknown;
  setSvgExportLabel?: unknown;
  vegaSpec?: unknown;
  savedChartVisualOverrides?: unknown;
  exportStateRef?: unknown;
  canvasRef?: unknown;
  canvas2DRef?: unknown;
  axesOverlayRef?: unknown;
  focusLayerRef?: unknown;
  cubeFrameRef?: unknown;
  tooltipLink?: unknown;
  setTooltipLink?: unknown;
  activeChart?: unknown;
  chartSampleRows?: unknown;
  scatterTooltipRef?: unknown;
  chartTooltipRef?: unknown;
  getEffectiveScatterBounds?: unknown;
  setChartInteractionMode?: unknown;
  setToast?: unknown;
  applyBrushSelection?: unknown;
  setLassoPoints?: unknown;
  setRulerPins?: unknown;
  setCrosshairPos?: unknown;
  setScatterView?: unknown;
  scatterDataRef?: unknown;
  stageHostRef?: unknown;
}): void {
  const {
    setPngExportHandler, setSvgExportHandler, setSvgExportLabel, vegaSpec, savedChartVisualOverrides,
    exportStateRef, canvasRef, canvas2DRef, axesOverlayRef, focusLayerRef, cubeFrameRef,
    tooltipLink, setTooltipLink, activeChart, chartSampleRows, scatterTooltipRef, chartTooltipRef,
    getEffectiveScatterBounds, setChartInteractionMode, setToast, applyBrushSelection, setLassoPoints,
    setRulerPins, setCrosshairPos, setScatterView, scatterDataRef, stageHostRef,
  } = ctx as Record<string, never>;
    // Register PNG/SVG export handlers for the Export tab
    useEffect(() => {
      setPngExportHandler(async (): Promise<Blob | null> => {
        const { activeChart: ac, gpuReady: gpu, chartVisualOverrides: overrides } = exportStateRef.current;
        const canvas = canvasRef.current;
        const canvas2D = canvas2DRef.current;
        const axesOverlay = axesOverlayRef.current;
        if (!canvas || !canvas2D || !ac) return null;
        const st = useLoomStore.getState();
        const capturing =
          !!st.previewCapture || !!st.socialExportTarget || st.socialExportReady;
        const smart = st.smartResults;
        const exportHasSmartOverlays = Boolean(
          smart &&
            ((smart.anomaly?.rowIndices?.length ?? 0) > 0 ||
              (smart.trend?.points?.length ?? 0) >= 2 ||
              (smart.forecast?.points?.length ?? 0) > 0 ||
              (smart.referenceLines?.lines?.length ?? 0) > 0 ||
              (smart.clusters && Object.keys(smart.clusters.rowToCluster).length > 0)),
        );
        const useWebGPU = canUseWebGpuScatter({
          kind: ac.kind,
          gpuReady: gpu,
          forceCanvasCapture: capturing,
          hasSmartOverlays: exportHasSmartOverlays,
          connectScatterTrail: st.connectScatterTrail,
          showMarginals: st.showMarginals,
          customRefLineCount: st.customRefLines[ac.id]?.length ?? 0,
          chart: ac,
          overrides,
        });
        // Prefer the layer that actually holds pixels; size from whichever is ready
        const w = Math.max(canvas2D.width, useWebGPU ? canvas.width : 0);
        const h = Math.max(canvas2D.height, useWebGPU ? canvas.height : 0);
        if (w === 0 || h === 0) return null;
        try {
          const off = document.createElement("canvas");
          off.width = w;
          off.height = h;
          const ctx = off.getContext("2d");
          if (!ctx) return null;
          const themeUi = getThemeUiColors(resolveRuntimeTheme(st.appSettings.theme));
          ctx.fillStyle = themeUi.bg;
          ctx.fillRect(0, 0, w, h);
          const cubeFrame = ac.kind === "dataCube" ? cubeFrameRef.current : null;
          if (cubeFrame) {
            // Voxels may live on the WebGPU layer — redraw the whole cube on Canvas instead of compositing.
            ctx.save();
            ctx.scale(w / cubeFrame.w, h / cubeFrame.h);
            renderDataCubeCanvas(ctx, cubeFrame.cube, cubeFrame.w, cubeFrame.h, {
              ...cubeFrame.opts,
              camera: cubeFrame.baseCamera,
              contentInsets: undefined,
              centerOf: undefined,
              showLegend: overrides.legendPosition !== "none",
              hovered: null,
            });
            ctx.restore();
          } else {
            const exp = exportStateRef.current;
            const cssW = canvas2D.width / stageDpr();
            const cssH = canvas2D.height / stageDpr();
            // Geo maps / globes already paint title, categorical legend, size key, and
            // footnote on canvas2D (and GPU globe sits on the WebGPU layer). Re-rendering
            // them here dropped the city color key from Share / Save PNGs — composite the
            // live stage instead so the export matches what you see.
            // Particle GPU scenes still re-draw on Canvas for a reliable readback.
            const needsSceneCanvas = isGpuSceneKind(ac.kind) && !isWebGpuGlobeKind(ac.kind) && !hasCanvasArrangement(overrides);
            if (needsSceneCanvas && exp.sampleRows?.rows.length) {
              ctx.save();
              ctx.scale(w / cssW, h / cssH);
              const pad = resolveChartPad({
                kind: ac.kind,
                width: cssW,
                height: cssH,
                basePad: overrides.chartPadding ?? DEFAULT_PAD,
                titleLayout: overrides.titleLayout,
                tickRotation: overrides.tickRotation ?? 0,
                chartFrame: overrides.chartFrame,
                isCompact: false,
                legendPosition: overrides.legendPosition,
                axisFontSize: overrides.axisFontSize,
                sourceFootnote: (overrides.sourceFootnote ?? "off") !== "off",
              });
              const ui = themeUi;
              const sceneOpts = {
                ...overrides,
                colors: exp.colors,
                lineCap: overrides.lineCap, lineJoin: overrides.lineJoin,
                opacity: exp.opacity,
                fontFamily: resolveChartFontFamily(overrides.fontFamily, st.appSettings.font, st.appSettings.faces),
                axisFontSize: resolveChartAxisFontSize(overrides.axisFontSize),
                themeText: ui.text,
                themeMuted: ui.label,
                themeBorder: ui.border,
                themeBg: ui.bg,
                pointSize: exp.pointSize,
                channelInvert: ac.channelInvert ?? undefined,
                yaw: exp.sceneOrbit.yaw,
                pitch: exp.sceneOrbit.pitch,
                zoom: exp.sceneOrbit.zoom,
              };
              const cols = exp.sampleRows.columns;
              const rows = exp.sampleRows.rows;
              const packed = extractGpuScenePoints(rows, cols, {
                xField: ac.xField,
                yField: ac.yField,
                zField: ac.zField,
                colorField: ac.colorField,
                sizeField: ac.sizeField,
                timeField: ac.timeField,
                trailId: ac.trailId,
                invertSize: !!ac.channelInvert?.size,
                invertZ: !!ac.channelInvert?.z,
              });
              if (packed) {
                renderGpuSceneCanvas(ac.kind as GpuSceneKind, ctx, packed, cssW, cssH, pad, sceneOpts);
              }
              ctx.restore();
            } else {
              try {
                ctx.drawImage(canvas2D, 0, 0);
              } catch {
                /* tainted / lost context */
              }
              if (useWebGPU) {
                try {
                  ctx.drawImage(canvas, 0, 0);
                } catch {
                  /* WebGPU readback can fail mid-resize */
                }
              }
            }
            if (axesOverlay && axesOverlay.width > 0 && axesOverlay.height > 0) {
              try {
                ctx.drawImage(axesOverlay, 0, 0);
              } catch {
                /* ignore */
              }
            }
          }
          // Pinned readouts + focus rings: the highlighted story travels with the PNG.
          const focusLayer = focusLayerRef.current;
          if (focusLayer && focusLayer.width === w && focusLayer.height === h) {
            try {
              ctx.drawImage(focusLayer, 0, 0);
            } catch {
              /* ignore */
            }
          }
          drawCanvasAnnotations(ctx, w, h, st.chartAnnotations[ac.id] ?? [], themeUi, { width: canvas2D.width / stageDpr(), height: canvas2D.height / stageDpr() }, { fontFamily: resolveChartFontFamily(overrides.fontFamily, st.appSettings.font, st.appSettings.faces), axisFontSize: overrides.axisFontSize });
          // Attribution burn-in for platform / social PNG exports.
          // When the canvas already has a source/time footnote, skip the burn-in bar.
          if (st.socialExportTarget) {
            const footnoteOnChart = Boolean(exportStateRef.current.chartFootnoteText);
            if (!footnoteOnChart) {
              const { drawExportBurnIn } = await import("@/lib/socialExport");
              const { formatSourceFootnote, resolveDataProvenance } = await import("@/lib/dataProvenance");
              const prov = resolveDataProvenance(st.selectedFile, {
                loadedRows: st.sampleRows?.rows.length ?? null,
                totalRows: st.sampleRows?.total_rows ?? st.selectedFile?.row_count ?? null,
              });
              const sourceLabel = prov
                ? formatSourceFootnote(prov, "credit")
                : st.selectedFile?.name ?? null;
              drawExportBurnIn(ctx, w, h, {
                burnIn: st.exportBurnIn,
                sourceLabel,
                themeText: themeUi.text,
                themeMuted: themeUi.label,
                themeBg: themeUi.bg,
              });
            }
          }
          return new Promise<Blob | null>((resolve) => {
            off.toBlob((blob) => resolve(blob), "image/png");
          });
        } catch {
          return null;
        }
      });
      const svgMode = svgExportMode(vegaSpec);
      setSvgExportLabel(
        (svgMode === "approx" || ARRANGEMENT_KEYS.some((key) => savedChartVisualOverrides[key] != null))
          ? "Vega approximation — use PNG to preserve canvas arrangement"
          : null,
      );
      setSvgExportHandler(
        svgMode === "off"
          ? null
          : async (): Promise<string | null> => {
        const { vegaSpec: spec, sampleRows: rows, colors: exportColors, continuousStops: exportStops } = exportStateRef.current;
        if (!spec || !rows?.rows?.length) return null;
        try {
          const { compile } = await import("vega-lite");
          const vega = await import("vega");
          const values = rows.rows.map((row) => {
            const obj: Record<string, unknown> = {};
            rows.columns.forEach((col, i) => { obj[col] = row[i]; });
            return obj;
          });
          // Specs carry dark-theme text colors; an exported file needs the current theme's
          // colors on an opaque background so it reads wherever it's opened.
          const { vegaExportConfigForTheme } = await import("@/lib/vegaThemeConfig");
          const current = useLoomStore.getState();
          const visual = resolveThemeChartStyle(resolveRuntimeTheme(current.appSettings.theme), current.chartVisualOverrides);
          const exportConfig = vegaExportConfigForTheme(resolveRuntimeTheme(current.appSettings.theme), { ...visual, colorblindCharts: current.appSettings.colorblindCharts, fontFamily: resolveChartFontFamily(visual.fontFamily, current.appSettings.font, current.appSettings.faces) });
          const base = (spec as { config?: Record<string, unknown> }).config ?? {};
          const specWithData = {
            ...applyChartSpecColors(spec as Record<string, unknown>, exportColors, exportStops),
            data: { values },
            config: {
              ...base,
              ...exportConfig,
              axis: { ...(base.axis as object | undefined), ...(exportConfig.axis as object) },
              title: { ...(base.title as object | undefined), ...(exportConfig.title as object) },
              legend: { ...(base.legend as object | undefined), ...(exportConfig.legend as object) },
            },
          };
          const compiled = compile(specWithData as Parameters<typeof compile>[0]);
          const view = new vega.View(vega.parse(compiled.spec), { renderer: "none" });
          await view.runAsync();
          const svg = await view.toSVG();
          view.finalize();
          return svg;
        } catch (e) {
          console.warn("SVG export failed:", e);
          return null;
        }
      },
      );
      return () => {
        setPngExportHandler(null);
        setSvgExportHandler(null);
        setSvgExportLabel(null);
      };
    }, [setPngExportHandler, setSvgExportHandler, setSvgExportLabel, vegaSpec, savedChartVisualOverrides]);

}
