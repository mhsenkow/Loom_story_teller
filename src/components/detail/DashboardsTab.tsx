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

export default function DashboardsTab() {
  const {
    dashboards,
    activeDashboardId,
    chartViews,
    queryViews,
    tableViews,
    querySnapshots,
    selectedFile,
    columnStats,
    sampleRows,
    setActiveDashboardId,
    addDashboard,
    removeDashboard,
    addDashboardSlot,
    removeDashboardSlot,
    setDashboardLayout,
    moveDashboardSlot,
    dashboardsExpanded,
    setDashboardsExpanded,
    applyTableView,
    applyChartView,
    applyQueryView,
    applyQuerySnapshot,
    setViewMode,
    setPanelTab,
    setToast,
    setDashboardRefresh,
    createStoryDashboard,
  } = useLoomStore(
    useShallow((s) => ({
      dashboards: s.dashboards,
      activeDashboardId: s.activeDashboardId,
      chartViews: s.chartViews,
      queryViews: s.queryViews,
      tableViews: s.tableViews,
      querySnapshots: s.querySnapshots,
      selectedFile: s.selectedFile,
      columnStats: s.columnStats,
      sampleRows: s.sampleRows,
      setActiveDashboardId: s.setActiveDashboardId,
      addDashboard: s.addDashboard,
      removeDashboard: s.removeDashboard,
      addDashboardSlot: s.addDashboardSlot,
      removeDashboardSlot: s.removeDashboardSlot,
      setDashboardLayout: s.setDashboardLayout,
      moveDashboardSlot: s.moveDashboardSlot,
      dashboardsExpanded: s.dashboardsExpanded,
      setDashboardsExpanded: s.setDashboardsExpanded,
      applyTableView: s.applyTableView,
      applyChartView: s.applyChartView,
      applyQueryView: s.applyQueryView,
      applyQuerySnapshot: s.applyQuerySnapshot,
      setViewMode: s.setViewMode,
      setPanelTab: s.setPanelTab,
      setToast: s.setToast,
      setDashboardRefresh: s.setDashboardRefresh,
      createStoryDashboard: s.createStoryDashboard,
    })),
  );
  const active = dashboards.find((d) => d.id === activeDashboardId);

  const getSlotLabel = useCallback(
    (viewType: "table" | "chart" | "query" | "snapshot", viewId: string) => {
      if (viewType === "table") {
        const v = tableViews.find((x) => x.id === viewId);
        return v ? v.name : viewId;
      }
      if (viewType === "chart") {
        const v = chartViews.find((x) => x.id === viewId);
        return v ? v.name : viewId;
      }
      if (viewType === "snapshot") {
        const v = querySnapshots.find((x) => x.id === viewId);
        return v ? v.name : viewId;
      }
      const v = queryViews.find((x) => x.id === viewId);
      return v ? v.name : viewId;
    },
    [tableViews, chartViews, querySnapshots, queryViews],
  );

  const handleCreateStoryDashboard = useCallback(async () => {
    if (!selectedFile) {
      setToast("Select a file first to create a story dashboard");
      return;
    }
    const story = recommendStorySequence(columnStats, sampleRows, selectedFile.name);
    if (story.charts.length === 0) {
      setToast("Not enough data variety to build a story. Try a file with categories and numbers.");
      return;
    }
    const id = createStoryDashboard(selectedFile.path, selectedFile.name, story.title, story.charts, sampleRows);
    if (!id) {
      setToast("Could not create story dashboard");
      return;
    }
    const dashboard = useLoomStore.getState().dashboards.find((d) => d.id === id);
    const chartIds = dashboard?.slots.filter((s) => s.viewType === "chart").map((s) => s.viewId) ?? [];
    if (chartIds.length > 0) {
      setToast(`Building "${story.title}" — capturing ${chartIds.length} previews…`);
      await captureStoryDashboardPreviews(id);
    } else {
      setDashboardsExpanded(true);
      setToast(`Created "${story.title}" with ${story.charts.length} charts`);
    }
  }, [selectedFile, columnStats, sampleRows, createStoryDashboard, setDashboardsExpanded, setToast]);

  const handleCreateStreamDashboard = useCallback(async () => {
    setToast("Loading stream data…");
    try {
      const snap = await streamSnapshot(500);
      if (!snap.sample.rows.length) {
        setToast("No stream data yet. Connect to Wikipedia stream first and wait a few seconds.");
        return;
      }
      const story = recommendStreamStory(snap.stats, snap.sample);
      if (story.charts.length === 0) {
        setToast("Could not generate stream charts");
        return;
      }
      const id = createStoryDashboard("stream://wiki", "Wikipedia Live", story.title, story.charts, snap.sample);
      if (!id) {
        setToast("Could not create stream dashboard");
        return;
      }
      const dashboard = useLoomStore.getState().dashboards.find((d) => d.id === id);
      const chartIds = dashboard?.slots.filter((s) => s.viewType === "chart").map((s) => s.viewId) ?? [];
      if (chartIds.length > 0) {
        setToast(`Building "${story.title}" — capturing ${chartIds.length} previews…`);
        await captureStoryDashboardPreviews(id);
      } else {
        setDashboardsExpanded(true);
        setToast(`Created "${story.title}" with ${story.charts.length} charts`);
      }
    } catch (e) {
      setToast(`Stream dashboard failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [createStoryDashboard, setDashboardsExpanded, setToast]);

  const handleExportMicrosite = useCallback(async () => {
    if (!active) return;
    const slots = active.slots.map((slot) => {
      const label = getSlotLabel(slot.viewType, slot.viewId);
      let snapshotDataUrl: string | null = null;
      let sourceLabel: string | undefined;
      if (slot.viewType === "chart") {
        const v = chartViews.find((x) => x.id === slot.viewId);
        snapshotDataUrl = v?.snapshotImageDataUrl ?? null;
        sourceLabel = v?.fileName;
      } else if (slot.viewType === "table") {
        const v = tableViews.find((x) => x.id === slot.viewId);
        sourceLabel = v?.name;
      } else if (slot.viewType === "query") {
        const v = queryViews.find((x) => x.id === slot.viewId);
        sourceLabel = v?.name;
      } else {
        const v = querySnapshots.find((x) => x.id === slot.viewId);
        sourceLabel = v?.name;
      }
      return { label, viewType: slot.viewType, snapshotDataUrl, sourceLabel };
    });
    const html = buildDashboardMicrositeHtml({
      dashboardName: active.name,
      slots,
      lastUpdatedMs: active.lastRefreshedAt ?? null,
      layoutTemplate: active.layoutTemplate ?? "auto",
      ogImageDataUrl: slots.find((s) => s.snapshotDataUrl)?.snapshotDataUrl ?? null,
    });
    try {
      const ok = await exportDashboardMicrosite(html, `${active.name}.html`);
      setToast(ok ? "Dashboard exported as microsite" : "Export cancelled");
    } catch (e) {
      console.error(e);
      setToast("Export failed");
    }
  }, [active, chartViews, tableViews, queryViews, querySnapshots, setToast, getSlotLabel]);

  const handleApplySlot = (viewType: "table" | "chart" | "query" | "snapshot", viewId: string) => {
    if (viewType === "table") applyTableView(viewId);
    else if (viewType === "chart") applyChartView(viewId);
    else if (viewType === "query") applyQueryView(viewId);
    else applyQuerySnapshot(viewId);
    setViewMode(viewType === "table" || viewType === "snapshot" ? "explorer" : viewType === "chart" ? "chart" : "query");
    setPanelTab(viewType === "table" || viewType === "snapshot" ? "stats" : viewType === "chart" ? "chart" : "stats");
  };

  const hasAnySavedViews = tableViews.length > 0 || chartViews.length > 0 || queryViews.length > 0 || querySnapshots.length > 0;
  const touchBtn =
    "inline-flex items-center justify-center min-h-9 px-2.5 rounded-md border text-xs font-medium transition-colors";

  const renderSavedRow = (
    kind: "table" | "chart" | "query" | "snapshot",
    v: { id: string; name: string },
    kindLabel: string,
  ) => (
    <li key={v.id} className="flex items-center gap-2 min-h-10">
      <span className="text-2xs text-loom-muted shrink-0 w-11">{kindLabel}</span>
      <span className="flex-1 text-xs text-loom-text truncate min-w-0" title={v.name}>
        {v.name}
      </span>
      {active && (
        <button
          type="button"
          onClick={() => {
            addDashboardSlot(active.id, kind, v.id);
            setToast("Added to dashboard");
          }}
          className={`${touchBtn} shrink-0 border-loom-border text-loom-muted hover:text-loom-text hover:border-loom-accent`}
          title={`Add “${v.name}” to ${active.name}`}
        >
          Add
        </button>
      )}
    </li>
  );

  const toggleSeeBoard = () => {
    if (!active) return;
    setDashboardsExpanded(!dashboardsExpanded);
  };

  const selectBoard = (id: string) => {
    setActiveDashboardId(id);
    // Switching boards while viewing keeps the canvas on the new board
    if (dashboardsExpanded) setDashboardsExpanded(true);
  };

  return (
    <div className="p-3 space-y-3 flex flex-col min-h-0">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => addDashboard("New dashboard")}
          className="loom-btn-primary text-xs min-h-9 px-3"
        >
          + New board
        </button>
        {active && (
          <button
            type="button"
            onClick={toggleSeeBoard}
            aria-pressed={dashboardsExpanded}
            className={`${touchBtn} ${
              dashboardsExpanded
                ? "border-loom-accent bg-loom-accent/20 text-loom-text"
                : "border-loom-accent text-loom-accent hover:bg-loom-accent/10"
            }`}
            title={dashboardsExpanded ? "Hide the board canvas" : "Show this board in the main area"}
          >
            {dashboardsExpanded ? "Hide board" : "See board"}
          </button>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Boards</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCreateStoryDashboard}
              className="text-2xs min-h-8 px-2 rounded border border-transparent text-loom-muted hover:text-loom-accent hover:border-loom-accent/40"
              title="Auto-create a story board from the open dataset"
            >
              Story
            </button>
            <button
              type="button"
              onClick={handleCreateStreamDashboard}
              className="text-2xs min-h-8 px-2 rounded border border-transparent text-loom-muted hover:text-loom-success hover:border-loom-success/40"
              title="Create a live stream board"
            >
              Stream
            </button>
          </div>
        </div>
        {dashboards.length === 0 ? (
          <p className="text-2xs text-loom-muted py-1">No boards yet — create one above.</p>
        ) : (
          <ul className="space-y-1" role="listbox" aria-label="Boards">
            {dashboards.map((d) => {
              const selected = activeDashboardId === d.id;
              return (
                <li key={d.id} className="flex items-center gap-1 min-h-10">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => selectBoard(d.id)}
                    className={`flex-1 min-w-0 min-h-9 text-left text-xs px-2.5 rounded-md truncate transition-colors ${
                      selected
                        ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50"
                        : "text-loom-muted hover:text-loom-text hover:bg-loom-elevated/50 border border-transparent"
                    }`}
                  >
                    {d.name}
                    {selected && dashboardsExpanded ? (
                      <span className="ml-1.5 text-2xs text-loom-accent font-normal">· showing</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeDashboard(d.id)}
                    className="shrink-0 min-h-9 min-w-9 text-loom-muted hover:text-loom-text text-sm rounded"
                    aria-label={`Remove ${d.name}`}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {active && (
        <>
          <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-loom-border/50">
            <div className="min-w-0">
              <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Slots</span>
              <p className="text-2xs text-loom-muted truncate" title={active.name}>
                on {active.name}
              </p>
            </div>
            <AddViewDropdown
              dashboardId={active.id}
              addDashboardSlot={addDashboardSlot}
              tableViews={tableViews}
              chartViews={chartViews}
              queryViews={queryViews}
              querySnapshots={querySnapshots}
            />
          </div>
          {active.slots.length === 0 ? (
            <div className="text-2xs text-loom-muted py-1 space-y-1">
              <p>No views on this board yet.</p>
              <p>
                Tap <strong>Add</strong> next to a saved view below, or <strong>+ Add view</strong>.
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {active.slots.map((slot, idx) => {
                const chartView = slot.viewType === "chart" ? chartViews.find((x) => x.id === slot.viewId) : null;
                const snapshotUrl = chartView?.snapshotImageDataUrl ?? null;
                return (
                  <li key={slot.id} className="flex items-center gap-1.5 loom-card px-2 py-1.5 min-h-11">
                    <div className="flex flex-col shrink-0">
                      <button
                        type="button"
                        onClick={() => moveDashboardSlot(active.id, slot.id, "up")}
                        disabled={idx === 0}
                        className="min-h-7 min-w-7 text-loom-muted hover:text-loom-text disabled:opacity-30"
                        aria-label="Move up"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDashboardSlot(active.id, slot.id, "down")}
                        disabled={idx === active.slots.length - 1}
                        className="min-h-7 min-w-7 text-loom-muted hover:text-loom-text disabled:opacity-30"
                        aria-label="Move down"
                      >
                        ▼
                      </button>
                    </div>
                    {snapshotUrl ? (
                      <div className="shrink-0 w-10 h-8 rounded overflow-hidden bg-loom-bg/50 flex items-center justify-center">
                        <img src={snapshotUrl} alt="" className="max-w-full max-h-full object-contain" />
                      </div>
                    ) : (
                      <span className="text-2xs text-loom-muted shrink-0 w-10">{slot.viewType}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleApplySlot(slot.viewType, slot.viewId)}
                      className="flex-1 text-left text-xs text-loom-text truncate hover:underline min-w-0 min-h-9"
                    >
                      {getSlotLabel(slot.viewType, slot.viewId)}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeDashboardSlot(active.id, slot.id)}
                      className="shrink-0 min-h-9 min-w-9 text-loom-muted hover:text-loom-text text-sm rounded"
                      aria-label="Remove slot"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-1">
            <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Layout</span>
            <select
              value={active.layoutTemplate ?? "auto"}
              onChange={(e) =>
                setDashboardLayout(
                  active.id,
                  (e.target.value as import("@/lib/store").DashboardLayoutTemplate) || "auto",
                )
              }
              className="text-xs w-full min-h-9 px-2 py-1.5 rounded border border-loom-border bg-loom-surface text-loom-text"
            >
              <option value="auto">Auto (responsive)</option>
              <option value="1x1">1×1</option>
              <option value="2x1">2×1</option>
              <option value="2x2">2×2</option>
              <option value="3x2">3×2</option>
              <option value="1+2">1 large + 2</option>
              <option value="stream">Stream (hero + grid)</option>
            </select>
          </div>
        </>
      )}

      <div className="space-y-1">
        <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Your saved views</span>
        {!hasAnySavedViews ? (
          <p className="text-2xs text-loom-muted py-1">
            Save a view from Chart, Query, or Explorer — it shows up here to add to a board.
          </p>
        ) : (
          <ul className="space-y-0.5 max-h-[min(36vh,14rem)] overflow-y-auto pr-0.5 -mr-0.5">
            {tableViews.map((v) => renderSavedRow("table", v, "Table"))}
            {chartViews.map((v) => renderSavedRow("chart", v, "Chart"))}
            {queryViews.map((v) => renderSavedRow("query", v, "Query"))}
            {querySnapshots.map((v) => renderSavedRow("snapshot", v, "Snap"))}
          </ul>
        )}
      </div>

      {active && (
        <details className="rounded-md border border-loom-border/70 bg-loom-surface/40 open:pb-2">
          <summary className="cursor-pointer select-none text-2xs font-semibold text-loom-muted uppercase tracking-wider px-2.5 py-2.5 min-h-9">
            Update &amp; export
          </summary>
          <div className="px-2.5 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={active.refreshInterval ?? "manual"}
                onChange={(e) =>
                  setDashboardRefresh(
                    active.id,
                    (e.target.value as import("@/lib/store").DashboardRefreshInterval) || "manual",
                  )
                }
                className="text-xs min-h-9 px-2 py-1.5 rounded border border-loom-border bg-loom-surface text-loom-text"
              >
                <option value="manual">Manual</option>
                <option value="1m">1 min</option>
                <option value="5m">5 min</option>
                <option value="15m">15 min</option>
                <option value="1h">1 hour</option>
                <option value="1d">1 day</option>
              </select>
              <button
                type="button"
                onClick={() => setDashboardRefresh(active.id, null, Date.now())}
                className={`${touchBtn} border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated`}
              >
                Refresh now
              </button>
              {active.lastRefreshedAt != null && (
                <span className="text-2xs text-loom-muted">
                  Updated{" "}
                  {new Date(active.lastRefreshedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </div>
            {active.slots.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={handleExportMicrosite}
                  className={`${touchBtn} w-full border-loom-border text-loom-muted hover:text-loom-text hover:border-loom-accent`}
                  title="Export as a self-contained HTML file"
                >
                  Export microsite
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const { exportStoryCarouselZip } = await import("@/lib/exportStoryCarousel");
                      const presetId = useLoomStore.getState().socialPresetId;
                      const result = await exportStoryCarouselZip(active.id, presetId);
                      if (!result) {
                        setToast("Could not capture story slides");
                        return;
                      }
                      const name = `${active.name.replace(/[^\w\-]+/g, "_")}-carousel.zip`;
                      const { saveBinaryAndReveal, isDesktop: desktop } = await import("@/lib/tauri");
                      const { shareOrDownloadFile } = await import("@/lib/socialExport");
                      if (desktop()) {
                        const path = await saveBinaryAndReveal(result.blob, name);
                        setToast(path ? `Saved ${result.count}-slide pack` : "Save cancelled");
                      } else {
                        await shareOrDownloadFile(result.blob, name, active.name);
                        setToast(`Exported ${result.count}-slide carousel ZIP`);
                      }
                    } catch (e) {
                      console.error(e);
                      setToast("Carousel export failed");
                    }
                  }}
                  className={`${touchBtn} w-full border-loom-accent/40 text-loom-accent hover:bg-loom-accent/10`}
                  title="Export chart slots as numbered PNGs for Instagram carousel / Stories"
                >
                  Export carousel ZIP
                </button>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function AddViewDropdown({
  dashboardId,
  addDashboardSlot,
  tableViews,
  chartViews,
  queryViews,
  querySnapshots,
}: {
  dashboardId: string;
  addDashboardSlot: (dashboardId: string, viewType: "table" | "chart" | "query" | "snapshot", viewId: string) => void;
  tableViews: { id: string; name: string }[];
  chartViews: { id: string; name: string }[];
  queryViews: { id: string; name: string }[];
  querySnapshots: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const allEmpty = tableViews.length === 0 && chartViews.length === 0 && queryViews.length === 0 && querySnapshots.length === 0;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={allEmpty}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        className="inline-flex items-center justify-center min-h-9 px-2.5 rounded-md border border-loom-border text-xs text-loom-muted hover:text-loom-text disabled:opacity-50"
      >
        + Add view
      </button>
      {open && !allEmpty && (
        <>
          <div className="fixed inset-0 z-10" aria-hidden onClick={() => setOpen(false)} />
          <div
            id={menuId}
            role="menu"
            className="loom-menu absolute right-0 top-full mt-1 z-20 min-w-[160px] py-1 rounded"
            onClick={(e) => e.stopPropagation()}
          >
            {tableViews.length > 0 && (
              <>
                <p className="px-2 py-0.5 text-2xs text-loom-muted uppercase">Table</p>
                {tableViews.map((v) => (
                  <button key={v.id} type="button" role="menuitem" onClick={() => { addDashboardSlot(dashboardId, "table", v.id); setOpen(false); }} className="w-full text-left text-xs px-2.5 min-h-9 py-2 hover:bg-loom-elevated text-loom-text truncate">
                    {v.name}
                  </button>
                ))}
              </>
            )}
            {chartViews.length > 0 && (
              <>
                <p className="px-2 py-0.5 text-2xs text-loom-muted uppercase mt-1">Chart</p>
                {chartViews.map((v) => (
                  <button key={v.id} type="button" role="menuitem" onClick={() => { addDashboardSlot(dashboardId, "chart", v.id); setOpen(false); }} className="w-full text-left text-xs px-2.5 min-h-9 py-2 hover:bg-loom-elevated text-loom-text truncate">
                    {v.name}
                  </button>
                ))}
              </>
            )}
            {queryViews.length > 0 && (
              <>
                <p className="px-2 py-0.5 text-2xs text-loom-muted uppercase mt-1">Query</p>
                {queryViews.map((v) => (
                  <button key={v.id} type="button" role="menuitem" onClick={() => { addDashboardSlot(dashboardId, "query", v.id); setOpen(false); }} className="w-full text-left text-xs px-2.5 min-h-9 py-2 hover:bg-loom-elevated text-loom-text truncate">
                    {v.name}
                  </button>
                ))}
              </>
            )}
            {querySnapshots.length > 0 && (
              <>
                <p className="px-2 py-0.5 text-2xs text-loom-muted uppercase mt-1">Snapshot</p>
                {querySnapshots.map((v) => (
                  <button key={v.id} type="button" role="menuitem" onClick={() => { addDashboardSlot(dashboardId, "snapshot", v.id); setOpen(false); }} className="w-full text-left text-xs px-2.5 min-h-9 py-2 hover:bg-loom-elevated text-loom-text truncate">
                    {v.name}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// --- Settings tab: app-wide theme, typography, accessibility ---
