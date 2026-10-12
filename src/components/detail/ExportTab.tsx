"use client";

import { useState, useCallback, useMemo, useEffect, useRef, useId, type ReactNode, type DragEvent } from "react";
import { formatVegaSpecJson } from "@/lib/vegaSpecDisplay";
import { defaultAppLookSettings, emptyChartVisualOverrides } from "@/lib/lookSettingsDefaults";
import { clampSmartFloat, clampSmartInt, SMART_TOP_N, SMART_Z } from "@/lib/smartInputClamp";
import { useIsMobile, useMobileLiveEdit, MOBILE_LIVE_EDIT_SHEET } from "@/lib/useMediaQuery";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { clearPersistedPreferences } from "@/lib/persist";
import { Button } from "@/components/ui/Button";
import { WorkspaceBackupControls } from "@/components/WorkspaceBackupControls";
import { useShallow } from "zustand/react/shallow";
import { useLoomStore, type PanelTab, type ChartVisualOverrides, type AppTheme, type FontScale } from "@/lib/store";
import { formatNumber } from "@/lib/format";
import { ChartKindPicker } from "@/components/ChartKindPicker";
import {
  AXIS_LABEL_COLOR_SWATCHES,
  AXIS_LINE_COLOR_SWATCHES,
  COLOR_PALETTES,
  palettesGrouped,
  resolveChartColors,
  type PaletteKind,
} from "@/lib/chartPalettes";
import {
  THEMES,
  THEME_LABEL,
  UI_CHROMES,
  UI_CHROME_LABEL,
  APP_FONTS,
  APP_FONT_LABEL,
  FACES_SOURCES,
  VISUAL_PRESETS,
  VISUAL_PRESET_BLURB,
  shuffleVisualOverrides,
  VISUAL_SHUFFLE_SECTIONS,
  type VisualPresetId,
  type VisualShuffleLocks,
  type VisualShuffleSection,
  normalizeTheme,
  type LookTheme,
  type UiChrome,
  type AppFont,
  type FacesSource,
} from "@/lib/lookSystem";
import { requestDiscoverScan } from "@/lib/discoverStories";
import { CHANGELOG, requestHelp, requestWhatsNew } from "@/lib/changelog";
import {
  createChartRec,
  fitEncodingToKind,
  Y_AGGREGATE_OPTIONS,
  getRecommendationReason,
  getRandomEncoding,
  applyEncodingLocks,
  chartKindDataSupport,
  tryBuildRandomChartRec,
  randomEncodingToExtra,
  recommendStorySequence,
  recommendStreamStory,
  type ChartKind,
  type YAggregateOption,
  type EncodingShuffleLocks,
} from "@/lib/recommendations";
import {
  computeDataQualityHints,
  formatChartAggregationSummary,
  chartCapabilities,
  encodingChannelLabels,
  CHART_LAYOUT_DIRECTIONS,
  CHART_Y_SCALE_OPTIONS,
  type ChartLayoutDirection,
  type ChartYScaleOption,
} from "@/lib/chartSupport";
import {
  chromeDomId,
  chromeSectionFor,
  type ChartChromeTarget,
} from "@/lib/chartChromeLink";
import { CHART_TOOLTIP_MODES, type ChartTooltipMode } from "@/lib/chartTooltipMode";
import {
  resolveDataProvenance,
  provenanceKindLabel,
  type DataProvenance,
} from "@/lib/dataProvenance";
import { TOP_N_OPTIONS, clampTopN, DEFAULT_TOP_N } from "@/lib/chartFacets";
import {
  CHART_TIME_RANGES,
  applyChartTimeWindow,
  chartTimeRangeOptions,
  pickDefaultTimeField,
  temporalColumnNames,
  timeColumnSpanMs,
  type ChartTimeRange,
} from "@/lib/chartTime";
import {
  runAnomaly,
  runForecast,
  runTrend,
  runReferenceLines,
  runClustering,
  runCorrelationMatrix,
  type AnomalyMethod,
} from "@/lib/smartAnalytics";
import { corrCellInk, corrFillT, sampleCorrDiverging, DEFAULT_CORR_DIVERGING } from "@/lib/corrMatrixStyle";
import { queryResultToCsv, downloadCsv } from "@/lib/csvExport";
import { buildDashboardMicrositeHtml } from "@/lib/dashboardMicrosite";
import { exportDashboardMicrosite, streamSnapshot, isDesktop, isTauri, openExternalUrl } from "@/lib/tauri";
import { isNumericColumnType } from "@/lib/dataCubeSchema";
import { captureStoryDashboardPreviews } from "@/lib/captureStoryPreviews";
import {
  SOCIAL_PRESETS,
  getSocialPreset,
  buildSocialCaption,
  shareOrDownloadFile,
  copyTextToClipboard,
  slugifyFilename,
  publishStoryToWorker,
  recordCanvasVideo,
} from "@/lib/socialExport";
import { downloadBlob } from "@/lib/zipStore";

export default function ExportTab() {
  const {
    activeChart,
    pngExportHandler,
    svgExportHandler,
    svgExportLabel,
    selectedFile,
    sampleRows,
    queryResult,
    chartVisualOverrides,
    chartTitleOverrides,
    aiSuggestionReason,
    socialPresetId,
    setSocialPresetId,
    exportBurnIn,
    setExportBurnIn,
    exportSupersample,
    setExportSupersample,
    socialExportReady,
    setSocialExportReady,
    setSocialExportTarget,
    setToast,
    setViewMode,
    dashboards,
    activeDashboardId,
    vegaSpec,
  } = useLoomStore(
    useShallow((s) => ({
      activeChart: s.activeChart,
      pngExportHandler: s.pngExportHandler,
      svgExportHandler: s.svgExportHandler,
      svgExportLabel: s.svgExportLabel,
      selectedFile: s.selectedFile,
      sampleRows: s.sampleRows,
      queryResult: s.queryResult,
      chartVisualOverrides: s.chartVisualOverrides,
      chartTitleOverrides: s.chartTitleOverrides,
      aiSuggestionReason: s.aiSuggestionReason,
      socialPresetId: s.socialPresetId,
      setSocialPresetId: s.setSocialPresetId,
      exportBurnIn: s.exportBurnIn,
      setExportBurnIn: s.setExportBurnIn,
      exportSupersample: s.exportSupersample,
      setExportSupersample: s.setExportSupersample,
      socialExportReady: s.socialExportReady,
      setSocialExportReady: s.setSocialExportReady,
      setSocialExportTarget: s.setSocialExportTarget,
      setToast: s.setToast,
      setViewMode: s.setViewMode,
      dashboards: s.dashboards,
      activeDashboardId: s.activeDashboardId,
      vegaSpec: s.vegaSpec,
    })),
  );
  const [pngFeedback, setPngFeedback] = useState(false);
  const [svgFeedback, setSvgFeedback] = useState(false);
  const [configFeedback, setConfigFeedback] = useState(false);
  const [captionFeedback, setCaptionFeedback] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setCopyError(null);
  }, []);

  const displayTitle = activeChart
    ? (chartTitleOverrides[activeChart.id] ?? activeChart.title)
    : "";

  const captionText = useMemo(() => {
    if (!activeChart) return "";
    return buildSocialCaption({
      title: displayTitle,
      subtitle: activeChart.subtitle,
      reason: aiSuggestionReason ?? getRecommendationReason(activeChart),
      source: selectedFile?.name,
      handle: exportBurnIn.includeHandle ? exportBurnIn.handleText : null,
    });
  }, [activeChart, displayTitle, aiSuggestionReason, selectedFile, exportBurnIn]);

  const runPlatformPng = useCallback(async (): Promise<Blob | null> => {
    const { capturePlatformPng } = await import("@/lib/capturePlatformPng");
    return capturePlatformPng(socialPresetId, { supersample: exportSupersample });
  }, [socialPresetId, exportSupersample]);

  const handleCopyPng = useCallback(async () => {
    setCopyError(null);
    setBusy("png");
    try {
      const blob = (await runPlatformPng()) ?? (pngExportHandler ? await pngExportHandler() : null);
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setPngFeedback(true);
        setTimeout(() => setPngFeedback(false), 2000);
      } else {
        setCopyError("Could not capture chart PNG.");
      }
    } catch (e) {
      console.warn("Copy PNG failed:", e);
      setCopyError("Clipboard access denied. Use HTTPS/localhost and allow clipboard permission.");
    } finally {
      setBusy(null);
    }
  }, [runPlatformPng, pngExportHandler]);

  const handleCopySvg = useCallback(async () => {
    if (!svgExportHandler) return;
    setCopyError(null);
    try {
      const svg = await svgExportHandler();
      if (svg) {
        await navigator.clipboard.writeText(svg);
        setSvgFeedback(true);
        setTimeout(() => setSvgFeedback(false), 2000);
      }
    } catch (e) {
      console.warn("Copy SVG failed:", e);
      setCopyError("Clipboard access denied. Use a secure context (HTTPS or localhost) and allow clipboard permission.");
    }
  }, [svgExportHandler]);

  const handleDownloadPng = useCallback(async () => {
    setCopyError(null);
    setBusy("download");
    try {
      const blob = (await runPlatformPng()) ?? (pngExportHandler ? await pngExportHandler() : null);
      if (blob) {
        const preset = getSocialPreset(socialPresetId);
        const name = `${slugifyFilename(displayTitle || "chart")}-${preset.id}.png`;
        downloadBlob(blob, name);
        setToast(`Downloaded ${preset.label} PNG`);
      } else {
        setCopyError("Could not capture chart PNG.");
      }
    } catch (e) {
      console.warn("Download PNG failed:", e);
      setCopyError("Export failed.");
    } finally {
      setBusy(null);
    }
  }, [runPlatformPng, pngExportHandler, socialPresetId, displayTitle, setToast]);

  const handleSharePng = useCallback(async () => {
    setCopyError(null);
    setBusy("share");
    try {
      const blob = (await runPlatformPng()) ?? (pngExportHandler ? await pngExportHandler() : null);
      if (!blob) {
        setCopyError("Could not capture chart PNG.");
        return;
      }
      const preset = getSocialPreset(socialPresetId);
      const name = `${slugifyFilename(displayTitle || "chart")}-${preset.id}.png`;
      const { saveBinaryAndReveal } = await import("@/lib/tauri");
      if (isDesktop()) {
        const path = await saveBinaryAndReveal(blob, name);
        setToast(path ? "Saved — revealed in Finder" : "Save cancelled");
      } else {
        const result = await shareOrDownloadFile(blob, name, displayTitle || "Loom chart");
        setToast(result === "shared" ? "Opened share sheet" : "Downloaded PNG");
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      console.warn("Share PNG failed:", e);
      setCopyError("Share failed.");
    } finally {
      setBusy(null);
    }
  }, [runPlatformPng, pngExportHandler, socialPresetId, displayTitle, setToast]);

  const handleDownloadSvg = useCallback(async () => {
    if (!svgExportHandler) return;
    setCopyError(null);
    try {
      const svg = await svgExportHandler();
      if (svg) {
        const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        downloadBlob(blob, `${slugifyFilename(displayTitle || "chart")}.svg`);
      }
    } catch (e) {
      console.warn("Download SVG failed:", e);
      setCopyError("Export failed.");
    }
  }, [svgExportHandler, displayTitle]);

  const handleCopyCaption = useCallback(async () => {
    if (!captionText) return;
    const ok = await copyTextToClipboard(captionText);
    if (ok) {
      setCaptionFeedback(true);
      setTimeout(() => setCaptionFeedback(false), 2000);
    } else {
      setCopyError("Clipboard access denied.");
    }
  }, [captionText]);

  const handleCopyChartConfig = useCallback(async () => {
    if (!activeChart) return;
    setCopyError(null);
    try {
      const config = {
        chart: {
          kind: activeChart.kind,
          title: activeChart.title,
          xField: activeChart.xField,
          yField: activeChart.yField,
          colorField: activeChart.colorField,
          sizeField: activeChart.sizeField,
        },
        visual: chartVisualOverrides,
      };
      await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      setConfigFeedback(true);
      setTimeout(() => setConfigFeedback(false), 2000);
    } catch (e) {
      console.warn("Copy config failed:", e);
      setCopyError("Clipboard access denied.");
    }
  }, [activeChart, chartVisualOverrides]);

  const handleToggleShareReady = useCallback(() => {
    const next = !socialExportReady;
    setSocialExportReady(next);
    if (next) {
      setViewMode("chart");
      const preset = getSocialPreset(socialPresetId);
      if (preset.width && preset.height) {
        setSocialExportTarget({
          width: preset.width,
          height: preset.height,
          pixelRatio: exportSupersample,
          presetId: socialPresetId,
        });
        if (preset.aspectId) {
          useLoomStore.getState().setAppSettings((s) => ({ ...s, chartAspect: preset.aspectId! }));
        }
      }
      setToast("Share ready — Esc to exit");
    } else {
      setSocialExportTarget(null);
    }
  }, [
    socialExportReady,
    setSocialExportReady,
    setViewMode,
    socialPresetId,
    exportSupersample,
    setSocialExportTarget,
    setToast,
  ]);

  const handleCarouselZip = useCallback(async () => {
    const dashId = activeDashboardId ?? dashboards[0]?.id;
    if (!dashId) {
      setCopyError("Create a story dashboard first (Dashboards → Tell a story).");
      return;
    }
    setBusy("carousel");
    setCopyError(null);
    try {
      const { exportStoryCarouselZip } = await import("@/lib/exportStoryCarousel");
      const result = await exportStoryCarouselZip(dashId, socialPresetId);
      if (!result) {
        setCopyError("Could not capture story slides.");
        return;
      }
      const dash = useLoomStore.getState().dashboards.find((d) => d.id === dashId);
      const name = `${slugifyFilename(dash?.name || "story")}-carousel.zip`;
      const { saveBinaryAndReveal, isDesktop: desktop } = await import("@/lib/tauri");
      if (desktop()) {
        const path = await saveBinaryAndReveal(result.blob, name);
        setToast(path ? `Saved ${result.count}-slide pack` : "Save cancelled");
      } else {
        await shareOrDownloadFile(result.blob, name, dash?.name || "Story pack");
        setToast(`Exported ${result.count}-slide carousel ZIP`);
      }
    } catch (e) {
      console.warn(e);
      setCopyError("Carousel export failed.");
    } finally {
      setBusy(null);
    }
  }, [activeDashboardId, dashboards, socialPresetId, setToast]);

  const handleStoryBundle = useCallback(async () => {
    const dashId = activeDashboardId ?? dashboards[0]?.id;
    if (!dashId) {
      setCopyError("Create a story dashboard first.");
      return;
    }
    setBusy("bundle");
    try {
      const st = useLoomStore.getState();
      const dash = st.dashboards.find((d) => d.id === dashId);
      if (!dash) return;
      const slots = dash.slots.map((slot) => {
        const v = st.chartViews.find((x) => x.id === slot.viewId);
        return {
          label: v?.name ?? slot.viewId,
          viewType: slot.viewType,
          snapshotDataUrl: v?.snapshotImageDataUrl ?? null,
          sourceLabel: v?.fileName,
        };
      });
      const ogSlot = slots.find((s) => s.snapshotDataUrl);
      const html = buildDashboardMicrositeHtml({
        dashboardName: dash.name,
        slots,
        lastUpdatedMs: dash.lastRefreshedAt ?? null,
        layoutTemplate: dash.layoutTemplate ?? "auto",
        ogImageDataUrl: ogSlot?.snapshotDataUrl ?? null,
        caption: captionText || undefined,
      });
      const enc = new TextEncoder();
      const entries: { name: string; data: Uint8Array }[] = [
        { name: "index.html", data: enc.encode(html) },
        { name: "caption.txt", data: enc.encode(captionText || dash.name) },
      ];
      if (vegaSpec) {
        entries.push({
          name: "chart-spec.json",
          data: enc.encode(JSON.stringify(vegaSpec, null, 2)),
        });
      }
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i]!;
        if (!s.snapshotDataUrl?.startsWith("data:")) continue;
        const b64 = s.snapshotDataUrl.split(",")[1];
        if (!b64) continue;
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        entries.push({
          name: `slides/${String(i + 1).padStart(2, "0")}.png`,
          data: bin,
        });
      }
      const { buildZip } = await import("@/lib/zipStore");
      const zipBytes = buildZip(entries);
      const ab = zipBytes.buffer.slice(
        zipBytes.byteOffset,
        zipBytes.byteOffset + zipBytes.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([ab], { type: "application/zip" });
      const name = `${slugifyFilename(dash.name)}-story-bundle.zip`;
      downloadBlob(blob, name);
      setToast("Story bundle downloaded");
    } catch (e) {
      console.warn(e);
      setCopyError("Story bundle failed.");
    } finally {
      setBusy(null);
    }
  }, [activeDashboardId, dashboards, captionText, vegaSpec, setToast]);

  const handlePublishStory = useCallback(async () => {
    const dashId = activeDashboardId ?? dashboards[0]?.id;
    if (!dashId) {
      setCopyError("Create a story dashboard first.");
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm("Publish a public link? Anyone with the URL can view this story.")
    ) {
      return;
    }
    setBusy("publish");
    try {
      const st = useLoomStore.getState();
      const dash = st.dashboards.find((d) => d.id === dashId);
      if (!dash) return;
      const slots = dash.slots.map((slot) => {
        const v = st.chartViews.find((x) => x.id === slot.viewId);
        return {
          label: v?.name ?? slot.viewId,
          viewType: slot.viewType,
          snapshotDataUrl: v?.snapshotImageDataUrl ?? null,
          sourceLabel: v?.fileName,
        };
      });
      const og = slots.find((s) => s.snapshotDataUrl)?.snapshotDataUrl ?? null;
      const html = buildDashboardMicrositeHtml({
        dashboardName: dash.name,
        slots,
        lastUpdatedMs: dash.lastRefreshedAt ?? null,
        layoutTemplate: dash.layoutTemplate ?? "auto",
        ogImageDataUrl: og,
        caption: captionText || undefined,
      });
      const published = await publishStoryToWorker({
        html,
        title: dash.name,
        ogImageDataUrl: og,
      });
      if (published?.url) {
        await copyTextToClipboard(published.url);
        setToast(`Published — URL copied`);
      } else {
        setCopyError(published?.error || "Publish unavailable offline — download the story bundle instead.");
      }
    } catch (e) {
      console.warn(e);
      setCopyError("Publish failed.");
    } finally {
      setBusy(null);
    }
  }, [activeDashboardId, dashboards, captionText, setToast]);

  const handleExportVideo = useCallback(async () => {
    setBusy("video");
    setCopyError(null);
    try {
      setViewMode("chart");
      const preset = getSocialPreset(socialPresetId === "current" ? "stories" : socialPresetId);
      if (preset.width && preset.height) {
        setSocialExportTarget({
          width: preset.width,
          height: preset.height,
          pixelRatio: 1,
          presetId: preset.id,
        });
        if (preset.aspectId) {
          useLoomStore.getState().setAppSettings((s) => ({ ...s, chartAspect: preset.aspectId! }));
        }
      }
      await new Promise((r) => setTimeout(r, 600));
      // Prefer the 2D canvas (always painted during social export)
      const canvas =
        document.querySelector<HTMLCanvasElement>("[data-loom-chart-canvas2d]") ||
        document.querySelector<HTMLCanvasElement>("main canvas");
      if (!canvas) {
        setCopyError("Chart canvas not ready.");
        setSocialExportTarget(null);
        return;
      }
      const blob = await recordCanvasVideo(canvas, { durationMs: 6000, fps: 30 });
      setSocialExportTarget(null);
      if (!blob) {
        setCopyError("Video export not supported in this browser.");
        return;
      }
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      const name = `${slugifyFilename(displayTitle || "chart")}-reel.${ext}`;
      await shareOrDownloadFile(blob, name, displayTitle || "Loom reel");
      setToast("Short video exported");
    } catch (e) {
      console.warn(e);
      setCopyError("Video export failed.");
      setSocialExportTarget(null);
    } finally {
      setBusy(null);
    }
  }, [socialPresetId, setSocialExportTarget, setViewMode, displayTitle, setToast]);

  const hasChartExport = activeChart && (pngExportHandler || svgExportHandler);
  const hasTableData = sampleRows && sampleRows.rows.length > 0 && selectedFile;
  const hasQueryData = queryResult && queryResult.rows.length > 0;
  const preset = getSocialPreset(socialPresetId);

  return (
    <div className="p-3 space-y-4">
      {hasChartExport && (
        <button
          type="button"
          onClick={() => useLoomStore.getState().setShareSheetOpen(true)}
          className="loom-btn-primary w-full min-h-10 text-sm font-semibold rounded-lg"
        >
          Share chart…
        </button>
      )}
      <p className="text-2xs text-loom-muted">
        Or fine-tune post-ready images, story carousels, video, and data (CSV) below.
      </p>
      {copyError && (
        <p role="alert" className="text-2xs text-loom-warning bg-loom-warning/10 border border-loom-warning/30 rounded px-2 py-1.5 flex items-center justify-between gap-2">
          <span>{copyError}</span>
          <button type="button" onClick={clearError} className="shrink-0 text-loom-muted hover:text-loom-text" aria-label="Dismiss">×</button>
        </p>
      )}

      {/* Social / platform */}
      <div className="space-y-1.5">
        <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Social</span>
        <div className="loom-card space-y-2">
          <label className="block text-2xs text-loom-muted">
            Platform size
            <select
              className="loom-input w-full mt-1 text-xs"
              value={socialPresetId}
              onChange={(e) => setSocialPresetId(e.target.value as typeof socialPresetId)}
            >
              {SOCIAL_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}{p.width ? ` (${p.width}×${p.height})` : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="text-2xs text-loom-muted">{preset.blurb}</p>
          <label className="flex items-center gap-2 text-2xs text-loom-text">
            <input
              type="checkbox"
              checked={exportSupersample === 2}
              onChange={(e) => setExportSupersample(e.target.checked ? 2 : 1)}
            />
            2× supersample (sharper feed posts)
          </label>
          <button
            type="button"
            onClick={handleToggleShareReady}
            className={`w-full px-3 py-2 text-xs font-medium rounded border transition-colors ${
              socialExportReady
                ? "border-loom-accent bg-loom-accent/15 text-loom-accent"
                : "text-loom-text bg-loom-elevated border-loom-border hover:border-loom-accent"
            }`}
          >
            {socialExportReady ? "Exit share-ready frame" : "Share-ready preview"}
          </button>
          <div className="border-t border-loom-border/50 pt-2 space-y-1.5">
            <span className="text-2xs text-loom-muted">Burn-in footer</span>
            {(
              [
                ["includeSource", "Source (if no on-chart footnote)"],
                ["includeTimestamp", "Timestamp"],
                ["includeHandle", "Handle"],
                ["includeLoomMark", "Made with Loom"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-2xs text-loom-text">
                <input
                  type="checkbox"
                  checked={!!exportBurnIn[key]}
                  onChange={(e) =>
                    setExportBurnIn((prev) => ({ ...prev, [key]: e.target.checked }))
                  }
                />
                {label}
              </label>
            ))}
            {exportBurnIn.includeHandle && (
              <input
                type="text"
                className="loom-input w-full text-xs"
                placeholder="@handle"
                value={exportBurnIn.handleText}
                onChange={(e) =>
                  setExportBurnIn((prev) => ({ ...prev, handleText: e.target.value }))
                }
              />
            )}
          </div>
          <button
            type="button"
            onClick={handleCopyCaption}
            disabled={!captionText}
            className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent disabled:opacity-50"
          >
            {captionFeedback ? "Caption copied!" : "Copy post caption"}
          </button>
          <button
            type="button"
            onClick={handleDownloadPng}
            disabled={!hasChartExport || !!busy}
            className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent disabled:opacity-50"
          >
            {busy === "download" ? "Capturing…" : `Download ${preset.label} PNG`}
          </button>
          <button
            type="button"
            onClick={handleSharePng}
            disabled={!hasChartExport || !!busy}
            className="w-full px-3 py-2 text-xs font-medium text-loom-accent bg-loom-accent/10 border border-loom-accent/40 rounded hover:bg-loom-accent/20 disabled:opacity-50"
          >
            {busy === "share" ? "Preparing…" : "Share image…"}
          </button>
          <button
            type="button"
            onClick={handleCarouselZip}
            disabled={!!busy}
            className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent disabled:opacity-50"
            title="Export active story dashboard as numbered PNGs in a ZIP"
          >
            {busy === "carousel" ? "Building carousel…" : "Story → carousel ZIP"}
          </button>
          <button
            type="button"
            onClick={handleStoryBundle}
            disabled={!!busy}
            className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent disabled:opacity-50"
          >
            {busy === "bundle" ? "Bundling…" : "Download story bundle"}
          </button>
          <button
            type="button"
            onClick={handlePublishStory}
            disabled={!!busy}
            className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent disabled:opacity-50"
          >
            {busy === "publish" ? "Publishing…" : "Publish story link"}
          </button>
          <button
            type="button"
            onClick={handleExportVideo}
            disabled={!hasChartExport || !!busy}
            className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent disabled:opacity-50"
          >
            {busy === "video" ? "Recording…" : "Export short video (Reel)"}
          </button>
        </div>
      </div>

      {/* Chart export */}
      <div className="space-y-1.5">
        <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Chart</span>
        <div className="loom-card space-y-2">
          {!hasChartExport ? (
            <p className="text-2xs text-loom-muted py-1">Select a chart to export as PNG or SVG.</p>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCopyPng}
                disabled={!pngExportHandler || !!busy}
                aria-label="Copy chart as PNG to clipboard"
                className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent hover:bg-loom-elevated/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pngFeedback ? "Copied!" : busy === "png" ? "Capturing…" : "Copy as PNG"}
              </button>
              <button
                type="button"
                onClick={handleCopySvg}
                disabled={!svgExportHandler}
                aria-label="Copy chart as SVG to clipboard"
                className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent hover:bg-loom-elevated/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {svgFeedback ? "Copied!" : svgExportLabel ? "Copy as SVG (Vega approx.)" : "Copy as SVG"}
              </button>
              <button
                type="button"
                onClick={handleCopyChartConfig}
                aria-label="Copy chart and visual config as JSON"
                className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent transition-colors"
              >
                {configFeedback ? "Copied!" : "Copy chart config (JSON)"}
              </button>
              <div className="border-t border-loom-border/50 pt-2 mt-2 space-y-2">
                <button
                  type="button"
                  onClick={handleDownloadSvg}
                  disabled={!svgExportHandler}
                  aria-label="Download chart as SVG file"
                  className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent transition-colors disabled:opacity-50"
                >
                  Download SVG
                </button>
                {svgExportLabel && (
                  <p className="text-2xs text-loom-muted leading-snug px-0.5">{svgExportLabel}</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Data export (CSV) */}
      <div className="space-y-1.5">
        <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Data</span>
        <div className="loom-card space-y-2">
          {hasTableData && (
            <button
              type="button"
              onClick={() => {
                const csv = queryResultToCsv(sampleRows!);
                downloadCsv(csv, selectedFile?.name?.replace(/\.[^.]+$/, "") || "table");
              }}
              aria-label="Export current table data as CSV file"
              className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent hover:bg-loom-elevated/80 transition-colors"
            >
              Export table to CSV
            </button>
          )}
          {hasQueryData && (
            <button
              type="button"
              onClick={() => {
                const csv = queryResultToCsv(queryResult!);
                downloadCsv(csv, selectedFile ? `query-${selectedFile.name.replace(/\.[^.]+$/, "")}` : "query-results");
              }}
              aria-label="Export query results as CSV file"
              className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent hover:bg-loom-elevated/80 transition-colors"
            >
              Export query results to CSV
            </button>
          )}
          {!hasTableData && !hasQueryData && (
            <p className="text-2xs text-loom-muted py-1">Open a file or run a query to export data as CSV.</p>
          )}
        </div>
      </div>
    </div>
  );
}
