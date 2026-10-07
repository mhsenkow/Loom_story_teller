// =================================================================
// DetailPanel — Stats / Chart (Vega & visual)
// =================================================================
// Right panel: Stats and Chart tabs. Schema lives in the footer.
// Chart tab: Encoding | Visual secondary header; encoding slots, Visual presets, Vega JSON.
// =================================================================

"use client";

import { useState, useCallback, useMemo, type ReactNode, type DragEvent } from "react";
import { useMobileLiveEdit, MOBILE_LIVE_EDIT_SHEET } from "@/lib/useMediaQuery";
import { useLoomStore, type PanelTab, type ChartVisualOverrides, type AppTheme, type FontScale } from "@/lib/store";
import { formatNumber } from "@/lib/format";
import { ChartKindPicker } from "@/components/ChartKindPicker";
import {
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
import { CHANGELOG, requestWhatsNew } from "@/lib/changelog";
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
import { computeDataQualityHints, formatChartAggregationSummary, chartCapabilities, encodingChannelLabels } from "@/lib/chartSupport";
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
  type AnomalyMethod,
} from "@/lib/smartAnalytics";
import { queryResultToCsv, downloadCsv } from "@/lib/csvExport";
import { buildDashboardMicrositeHtml } from "@/lib/dashboardMicrosite";
import { exportDashboardMicrosite, streamSnapshot, isTauri, isTauri as checkTauri, openExternalUrl } from "@/lib/tauri";
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

const TABS: { key: PanelTab; label: string }[] = [
  { key: "stats", label: "Stats" },
  { key: "chart", label: "Chart" },
  { key: "export", label: "Export" },
  { key: "smart", label: "Smart" },
  { key: "dashboards", label: "Dashboards" },
  { key: "settings", label: "Settings" },
];

export function DetailPanel() {
  const { panelOpen, panelTab, setPanelTab, selectedFile, togglePanel } = useLoomStore();
  const liveEdit = useMobileLiveEdit();

  if (!panelOpen) return null;

  return (
    <>
      {/* Mobile backdrop — undimmed while live-editing so the chart above stays readable */}
      <button
        type="button"
        className={`md:hidden fixed inset-0 z-[35] ${liveEdit ? "bg-transparent" : "loom-overlay animate-fade-in"}`}
        aria-label="Close detail panel"
        onClick={togglePanel}
      />
      <aside
        className={`
          flex flex-col bg-loom-surface flex-shrink-0 animate-slide-up md:animate-none
          md:relative md:h-full md:w-[var(--panel-width)] md:border-l md:border-loom-border md:z-auto
          fixed inset-x-0 bottom-0 z-40 w-full
          border-t border-loom-border rounded-t-2xl shadow-loom-lg
          md:max-h-none md:rounded-none md:shadow-none md:inset-auto
          ${liveEdit ? "" : "h-[min(88dvh,44rem)]"}
        `}
        style={{ paddingBottom: "var(--safe-bottom)", ...(liveEdit ? { height: MOBILE_LIVE_EDIT_SHEET } : {}) }}
      >
        {/* Mobile sheet chrome */}
        <div className={`md:hidden relative flex items-center justify-between px-4 shrink-0 ${liveEdit ? "pt-2.5 pb-0" : "pt-3.5 pb-1.5"}`}>
          <div className="pointer-events-none absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-loom-border/80" />
          <span className="text-sm font-semibold text-loom-text tracking-tight">
            {TABS.find((t) => t.key === panelTab)?.label ?? "Details"}
          </span>
          <button type="button" onClick={togglePanel} className="loom-btn-ghost min-h-9 min-w-9 flex items-center justify-center text-loom-muted text-lg leading-none rounded-md" aria-label="Close">
            ×
          </button>
        </div>
      {/* Tab Bar */}
      <div role="tablist" aria-label="Panel sections" className="loom-tabs px-1.5 sm:px-2 min-h-[var(--topbar-height)] border-b border-loom-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`panel-tab-${tab.key}`}
            aria-controls="panel-content"
            aria-selected={panelTab === tab.key}
            tabIndex={panelTab === tab.key ? 0 : -1}
            aria-label={tab.label}
            onClick={() => setPanelTab(tab.key)}
            onKeyDown={(e) => {
              const i = TABS.findIndex((t) => t.key === panelTab);
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                const next = TABS[(i + 1) % TABS.length];
                setPanelTab(next.key);
                queueMicrotask(() => document.getElementById(`panel-tab-${next.key}`)?.focus());
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                const prev = TABS[(i - 1 + TABS.length) % TABS.length];
                setPanelTab(prev.key);
                queueMicrotask(() => document.getElementById(`panel-tab-${prev.key}`)?.focus());
              } else if (e.key === "Home") {
                e.preventDefault();
                setPanelTab(TABS[0].key);
                queueMicrotask(() => document.getElementById(`panel-tab-${TABS[0].key}`)?.focus());
              } else if (e.key === "End") {
                e.preventDefault();
                const last = TABS[TABS.length - 1];
                setPanelTab(last.key);
                queueMicrotask(() => document.getElementById(`panel-tab-${last.key}`)?.focus());
              }
            }}
            className="loom-tab"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div role="tabpanel" id="panel-content" aria-labelledby={`panel-tab-${panelTab}`} className="flex-1 overflow-y-auto">
        {panelTab === "settings" ? (
          <SettingsView />
        ) : panelTab === "dashboards" ? (
          <DashboardsView />
        ) : !selectedFile ? (
          <div className="flex items-center justify-center h-full px-6 py-10">
            <p className="text-sm text-loom-muted text-center leading-relaxed">Select a file to inspect</p>
          </div>
        ) : panelTab === "stats" ? (
          <StatsView />
        ) : panelTab === "export" ? (
          <ExportView />
        ) : panelTab === "smart" ? (
          <SmartView />
        ) : (
          <ChartPanelView />
        )}
      </div>
    </aside>
    </>
  );
}

// --- Dashboards tab: saved dashboards, slots, focus/expand ---
function DashboardsView() {
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
  } = useLoomStore();
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
    if (!checkTauri()) {
      setToast("Stream dashboards require the desktop app");
      return;
    }
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

  return (
    <div className="p-3 space-y-3 flex flex-col min-h-0">
      <p className="text-2xs text-loom-muted">
        Quickly build dashboards from your existing chart, query, and table views. Saved views are persisted in your local storage so you don&apos;t lose them.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={handleCreateStoryDashboard}
          className="text-xs py-1.5 px-2 rounded border border-loom-accent bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 font-medium"
          title="Auto-create a dashboard of charts that tell a story (trend, breakdown, distribution, relationship)"
        >
          Tell a story
        </button>
        <button
          type="button"
          onClick={handleCreateStreamDashboard}
          className="text-xs py-1.5 px-2 rounded border border-loom-success/50 bg-loom-success/10 text-loom-success hover:bg-loom-success/20 font-medium"
          title="Create a live analytics dashboard from the Wikipedia event stream (connect in Data &amp; sources first)"
        >
          Stream dashboard
        </button>
        <button
          type="button"
          onClick={() => addDashboard("New dashboard")}
          className="loom-btn-primary text-xs py-1.5 px-2"
        >
          + New dashboard
        </button>
        {active && (
          <button
            type="button"
            onClick={() => setDashboardsExpanded(true)}
            className="text-xs py-1.5 px-2 rounded border border-loom-accent text-loom-accent hover:bg-loom-accent/10"
            title="Expand dashboard to main area"
          >
            Expand
          </button>
        )}
      </div>

      {active && (
        <div className="space-y-1">
          <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Update</span>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={active.refreshInterval ?? "manual"}
              onChange={(e) => setDashboardRefresh(active.id, (e.target.value as import("@/lib/store").DashboardRefreshInterval) || "manual")}
              className="text-2xs px-1.5 py-0.5 rounded border border-loom-border bg-loom-surface text-loom-text"
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
              className="text-2xs px-2 py-0.5 rounded border border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated"
            >
              Refresh now
            </button>
            {active.lastRefreshedAt != null && (
              <span className="text-2xs text-loom-muted">
                Last updated {new Date(active.lastRefreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
          <p className="text-2xs text-loom-muted/80">Refresh interval is a hint for when data might be stale; use &quot;Refresh now&quot; to update.</p>
        </div>
      )}

      {active && active.slots.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleExportMicrosite}
            className="text-xs py-1.5 px-2 rounded border border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated hover:border-loom-accent"
            title="Export dashboard as a self-contained HTML file (data lineage included)"
          >
            Export as microsite
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
                const { saveBinaryAndReveal, isTauri: tauri } = await import("@/lib/tauri");
                const { shareOrDownloadFile } = await import("@/lib/socialExport");
                if (tauri()) {
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
            className="text-xs py-1.5 px-2 rounded border border-loom-accent/40 text-loom-accent hover:bg-loom-accent/10"
            title="Export chart slots as numbered PNGs for Instagram carousel / Stories"
          >
            Export carousel ZIP
          </button>
        </div>
      )}

      {/* Saved views — always visible so users see what they have and can add to dashboard */}
      <div className="space-y-1">
        <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Your saved views</span>
        {!hasAnySavedViews ? (
          <p className="text-2xs text-loom-muted py-1">
            No saved views yet. In the <strong>Chart</strong> tab click &quot;Save view&quot; above the chart; in <strong>Query</strong> use &quot;Save view&quot;; in <strong>Explorer</strong> open Views → &quot;Save current view&quot;.
          </p>
        ) : (
          <ul className="space-y-1">
            {tableViews.map((v) => (
              <li key={v.id} className="flex items-center gap-2 group">
                <span className="text-2xs text-loom-muted shrink-0 w-12">Table</span>
                <span className="flex-1 text-xs text-loom-text truncate">{v.name}</span>
                {active && (
                  <button
                    type="button"
                    onClick={() => { addDashboardSlot(active.id, "table", v.id); setToast("Added to dashboard"); }}
                    className="text-2xs py-0.5 px-1.5 rounded border border-loom-border text-loom-muted hover:text-loom-text hover:border-loom-accent shrink-0"
                  >
                    Add to dashboard
                  </button>
                )}
              </li>
            ))}
            {chartViews.map((v) => (
              <li key={v.id} className="flex items-center gap-2 group">
                <span className="text-2xs text-loom-muted shrink-0 w-12">Chart</span>
                <span className="flex-1 text-xs text-loom-text truncate">{v.name}</span>
                {active && (
                  <button
                    type="button"
                    onClick={() => { addDashboardSlot(active.id, "chart", v.id); setToast("Added to dashboard"); }}
                    className="text-2xs py-0.5 px-1.5 rounded border border-loom-border text-loom-muted hover:text-loom-text hover:border-loom-accent shrink-0"
                  >
                    Add to dashboard
                  </button>
                )}
              </li>
            ))}
            {queryViews.map((v) => (
              <li key={v.id} className="flex items-center gap-2 group">
                <span className="text-2xs text-loom-muted shrink-0 w-12">Query</span>
                <span className="flex-1 text-xs text-loom-text truncate">{v.name}</span>
                {active && (
                  <button
                    type="button"
                    onClick={() => { addDashboardSlot(active.id, "query", v.id); setToast("Added to dashboard"); }}
                    className="text-2xs py-0.5 px-1.5 rounded border border-loom-border text-loom-muted hover:text-loom-text hover:border-loom-accent shrink-0"
                  >
                    Add to dashboard
                  </button>
                )}
              </li>
            ))}
            {querySnapshots.map((v) => (
              <li key={v.id} className="flex items-center gap-2 group">
                <span className="text-2xs text-loom-muted shrink-0 w-12">Snapshot</span>
                <span className="flex-1 text-xs text-loom-text truncate">{v.name}</span>
                {active && (
                  <button
                    type="button"
                    onClick={() => { addDashboardSlot(active.id, "snapshot", v.id); setToast("Added to dashboard"); }}
                    className="text-2xs py-0.5 px-1.5 rounded border border-loom-border text-loom-muted hover:text-loom-text hover:border-loom-accent shrink-0"
                  >
                    Add to dashboard
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1">
        <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Dashboards</span>
        {dashboards.length === 0 ? (
          <p className="text-2xs text-loom-muted py-1">No dashboards yet. Create one above.</p>
        ) : (
          <ul className="space-y-1">
            {dashboards.map((d) => (
              <li key={d.id} className="flex items-center gap-1 group">
                <button
                  type="button"
                  onClick={() => setActiveDashboardId(activeDashboardId === d.id ? null : d.id)}
                  className={`flex-1 min-w-0 text-left text-xs px-2 py-1.5 rounded truncate transition-colors ${activeDashboardId === d.id ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50" : "text-loom-muted hover:text-loom-text hover:bg-loom-elevated/50 border border-transparent"
                    }`}
                >
                  {d.name}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActiveDashboardId(d.id); setDashboardsExpanded(true); }}
                  className="shrink-0 text-xs px-2 py-1 rounded border border-loom-accent text-loom-accent hover:bg-loom-accent/10"
                  title={`Expand ${d.name} to main area`}
                >
                  Expand
                </button>
                <button
                  type="button"
                  onClick={() => removeDashboard(d.id)}
                  className="opacity-0 group-hover:opacity-100 text-loom-muted hover:text-loom-text text-xs p-1 rounded"
                  aria-label={`Remove ${d.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {active && (
        <>
          <div className="space-y-1">
            <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Layout</span>
            <select
              value={active.layoutTemplate ?? "auto"}
              onChange={(e) => setDashboardLayout(active.id, (e.target.value as import("@/lib/store").DashboardLayoutTemplate) || "auto")}
              className="text-2xs w-full px-2 py-1 rounded border border-loom-border bg-loom-surface text-loom-text"
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
          <div className="flex items-center justify-between">
            <span className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Slots</span>
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
              <p>No views in this dashboard yet.</p>
              {hasAnySavedViews ? (
                <p>Use <strong>&quot;Add to dashboard&quot;</strong> next to any saved view above, or open <strong>&quot;+ Add view&quot;</strong> to pick one.</p>
              ) : (
                <p>Save a view first from the Chart, Query, or Explorer tab (see &quot;Your saved views&quot; above for how).</p>
              )}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {active.slots.map((slot, idx) => {
                const chartView = slot.viewType === "chart" ? chartViews.find((x) => x.id === slot.viewId) : null;
                const snapshotUrl = chartView?.snapshotImageDataUrl ?? null;
                return (
                  <li key={slot.id} className="flex items-center gap-1 group loom-card px-2 py-1.5">
                    <div className="flex flex-col shrink-0 opacity-60 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => moveDashboardSlot(active.id, slot.id, "up")}
                        disabled={idx === 0}
                        className="p-0.5 text-loom-muted hover:text-loom-text disabled:opacity-30"
                        aria-label="Move up"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDashboardSlot(active.id, slot.id, "down")}
                        disabled={idx === active.slots.length - 1}
                        className="p-0.5 text-loom-muted hover:text-loom-text disabled:opacity-30"
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
                      className="flex-1 text-left text-xs text-loom-text truncate hover:underline min-w-0"
                    >
                      {getSlotLabel(slot.viewType, slot.viewId)}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeDashboardSlot(active.id, slot.id)}
                      className="opacity-0 group-hover:opacity-100 text-loom-muted hover:text-loom-text text-xs p-0.5 shrink-0"
                      aria-label="Remove slot"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
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
  const allEmpty = tableViews.length === 0 && chartViews.length === 0 && queryViews.length === 0 && querySnapshots.length === 0;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={allEmpty}
        className="text-2xs py-1 px-2 rounded border border-loom-border text-loom-muted hover:text-loom-text disabled:opacity-50"
      >
        + Add view
      </button>
      {open && !allEmpty && (
        <>
          <div className="fixed inset-0 z-10" aria-hidden onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 z-20 min-w-[160px] py-1 rounded border border-loom-border bg-loom-surface shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {tableViews.length > 0 && (
              <>
                <p className="px-2 py-0.5 text-2xs text-loom-muted uppercase">Table</p>
                {tableViews.map((v) => (
                  <button key={v.id} type="button" onClick={() => { addDashboardSlot(dashboardId, "table", v.id); setOpen(false); }} className="w-full text-left text-xs px-2 py-1 hover:bg-loom-elevated text-loom-text truncate">
                    {v.name}
                  </button>
                ))}
              </>
            )}
            {chartViews.length > 0 && (
              <>
                <p className="px-2 py-0.5 text-2xs text-loom-muted uppercase mt-1">Chart</p>
                {chartViews.map((v) => (
                  <button key={v.id} type="button" onClick={() => { addDashboardSlot(dashboardId, "chart", v.id); setOpen(false); }} className="w-full text-left text-xs px-2 py-1 hover:bg-loom-elevated text-loom-text truncate">
                    {v.name}
                  </button>
                ))}
              </>
            )}
            {queryViews.length > 0 && (
              <>
                <p className="px-2 py-0.5 text-2xs text-loom-muted uppercase mt-1">Query</p>
                {queryViews.map((v) => (
                  <button key={v.id} type="button" onClick={() => { addDashboardSlot(dashboardId, "query", v.id); setOpen(false); }} className="w-full text-left text-xs px-2 py-1 hover:bg-loom-elevated text-loom-text truncate">
                    {v.name}
                  </button>
                ))}
              </>
            )}
            {querySnapshots.length > 0 && (
              <>
                <p className="px-2 py-0.5 text-2xs text-loom-muted uppercase mt-1">Snapshot</p>
                {querySnapshots.map((v) => (
                  <button key={v.id} type="button" onClick={() => { addDashboardSlot(dashboardId, "snapshot", v.id); setOpen(false); }} className="w-full text-left text-xs px-2 py-1 hover:bg-loom-elevated text-loom-text truncate">
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
function SettingsView() {
  const { appSettings, setAppSettings, setToast } = useLoomStore();
  const fontScales: { value: FontScale; label: string }[] = [
    { value: 0.9, label: "90%" },
    { value: 1, label: "100%" },
    { value: 1.1, label: "110%" },
    { value: 1.15, label: "115%" },
  ];
  const currentTheme = (appSettings.theme === "high-contrast" ? "contrast" : appSettings.theme === "colorblind" ? "dark" : appSettings.theme) as LookTheme;

  return (
    <div className="p-4 space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Discover</h3>
        <p className="text-2xs text-loom-muted mb-2">
          Intro scan of live feeds for chart-ready stories (shown once until you skip it).
        </p>
        <button
          type="button"
          className="loom-btn-primary text-xs py-1.5 px-3"
          onClick={() => {
            requestDiscoverScan();
            setToast("Scanning feeds for something interesting…");
          }}
        >
          What’s interesting right now
        </button>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">What’s new</h3>
        <p className="text-2xs text-loom-muted mb-2">Recent features and fixes{CHANGELOG[0] ? ` · latest ${CHANGELOG[0].date}` : ""}.</p>
        <button type="button" className="loom-btn-ghost text-xs py-1.5 px-3 border border-loom-border" onClick={requestWhatsNew}>
          See what’s new
        </button>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Theme</h3>
        <p className="text-2xs text-loom-label mb-2">
          Shared ibm.io look spectrum · double-click to cycle
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setAppSettings((prev) => ({ ...prev, theme: t as AppTheme }))}
              onDoubleClick={(e) => {
                e.preventDefault();
                setAppSettings((prev) => {
                  const cur = normalizeTheme(prev.theme);
                  const idx = THEMES.indexOf(cur);
                  const next = THEMES[(idx + 1) % THEMES.length]!;
                  return { ...prev, theme: next as AppTheme };
                });
              }}
              className={`px-2 py-1.5 text-2xs rounded-md border text-left transition-colors ${
                currentTheme === t
                  ? "border-loom-accent bg-loom-accent/15 text-loom-text font-medium"
                  : "border-loom-border text-loom-label hover:text-loom-text"
              }`}
            >
              {THEME_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Chrome</h3>
        <p className="text-2xs text-loom-label mb-2">Shell face (type + borders)</p>
        <div className="grid grid-cols-2 gap-1.5">
          {UI_CHROMES.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setAppSettings((prev) => ({ ...prev, uiChrome: u as UiChrome }))}
              className={`px-2 py-1.5 text-2xs rounded-md border text-left transition-colors ${
                appSettings.uiChrome === u
                  ? "border-loom-accent bg-loom-accent/15 text-loom-text font-medium"
                  : "border-loom-border text-loom-label hover:text-loom-text"
              }`}
            >
              {UI_CHROME_LABEL[u]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Typeface</h3>
        <select
          value={appSettings.font}
          onChange={(e) => setAppSettings((prev) => ({ ...prev, font: e.target.value as AppFont }))}
          className="loom-input w-full text-xs py-1.5"
        >
          {APP_FONTS.map((f) => (
            <option key={f} value={f}>{APP_FONT_LABEL[f]}</option>
          ))}
        </select>
        <div className="flex gap-1.5 mt-2">
          {FACES_SOURCES.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setAppSettings((prev) => ({ ...prev, faces: f as FacesSource }))}
              className={`px-2 py-1 text-2xs rounded border ${
                appSettings.faces === f ? "border-loom-accent text-loom-text" : "border-loom-border text-loom-muted"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <p className="text-2xs text-loom-muted mt-1">Faces: web fonts vs local system stacks</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">UI scale</h3>
        <div className="flex flex-wrap gap-2">
          {fontScales.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setAppSettings((prev) => ({ ...prev, fontScale: s.value }))}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                appSettings.fontScale === s.value
                  ? "border-loom-accent bg-loom-accent/20 text-loom-text"
                  : "border-loom-border text-loom-muted hover:text-loom-text"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Accessibility</h3>
        <label className="flex items-center gap-2 cursor-pointer mb-2">
          <input
            type="checkbox"
            checked={appSettings.reducedMotion}
            onChange={(e) => setAppSettings((prev) => ({ ...prev, reducedMotion: e.target.checked }))}
            className="rounded border-loom-border accent-loom-accent"
          />
          <span className="text-xs text-loom-text">Reduce motion</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!appSettings.colorblindCharts}
            onChange={(e) => setAppSettings((prev) => ({ ...prev, colorblindCharts: e.target.checked }))}
            className="rounded border-loom-border accent-loom-accent"
          />
          <span className="text-xs text-loom-text">Colorblind chart palette</span>
        </label>
        <p className="text-2xs text-loom-muted mt-1 ml-6">Paul Tol–safe series; shell theme unchanged</p>
      </div>

      <div className="pt-2 border-t border-loom-border">
        <p className="text-2xs text-loom-muted">
          Chart → Visual uses Theme palette colors from the active theme. Looks sync to{" "}
          <span className="font-mono">ibm.tools.shared</span> when available.
        </p>
      </div>
    </div>
  );
}

const DRAG_TYPE_COLUMN = "application/x-loom-column";

type EncodingOption = { value: string; label: string; type?: string; disabled?: boolean };

/** Single channel control: label + select (+ optional type), doubles as column drop target. */
function EncodingSlot({
  label,
  value,
  options,
  typeHint,
  allowEmpty,
  emptyLabel = "None",
  isDropActive,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onChange,
  trailing,
}: {
  label: string;
  value: string;
  options: EncodingOption[];
  typeHint?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  isDropActive?: boolean;
  onDragEnter?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: DragEvent) => void;
  onChange: (value: string) => void;
  trailing?: ReactNode;
}) {
  const droppable = Boolean(onDrop);
  return (
    <div className="space-y-1">
      <div
        onDragEnter={
          droppable
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onDragEnter?.(e);
              }
            : undefined
        }
        onDragOver={
          droppable
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
                onDragOver?.(e);
              }
            : undefined
        }
        onDragLeave={
          droppable
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onDragLeave?.();
              }
            : undefined
        }
        onDrop={
          droppable
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onDrop?.(e);
              }
            : undefined
        }
        className={`
          flex items-stretch gap-0 rounded-md border overflow-hidden transition-colors
          ${isDropActive ? "border-loom-accent bg-loom-accent/10 ring-1 ring-loom-accent/40" : "border-loom-border bg-loom-elevated/40"}
          ${droppable && !isDropActive ? "border-dashed" : ""}
        `}
      >
        <span
          className="shrink-0 w-[4.5rem] px-1.5 flex items-center text-2xs font-semibold uppercase tracking-wide text-loom-muted bg-loom-bg/60 border-r border-loom-border/80 leading-tight"
          title={droppable ? `${label} — pick a column or drop from Schema` : label}
        >
          {label}
        </span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="loom-input flex-1 min-w-0 border-0 rounded-none bg-transparent text-xs py-2 px-2 font-mono focus:ring-0"
          aria-label={`${label} field`}
        >
          {allowEmpty && <option value="">{emptyLabel}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled} title={o.type}>
              {o.type ? `${o.label}` : o.label}
            </option>
          ))}
        </select>
        {typeHint ? (
          <span className="hidden sm:flex shrink-0 max-w-[5.5rem] items-center px-1.5 text-2xs font-mono text-loom-muted truncate border-l border-loom-border/80" title={typeHint}>
            {typeHint.replace(/^(VARCHAR|DOUBLE|INTEGER|BIGINT|BOOLEAN|TIMESTAMP|FLOAT|DECIMAL|REAL)/i, (m) => m.slice(0, 3).toUpperCase())}
          </span>
        ) : null}
      </div>
      {trailing}
    </div>
  );
}

function EncodingSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wider pt-1">{children}</p>
  );
}

type IconToggleOption<T extends string | number> = {
  value: T;
  label: string;
  icon: ReactNode;
};

/** Compact icon button group for small discrete option sets (≤6). */
function IconToggleGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: IconToggleOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="text-2xs text-loom-muted mb-1">{label}</p>
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              title={opt.label}
              aria-label={opt.label}
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className={`
                min-h-9 min-w-9 px-2 rounded-md border flex items-center justify-center transition-colors
                ${active
                  ? "border-loom-accent bg-loom-accent/15 text-loom-text"
                  : "border-loom-border text-loom-muted hover:border-loom-accent/40 hover:text-loom-text hover:bg-loom-elevated"}
              `}
            >
              {opt.icon}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ColorSwatchGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; color: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="text-2xs text-loom-muted mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              title={opt.label}
              aria-label={opt.label}
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className={`
                min-h-9 min-w-9 rounded-md border flex items-center justify-center transition-colors
                ${active ? "border-loom-accent ring-1 ring-loom-accent/50" : "border-loom-border hover:border-loom-accent/40"}
              `}
            >
              <span
                className="w-4 h-4 rounded-sm border border-black/20"
                style={{
                  background:
                    opt.color === "theme"
                      ? "var(--loom-border)"
                      : opt.color,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

const Ico = {
  plain: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1" />
    </svg>
  ),
  viz: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2 12V8M6 12V5M10 12V7M14 12V3" strokeLinecap="round" />
    </svg>
  ),
  deep: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2 13V6M5 13V4M8 13V7M11 13V3M14 13V8" strokeLinecap="round" />
      <path d="M2 3h12" opacity="0.4" />
    </svg>
  ),
  dots: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="4" cy="5" r="1.5" /><circle cx="9" cy="8" r="1.5" /><circle cx="12" cy="4" r="1.5" /><circle cx="6" cy="12" r="1.5" />
    </svg>
  ),
  squares: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="2" y="3" width="4" height="4" rx="0.5" /><rect x="9" y="6" width="4" height="4" rx="0.5" /><rect x="5" y="11" width="3" height="3" rx="0.5" />
    </svg>
  ),
  ticks: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M3 4v3M7 6v5M11 3v4M14 8v3" strokeLinecap="round" />
    </svg>
  ),
  bar: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="2" y="8" width="3" height="6" rx="0.5" /><rect x="6.5" y="4" width="3" height="10" rx="0.5" /><rect x="11" y="6" width="3" height="8" rx="0.5" />
    </svg>
  ),
  ring: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="8" cy="8" r="4.5" /><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  rule: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3 13h10M3 13V3" strokeLinecap="round" />
    </svg>
  ),
  ladder: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 13h10M3 13V3M3 6h4M3 9h6M3 11h3" strokeLinecap="round" />
    </svg>
  ),
  mercury: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M8 2v9" strokeLinecap="round" /><circle cx="8" cy="13" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  spine: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M8 2v12M3 13h10" strokeLinecap="round" />
    </svg>
  ),
  index: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 13h10M3 13V3M2 5h3M2 8h3M2 11h3" strokeLinecap="round" />
    </svg>
  ),
  tape: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M2 12h12M4 12V8M7 12V5M10 12V9M13 12V6" strokeLinecap="round" opacity="0.85" />
      <path d="M2 4h12" strokeDasharray="2 2" />
    </svg>
  ),
  tint: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1" opacity="0.35" /><rect x="5" y="6" width="6" height="4" rx="0.5" />
    </svg>
  ),
  wash: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1" opacity="0.2" /><path d="M2 8h12" stroke="currentColor" strokeWidth="3" opacity="0.45" />
    </svg>
  ),
  dot: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="8" cy="8" r="5" opacity="0.35" /><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  alarm: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M8 3l6 10H2L8 3z" strokeLinejoin="round" /><circle cx="8" cy="11" r="0.8" fill="currentColor" stroke="none" /><path d="M8 7v2.5" strokeLinecap="round" />
    </svg>
  ),
  tag: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M2 8l6-6h5v5L7 13 2 8z" strokeLinejoin="round" /><circle cx="11" cy="5" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  pair: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2 4h8M2 7h5" strokeLinecap="round" /><rect x="2" y="10" width="12" height="4" rx="0.5" opacity="0.4" />
    </svg>
  ),
  stack: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3 3h10M3 6h7M3 9h10M3 12h6" strokeLinecap="round" />
    </svg>
  ),
  titleSpine: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3 3v10M6 4h7M6 7h5" strokeLinecap="round" />
    </svg>
  ),
  caption: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="2" y="2" width="12" height="8" rx="1" opacity="0.45" /><path d="M3 13h10M3 15h6" strokeLinecap="round" />
    </svg>
  ),
  ticket: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="2" y="4" width="12" height="8" rx="1" /><path d="M5 4v8" strokeDasharray="1.5 1.5" /><path d="M7 7h5M7 9h3" strokeLinecap="round" />
    </svg>
  ),
  slab: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="2" y="3" width="12" height="4" rx="0.5" /><rect x="2" y="9" width="12" height="4" rx="0.5" opacity="0.35" />
    </svg>
  ),
  hero: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="1.5" y="2" width="13" height="12" rx="1" /><path d="M4 6h8M4 9h5" strokeLinecap="round" />
    </svg>
  ),
  compact: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="4" y="4" width="8" height="8" rx="1" /><path d="M6 7h4M6 9h2" strokeLinecap="round" />
    </svg>
  ),
  focus: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" strokeLinecap="round" strokeLinejoin="round" /><circle cx="8" cy="8" r="2" />
    </svg>
  ),
  whisper: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="8" cy="8" r="5" opacity="0.2" />
    </svg>
  ),
  soft: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="8" cy="8" r="5" opacity="0.45" />
    </svg>
  ),
  firm: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="8" cy="8" r="5" opacity="0.8" />
    </svg>
  ),
  se: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="1" opacity="0.4" /><circle cx="11" cy="11" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  sw: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="1" opacity="0.4" /><circle cx="5" cy="11" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  ne: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="1" opacity="0.4" /><circle cx="11" cy="5" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  nw: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="1" opacity="0.4" /><circle cx="5" cy="5" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  weightLight: <span className="text-2xs font-light leading-none">Ag</span>,
  weightRegular: <span className="text-2xs font-normal leading-none">Ag</span>,
  weightSemi: <span className="text-2xs font-semibold leading-none">Ag</span>,
  weightBold: <span className="text-2xs font-bold leading-none">Ag</span>,
  rot0: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 12h10" /><text x="4" y="9" fontSize="6" fill="currentColor" stroke="none">abc</text>
    </svg>
  ),
  rot30: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M3 12h10" /><path d="M5 11l3-5" strokeLinecap="round" /><path d="M9 11l3-5" strokeLinecap="round" />
    </svg>
  ),
  rot45: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M3 12h10" /><path d="M5 11l4-4" strokeLinecap="round" /><path d="M9 11l4-4" strokeLinecap="round" />
    </svg>
  ),
  rot60: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M3 12h10" /><path d="M6 11l2-6" strokeLinecap="round" /><path d="M10 11l2-6" strokeLinecap="round" />
    </svg>
  ),
  rot90: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M3 12h10" /><path d="M6 11V4" strokeLinecap="round" /><path d="M10 11V4" strokeLinecap="round" />
    </svg>
  ),
  solid: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 8h12" strokeLinecap="round" />
    </svg>
  ),
  dashed: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 8h12" strokeLinecap="round" strokeDasharray="3 2" />
    </svg>
  ),
  dotted: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 8h12" strokeLinecap="round" strokeDasharray="1 2.5" />
    </svg>
  ),
  none: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="8" cy="8" r="5" /><path d="M4.5 4.5l7 7" strokeLinecap="round" />
    </svg>
  ),
} as const;

function StatsView() {
  const { columnStats, sampleRows, selectedFile } = useLoomStore();
  const stats = columnStats ?? [];
  const dq = useMemo(() => computeDataQualityHints(stats, sampleRows), [stats, sampleRows]);
  const provenance = useMemo(
    () =>
      resolveDataProvenance(selectedFile, {
        loadedRows: sampleRows?.rows.length ?? null,
        totalRows: sampleRows?.total_rows ?? selectedFile?.row_count ?? null,
      }),
    [selectedFile, sampleRows],
  );

  if (stats.length === 0 && !provenance) {
    return (
      <div className="p-4 text-center text-sm text-loom-muted">
        No column stats. Select a file or run a query to see stats.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {provenance && <ProvenanceCard provenance={provenance} />}
      {stats.length === 0 ? (
        <div className="text-center text-sm text-loom-muted py-4">No column stats yet.</div>
      ) : (
        <>
          {(dq.nullHeavy.length > 0 || dq.constantCols.length > 0 || dq.duplicateSummary) && (
            <div className="loom-card border border-loom-border/80 p-2 space-y-1.5">
              <p className="text-xs font-semibold text-loom-text">Data health</p>
              {dq.nullHeavy.length > 0 && (
                <div className="text-2xs text-loom-muted">
                  <span className="text-loom-text font-medium">High nulls: </span>
                  {dq.nullHeavy.map((h) => `${h.name} (${h.pct}%)`).join(", ")}
                </div>
              )}
              {dq.constantCols.length > 0 && (
                <div className="text-2xs text-loom-muted">
                  <span className="text-loom-text font-medium">Constant / single value: </span>
                  {dq.constantCols.join(", ")}
                </div>
              )}
              {dq.duplicateSummary && (
                <div className="text-2xs text-loom-muted">
                  <span className="text-loom-text font-medium">Duplicates: </span>
                  {dq.duplicateSummary}
                </div>
              )}
            </div>
          )}
          {stats.map((col) => (
            <div key={String(col.name)} className="loom-card space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-medium text-loom-text">{col.name ?? "—"}</span>
                <span className="loom-badge">{col.data_type ?? "?"}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs font-mono">
                <StatRow label="Distinct" value={formatNumber(Number(col.distinct_count) || 0)} />
                <StatRow label="Nulls" value={formatNumber(Number(col.null_count) || 0)} />
                <StatRow label="Min" value={col.min_value != null ? String(col.min_value) : "—"} />
                <StatRow label="Max" value={col.max_value != null ? String(col.max_value) : "—"} />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function ProvenanceCard({ provenance }: { provenance: DataProvenance }) {
  const openLink = async (href: string) => {
    try {
      if (isTauri()) await openExternalUrl(href);
      else window.open(href, "_blank", "noopener,noreferrer");
    } catch {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="loom-card border border-loom-accent/25 bg-loom-accent/5 p-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-loom-muted/90">Source</p>
          <p className="text-xs font-semibold text-loom-text leading-snug truncate" title={provenance.title}>
            {provenance.title}
          </p>
        </div>
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-loom-border/80 text-loom-muted">
          {provenanceKindLabel(provenance.kind)}
        </span>
      </div>
      {provenance.credit && (
        <p className="text-2xs text-loom-muted leading-snug">{provenance.credit}</p>
      )}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-2xs text-loom-muted font-mono">
        {provenance.rowsLabel && <span>{provenance.rowsLabel}</span>}
        {provenance.capturedAt && (
          <span title={provenance.capturedAt}>
            Captured {new Date(provenance.capturedAt).toLocaleString()}
          </span>
        )}
      </div>
      {provenance.links.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {provenance.links.map((link) => (
            <button
              key={link.href}
              type="button"
              onClick={() => void openLink(link.href)}
              className="text-2xs px-2 py-1 rounded border border-loom-accent/40 text-loom-accent hover:bg-loom-accent/10 transition-colors"
              title={link.href}
            >
              {link.label} ↗
            </button>
          ))}
        </div>
      )}
      {!provenance.links.length && provenance.kind === "local" && (
        <p className="text-2xs text-loom-muted/80 leading-snug">
          Local file — no public URL on this dataset. Export / share will still credit the filename.
        </p>
      )}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-loom-muted">{label}</span>
      <span className="text-loom-text truncate max-w-[120px]" title={value}>{value}</span>
    </div>
  );
}

// --- Export tab: Social packs + Chart (PNG/SVG) + Data (CSV) ---

function ExportView() {
  const {
    activeChart,
    pngExportHandler,
    svgExportHandler,
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
  } = useLoomStore();
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
      if (isTauri()) {
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

  const handleCopyChartConfig = useCallback(() => {
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
      void navigator.clipboard.writeText(JSON.stringify(config, null, 2));
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
      const { saveBinaryAndReveal, isTauri: tauri } = await import("@/lib/tauri");
      if (tauri()) {
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
        <p className="text-2xs text-amber-500/90 bg-amber-500/10 rounded px-2 py-1.5 flex items-center justify-between gap-2">
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
                {svgFeedback ? "Copied!" : "Copy as SVG"}
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

// --- Smart tab: Anomaly, Forecast, Trend, Reference lines, Clustering ---

function SmartView() {
  const { activeChart, sampleRows, columnStats, setSmartResults, smartResults, setTableFilterRowIndices, setToast } = useLoomStore();
  const [anomalyCol, setAnomalyCol] = useState("");
  const [anomalyMethod, setAnomalyMethod] = useState<AnomalyMethod>("z-score");
  const [anomalyThreshold, setAnomalyThreshold] = useState(2.5);
  const [forecastHorizon, setForecastHorizon] = useState(5);
  const [forecastMethod, setForecastMethod] = useState<"linear" | "moving-avg">("linear");
  const [refCol, setRefCol] = useState("");
  const [refAxis, setRefAxis] = useState<"x" | "y">("y");
  const [refTypes, setRefTypes] = useState<("mean" | "median" | "q1" | "q3")[]>(["mean", "median"]);
  const [clusterK, setClusterK] = useState(3);

  const columns = columnStats?.map((c) => c.name) ?? [];
  const numericCols = columnStats?.filter((c) =>
    ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL"].some((t) =>
      (c.data_type ?? "").toUpperCase().includes(t),
    ),
  ).map((c) => c.name) ?? [];
  const rows = sampleRows?.rows ?? [];
  const canRun = rows.length > 0 && columns.length > 0 && activeChart;

  const runAnomalyCard = useCallback(() => {
    if (!canRun || !anomalyCol) return;
    const result = runAnomaly(rows, anomalyCol, columns, anomalyMethod, anomalyThreshold);
    if (result) setSmartResults((prev) => ({ ...prev, anomaly: result }));
  }, [canRun, anomalyCol, anomalyMethod, anomalyThreshold, rows, columns, setSmartResults]);

  const runForecastCard = useCallback(() => {
    if (!canRun || !activeChart?.yField) return;
    const result = runForecast(
      rows,
      activeChart.xField,
      activeChart.yField,
      columns,
      forecastHorizon,
      forecastMethod,
    );
    if (result) setSmartResults((prev) => ({ ...prev, forecast: result }));
  }, [canRun, activeChart, forecastHorizon, forecastMethod, rows, columns, setSmartResults]);

  const runTrendCard = useCallback(() => {
    if (!canRun || !activeChart?.yField) return;
    const result = runTrend(rows, activeChart.xField, activeChart.yField, columns);
    if (result) setSmartResults((prev) => ({ ...prev, trend: result }));
  }, [canRun, activeChart, rows, columns, setSmartResults]);

  const runRefLinesCard = useCallback(() => {
    if (!canRun || !refCol) return;
    const result = runReferenceLines(rows, refCol, columns, refAxis, refTypes);
    if (result) setSmartResults((prev) => ({ ...prev, referenceLines: result }));
  }, [canRun, refCol, refAxis, refTypes, rows, columns, setSmartResults]);

  const runClusteringCard = useCallback(() => {
    if (!canRun || !activeChart?.yField) return;
    const result = runClustering(
      rows,
      activeChart.xField,
      activeChart.yField,
      columns,
      clusterK,
    );
    if (result) setSmartResults((prev) => ({ ...prev, clusters: result }));
  }, [canRun, activeChart, clusterK, rows, columns, setSmartResults]);

  const clearSmart = useCallback(() => {
    setSmartResults(null);
  }, [setSmartResults]);

  if (!activeChart) {
    return (
      <div className="p-4 text-center text-sm text-loom-muted">
        Select a chart to run smart analytics. Results visualize on the chart.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4">
      <p className="text-2xs text-loom-muted">
        Run analytics below; results appear on the chart. Switch to Chart view to see them.
      </p>
      <button
        type="button"
        onClick={clearSmart}
        className="text-2xs py-1 px-2 rounded border border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-text"
      >
        Clear all overlays
      </button>

      {/* Anomaly detection */}
      <div className="loom-card p-2 space-y-2">
        <p className="text-xs font-semibold text-loom-text">Anomaly detection</p>
        <p className="text-2xs text-loom-muted">Highlight outliers in a numeric column (table + chart).</p>
        <div>
          <label className="block text-2xs text-loom-muted mb-0.5">Column</label>
          <select
            value={anomalyCol}
            onChange={(e) => setAnomalyCol(e.target.value)}
            className="loom-input w-full text-xs py-1"
          >
            <option value="">Select…</option>
            {numericCols.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-2xs text-loom-muted mb-0.5">Method</label>
          <select
            value={anomalyMethod}
            onChange={(e) => setAnomalyMethod(e.target.value as AnomalyMethod)}
            className="loom-input w-full text-xs py-1"
          >
            <option value="z-score">Z-score</option>
            <option value="iqr">IQR</option>
            <option value="mad">MAD</option>
          </select>
        </div>
        {(anomalyMethod === "z-score" || anomalyMethod === "mad") && (
          <div>
            <label className="block text-2xs text-loom-muted mb-0.5">Threshold</label>
            <input
              type="number"
              min={1}
              max={5}
              step={0.5}
              value={anomalyThreshold}
              onChange={(e) => setAnomalyThreshold(Number(e.target.value))}
              className="loom-input w-full text-xs py-1"
            />
          </div>
        )}
        <button
          type="button"
          onClick={runAnomalyCard}
          disabled={!anomalyCol || rows.length === 0}
          className="w-full px-2 py-1.5 text-xs font-medium text-loom-text bg-loom-accent/20 border border-loom-accent rounded hover:bg-loom-accent/30"
        >
          Run
        </button>
        {smartResults?.anomaly?.rowIndices && smartResults.anomaly.rowIndices.length > 0 && (
          <button
            type="button"
            onClick={() => setTableFilterRowIndices(smartResults.anomaly!.rowIndices)}
            className="w-full px-2 py-1 text-2xs text-loom-muted border border-loom-border rounded hover:bg-loom-elevated"
          >
            Filter table to anomalies
          </button>
        )}
      </div>

      {/* Forecast */}
      <div className="loom-card p-2 space-y-2">
        <p className="text-xs font-semibold text-loom-text">Forecast</p>
        <p className="text-2xs text-loom-muted">Extend the chart with predicted points (linear or moving avg).</p>
        <div>
          <label className="block text-2xs text-loom-muted mb-0.5">Horizon (points)</label>
          <input
            type="number"
            min={1}
            max={50}
            value={forecastHorizon}
            onChange={(e) => setForecastHorizon(Number(e.target.value))}
            className="loom-input w-full text-xs py-1"
          />
        </div>
        <div>
          <label className="block text-2xs text-loom-muted mb-0.5">Method</label>
          <select
            value={forecastMethod}
            onChange={(e) => setForecastMethod(e.target.value as "linear" | "moving-avg")}
            className="loom-input w-full text-xs py-1"
          >
            <option value="linear">Linear</option>
            <option value="moving-avg">Moving average</option>
          </select>
        </div>
        <button
          type="button"
          onClick={runForecastCard}
          disabled={!activeChart.yField || rows.length === 0}
          className="w-full px-2 py-1.5 text-xs font-medium text-loom-text bg-loom-accent/20 border border-loom-accent rounded hover:bg-loom-accent/30"
        >
          Run
        </button>
      </div>

      {/* Trend line */}
      <div className="loom-card p-2 space-y-2">
        <p className="text-xs font-semibold text-loom-text">Trend line</p>
        <p className="text-2xs text-loom-muted">Linear regression over X × Y. Shows on scatter/line.</p>
        <button
          type="button"
          onClick={runTrendCard}
          disabled={!activeChart.yField || rows.length < 2}
          className="w-full px-2 py-1.5 text-xs font-medium text-loom-text bg-loom-accent/20 border border-loom-accent rounded hover:bg-loom-accent/30"
        >
          Run
        </button>
      </div>

      {/* Reference lines */}
      <div className="loom-card p-2 space-y-2">
        <p className="text-xs font-semibold text-loom-text">Reference lines</p>
        <p className="text-2xs text-loom-muted">Mean, median, Q1, Q3 on an axis.</p>
        <div>
          <label className="block text-2xs text-loom-muted mb-0.5">Column</label>
          <select value={refCol} onChange={(e) => setRefCol(e.target.value)} className="loom-input w-full text-xs py-1">
            <option value="">Select…</option>
            {numericCols.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-2xs text-loom-muted mb-0.5">Axis</label>
          <select value={refAxis} onChange={(e) => setRefAxis(e.target.value as "x" | "y")} className="loom-input w-full text-xs py-1">
            <option value="x">X</option>
            <option value="y">Y</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-1">
          {(["mean", "median", "q1", "q3"] as const).map((t) => (
            <label key={t} className="flex items-center gap-1 text-2xs text-loom-muted cursor-pointer">
              <input
                type="checkbox"
                checked={refTypes.includes(t)}
                onChange={(e) =>
                  setRefTypes((prev) =>
                    e.target.checked ? [...prev, t] : prev.filter((x) => x !== t),
                  )
                }
                className="rounded border-loom-border accent-loom-accent"
              />
              {t.toUpperCase()}
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={runRefLinesCard}
          disabled={!refCol || refTypes.length === 0 || rows.length === 0}
          className="w-full px-2 py-1.5 text-xs font-medium text-loom-text bg-loom-accent/20 border border-loom-accent rounded hover:bg-loom-accent/30"
        >
          Run
        </button>
      </div>

      {/* Clustering */}
      <div className="loom-card p-2 space-y-2">
        <p className="text-xs font-semibold text-loom-text">Clustering</p>
        <p className="text-2xs text-loom-muted">Group points by position (k-means style). Colors by cluster on scatter.</p>
        <div>
          <label className="block text-2xs text-loom-muted mb-0.5">Clusters (k)</label>
          <input
            type="number"
            min={2}
            max={8}
            value={clusterK}
            onChange={(e) => setClusterK(Number(e.target.value))}
            className="loom-input w-full text-xs py-1"
          />
        </div>
        <button
          type="button"
          onClick={runClusteringCard}
          disabled={!activeChart.yField || rows.length < clusterK}
          className="w-full px-2 py-1.5 text-xs font-medium text-loom-text bg-loom-accent/20 border border-loom-accent rounded hover:bg-loom-accent/30"
        >
          Run
        </button>
      </div>

      {/* Correlation matrix */}
      <div className="loom-card p-2 space-y-2">
        <p className="text-xs font-semibold text-loom-text">Correlation matrix</p>
        <p className="text-2xs text-loom-muted">Pairwise Pearson r across numeric columns.</p>
        <button
          type="button"
          disabled={numericCols.length < 2}
          onClick={() => {
            const nc = numericCols.slice(0, 8);
            const colIndices = nc.map((c) => columns.indexOf(c));
            const means: number[] = colIndices.map((ci) => {
              let sum = 0, n = 0;
              for (const r of rows) { const v = Number(r[ci]); if (!isNaN(v)) { sum += v; n++; } }
              return n > 0 ? sum / n : 0;
            });
            const matrix: number[][] = [];
            for (let a = 0; a < nc.length; a++) {
              matrix[a] = [];
              for (let b = 0; b < nc.length; b++) {
                if (a === b) { matrix[a][b] = 1; continue; }
                let sumAB = 0, sumA2 = 0, sumB2 = 0, n = 0;
                for (const r of rows) {
                  const va = Number(r[colIndices[a]]) - means[a];
                  const vb = Number(r[colIndices[b]]) - means[b];
                  if (isNaN(va) || isNaN(vb)) continue;
                  sumAB += va * vb; sumA2 += va * va; sumB2 += vb * vb; n++;
                }
                matrix[a][b] = n > 2 && sumA2 > 0 && sumB2 > 0 ? sumAB / Math.sqrt(sumA2 * sumB2) : 0;
              }
            }
            setSmartResults((prev) => ({ ...prev, correlation: { columns: nc, matrix } as never }));
            setToast("Correlation matrix computed");
          }}
          className="w-full px-2 py-1.5 text-xs font-medium text-loom-text bg-loom-accent/20 border border-loom-accent rounded hover:bg-loom-accent/30"
        >
          Compute
        </button>
        {(smartResults as Record<string, unknown>)?.correlation ? (() => {
          const corr = (smartResults as Record<string, unknown>).correlation as { columns: string[]; matrix: number[][] };
          return (
            <div className="overflow-x-auto mt-1">
              <table className="text-2xs font-mono border-collapse">
                <thead>
                  <tr>
                    <th className="px-1 py-0.5" />
                    {corr.columns.map((c) => <th key={c} className="px-1 py-0.5 text-loom-muted truncate max-w-[48px]">{c.slice(0, 6)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {corr.columns.map((c, i) => (
                    <tr key={c}>
                      <td className="px-1 py-0.5 text-loom-muted truncate max-w-[48px]">{c.slice(0, 6)}</td>
                      {corr.matrix[i].map((v, j) => (
                        <td key={j} className="px-1 py-0.5 text-center" style={{ background: `rgba(108,92,231,${Math.abs(v) * 0.5})` }} title={`${corr.columns[i]} × ${corr.columns[j]}: ${v.toFixed(3)}`}>
                          {v.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })() : null}
      </div>

      {/* AI / Vision (future) */}
      <div className="loom-card p-2 space-y-2 opacity-80">
        <p className="text-xs font-semibold text-loom-text">Chart insight (AI)</p>
        <p className="text-2xs text-loom-muted">
          Future: use a vision model (e.g. Ollama with LLaVA) to &quot;look&quot; at the chart — describe it, suggest anomalies, or answer questions.
        </p>
        <button type="button" disabled className="w-full px-2 py-1.5 text-xs text-loom-muted border border-loom-border rounded cursor-not-allowed">
          Coming soon
        </button>
      </div>
    </div>
  );
}

// --- Save chart view button (used in Chart tab) ---
function SaveChartViewButton() {
  const { selectedFile, activeChart, chartVisualOverrides, addChartView, setToast, setPromptDialog, querySql, sampleRows, pngExportHandler } = useLoomStore();
  if (!selectedFile || !activeChart) return null;
  return (
    <button
      type="button"
      onClick={() => {
        setPromptDialog({
          title: "Name for this chart view",
          defaultValue: activeChart.title || "Chart view",
          onConfirm: async (name) => {
            if (name == null || !name.trim()) return;
            let snapshotImageDataUrl: string | null = null;
            if (pngExportHandler) {
              try {
                const blob = await pngExportHandler();
                if (blob) {
                  snapshotImageDataUrl = await new Promise<string>((res, rej) => {
                    const r = new FileReader();
                    r.onload = () => res(r.result as string);
                    r.onerror = rej;
                    r.readAsDataURL(blob);
                  });
                }
              } catch (_) { /* ignore */ }
            }
            const sample = sampleRows ? { columns: sampleRows.columns, types: sampleRows.types ?? [], rows: sampleRows.rows, total_rows: sampleRows.total_rows } : undefined;
            const ok = addChartView(name.trim(), selectedFile.path, selectedFile.name, activeChart, { ...chartVisualOverrides }, querySql, sample, snapshotImageDataUrl);
            setToast(ok ? "Chart view saved. Add it in the Dashboards tab with \"Add to dashboard\" or \"+ Add view\"." : "Could not save chart view");
          }
        });
      }}
      className="text-2xs py-0.5 px-1.5 rounded border border-loom-border text-loom-muted hover:text-loom-text hover:border-loom-accent"
    >
      Save view
    </button>
  );
}

// --- Chart tab: Vega spec + visual overrides ---

function ChartPanelView() {
  const {
    activeChart,
    vegaSpec,
    sampleRows,
    columnStats,
    chartVisualOverrides,
    setChartVisualOverrides,
    setActiveChart,
    selectedFile,
    aiSuggestionReason,
    chartAnnotations,
    addChartAnnotation,
    removeChartAnnotation,
    barStackMode, setBarStackMode,
    connectScatterTrail, setConnectScatterTrail,
    showMarginals, setShowMarginals,
    customRefLines, addCustomRefLine, removeCustomRefLine,
    setPromptDialog,
    setToast,
    appSettings,
  } = useLoomStore();
  const [specExpanded, setSpecExpanded] = useState(true);
  const [specCopyOk, setSpecCopyOk] = useState(false);
  const [dragOverSlot, setDragOverSlot] = useState<"x" | "y" | "color" | null>(null);
  /** Chart panel secondary nav — Encoding (data) vs Visual (look). */
  const [chartPanelSection, setChartPanelSection] = useState<"encoding" | "visual">("encoding");
  const [activeChartOpen, setActiveChartOpen] = useState(true);
  const [vegaOpen, setVegaOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [moreChannelsOpen, setMoreChannelsOpen] = useState(() =>
    Boolean(
      activeChart?.sizeField ||
        activeChart?.glowField ||
        activeChart?.outlineField ||
        activeChart?.opacityField,
    ),
  );
  const [encodingLocks, setEncodingLocks] = useState<EncodingShuffleLocks>({});
  const [visualLocks, setVisualLocks] = useState<VisualShuffleLocks>({});

  const toggleEncodingLock = useCallback((key: keyof EncodingShuffleLocks) => {
    setEncodingLocks((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleVisualLock = useCallback((key: VisualShuffleSection) => {
    setVisualLocks((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const tableName = selectedFile?.name?.replace(/\.\w+$/, "") ?? "";

  const extraFromChart = useCallback(
    () => ({
      sizeField: activeChart?.sizeField ?? null,
      zField: activeChart?.zField ?? null,
      timeField: activeChart?.timeField ?? null,
      trailId: activeChart?.trailId ?? null,
      rowField: activeChart?.rowField ?? null,
      glowField: activeChart?.glowField ?? null,
      outlineField: activeChart?.outlineField ?? null,
      opacityField: activeChart?.opacityField ?? null,
      yAggregate: activeChart?.yAggregate ?? null,
      topN: activeChart?.topN ?? null,
      y2Field: activeChart?.y2Field ?? null,
      comparePrevious: activeChart?.comparePrevious ?? null,
      rollingWindow: activeChart?.rollingWindow ?? null,
      yScale: activeChart?.yScale ?? null,
      seriesNormalize: activeChart?.seriesNormalize ?? null,
      residualOverlay: activeChart?.residualOverlay ?? null,
      anomalyHighlight: activeChart?.anomalyHighlight ?? null,
      bumpMode: activeChart?.bumpMode ?? null,
      timeWindowField: activeChart?.timeWindowField ?? null,
      timeWindow: activeChart?.timeWindow ?? null,
      tooltipFields: activeChart?.tooltipFields,
      tooltipKeyField: activeChart?.tooltipKeyField ?? null,
      barStackMode,
    }),
    [
      activeChart?.sizeField,
      activeChart?.zField,
      activeChart?.timeField,
      activeChart?.trailId,
      activeChart?.rowField,
      activeChart?.glowField,
      activeChart?.outlineField,
      activeChart?.opacityField,
      activeChart?.yAggregate,
      activeChart?.topN,
      activeChart?.y2Field,
      activeChart?.comparePrevious,
      activeChart?.rollingWindow,
      activeChart?.yScale,
      activeChart?.seriesNormalize,
      activeChart?.residualOverlay,
      activeChart?.anomalyHighlight,
      activeChart?.bumpMode,
      activeChart?.timeWindowField,
      activeChart?.timeWindow,
      activeChart?.tooltipFields,
      activeChart?.tooltipKeyField,
      barStackMode,
    ],
  );

  const handleDrop = useCallback(
    (slot: "x" | "y" | "color") => (e: DragEvent) => {
      e.preventDefault();
      setDragOverSlot(null);
      const colName = e.dataTransfer.getData(DRAG_TYPE_COLUMN) || e.dataTransfer.getData("text/plain");
      if (!colName || !activeChart || columnStats.length === 0) return;
      const newX = slot === "x" ? colName : activeChart.xField;
      const newY = slot === "y" ? colName : activeChart.yField;
      const newColor = slot === "color" ? colName : activeChart.colorField;
      const rec = createChartRec(activeChart.kind, columnStats, newX, newY, newColor, tableName, extraFromChart());
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const handleDragEnter = useCallback((slot: "x" | "y" | "color") => () => setDragOverSlot(slot), []);
  const handleDragOver = useCallback((slot: "x" | "y" | "color") => (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverSlot(slot);
  }, []);
  const handleDragLeave = useCallback(() => setDragOverSlot(null), []);

  const updateOverride = useCallback(
    (key: keyof ChartVisualOverrides, value: number | string | boolean | undefined) => {
      setChartVisualOverrides((prev) => ({ ...prev, [key]: value }));
    },
    [setChartVisualOverrides],
  );

  const handleCopySpec = useCallback(() => {
    if (!vegaSpec) return;
    const json = JSON.stringify(vegaSpec, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setSpecCopyOk(true);
      setTimeout(() => setSpecCopyOk(false), 1500);
    });
  }, [vegaSpec]);

  const applyEncoding = useCallback(
    (slot: "x" | "y" | "color", colName: string) => {
      if (!activeChart || columnStats.length === 0) return;
      const newX = slot === "x" ? colName : activeChart.xField;
      const newY = slot === "y" ? (colName === "" ? null : colName) : activeChart.yField;
      const newColor = slot === "color" ? (colName === "__none__" || colName === "" ? null : colName) : activeChart.colorField;
      const rec = createChartRec(activeChart.kind, columnStats, newX, newY, newColor, tableName, extraFromChart());
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyEncodingExtra = useCallback(
    (slot: "size" | "z" | "row" | "glow" | "outline" | "opacity" | "y2", colName: string) => {
      if (!activeChart || columnStats.length === 0) return;
      const sizeField = slot === "size" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.sizeField ?? null);
      const zField = slot === "z" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.zField ?? null);
      const rowField = slot === "row" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.rowField ?? null);
      const glowField = slot === "glow" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.glowField ?? null);
      const outlineField = slot === "outline" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.outlineField ?? null);
      const opacityField = slot === "opacity" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.opacityField ?? null);
      const y2Field = slot === "y2" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.y2Field ?? null);
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        {
          ...extraFromChart(),
          sizeField,
          zField,
          rowField,
          glowField,
          outlineField,
          opacityField,
          y2Field,
        },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applySplitMode = useCallback(
    (mode: "color" | "facet" | "both") => {
      if (!activeChart || columnStats.length === 0) return;
      const splitField = activeChart.colorField ?? activeChart.rowField;
      if (!splitField) return;
      let colorField: string | null = activeChart.colorField;
      let rowField: string | null = activeChart.rowField ?? null;
      if (mode === "color") {
        colorField = splitField;
        rowField = null;
      } else if (mode === "facet") {
        colorField = null;
        rowField = splitField;
      } else {
        colorField = splitField;
        rowField = splitField;
      }
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        colorField,
        tableName,
        { ...extraFromChart(), rowField },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyTopN = useCallback(
    (n: number) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        { ...extraFromChart(), topN: clampTopN(n) },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyComparePrevious = useCallback(
    (on: boolean) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        { ...extraFromChart(), comparePrevious: on },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyTimeWindow = useCallback(
    (next: { field?: string | null; range?: ChartTimeRange | null }) => {
      if (!activeChart || columnStats.length === 0) return;
      const field =
        next.field !== undefined
          ? next.field
          : (activeChart.timeWindowField ?? pickDefaultTimeField(columnStats, activeChart));
      let range = next.range !== undefined ? next.range : (activeChart.timeWindow ?? "all");
      if (!field) range = "all";
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        {
          ...extraFromChart(),
          timeWindowField: field,
          timeWindow: range && range !== "all" ? range : null,
        },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  /** Drop Encoding extras the target kind cannot render (stale Facet / Top N / Compare). */
  const extrasForKind = useCallback(
    (kind: ChartKind, base: ReturnType<typeof extraFromChart>) => {
      const caps = chartCapabilities(kind);
      return {
        ...base,
        rowField: caps.facetRow ? base.rowField : null,
        topN: caps.topN ? base.topN : null,
        y2Field: caps.compareY ? base.y2Field : null,
        comparePrevious: caps.compareY ? base.comparePrevious : null,
        sizeField: caps.sizeChannel ? base.sizeField : null,
        zField: caps.zChannel ? base.zField : null,
        glowField: caps.glowOutline ? base.glowField : null,
        outlineField: caps.glowOutline ? base.outlineField : null,
        opacityField: caps.opacityChannel ? base.opacityField : null,
      };
    },
    [],
  );

  const applyChartType = useCallback(
    (kind: ChartKind) => {
      if (!activeChart || columnStats.length === 0) return;
      const fit = fitEncodingToKind(kind, columnStats, activeChart);
      const sanitized = extrasForKind(kind, extraFromChart());
      let rec = createChartRec(kind, columnStats, fit.xField, fit.yField, fit.colorField, tableName, sanitized);
      if (!rec) {
        for (let i = 0; i < 24; i++) {
          const enc = getRandomEncoding(columnStats, kind);
          if (!enc) break;
          const extra: Parameters<typeof createChartRec>[6] = {
            ...sanitized,
            ...randomEncodingToExtra(enc),
          };
          // Re-sanitize after random extras (which may set facet/topN/compare).
          const cleaned = extrasForKind(kind, { ...extraFromChart(), ...extra });
          rec = createChartRec(kind, columnStats, enc.xField, enc.yField, enc.colorField, tableName, cleaned);
          if (rec) break;
        }
      }
      if (rec) setActiveChart(rec);
      else setToast(`Can’t build a ${kind} chart from these columns`);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart, extrasForKind, setToast],
  );

  const kindSupport = useCallback((kind: ChartKind) => chartKindDataSupport(columnStats, kind), [columnStats]);

  const applyYAggregate = useCallback(
    (agg: YAggregateOption) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        { ...extraFromChart(), yAggregate: agg },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyTooltipFields = useCallback(
    (fields: string[]) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        { ...extraFromChart(), tooltipFields: fields.length > 0 ? fields : undefined },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyTooltipKeyField = useCallback(
    (col: string | null) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        { ...extraFromChart(), tooltipKeyField: col === null ? undefined : col },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const handleRandomize = useCallback(() => {
    if (columnStats.length === 0) return;
    const keep = activeChart
      ? {
          kind: activeChart.kind,
          xField: activeChart.xField,
          yField: activeChart.yField,
          colorField: activeChart.colorField,
          sizeField: activeChart.sizeField ?? null,
        }
      : undefined;
    const rec = tryBuildRandomChartRec(columnStats, tableName, { locks: encodingLocks, keep });
    if (rec) {
      setActiveChart(rec);
      const locked = Object.entries(encodingLocks).filter(([, v]) => v).map(([k]) => k);
      setToast(
        locked.length
          ? `Random · ${rec.kind} (locked ${locked.join(", ")})`
          : `Random · ${rec.kind}`,
      );
    } else {
      setToast("Couldn’t find a random chart for these columns");
    }
  }, [columnStats, tableName, setActiveChart, setToast, encodingLocks, activeChart]);

  const handleRandomizeEncoding = useCallback(() => {
    if (columnStats.length === 0 || !activeChart) return;
    if (!chartKindDataSupport(columnStats, activeChart.kind).ok) {
      setToast(`This table can’t support ${activeChart.kind} — pick another type`);
      return;
    }
    const keep = {
      xField: activeChart.xField,
      yField: activeChart.yField,
      colorField: activeChart.colorField,
      sizeField: activeChart.sizeField ?? null,
    };
    for (let i = 0; i < 48; i++) {
      const drawn = getRandomEncoding(columnStats, activeChart.kind);
      if (!drawn) continue;
      const enc = applyEncodingLocks(drawn, encodingLocks, keep);
      const extra: Parameters<typeof createChartRec>[6] = {
        ...extraFromChart(),
        ...randomEncodingToExtra(enc),
      };
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        enc.xField,
        enc.yField,
        enc.colorField,
        tableName,
        extra,
      );
      if (rec) {
        setActiveChart(rec);
        const bits = [
          rec.xField,
          rec.yField,
          encodingLocks.color ? null : rec.colorField,
          rec.rowField ? `facets:${rec.rowField}` : null,
          rec.topN ? `top ${rec.topN}` : null,
          rec.y2Field ? `vs ${rec.y2Field}` : null,
          rec.comparePrevious ? "vs earlier" : null,
          rec.rollingWindow ? `roll ${rec.rollingWindow}` : null,
          rec.seriesNormalize === "index100" ? "index 100" : rec.seriesNormalize === "zscore" ? "z-score" : null,
          rec.yScale && rec.yScale !== "linear" ? `${rec.yScale} Y` : null,
          rec.residualOverlay ? "residuals" : null,
          rec.anomalyHighlight ? "anomalies" : null,
          rec.bumpMode === "delta" ? "Δ rank" : null,
        ].filter(Boolean);
        setToast(`Shuffled · ${bits.join(" × ")}`);
        return;
      }
    }
    setToast("Couldn’t shuffle fields for this chart type");
  }, [columnStats, tableName, setActiveChart, activeChart, extraFromChart, setToast, encodingLocks]);

  if (!activeChart) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-sm text-loom-muted">No chart selected</p>
        <p className="text-2xs text-loom-muted mt-1">Pick a suggestion from the Chart view</p>
      </div>
    );
  }

  const specJson = vegaSpec ? JSON.stringify(vegaSpec, null, 2) : "{}";
  const rowCount = sampleRows?.rows.length ?? 0;
  const totalRows = sampleRows?.total_rows ?? rowCount;
  const aggSummary = formatChartAggregationSummary(activeChart);
  const caps = chartCapabilities(activeChart.kind);
  const channelLabels = encodingChannelLabels(activeChart.kind);
  const showX = caps.xChannel;
  const showY = caps.yChannel;
  const showColor = caps.colorChannel;
  const showSize = caps.sizeChannel;
  /** Pyramid / slope / dumbbell need the second measure visible — not buried under More. */
  const sizeInPrimary =
    activeChart.kind === "pyramid" ||
    activeChart.kind === "slope" ||
    activeChart.kind === "dumbbell" ||
    activeChart.kind === "dataCube";
  const isDataCube = activeChart.kind === "dataCube";
  const cubeAggregate: YAggregateOption = activeChart.sizeField ? (activeChart.yAggregate ?? "sum") : "count";
  const showAggregate = caps.aggregate;
  const effectiveAggregate: YAggregateOption = !activeChart.yField
    ? "count"
    : (activeChart.yAggregate ?? (activeChart.kind === "line" ? "mean" : "sum"));
  const showRow = caps.facetRow;
  const showTopN = caps.topN;
  const showCompareY = caps.compareY;
  const showMarkPoints = caps.markPoints;
  const showOpacityEnc = caps.opacityChannel;
  const showGlowOutline = caps.glowOutline;
  const splitField = activeChart.colorField ?? activeChart.rowField ?? null;
  /** Split chips only make sense when Color and Facet share (or could share) one field. */
  const splitCompatible =
    !!splitField &&
    (!activeChart.colorField ||
      !activeChart.rowField ||
      activeChart.colorField === activeChart.rowField);
  const splitMode: "color" | "facet" | "both" | null = !splitCompatible
    ? null
    : activeChart.colorField && activeChart.rowField
      ? "both"
      : activeChart.rowField
        ? "facet"
        : "color";
  const numericCols = columnStats.filter(
    (c) => ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL"].some((t) => (c.data_type ?? "").toUpperCase().includes(t)),
  );
  const nominalForRow = columnStats.filter((c) => {
    if (numericCols.some((n) => n.name === c.name)) return false;
    const d = c.distinct_count ?? 0;
    if (d < 2 || d > 30) return false;
    // Don't facet by the same field already on X or Y
    if (c.name === activeChart.xField || c.name === activeChart.yField) return false;
    return true;
  });

  const colType = (name: string) => columnStats.find((c) => c.name === name)?.data_type ?? "";
  const timeColNames = temporalColumnNames(columnStats);
  const timeFieldActive = activeChart.timeWindowField ?? pickDefaultTimeField(columnStats, activeChart);
  const timeIdx = sampleRows && timeFieldActive ? sampleRows.columns.indexOf(timeFieldActive) : -1;
  const timeSpanMs =
    sampleRows && timeIdx >= 0 ? timeColumnSpanMs(sampleRows.rows, timeIdx) : 0;
  const timeRangeChoices = chartTimeRangeOptions(timeSpanMs);
  const timeWindowActive = activeChart.timeWindow ?? "all";
  const allColOptions: EncodingOption[] = columnStats.map((c) => ({
    value: c.name,
    label: c.name,
    type: c.data_type,
  }));
  const numericOptions: EncodingOption[] = numericCols.map((c) => ({
    value: c.name,
    label: c.name,
    type: c.data_type,
  }));
  const rowOptions: EncodingOption[] = nominalForRow.map((c) => ({
    value: c.name,
    label: c.name,
    type: c.data_type,
  }));
  const tooltipSelectedCount = activeChart.tooltipFields?.length ?? 0;
  const extraChannelCount = [
    showMarkPoints && activeChart.sizeField,
    showGlowOutline && activeChart.glowField,
    showGlowOutline && activeChart.outlineField,
    showOpacityEnc && activeChart.opacityField,
  ].filter(Boolean).length;

  return (
    <div className="flex flex-col min-h-0">
      {/* Sticky Encoding | Visual secondary header */}
      <div
        role="tablist"
        aria-label="Chart panel sections"
        className="sticky top-0 z-10 flex items-center gap-0.5 px-2 py-1.5 border-b border-loom-border bg-loom-surface shrink-0"
      >
        <div className="flex items-center gap-0.5 bg-loom-elevated rounded-md p-0.5 w-full">
          {(
            [
              { id: "encoding" as const, label: "Encoding" },
              { id: "visual" as const, label: "Visual" },
            ]
          ).map((sec) => (
            <button
              key={sec.id}
              type="button"
              role="tab"
              id={`chart-section-${sec.id}`}
              aria-controls={`chart-section-panel-${sec.id}`}
              aria-selected={chartPanelSection === sec.id}
              tabIndex={chartPanelSection === sec.id ? 0 : -1}
              onClick={() => setChartPanelSection(sec.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const next = chartPanelSection === "encoding" ? "visual" : "encoding";
                  setChartPanelSection(next);
                  queueMicrotask(() => document.getElementById(`chart-section-${next}`)?.focus());
                }
              }}
              className={`
                flex-1 min-h-9 px-3 py-1.5 text-xs font-medium rounded transition-colors
                ${chartPanelSection === sec.id
                  ? "bg-loom-surface text-loom-text shadow-sm border border-loom-border"
                  : "text-loom-muted hover:text-loom-text border border-transparent"}
              `}
            >
              {sec.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 p-3">
      {chartPanelSection === "encoding" && (
        <div
          role="tabpanel"
          id="chart-section-panel-encoding"
          aria-labelledby="chart-section-encoding"
          className="flex flex-col gap-3"
        >
      {/* Encoding */}
      <div className="loom-card overflow-hidden">
        <div className="space-y-2.5 px-2.5 py-3">
            {(() => {
              const curSupport = chartKindDataSupport(columnStats, activeChart.kind);
              if (!curSupport.ok) {
                return (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-2xs text-amber-200/90">
                    <span className="font-medium">Doesn’t fit this table:</span> {curSupport.reason}
                  </div>
                );
              }
              return null;
            })()}

            <div className="flex gap-1.5 items-stretch">
              <div className="flex-1 min-w-0">
                <ChartKindPicker
                  value={activeChart.kind}
                  support={kindSupport}
                  onChange={(v) => {
                    if (!chartKindDataSupport(columnStats, v).ok) return;
                    applyChartType(v);
                  }}
                />
              </div>
              <button
                type="button"
                onClick={handleRandomizeEncoding}
                className="shrink-0 min-h-9 min-w-9 px-2 rounded-md border border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated transition-colors"
                title="Shuffle unlocked fields (keeps chart type; respects locks)"
                aria-label="Shuffle fields"
              >
                ⟳
              </button>
              <button
                type="button"
                onClick={handleRandomize}
                className="shrink-0 min-h-9 min-w-9 px-2 rounded-md border border-loom-border text-loom-muted hover:text-loom-accent hover:bg-loom-elevated transition-colors"
                title="Random chart — respects locks (type / x / y / color / size)"
                aria-label="Randomize chart"
              >
                ✦
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <span className="text-2xs text-loom-muted mr-0.5">Lock</span>
              {(
                [
                  ["kind", "Type"],
                  ["x", "X"],
                  ["y", "Y"],
                  ["color", "Color"],
                    ["size", channelLabels.size],
                  ] as const
                ).map(([key, label]) => {
                const on = !!encodingLocks[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleEncodingLock(key)}
                    title={on ? `Unlock ${label} for random` : `Lock ${label} while randomizing`}
                    className={`px-1.5 py-0.5 text-2xs rounded border ${
                      on
                        ? "border-loom-accent/60 text-loom-accent bg-loom-accent/10"
                        : "border-loom-border text-loom-muted hover:border-loom-accent/40"
                    }`}
                  >
                    {label}{on ? " · locked" : ""}
                  </button>
                );
              })}
            </div>

            <EncodingSectionLabel>Channels</EncodingSectionLabel>
            <div className="space-y-2">
              {showX && (
              <EncodingSlot
                label={channelLabels.x}
                value={activeChart.xField}
                options={allColOptions}
                typeHint={colType(activeChart.xField)}
                isDropActive={dragOverSlot === "x"}
                onDragEnter={handleDragEnter("x")}
                onDragOver={handleDragOver("x")}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop("x")}
                onChange={(v) => applyEncoding("x", v)}
              />
              )}

              {!showX && activeChart.kind === "radar" && (
                <p className="text-2xs text-loom-muted px-0.5">
                  Radar uses all numeric columns as axes. Set Series (color) to compare groups.
                </p>
              )}

              {showY && (
                <EncodingSlot
                  label={channelLabels.y}
                  value={activeChart.yField ?? ""}
                  options={allColOptions}
                  allowEmpty
                  emptyLabel="—"
                  typeHint={activeChart.yField ? colType(activeChart.yField) : undefined}
                  isDropActive={dragOverSlot === "y"}
                  onDragEnter={handleDragEnter("y")}
                  onDragOver={handleDragOver("y")}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop("y")}
                  onChange={(v) => applyEncoding("y", v)}
                  trailing={
                    showAggregate ? (
                      <div className="flex items-center gap-2 pl-0.5">
                        <label className="text-2xs text-loom-muted shrink-0" htmlFor="loom-y-agg">
                          Aggregate
                        </label>
                        <select
                          id="loom-y-agg"
                          value={effectiveAggregate}
                          onChange={(e) => applyYAggregate(e.target.value as YAggregateOption)}
                          className="loom-input flex-1 text-xs py-1.5 min-h-8"
                          title="How values are summarized"
                        >
                          {Y_AGGREGATE_OPTIONS.map((opt) => (
                            <option
                              key={opt.value}
                              value={opt.value}
                              disabled={!activeChart.yField && opt.value !== "count"}
                            >
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : undefined
                  }
                />
              )}

              {showColor && !(activeChart.kind === "pyramid" || activeChart.kind === "slope") && (
                <EncodingSlot
                  label={channelLabels.color}
                  value={activeChart.colorField ?? ""}
                  options={allColOptions}
                  allowEmpty
                  emptyLabel="None"
                  typeHint={activeChart.colorField ? colType(activeChart.colorField) : undefined}
                  isDropActive={dragOverSlot === "color"}
                  onDragEnter={handleDragEnter("color")}
                  onDragOver={handleDragOver("color")}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop("color")}
                  onChange={(v) => applyEncoding("color", v === "" ? "__none__" : v)}
                  trailing={
                    activeChart.kind === "bar" && activeChart.colorField ? (
                      <div className="flex items-center gap-1.5 flex-wrap pl-0.5">
                        <span className="text-2xs text-loom-muted shrink-0">Layout</span>
                        <div className="flex gap-1 flex-wrap">
                          {(["grouped", "stacked", "percent"] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => {
                                setBarStackMode(m);
                                if (columnStats.length === 0) return;
                                const rec = createChartRec(
                                  activeChart.kind,
                                  columnStats,
                                  activeChart.xField,
                                  activeChart.yField,
                                  activeChart.colorField,
                                  tableName,
                                  { ...extraFromChart(), barStackMode: m },
                                );
                                if (rec) setActiveChart(rec);
                              }}
                              className={`min-h-8 px-2.5 text-2xs rounded-md capitalize ${
                                barStackMode === m
                                  ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50"
                                  : "text-loom-muted border border-loom-border hover:border-loom-accent/40"
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : undefined
                  }
                />
              )}
              {showRow && (
                <EncodingSlot
                  label="Facet"
                  value={activeChart.rowField ?? ""}
                  options={rowOptions}
                  allowEmpty
                  emptyLabel="None"
                  typeHint={activeChart.rowField ? colType(activeChart.rowField) : undefined}
                  onChange={(v) => applyEncodingExtra("row", v === "" ? "__none__" : v)}
                />
              )}
              {showRow && splitCompatible && splitField && (
                <div className="flex items-center gap-1.5 flex-wrap pl-0.5">
                  <span className="text-2xs text-loom-muted shrink-0">Split</span>
                  <div className="flex gap-1 flex-wrap">
                    {(
                      [
                        ["color", "Color"],
                        ["facet", "Facet"],
                        ["both", "Both"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => applySplitMode(mode)}
                        className={`min-h-8 px-2.5 text-2xs rounded-md ${
                          splitMode === mode
                            ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50"
                            : "text-loom-muted border border-loom-border hover:border-loom-accent/40"
                        }`}
                        title={
                          mode === "color"
                            ? "Overlay series by color"
                            : mode === "facet"
                              ? "Small multiples (one panel per value)"
                              : "Color within each facet panel"
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {showTopN && (
                <div className="flex items-center gap-2 pl-0.5">
                  <label className="text-2xs text-loom-muted shrink-0" htmlFor="loom-top-n">
                    Top N
                  </label>
                  <select
                    id="loom-top-n"
                    value={clampTopN(activeChart.topN, DEFAULT_TOP_N)}
                    onChange={(e) => applyTopN(Number(e.target.value))}
                    className="loom-input flex-1 text-xs py-1.5 min-h-8"
                    title="How many categories to keep (ranked by value)"
                  >
                    {TOP_N_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {showCompareY && (
                <>
                  <EncodingSlot
                    label="Compare Y"
                    value={activeChart.y2Field ?? ""}
                    options={numericOptions.filter((o) => o.value !== activeChart.yField)}
                    allowEmpty
                    emptyLabel="None"
                    typeHint={activeChart.y2Field ? colType(activeChart.y2Field) : undefined}
                    onChange={(v) => applyEncodingExtra("y2", v === "" ? "__none__" : v)}
                  />
                  <label className="flex items-center gap-1.5 text-2xs text-loom-muted cursor-pointer pl-0.5">
                    <input
                      type="checkbox"
                      checked={!!activeChart.comparePrevious}
                      onChange={(e) => applyComparePrevious(e.target.checked)}
                      className="rounded border-loom-border accent-loom-accent"
                    />
                    Overlay earlier half (compare)
                  </label>
                </>
              )}
              {timeColNames.length > 0 && (
                <>
                  <EncodingSlot
                    label="Time"
                    value={timeFieldActive ?? ""}
                    options={timeColNames.map((n) => ({ value: n, label: n }))}
                    allowEmpty
                    emptyLabel="None"
                    typeHint={timeFieldActive ? colType(timeFieldActive) : undefined}
                    onChange={(v) =>
                      applyTimeWindow({
                        field: v === "" || v === "__none__" ? null : v,
                        range: v === "" || v === "__none__" ? "all" : timeWindowActive,
                      })
                    }
                  />
                  <div className="flex items-center gap-1.5 flex-wrap pl-0.5">
                    <span className="text-2xs text-loom-muted shrink-0">Window</span>
                    <div className="flex gap-1 flex-wrap">
                      {(timeRangeChoices.includes(timeWindowActive)
                        ? timeRangeChoices
                        : [timeWindowActive, ...timeRangeChoices.filter((r) => r !== timeWindowActive)]
                      ).map((r) => {
                        const spec = CHART_TIME_RANGES.find((x) => x.value === r);
                        const on = timeWindowActive === r;
                        return (
                          <button
                            key={r}
                            type="button"
                            disabled={!timeFieldActive && r !== "all"}
                            onClick={() => applyTimeWindow({ field: timeFieldActive, range: r })}
                            className={`min-h-8 px-2.5 text-2xs rounded-md ${
                              on
                                ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50"
                                : "text-loom-muted border border-loom-border hover:border-loom-accent/40"
                            }`}
                            title={spec?.label ?? r}
                          >
                            {spec?.short ?? r}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {timeWindowActive !== "all" && sampleRows && (
                    <p className="text-2xs text-loom-muted pl-0.5">
                      {(() => {
                        const slice = applyChartTimeWindow(sampleRows.rows, sampleRows.columns, {
                          timeWindowField: timeFieldActive,
                          timeWindow: timeWindowActive,
                        });
                        if (!slice.filtered) {
                          return "Window uses the wall clock for live data, or the newest sample time for historical files.";
                        }
                        const modeHint =
                          slice.mode === "forward"
                            ? "upcoming from now"
                            : slice.mode === "wall"
                              ? "wall clock"
                              : "from newest sample";
                        return `${slice.kept.toLocaleString()} of ${slice.total.toLocaleString()} rows (${modeHint})`;
                      })()}
                    </p>
                  )}
                </>
              )}
              {caps.zChannel && (
                <EncodingSlot
                  label={isDataCube ? "Depth" : "Z"}
                  value={activeChart.zField ?? ""}
                  options={isDataCube ? allColOptions : numericOptions}
                  allowEmpty={!isDataCube}
                  emptyLabel="Auto"
                  typeHint={activeChart.zField ? colType(activeChart.zField) : undefined}
                  onChange={(v) => applyEncodingExtra("z", v === "" ? "__none__" : v)}
                />
              )}
              {showSize && sizeInPrimary && (
                <EncodingSlot
                  label={channelLabels.size}
                  value={activeChart.sizeField ?? ""}
                  options={numericOptions}
                  allowEmpty
                  emptyLabel={isDataCube ? "Row count" : "None"}
                  typeHint={activeChart.sizeField ? colType(activeChart.sizeField) : undefined}
                  onChange={(v) => applyEncodingExtra("size", v === "" ? "__none__" : v)}
                  trailing={
                    isDataCube ? (
                      <div className="flex items-center gap-2 pl-0.5">
                        <label className="text-2xs text-loom-muted shrink-0" htmlFor="loom-cube-agg">
                          Aggregate
                        </label>
                        <select
                          id="loom-cube-agg"
                          value={cubeAggregate}
                          onChange={(e) => applyYAggregate(e.target.value as YAggregateOption)}
                          disabled={!activeChart.sizeField}
                          className="loom-input flex-1 text-xs py-1.5 min-h-8"
                          title="How each cell's rows are summarized"
                        >
                          {Y_AGGREGATE_OPTIONS.filter((opt) => opt.value !== "count" || !activeChart.sizeField).map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : undefined
                  }
                />
              )}
            </div>

            {(showSize || showGlowOutline || showOpacityEnc) && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setMoreChannelsOpen((o) => !o)}
                  className="flex w-full items-center justify-between text-2xs text-loom-muted hover:text-loom-text py-1"
                >
                  <span>
                    More channels
                    {extraChannelCount > 0 ? ` · ${extraChannelCount} set` : ""}
                  </span>
                  <span>{moreChannelsOpen ? "▼" : "▶"}</span>
                </button>
                {moreChannelsOpen && (
                  <div className="space-y-2">
                    {showSize && !sizeInPrimary && (
                      <EncodingSlot
                        label={channelLabels.size}
                        value={activeChart.sizeField ?? ""}
                        options={numericOptions}
                        allowEmpty
                        typeHint={activeChart.sizeField ? colType(activeChart.sizeField) : undefined}
                        onChange={(v) => applyEncodingExtra("size", v === "" ? "__none__" : v)}
                      />
                    )}
                    {showGlowOutline && (
                      <>
                        <EncodingSlot
                          label="Glow"
                          value={activeChart.glowField ?? ""}
                          options={allColOptions}
                          allowEmpty
                          onChange={(v) => applyEncodingExtra("glow", v === "" ? "__none__" : v)}
                        />
                        <EncodingSlot
                          label="Outline"
                          value={activeChart.outlineField ?? ""}
                          options={allColOptions}
                          allowEmpty
                          onChange={(v) => applyEncodingExtra("outline", v === "" ? "__none__" : v)}
                        />
                      </>
                    )}
                    {showOpacityEnc && (
                      <EncodingSlot
                        label="Opacity"
                        value={activeChart.opacityField ?? ""}
                        options={allColOptions}
                        allowEmpty
                        onChange={(v) => applyEncodingExtra("opacity", v === "" ? "__none__" : v)}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-loom-border/70 pt-2 space-y-2">
              <button
                type="button"
                onClick={() => setTooltipOpen((o) => !o)}
                className="flex w-full items-center justify-between text-2xs text-loom-muted hover:text-loom-text py-1"
              >
                <span>
                  Tooltip
                  {tooltipSelectedCount > 0
                    ? ` · ${tooltipSelectedCount} fields`
                    : " · encoding defaults"}
                </span>
                <span>{tooltipOpen ? "▼" : "▶"}</span>
              </button>
              {tooltipOpen && (
                <div className="space-y-2">
                  {!caps.tooltipHover && (
                    <p className="text-2xs text-loom-muted leading-snug">
                      Hover tooltips aren’t available for this chart type yet — field picks still save for share / when you switch kinds.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {columnStats.map((c) => {
                      const on = activeChart.tooltipFields?.includes(c.name) ?? false;
                      return (
                        <button
                          key={c.name}
                          type="button"
                          onClick={() => {
                            const cur = new Set(activeChart.tooltipFields ?? []);
                            if (on) cur.delete(c.name);
                            else cur.add(c.name);
                            applyTooltipFields([...cur]);
                          }}
                          className={`min-h-8 px-2 rounded-md text-2xs border transition-colors ${
                            on
                              ? "border-loom-accent/50 bg-loom-accent/15 text-loom-text"
                              : "border-loom-border text-loom-muted hover:border-loom-accent/30 hover:text-loom-text"
                          }`}
                          title={c.data_type}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => applyTooltipFields([])}
                      className="text-2xs text-loom-muted hover:text-loom-text"
                    >
                      Use encoding defaults
                    </button>
                  </div>
                  <EncodingSlot
                    label="Link"
                    value={activeChart.tooltipKeyField ?? ""}
                    options={allColOptions}
                    allowEmpty
                    emptyLabel="Same as X"
                    onChange={(v) => applyTooltipKeyField(v === "" ? null : v)}
                  />
                  <p className="text-2xs text-loom-muted leading-snug">
                    Link key is used when you press L on the chart to filter by a value.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-2xs text-loom-muted tabular-nums truncate">
                {rowCount.toLocaleString()}
                {totalRows > rowCount ? ` / ${totalRows.toLocaleString()}` : ""} rows · {aggSummary}
              </p>
              <SaveChartViewButton />
            </div>
          </div>
      </div>

      {/* Active chart — toggles & annotations */}
      <div className="loom-card overflow-hidden">
        <button
          type="button"
          onClick={() => setActiveChartOpen((o) => !o)}
          className="w-full flex items-center justify-between px-2.5 py-2 text-left hover:bg-loom-elevated/50 transition-colors"
        >
          <span className="text-xs font-semibold text-loom-text">Active chart</span>
          <span className="text-loom-muted text-xs">{activeChartOpen ? "▼" : "▶"}</span>
        </button>
        {activeChartOpen && (
          <div className="space-y-2 px-2.5 pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="loom-badge capitalize">{activeChart.kind}</span>
              <button
                type="button"
                className="text-2xs text-loom-muted hover:text-loom-text border-b border-dotted border-loom-muted/40"
                title={aiSuggestionReason ?? getRecommendationReason(activeChart)}
              >
                Why this chart?
              </button>
            </div>
            {caps.scatterExtras && (
              <div className="mt-2 space-y-1">
                <label className="flex items-center gap-1.5 text-2xs text-loom-muted cursor-pointer">
                  <input type="checkbox" checked={connectScatterTrail} onChange={(e) => setConnectScatterTrail(e.target.checked)} className="rounded border-loom-border accent-loom-accent" />
                  Connect points (trail)
                </label>
                <label className="flex items-center gap-1.5 text-2xs text-loom-muted cursor-pointer">
                  <input type="checkbox" checked={showMarginals} onChange={(e) => setShowMarginals(e.target.checked)} className="rounded border-loom-border accent-loom-accent" />
                  Marginal distributions
                </label>
              </div>
            )}
            {/* Custom reference lines */}
            {caps.referenceLines && (
            <div className="mt-2">
              <button type="button" onClick={() => {
                setPromptDialog({
                  title: "Reference line value (number)",
                  defaultValue: "",
                  onConfirm: (val) => {
                    if (val == null || isNaN(Number(val))) return;
                    setTimeout(() => {
                      setPromptDialog({
                        title: "Label",
                        defaultValue: "Ref",
                        onConfirm: (label) => {
                          if (label != null) addCustomRefLine(activeChart.id, "y", Number(val), label || "Ref");
                        }
                      });
                    }, 50);
                  }
                });
              }} className="text-2xs text-loom-muted hover:text-loom-text">+ Add reference line</button>
              {(customRefLines[activeChart.id] ?? []).map((l) => (
                <div key={l.id} className="flex items-center justify-between text-2xs text-loom-text mt-0.5">
                  <span>{l.axis.toUpperCase()}={l.value} {l.label}</span>
                  <button type="button" onClick={() => removeCustomRefLine(activeChart.id, l.id)} className="text-loom-muted hover:text-loom-text">×</button>
                </div>
              ))}
            </div>
            )}
          </div>
        )}
      </div>

      {/* Vega-Lite spec — under Encoding */}
      <div className="loom-card overflow-hidden">
        <button
          type="button"
          onClick={() => setVegaOpen((o) => !o)}
          className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-loom-elevated/50 rounded transition-colors"
        >
          <span className="text-xs font-semibold text-loom-text">Vega-Lite spec</span>
          <span className="text-loom-muted text-xs">{vegaOpen ? "▼" : "▶"}</span>
        </button>
        {vegaOpen && (
          <div className="space-y-2 px-2 pb-2">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setSpecExpanded(!specExpanded)}
                className="text-2xs text-loom-muted hover:text-loom-accent transition-colors"
              >
                {specExpanded ? "Collapse JSON" : "Expand JSON"}
              </button>
              <button
                type="button"
                onClick={handleCopySpec}
                className="text-2xs px-2 py-1 rounded border border-loom-border hover:border-loom-accent text-loom-muted hover:text-loom-text transition-colors"
              >
                {specCopyOk ? "Copied" : "Copy JSON"}
              </button>
            </div>
            {specExpanded && (
              <pre className="text-2xs font-mono text-loom-muted bg-loom-bg rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                {specJson}
              </pre>
            )}
          </div>
        )}
      </div>
        </div>
      )}

      {chartPanelSection === "visual" && (
        <div
          role="tabpanel"
          id="chart-section-panel-visual"
          aria-labelledby="chart-section-visual"
        >
      {/* Visual */}
      <div className="loom-card overflow-hidden">
        <div className="space-y-4 px-2.5 py-3">
            {/* Presets — full replace */}
            <div className="space-y-1.5">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Design system</p>
              <p className="text-2xs text-loom-muted leading-snug">
                Full looks — Tufte / Bauhaus / Newspaper / Military change ink, axes, and atmosphere on every chart kind.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(VISUAL_PRESETS) as VisualPresetId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    title={VISUAL_PRESET_BLURB[id]}
                    onClick={() => setChartVisualOverrides({ ...VISUAL_PRESETS[id].overrides })}
                    className={`px-2.5 py-1.5 min-h-9 text-2xs rounded border ${
                      id === "tufte" || id === "bauhaus" || id === "newspaper" || id === "military"
                        ? "border-loom-accent/50 text-loom-text bg-loom-accent/5 hover:bg-loom-accent/12"
                        : id === "clarity"
                          ? "border-loom-accent/60 text-loom-accent bg-loom-accent/10 hover:bg-loom-accent/15"
                          : "border-loom-border text-loom-text hover:border-loom-accent hover:bg-loom-accent/10"
                    }`}
                  >
                    {VISUAL_PRESETS[id].name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const next = shuffleVisualOverrides(chartVisualOverrides, visualLocks);
                    setChartVisualOverrides(next);
                    const locked = VISUAL_SHUFFLE_SECTIONS.filter((s) => visualLocks[s.id]).map((s) => s.label);
                    setToast(
                      locked.length
                        ? `Shuffled look · kept ${locked.join(", ")}`
                        : "Shuffled look · color + design",
                    );
                  }}
                  className="px-2.5 py-1.5 min-h-9 text-2xs rounded border border-loom-accent/50 text-loom-accent hover:bg-loom-accent/10"
                  title="Randomize unlocked Visual sections (Color included when unlocked)"
                >
                  Shuffle look
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                <span className="text-2xs text-loom-muted mr-0.5">Lock</span>
                {VISUAL_SHUFFLE_SECTIONS.map((s) => {
                  const on = !!visualLocks[s.id];
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleVisualLock(s.id)}
                      title={on ? `Unlock ${s.label}` : `Lock ${s.label} while shuffling`}
                      className={`px-1.5 py-0.5 text-2xs rounded border ${
                        on
                          ? "border-loom-accent/60 text-loom-accent bg-loom-accent/10"
                          : "border-loom-border text-loom-muted hover:border-loom-accent/40"
                      }`}
                    >
                      {s.label}{on ? " · locked" : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Color palettes */}
            <div className="space-y-2">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Color</p>
              <p className="text-2xs text-loom-muted leading-snug">
                Data-viz scales — Auto picks categorical, sequential, or semantic from the chart.
              </p>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["auto", "Auto"],
                    ["categorical", "Cat"],
                    ["sequential", "Seq"],
                    ["diverging", "Div"],
                    ["spectrum", "Spec"],
                    ["semantic", "Sem"],
                  ] as const
                ).map(([id, label]) => {
                  const cur = chartVisualOverrides.colorScaleKind ?? "auto";
                  const active = cur === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        updateOverride("colorScaleKind", id);
                        if (id === "auto") updateOverride("colorPalette", "auto");
                        else {
                          const first = COLOR_PALETTES.find(
                            (p) => p.kind === id && p.source === "system" && p.id !== "auto",
                          );
                          if (first) updateOverride("colorPalette", first.id);
                        }
                      }}
                      className={`px-2 py-1 text-2xs rounded border ${
                        active
                          ? "border-loom-accent text-loom-accent bg-loom-accent/10"
                          : "border-loom-border text-loom-muted hover:border-loom-accent/50"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!chartVisualOverrides.colorPaletteReverse}
                  onChange={(e) => updateOverride("colorPaletteReverse", e.target.checked)}
                  className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                />
                Reverse scale
              </label>
              {(() => {
                const applied = resolveChartColors({
                  paletteId: chartVisualOverrides.colorPalette ?? "auto",
                  theme: appSettings.theme,
                  colorblind: !!appSettings.colorblindCharts,
                  chartKind: activeChart?.kind ?? null,
                  reverse: !!chartVisualOverrides.colorPaletteReverse,
                  scaleKind: chartVisualOverrides.colorScaleKind ?? "auto",
                });
                const kindFilter = chartVisualOverrides.colorScaleKind ?? "auto";
                const grouped = palettesGrouped();
                const filterList = (list: typeof grouped.system) =>
                  kindFilter === "auto"
                    ? list
                    : list.filter((p) => p.kind === (kindFilter as PaletteKind));
                const sections: { title: string; items: typeof grouped.system }[] = [
                  { title: "System", items: filterList(grouped.system) },
                  { title: "Theme", items: filterList(grouped.theme) },
                  { title: "Research", items: filterList(grouped.research) },
                ].filter((s) => s.items.length > 0);
                const selectedId = chartVisualOverrides.colorPalette ?? "auto";
                return (
                  <div className="space-y-2.5">
                    <div className="rounded border border-loom-border/60 bg-loom-elevated/40 px-2 py-1.5">
                      <p className="text-2xs text-loom-muted mb-1">
                        Applied · {applied.paletteId}
                        {applied.continuous ? " · continuous" : ""}
                      </p>
                      <div className="flex h-3 rounded overflow-hidden">
                        {applied.colors.map((c, i) => (
                          <span key={`${c}-${i}`} className="flex-1" style={{ background: c }} title={c} />
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        updateOverride("colorPalette", "auto");
                        updateOverride("colorScaleKind", "auto");
                      }}
                      className={`w-full text-left rounded border px-2 py-1.5 ${
                        selectedId === "auto"
                          ? "border-loom-accent bg-loom-accent/10"
                          : "border-loom-border hover:border-loom-accent/40"
                      }`}
                    >
                      <span className="text-2xs text-loom-text font-medium">Auto</span>
                      <span className="block text-2xs text-loom-muted">Match scale to chart kind</span>
                    </button>
                    {sections.map((sec) => (
                      <div key={sec.title} className="space-y-1">
                        <p className="text-2xs text-loom-muted uppercase tracking-wide">{sec.title}</p>
                        <div className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
                          {sec.items.map((p) => {
                            const active = selectedId === p.id;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                  updateOverride("colorPalette", p.id);
                                  updateOverride("colorScaleKind", p.kind);
                                }}
                                className={`w-full text-left rounded border px-2 py-1.5 ${
                                  active
                                    ? "border-loom-accent bg-loom-accent/10"
                                    : "border-loom-border hover:border-loom-accent/40"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="text-2xs text-loom-text font-medium truncate">{p.name}</span>
                                  <span className="text-2xs text-loom-muted shrink-0">{p.kind}</span>
                                </div>
                                <div className="flex h-2.5 rounded overflow-hidden">
                                  {p.colors.map((c, i) => (
                                    <span key={`${p.id}-${i}`} className="flex-1" style={{ background: c }} />
                                  ))}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Look spectrum — only controls that affect this chart kind */}
            <div className="space-y-2.5">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Look</p>
              <IconToggleGroup
                label="Detail"
                value={chartVisualOverrides.chartDetail ?? "viz"}
                onChange={(v) => updateOverride("chartDetail", v)}
                options={[
                  { value: "plain", label: "Plain", icon: Ico.plain },
                  { value: "viz", label: "Viz", icon: Ico.viz },
                  { value: "deep", label: "Deep", icon: Ico.deep },
                ]}
              />
              {caps.markMotif && (
                <IconToggleGroup
                  label="Mark motif"
                  value={chartVisualOverrides.markMotif ?? "dots"}
                  onChange={(v) => updateOverride("markMotif", v)}
                  options={[
                    { value: "dots", label: "Dots", icon: Ico.dots },
                    { value: "squares", label: "Squares", icon: Ico.squares },
                    { value: "ticks", label: "Ticks", icon: Ico.ticks },
                    { value: "bar", label: "Bar", icon: Ico.bar },
                    { value: "ring", label: "Ring", icon: Ico.ring },
                  ]}
                />
              )}
              {caps.cartesian && (
                <IconToggleGroup
                  label="Axis style"
                  value={chartVisualOverrides.axisStyle ?? "rule"}
                  onChange={(v) => updateOverride("axisStyle", v)}
                  options={[
                    { value: "rule", label: "Rule", icon: Ico.rule },
                    { value: "ladder", label: "Ladder", icon: Ico.ladder },
                    { value: "mercury", label: "Mercury", icon: Ico.mercury },
                    { value: "spine", label: "Spine", icon: Ico.spine },
                    { value: "index", label: "Index", icon: Ico.index },
                    { value: "tape", label: "Tape", icon: Ico.tape },
                  ]}
                />
              )}
              <IconToggleGroup
                label="Title layout"
                value={chartVisualOverrides.titleLayout ?? "pair"}
                onChange={(v) => updateOverride("titleLayout", v)}
                options={[
                  { value: "pair", label: "Pair", icon: Ico.pair },
                  { value: "stack", label: "Stack", icon: Ico.stack },
                  { value: "spine", label: "Spine", icon: Ico.titleSpine },
                  { value: "caption", label: "Caption", icon: Ico.caption },
                  { value: "ticket", label: "Ticket", icon: Ico.ticket },
                  { value: "slab", label: "Slab", icon: Ico.slab },
                ]}
              />
              <IconToggleGroup
                label="Frame"
                value={chartVisualOverrides.chartFrame ?? "focus"}
                onChange={(v) => updateOverride("chartFrame", v)}
                options={[
                  { value: "hero", label: "Hero", icon: Ico.hero },
                  { value: "compact", label: "Compact", icon: Ico.compact },
                  { value: "focus", label: "Focus", icon: Ico.focus },
                ]}
              />
              <div className="space-y-1.5">
                <p className="text-2xs text-loom-muted">Source footnote</p>
                <p className="text-[10px] text-loom-muted/80 leading-snug">
                  Drawn on the chart (and in Share / PNG) — pathway back to the data.
                </p>
                <select
                  className="loom-input text-2xs w-full py-1.5"
                  value={chartVisualOverrides.sourceFootnote ?? "credit"}
                  onChange={(e) =>
                    updateOverride(
                      "sourceFootnote",
                      e.target.value as "off" | "name" | "credit" | "full",
                    )
                  }
                >
                  <option value="off">Off</option>
                  <option value="name">Name only</option>
                  <option value="credit">Name + credit</option>
                  <option value="full">Full lineage</option>
                </select>
                {(chartVisualOverrides.sourceFootnote ?? "credit") !== "off" && (
                  <IconToggleGroup
                    label="Footnote align"
                    value={chartVisualOverrides.sourceFootnoteAlign ?? "left"}
                    onChange={(v) => updateOverride("sourceFootnoteAlign", v)}
                    options={[
                      { value: "left", label: "Left", icon: Ico.plain },
                      { value: "center", label: "Center", icon: Ico.viz },
                      { value: "right", label: "Right", icon: Ico.deep },
                    ]}
                  />
                )}
              </div>
              <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer min-h-8">
                <input
                  type="checkbox"
                  checked={chartVisualOverrides.ghostEnabled ?? false}
                  onChange={(e) => updateOverride("ghostEnabled", e.target.checked)}
                  className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                />
                Ghost overlay
              </label>
              {chartVisualOverrides.ghostEnabled && (
                <div className="space-y-2.5 pl-0.5">
                  <IconToggleGroup
                    label="Ghost weight"
                    value={chartVisualOverrides.ghostWeight ?? "soft"}
                    onChange={(v) => updateOverride("ghostWeight", v)}
                    options={[
                      { value: "whisper", label: "Whisper", icon: Ico.whisper },
                      { value: "soft", label: "Soft", icon: Ico.soft },
                      { value: "firm", label: "Firm", icon: Ico.firm },
                    ]}
                  />
                  <IconToggleGroup
                    label="Ghost place"
                    value={chartVisualOverrides.ghostPlace ?? "se"}
                    onChange={(v) => updateOverride("ghostPlace", v)}
                    options={[
                      { value: "nw", label: "Top left", icon: Ico.nw },
                      { value: "ne", label: "Top right", icon: Ico.ne },
                      { value: "sw", label: "Bottom left", icon: Ico.sw },
                      { value: "se", label: "Bottom right", icon: Ico.se },
                    ]}
                  />
                </div>
              )}
            </div>
            {/* Typography */}
            <div className="space-y-2.5">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Typography</p>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Font family</label>
                <select
                  value={chartVisualOverrides.fontFamily ?? "Inter"}
                  onChange={(e) => updateOverride("fontFamily", e.target.value)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {["Inter", "JetBrains Mono", "IBM Plex Sans", "Libre Baskerville", "Lora", "Fira Code", "Geist"].map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <IconToggleGroup
                label="Title weight"
                value={chartVisualOverrides.titleFontWeight ?? 600}
                onChange={(v) => updateOverride("titleFontWeight", v)}
                options={[
                  { value: 300, label: "Light", icon: Ico.weightLight },
                  { value: 400, label: "Regular", icon: Ico.weightRegular },
                  { value: 600, label: "Semibold", icon: Ico.weightSemi },
                  { value: 700, label: "Bold", icon: Ico.weightBold },
                ]}
              />
              <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer min-h-8">
                <input
                  type="checkbox"
                  checked={chartVisualOverrides.titleItalic ?? false}
                  onChange={(e) => updateOverride("titleItalic", e.target.checked)}
                  className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                />
                Title italic
              </label>
              {caps.cartesian && (
                <IconToggleGroup
                  label="Tick label rotation"
                  value={chartVisualOverrides.tickRotation ?? 0}
                  onChange={(v) => updateOverride("tickRotation", v)}
                  options={[
                    { value: 0, label: "0°", icon: Ico.rot0 },
                    { value: 30, label: "30°", icon: Ico.rot30 },
                    { value: 45, label: "45°", icon: Ico.rot45 },
                    { value: 60, label: "60°", icon: Ico.rot60 },
                    { value: 90, label: "90°", icon: Ico.rot90 },
                  ]}
                />
              )}
            </div>

            {/* Marks — only for kinds that draw marks this way */}
            {(caps.markPoints || caps.barMarks || caps.lineMarks) && (
            <div className="space-y-2">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Marks</p>
              {caps.markPoints && (
                <>
                  <div>
                    <label className="block text-2xs text-loom-muted mb-1">Point size</label>
                    <input
                      type="range"
                      min={2}
                      max={24}
                      value={chartVisualOverrides.pointSize ?? 12}
                      onChange={(e) => updateOverride("pointSize", Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                    />
                    <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.pointSize ?? 12}</span>
                  </div>
                  <div>
                    <label className="block text-2xs text-loom-muted mb-1">Mark shape</label>
                    <select
                      value={chartVisualOverrides.markShape ?? "circle"}
                      onChange={(e) => updateOverride("markShape", e.target.value)}
                      className="loom-input w-full text-xs py-1.5"
                    >
                      {["circle", "square", "diamond", "triangle", "cross", "star", "hexagon", "ring"].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chartVisualOverrides.markStroke ?? false}
                      onChange={(e) => updateOverride("markStroke", e.target.checked)}
                      className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                    />
                    Mark outline
                  </label>
                  {chartVisualOverrides.markStroke && (
                    <div className="grid grid-cols-2 gap-1">
                      <div>
                        <label className="block text-2xs text-loom-muted mb-0.5">Stroke width</label>
                        <input
                          type="number"
                          min={0.5}
                          max={3}
                          step={0.5}
                          value={chartVisualOverrides.markStrokeWidth ?? 1}
                          onChange={(e) => updateOverride("markStrokeWidth", Number(e.target.value) || undefined)}
                          className="loom-input w-full text-xs py-1"
                        />
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-2xs text-loom-muted mb-1">Jitter (px)</label>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      value={chartVisualOverrides.markJitter ?? 0}
                      onChange={(e) => updateOverride("markJitter", Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                    />
                    <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.markJitter ?? 0}</span>
                  </div>
                  <div>
                    <label className="block text-2xs text-loom-muted mb-1">Size scale</label>
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.1}
                      value={chartVisualOverrides.sizeScale ?? 1}
                      onChange={(e) => updateOverride("sizeScale", Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                    />
                    <span className="text-2xs font-mono text-loom-muted ml-2">
                      {(chartVisualOverrides.sizeScale ?? 1).toFixed(1)}×
                      {activeChart.sizeField && (() => {
                        const s = chartVisualOverrides.sizeScale ?? 1;
                        return (
                          <span className="ml-1 text-loom-muted/80" title="Size encoding min–max multiplier">
                            {" "}(range {(0.4 * s).toFixed(1)}× – {(1.2 * s).toFixed(1)}×)
                          </span>
                        );
                      })()}
                    </span>
                  </div>
                </>
              )}
              {caps.barMarks && (
                <div>
                  <label className="block text-2xs text-loom-muted mb-1">Bar corner radius (px)</label>
                  <input
                    type="range"
                    min={0}
                    max={12}
                    value={chartVisualOverrides.barCornerRadius ?? 3}
                    onChange={(e) => updateOverride("barCornerRadius", Number(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                  />
                  <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.barCornerRadius ?? 3}</span>
                </div>
              )}
              {caps.lineMarks && (
                <>
                  <IconToggleGroup
                    label="Line style"
                    value={chartVisualOverrides.lineStrokeStyle ?? "solid"}
                    onChange={(v) => updateOverride("lineStrokeStyle", v)}
                    options={[
                      { value: "solid", label: "Solid", icon: Ico.solid },
                      { value: "dashed", label: "Dashed", icon: Ico.dashed },
                      { value: "dotted", label: "Dotted", icon: Ico.dotted },
                    ]}
                  />
                  <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer min-h-8">
                    <input
                      type="checkbox"
                      checked={chartVisualOverrides.lineCurveSmooth ?? false}
                      onChange={(e) => updateOverride("lineCurveSmooth", e.target.checked)}
                      className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                    />
                    Smooth curve
                  </label>
                </>
              )}
            </div>
            )}

            {/* Axes & Grid — cartesian charts only */}
            {caps.cartesian && (
            <div className="space-y-2.5">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Axes & Grid</p>
              <ColorSwatchGroup
                label="Axis line color"
                value={chartVisualOverrides.axisLineColor ?? "theme"}
                onChange={(v) => updateOverride("axisLineColor", v === "theme" ? undefined : v)}
                options={[
                  { value: "theme", label: "Theme border", color: "theme" },
                  { value: "#2a2a30", label: "Graphite", color: "#2a2a30" },
                  { value: "#6b6b78", label: "Muted", color: "#6b6b78" },
                  { value: "#000000", label: "Black", color: "#000000" },
                  { value: "#ffffff", label: "White", color: "#ffffff" },
                  { value: "#c8c8c4", label: "Light gray", color: "#c8c8c4" },
                ]}
              />
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Axis line width</label>
                <input
                  type="range"
                  min={0.5}
                  max={4}
                  step={0.5}
                  value={chartVisualOverrides.axisLineWidth ?? 1}
                  onChange={(e) => updateOverride("axisLineWidth", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                />
                <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.axisLineWidth ?? 1}</span>
              </div>
              <IconToggleGroup
                label="Grid style"
                value={chartVisualOverrides.gridStyle ?? "solid"}
                onChange={(v) => updateOverride("gridStyle", v)}
                options={[
                  { value: "solid", label: "Solid", icon: Ico.solid },
                  { value: "dashed", label: "Dashed", icon: Ico.dashed },
                  { value: "dotted", label: "Dotted", icon: Ico.dotted },
                  { value: "none", label: "None", icon: Ico.none },
                ]}
              />
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Grid opacity</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={chartVisualOverrides.gridOpacity ?? 0.5}
                  onChange={(e) => updateOverride("gridOpacity", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                />
                <span className="text-2xs font-mono text-loom-muted ml-2">{((chartVisualOverrides.gridOpacity ?? 0.5) * 100).toFixed(0)}%</span>
              </div>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Tick count</label>
                <input
                  type="range"
                  min={3}
                  max={10}
                  value={chartVisualOverrides.tickCount ?? 5}
                  onChange={(e) => updateOverride("tickCount", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                />
                <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.tickCount ?? 5}</span>
              </div>
              <ColorSwatchGroup
                label="Axis label color"
                value={chartVisualOverrides.axisLabelColor ?? "theme"}
                onChange={(v) => updateOverride("axisLabelColor", v === "theme" ? undefined : v)}
                options={[
                  { value: "theme", label: "Theme muted", color: "theme" },
                  { value: "#6b6b78", label: "Muted gray", color: "#6b6b78" },
                  { value: "#000000", label: "Black", color: "#000000" },
                  { value: "#ffffff", label: "White", color: "#ffffff" },
                  { value: "#e8e8ec", label: "Near white", color: "#e8e8ec" },
                  { value: "#1a1a1f", label: "Near black", color: "#1a1a1f" },
                ]}
              />
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Axis font size</label>
                <input
                  type="number"
                  min={8}
                  max={16}
                  value={chartVisualOverrides.axisFontSize ?? 10}
                  onChange={(e) => updateOverride("axisFontSize", Number(e.target.value) || undefined)}
                  className="loom-input w-full text-xs py-1"
                />
              </div>
              <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={chartVisualOverrides.showGrid ?? true}
                  onChange={(e) => updateOverride("showGrid", e.target.checked)}
                  className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                />
                Show grid
              </label>
            </div>
            )}

            {/* Layout */}
            <div className="space-y-2">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Layout</p>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Chart padding (px)</label>
                <input
                  type="range"
                  min={20}
                  max={80}
                  value={chartVisualOverrides.chartPadding ?? 56}
                  onChange={(e) => updateOverride("chartPadding", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                />
                <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.chartPadding ?? 56}</span>
              </div>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Legend position</label>
                <select
                  value={chartVisualOverrides.legendPosition ?? "auto"}
                  onChange={(e) => updateOverride("legendPosition", e.target.value)}
                  className="loom-input w-full text-xs py-1.5"
                  disabled={!caps.legend}
                >
                  {[
                    ["auto", "Auto (emptiest corner)"],
                    ["top-right", "Top right"],
                    ["top-left", "Top left"],
                    ["bottom-right", "Bottom right"],
                    ["bottom-left", "Bottom left"],
                    ["none", "None"],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                {!caps.legend && (
                  <p className="text-2xs text-loom-muted mt-0.5">Legend isn’t used for this chart type.</p>
                )}
              </div>
              {caps.dataLabels && (
                <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chartVisualOverrides.showDataLabels ?? false}
                    onChange={(e) => updateOverride("showDataLabels", e.target.checked)}
                    className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                  />
                  Data labels
                </label>
              )}
            </div>

            {/* Atmosphere */}
            <div className="space-y-2">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Atmosphere</p>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Background</label>
                <select
                  value={chartVisualOverrides.backgroundStyle ?? "default"}
                  onChange={(e) => updateOverride("backgroundStyle", e.target.value)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {["default", "tufte", "newsprint", "bauhaus", "carbon", "blueprint", "ruled", "gradient", "paper", "transparent"].map((b) => (
                    <option key={b} value={b}>
                      {b === "default" ? "Default"
                        : b === "tufte" ? "Tufte clean"
                        : b === "newsprint" ? "Newsprint"
                        : b === "bauhaus" ? "Bauhaus blocks"
                        : b === "carbon" ? "Carbon hatch"
                        : b === "blueprint" ? "Blueprint"
                        : b === "ruled" ? "Ruled notebook"
                        : b === "gradient" ? "Gradient vignette"
                        : b === "paper" ? "Paper grain"
                        : "Transparent"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Blend mode</label>
                <select
                  value={chartVisualOverrides.blendMode ?? "source-over"}
                  onChange={(e) => updateOverride("blendMode", e.target.value as GlobalCompositeOperation)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {["source-over", "screen", "multiply", "lighten"].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              {caps.markPoints && (
                <>
                  <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chartVisualOverrides.glowEnabled ?? false}
                      onChange={(e) => updateOverride("glowEnabled", e.target.checked)}
                      className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                    />
                    Glow on marks
                  </label>
                  {chartVisualOverrides.glowEnabled && (
                    <div>
                      <label className="block text-2xs text-loom-muted mb-1">Glow intensity</label>
                      <input
                        type="range"
                        min={1}
                        max={20}
                        value={chartVisualOverrides.glowIntensity ?? 8}
                        onChange={(e) => updateOverride("glowIntensity", Number(e.target.value))}
                        className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                      />
                      <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.glowIntensity ?? 8}</span>
                    </div>
                  )}
                </>
              )}
              <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={chartVisualOverrides.animateEntrance ?? false}
                  onChange={(e) => updateOverride("animateEntrance", e.target.checked)}
                  className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                />
                Animate entrance
              </label>
            </div>

            {/* Annotations */}
            {activeChart && (
              <div className="space-y-2">
                <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Annotations</p>
                <button
                  type="button"
                  onClick={() => {
                    setPromptDialog({
                      title: "Annotation text",
                      defaultValue: "",
                      onConfirm: (text) => {
                        if (text?.trim()) addChartAnnotation(activeChart.id, text.trim());
                      }
                    });
                  }}
                  className="w-full px-2 py-1 text-2xs rounded border border-loom-border text-loom-text hover:border-loom-accent"
                >
                  Add note
                </button>
                {(chartAnnotations[activeChart.id] ?? []).map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-1 text-2xs text-loom-text bg-loom-elevated/50 rounded px-2 py-1">
                    <span className="truncate min-w-0">{a.text}</span>
                    <button type="button" onClick={() => removeChartAnnotation(activeChart.id, a.id)} className="shrink-0 text-loom-muted hover:text-loom-text" aria-label="Remove">×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Shared */}
            <div className="space-y-2 pt-2 border-t border-loom-border">
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Opacity</label>
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={chartVisualOverrides.opacity ?? 0.7}
                  onChange={(e) => updateOverride("opacity", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                />
                <span className="text-2xs font-mono text-loom-muted ml-2">{((chartVisualOverrides.opacity ?? 0.7) * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
      </div>
        </div>
      )}
      </div>
    </div>
  );
}
