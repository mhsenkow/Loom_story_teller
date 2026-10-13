// =================================================================
// ExportTab — capture settings + story / video / SVG / CSV long-tail
// =================================================================
// One-tap Share lives in the Share sheet (TopBar / “Share chart…”).
// This panel authors platform size / burn-in, then exports what Share
// doesn’t: dashboard packs, video, SVG, config JSON, and CSV.
// =================================================================

"use client";

import { useState, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useLoomStore } from "@/lib/store";
import { getRecommendationReason } from "@/lib/recommendations";
import { queryResultToCsv, downloadCsv } from "@/lib/csvExport";
import { buildDashboardMicrositeHtml } from "@/lib/dashboardMicrosite";
import { isDesktop } from "@/lib/tauri";
import { beginShareReadyAspect, endShareReadyAspect } from "@/lib/shareReadySession";
import { invalidateSharePreview, warmSharePreview } from "@/lib/sharePreviewCache";
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
  const [copyError, setCopyError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const clearError = useCallback(() => setCopyError(null), []);

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
    // Prefer the warm Share cache so Export clipboard matches the Share preview.
    const cached = await warmSharePreview(socialPresetId);
    if (cached) return cached;
    const { capturePlatformPng } = await import("@/lib/capturePlatformPng");
    return capturePlatformPng(socialPresetId, { supersample: exportSupersample });
  }, [socialPresetId, exportSupersample]);

  const openShareSheet = useCallback(() => {
    if (!activeChart) {
      setToast("Pick or create a chart before sharing");
      return;
    }
    if (!sampleRows?.rows.length && !selectedFile) {
      setToast("Open data before sharing a chart");
      return;
    }
    void warmSharePreview(socialPresetId);
    useLoomStore.getState().setShareSheetOpen(true);
  }, [activeChart, sampleRows, selectedFile, socialPresetId, setToast]);

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
      const nextPreset = getSocialPreset(socialPresetId);
      if (nextPreset.width && nextPreset.height) {
        setSocialExportTarget({
          width: nextPreset.width,
          height: nextPreset.height,
          pixelRatio: exportSupersample,
          presetId: socialPresetId,
        });
        beginShareReadyAspect(nextPreset.aspectId ?? undefined);
      }
      setToast("Share ready — Esc to exit (panel hides while framing)");
    } else {
      endShareReadyAspect();
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
      const { saveBinaryAndReveal } = await import("@/lib/tauri");
      if (isDesktop()) {
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
      if (isDesktop()) {
        const { saveBinaryAndReveal } = await import("@/lib/tauri");
        const path = await saveBinaryAndReveal(blob, name);
        setToast(path ? "Story bundle saved" : "Save cancelled");
      } else {
        downloadBlob(blob, name);
        setToast("Story bundle downloaded");
      }
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
      !window.confirm("Publish a public dashboard story link? Anyone with the URL can view it.")
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
        setToast("Dashboard story published — URL copied");
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
      const nextPreset = getSocialPreset(socialPresetId === "current" ? "stories" : socialPresetId);
      if (nextPreset.width && nextPreset.height) {
        setSocialExportTarget({
          width: nextPreset.width,
          height: nextPreset.height,
          pixelRatio: 1,
          presetId: nextPreset.id,
        });
        beginShareReadyAspect(nextPreset.aspectId ?? undefined);
      }
      await new Promise((r) => setTimeout(r, 600));
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
      endShareReadyAspect();
      setBusy(null);
    }
  }, [socialPresetId, setSocialExportTarget, setViewMode, displayTitle, setToast]);

  const hasChartExport = activeChart && (pngExportHandler || svgExportHandler);
  const hasTableData = sampleRows && sampleRows.rows.length > 0 && selectedFile;
  const hasQueryData = queryResult && queryResult.rows.length > 0;
  const preset = getSocialPreset(socialPresetId);
  const hasStory = dashboards.length > 0;

  return (
    <div className="p-3 space-y-4">
      {hasChartExport && (
        <button
          type="button"
          onClick={openShareSheet}
          className="loom-btn-primary w-full min-h-10 text-sm font-semibold rounded-lg"
        >
          Share chart…
        </button>
      )}
      <p className="text-2xs text-loom-muted leading-snug">
        Share sheet handles image, caption, link, and NeoSpace. Below: platform framing,
        story packs, video, SVG, and CSV.
      </p>
      {copyError && (
        <p role="alert" className="text-2xs text-loom-warning bg-loom-warning/10 border border-loom-warning/30 rounded px-2 py-1.5 flex items-center justify-between gap-2">
          <span>{copyError}</span>
          <button type="button" onClick={clearError} className="shrink-0 text-loom-muted hover:text-loom-text" aria-label="Dismiss">×</button>
        </p>
      )}

      {/* Capture settings — authoring for Share + story/video */}
      <div className="space-y-1.5">
        <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Capture settings</span>
        <div className="loom-card space-y-2">
          <label className="block text-2xs text-loom-muted">
            Platform size
            <select
              className="loom-input w-full mt-1 text-xs"
              value={socialPresetId}
              onChange={(e) => {
                invalidateSharePreview();
                setSocialPresetId(e.target.value as typeof socialPresetId);
              }}
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
              onChange={(e) => {
                invalidateSharePreview();
                setExportSupersample(e.target.checked ? 2 : 1);
              }}
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
          <p className="text-2xs text-loom-muted leading-snug">
            Frames the chart at the platform size on canvas. Esc exits; the side panels hide while framing.
          </p>
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
                  onChange={(e) => {
                    invalidateSharePreview();
                    setExportBurnIn((prev) => ({ ...prev, [key]: e.target.checked }));
                  }}
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
                onChange={(e) => {
                  invalidateSharePreview();
                  setExportBurnIn((prev) => ({ ...prev, handleText: e.target.value }));
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Story dashboard — multi-chart packs Share sheet doesn’t do */}
      <div className="space-y-1.5">
        <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Story dashboard</span>
        <div className="loom-card space-y-2">
          {!hasStory && (
            <p className="text-2xs text-loom-muted py-1">
              Build a story under Dashboards → Tell a story, then export slides here.
            </p>
          )}
          <button
            type="button"
            onClick={handleCarouselZip}
            disabled={!!busy || !hasStory}
            className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent disabled:opacity-50"
            title="Fresh PNG of each story slide at the platform size"
          >
            {busy === "carousel" ? "Building carousel…" : "Download carousel ZIP (fresh slides)"}
          </button>
          <button
            type="button"
            onClick={handleStoryBundle}
            disabled={!!busy || !hasStory}
            className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent disabled:opacity-50"
            title="Offline HTML + saved view snapshots (not a live re-capture)"
          >
            {busy === "bundle" ? "Bundling…" : "Download offline bundle (HTML + snapshots)"}
          </button>
          <button
            type="button"
            onClick={handlePublishStory}
            disabled={!!busy || !hasStory}
            className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent disabled:opacity-50"
            title="Public multi-slide story page — for a single chart link use Share → Get link"
          >
            {busy === "publish" ? "Publishing…" : "Publish dashboard story link"}
          </button>
          <p className="text-2xs text-loom-muted leading-snug">
            For one chart + optional data snapshot, use Share → Get link instead.
          </p>
        </div>
      </div>

      {/* Video */}
      <div className="space-y-1.5">
        <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Video</span>
        <div className="loom-card space-y-2">
          <button
            type="button"
            onClick={handleExportVideo}
            disabled={!hasChartExport || !!busy}
            className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent disabled:opacity-50"
          >
            {busy === "video" ? "Recording…" : "Export short video (Reel)"}
          </button>
          <p className="text-2xs text-loom-muted leading-snug">
            Records the canvas for ~6s. Best on canvas-painted charts; WebGPU-only scenes may look empty.
          </p>
        </div>
      </div>

      {/* Chart files */}
      <div className="space-y-1.5">
        <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Chart files</span>
        <div className="loom-card space-y-2">
          {!hasChartExport ? (
            <p className="text-2xs text-loom-muted py-1">Select a chart to export PNG, SVG, or config.</p>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCopyPng}
                disabled={!pngExportHandler || !!busy}
                aria-label={`Copy ${preset.label} PNG to clipboard`}
                className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent disabled:opacity-50"
              >
                {pngFeedback ? "Copied!" : busy === "png" ? "Capturing…" : `Copy ${preset.label} PNG`}
              </button>
              <p className="text-2xs text-loom-muted leading-snug -mt-1">
                Clipboard only — Share / Save image live in the Share sheet.
              </p>
              <button
                type="button"
                onClick={handleCopySvg}
                disabled={!svgExportHandler}
                aria-label="Copy chart as SVG to clipboard"
                className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent disabled:opacity-50"
              >
                {svgFeedback ? "Copied!" : svgExportLabel ? "Copy SVG (Vega approx.)" : "Copy SVG"}
              </button>
              <button
                type="button"
                onClick={handleDownloadSvg}
                disabled={!svgExportHandler}
                aria-label="Download chart as SVG file"
                className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent disabled:opacity-50"
              >
                Download SVG
              </button>
              {svgExportLabel && (
                <p className="text-2xs text-loom-muted leading-snug">{svgExportLabel}</p>
              )}
              <button
                type="button"
                onClick={handleCopyChartConfig}
                aria-label="Copy chart and visual config as JSON"
                className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent"
              >
                {configFeedback ? "Copied!" : "Copy encoding + look (JSON)"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Data */}
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
              className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent"
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
              className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent"
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
