// =================================================================
// DetailPanel — Stats / Chart (Vega & visual)
// =================================================================
// Right panel: Stats and Chart tabs. Schema lives in the footer.
// Chart tab: encoding drop zones + dropdowns; drag from footer Schema
// or pick columns from dropdowns.
// =================================================================

"use client";

import { useState, useCallback, useMemo } from "react";
import { useLoomStore, type PanelTab, type ChartVisualOverrides, type AppTheme, type FontScale } from "@/lib/store";
import { formatNumber } from "@/lib/format";
import { COLOR_PALETTES } from "@/lib/chartPalettes";
import {
  createChartRec,
  CHART_KIND_OPTIONS,
  Y_AGGREGATE_OPTIONS,
  getRecommendationReason,
  getRandomEncoding,
  chartKindDataSupport,
  tryBuildRandomChartRec,
  recommend,
  recommendStorySequence,
  recommendStreamStory,
  type ChartKind,
  type YAggregateOption,
} from "@/lib/recommendations";
import { computeDataQualityHints, formatChartAggregationSummary } from "@/lib/chartSupport";
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
import { exportDashboardMicrosite } from "@/lib/tauri";
import { captureStoryDashboardPreviews } from "@/lib/captureStoryPreviews";
import { streamSnapshot, isTauri as checkTauri } from "@/lib/tauri";

const TABS: { key: PanelTab; label: string }[] = [
  { key: "stats", label: "Stats" },
  { key: "chart", label: "Chart" },
  { key: "export", label: "Export" },
  { key: "smart", label: "Smart" },
  { key: "dashboards", label: "Dashboards" },
  { key: "settings", label: "Settings" },
];

export function DetailPanel() {
  const { panelOpen, panelTab, setPanelTab, selectedFile } = useLoomStore();

  if (!panelOpen) return null;

  return (
    <aside className="flex flex-col h-full w-[var(--panel-width)] border-l border-loom-border bg-loom-surface flex-shrink-0">
      {/* Tab Bar */}
      <div role="tablist" aria-label="Panel sections" className="flex items-center gap-0.5 px-2 h-[var(--topbar-height)] border-b border-loom-border flex-wrap">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={panelTab === tab.key}
            aria-label={tab.label}
            onClick={() => setPanelTab(tab.key)}
            className={`
              px-3 py-1 text-xs font-medium rounded transition-all duration-100
              ${panelTab === tab.key
                ? "bg-loom-elevated text-loom-text"
                : "text-loom-muted hover:text-loom-text"
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div role="tabpanel" id="panel-content" aria-label={TABS.find((t) => t.key === panelTab)?.label ?? "Panel"} className="flex-1 overflow-y-auto">
        {panelTab === "settings" ? (
          <SettingsView />
        ) : panelTab === "dashboards" ? (
          <DashboardsView />
        ) : !selectedFile ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-loom-muted">Select a file to inspect</p>
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
      setToast("Capturing chart previews…");
      await captureStoryDashboardPreviews(id);
      setToast(`Created "${story.title}" with ${story.charts.length} charts`);
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
        setToast("Capturing chart previews…");
        await captureStoryDashboardPreviews(id);
      }
      setDashboardsExpanded(true);
      setToast(`Created "${story.title}" with ${story.charts.length} charts`);
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportMicrosite}
            className="text-xs py-1.5 px-2 rounded border border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated hover:border-loom-accent"
            title="Export dashboard as a self-contained HTML file (data lineage included)"
          >
            Export as microsite
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
  const { appSettings, setAppSettings } = useLoomStore();
  const themes: { value: AppTheme; label: string; desc: string }[] = [
    { value: "dark", label: "Dark", desc: "Default dark theme" },
    { value: "light", label: "Light", desc: "Light backgrounds" },
    { value: "high-contrast", label: "High contrast", desc: "Maximum contrast for accessibility" },
    { value: "colorblind", label: "Colorblind friendly", desc: "Palette safe for deuteranopia/protanopia" },
  ];
  const fontScales: { value: FontScale; label: string }[] = [
    { value: 0.9, label: "90%" },
    { value: 1, label: "100%" },
    { value: 1.1, label: "110%" },
    { value: 1.15, label: "115%" },
  ];

  return (
    <div className="p-4 space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Theme</h3>
        <p className="text-2xs text-loom-muted mb-2">App and chart palette</p>
        <div className="space-y-1.5">
          {themes.map((t) => (
            <label
              key={t.value}
              className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors ${appSettings.theme === t.value ? "border-loom-accent bg-loom-accent/10" : "border-loom-border hover:border-loom-muted"
                }`}
            >
              <input
                type="radio"
                name="theme"
                value={t.value}
                checked={appSettings.theme === t.value}
                onChange={() => setAppSettings((prev) => ({ ...prev, theme: t.value }))}
                className="accent-loom-accent"
              />
              <div>
                <span className="text-xs font-medium text-loom-text">{t.label}</span>
                <span className="text-2xs text-loom-muted ml-1">— {t.desc}</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Typography</h3>
        <p className="text-2xs text-loom-muted mb-2">UI font size scale</p>
        <div className="flex flex-wrap gap-2">
          {fontScales.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setAppSettings((prev) => ({ ...prev, fontScale: s.value }))}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${appSettings.fontScale === s.value ? "border-loom-accent bg-loom-accent/20 text-loom-text" : "border-loom-border text-loom-muted hover:text-loom-text"
                }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Accessibility</h3>
        <p className="text-2xs text-loom-muted mb-2">Motion and animation</p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={appSettings.reducedMotion}
            onChange={(e) => setAppSettings((prev) => ({ ...prev, reducedMotion: e.target.checked }))}
            className="rounded border-loom-border accent-loom-accent"
          />
          <span className="text-xs text-loom-text">Reduce motion</span>
        </label>
        <p className="text-2xs text-loom-muted mt-1 ml-6">Minimizes animations and transitions</p>
      </div>

      <div className="pt-2 border-t border-loom-border">
        <p className="text-2xs text-loom-muted">
          Settings apply immediately. In Chart → Visual, the &quot;Theme (app)&quot; color palette uses the same colors as the theme above; other palettes override.
        </p>
      </div>
    </div>
  );
}

const DRAG_TYPE_COLUMN = "application/x-loom-column";

function DropZone({
  label,
  value,
  isActive,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  label: string;
  value: string;
  isActive: boolean;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragEnter(e);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        onDragOver(e);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragLeave();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDrop(e);
      }}
      className={`
        min-h-[36px] rounded border-2 border-dashed px-2 py-2 text-xs font-mono transition-colors flex items-center
        ${isActive ? "border-loom-accent bg-loom-accent/10" : "border-loom-border bg-loom-elevated/50"}
      `}
    >
      <span className="text-loom-muted mr-2">{label}:</span>
      <span className="text-loom-text truncate">{value}</span>
    </div>
  );
}

function StatsView() {
  const { columnStats, sampleRows } = useLoomStore();
  const stats = columnStats ?? [];
  const dq = useMemo(() => computeDataQualityHints(stats, sampleRows), [stats, sampleRows]);

  if (stats.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-loom-muted">
        No column stats. Select a file or run a query to see stats.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
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

// --- Export tab: Chart (PNG/SVG) + Data (CSV) ---

function ExportView() {
  const {
    activeChart,
    pngExportHandler,
    svgExportHandler,
    selectedFile,
    sampleRows,
    queryResult,
    chartVisualOverrides,
  } = useLoomStore();
  const [pngFeedback, setPngFeedback] = useState(false);
  const [svgFeedback, setSvgFeedback] = useState(false);
  const [configFeedback, setConfigFeedback] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setCopyError(null);
  }, []);

  const handleCopyPng = useCallback(async () => {
    if (!pngExportHandler) return;
    setCopyError(null);
    try {
      const blob = await pngExportHandler();
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setPngFeedback(true);
        setTimeout(() => setPngFeedback(false), 2000);
      }
    } catch (e) {
      console.warn("Copy PNG failed:", e);
      setCopyError("Clipboard access denied. Use a secure context (HTTPS or localhost) and allow clipboard permission.");
    }
  }, [pngExportHandler]);

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
    if (!pngExportHandler) return;
    setCopyError(null);
    try {
      const blob = await pngExportHandler();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `chart-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.warn("Download PNG failed:", e);
      setCopyError("Export failed.");
    }
  }, [pngExportHandler]);

  const handleDownloadSvg = useCallback(async () => {
    if (!svgExportHandler) return;
    setCopyError(null);
    try {
      const svg = await svgExportHandler();
      if (svg) {
        const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `chart-${Date.now()}.svg`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.warn("Download SVG failed:", e);
      setCopyError("Export failed.");
    }
  }, [svgExportHandler]);

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

  const hasChartExport = activeChart && (pngExportHandler || svgExportHandler);
  const hasTableData = sampleRows && sampleRows.rows.length > 0 && selectedFile;
  const hasQueryData = queryResult && queryResult.rows.length > 0;

  return (
    <div className="p-3 space-y-4">
      <p className="text-2xs text-loom-muted">
        Export the current chart (PNG/SVG) or data (CSV) from here.
      </p>
      {copyError && (
        <p className="text-2xs text-amber-500/90 bg-amber-500/10 rounded px-2 py-1.5 flex items-center justify-between gap-2">
          <span>{copyError}</span>
          <button type="button" onClick={clearError} className="shrink-0 text-loom-muted hover:text-loom-text" aria-label="Dismiss">×</button>
        </p>
      )}

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
                disabled={!pngExportHandler}
                aria-label="Copy chart as PNG to clipboard"
                className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent hover:bg-loom-elevated/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pngFeedback ? "Copied!" : "Copy as PNG"}
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
                  onClick={handleDownloadPng}
                  disabled={!pngExportHandler}
                  aria-label="Download chart as PNG file"
                  className="w-full px-3 py-2 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded hover:border-loom-accent transition-colors disabled:opacity-50"
                >
                  Download PNG
                </button>
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
  } = useLoomStore();
  const [specExpanded, setSpecExpanded] = useState(true);
  const [specCopyOk, setSpecCopyOk] = useState(false);
  const [dragOverSlot, setDragOverSlot] = useState<"x" | "y" | "color" | null>(null);
  const [encodingOpen, setEncodingOpen] = useState(true);
  const [activeChartOpen, setActiveChartOpen] = useState(true);
  const [visualOpen, setVisualOpen] = useState(true);
  const [vegaOpen, setVegaOpen] = useState(false);

  const tableName = selectedFile?.name?.replace(/\.\w+$/, "") ?? "";

  const extraFromChart = useCallback(
    () => ({
      sizeField: activeChart?.sizeField ?? null,
      rowField: activeChart?.rowField ?? null,
      glowField: activeChart?.glowField ?? null,
      outlineField: activeChart?.outlineField ?? null,
      opacityField: activeChart?.opacityField ?? null,
      yAggregate: activeChart?.yAggregate ?? null,
      tooltipFields: activeChart?.tooltipFields,
      tooltipKeyField: activeChart?.tooltipKeyField ?? null,
      barStackMode,
    }),
    [
      activeChart?.sizeField,
      activeChart?.rowField,
      activeChart?.glowField,
      activeChart?.outlineField,
      activeChart?.opacityField,
      activeChart?.yAggregate,
      activeChart?.tooltipFields,
      activeChart?.tooltipKeyField,
      barStackMode,
    ],
  );

  const handleDrop = useCallback(
    (slot: "x" | "y" | "color") => (e: React.DragEvent) => {
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
  const handleDragOver = useCallback((slot: "x" | "y" | "color") => (e: React.DragEvent) => {
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
    (slot: "size" | "row" | "glow" | "outline" | "opacity", colName: string) => {
      if (!activeChart || columnStats.length === 0) return;
      const sizeField = slot === "size" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.sizeField ?? null);
      const rowField = slot === "row" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.rowField ?? null);
      const glowField = slot === "glow" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.glowField ?? null);
      const outlineField = slot === "outline" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.outlineField ?? null);
      const opacityField = slot === "opacity" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.opacityField ?? null);
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        {
          sizeField,
          rowField,
          glowField,
          outlineField,
          opacityField,
          yAggregate: activeChart.yAggregate ?? null,
          tooltipFields: activeChart.tooltipFields,
          tooltipKeyField: activeChart.tooltipKeyField ?? null,
        },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart],
  );

  const applyChartType = useCallback(
    (kind: ChartKind) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        extraFromChart(),
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

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
    const rec = tryBuildRandomChartRec(columnStats, tableName);
    if (rec) setActiveChart(rec);
  }, [columnStats, tableName, setActiveChart]);

  const handleRandomizeEncoding = useCallback(() => {
    if (columnStats.length === 0 || !activeChart) return;
    for (let i = 0; i < 48; i++) {
      const enc = getRandomEncoding(columnStats, activeChart.kind);
      if (!enc) continue;
      const extra: Parameters<typeof createChartRec>[6] = {};
      if (enc.sizeField) extra.sizeField = enc.sizeField;
      if (activeChart.tooltipFields?.length) extra.tooltipFields = activeChart.tooltipFields;
      if (activeChart.tooltipKeyField) extra.tooltipKeyField = activeChart.tooltipKeyField;
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
        return;
      }
    }
  }, [columnStats, tableName, setActiveChart, activeChart]);

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
  const showY = activeChart.kind !== "histogram";
  const showColor = !["histogram", "pie"].includes(activeChart.kind);
  const showSize = activeChart.kind === "scatter" || activeChart.kind === "strip" || activeChart.kind === "bubble";
  const showAggregate = ["bar", "line", "area", "pie"].includes(activeChart.kind);
  const effectiveAggregate: YAggregateOption = !activeChart.yField
    ? "count"
    : (activeChart.yAggregate ?? (activeChart.kind === "line" ? "mean" : "sum"));
  const showRow = ["bar", "line", "area"].includes(activeChart.kind);
  const showVisualEncoding = activeChart.kind === "scatter" || activeChart.kind === "strip";
  const numericCols = columnStats.filter(
    (c) => ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL"].some((t) => (c.data_type ?? "").toUpperCase().includes(t)),
  );
  const nominalForRow = columnStats.filter(
    (c) => !numericCols.some((n) => n.name === c.name) && (c.distinct_count ?? 0) >= 2 && (c.distinct_count ?? 0) <= 30,
  );

  const colType = (name: string) => columnStats.find((c) => c.name === name)?.data_type ?? "";

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Save chart view — always visible at top */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-loom-muted">Save this chart for dashboards</span>
        <SaveChartViewButton />
      </div>
      {/* Encoding — collapsible */}
      <div className="loom-card overflow-hidden">
        <button
          type="button"
          onClick={() => setEncodingOpen((o) => !o)}
          className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-loom-elevated/50 rounded transition-colors"
        >
          <span className="text-xs font-semibold text-loom-text">Encoding</span>
          <span className="text-loom-muted text-xs">{encodingOpen ? "▼" : "▶"}</span>
        </button>
        {encodingOpen && (
          <div className="space-y-2 px-2 pb-2">
            {(() => {
              const curSupport = chartKindDataSupport(columnStats, activeChart.kind);
              if (!curSupport.ok) {
                return (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-2xs text-amber-200/90">
                    <span className="font-medium">Current chart doesn’t fit this table:</span> {curSupport.reason}
                  </div>
                );
              }
              return null;
            })()}
            <div>
              <label className="block text-2xs text-loom-muted mb-1">Chart type</label>
              <select
                value={activeChart.kind}
                onChange={(e) => {
                  const v = e.target.value as ChartKind;
                  if (!chartKindDataSupport(columnStats, v).ok) return;
                  applyChartType(v);
                }}
                className="loom-input w-full text-xs py-1.5 font-mono"
                title="Types that don’t match your columns are disabled"
              >
                {CHART_KIND_OPTIONS.map((opt) => {
                  const { ok, reason } = chartKindDataSupport(columnStats, opt.value);
                  return (
                    <option key={opt.value} value={opt.value} disabled={!ok} title={!ok ? reason : undefined}>
                      {!ok ? `${opt.label} — ${reason}` : opt.label}
                    </option>
                  );
                })}
              </select>
              <p className="text-2xs text-loom-muted mt-0.5">Grayed options need different column types or cardinality.</p>
            </div>
            <div className="flex rounded border border-loom-border overflow-hidden">
              <button
                type="button"
                onClick={handleRandomizeEncoding}
                className="flex-1 text-2xs py-1.5 px-2 text-loom-muted hover:bg-loom-elevated hover:text-loom-text transition-colors text-left"
                title="Keep chart type, shuffle columns"
              >
                ⟳ Shuffle fields
              </button>
              <span className="w-px bg-loom-border" />
              <button
                type="button"
                onClick={handleRandomize}
                className="text-2xs py-1.5 px-2.5 text-loom-muted hover:bg-loom-elevated hover:text-loom-accent transition-colors"
                title="Randomize chart type and columns"
              >
                🎲
              </button>
            </div>
            <p className="text-2xs text-loom-muted">Drag columns from footer Schema tab, or choose below.</p>
            <div className="space-y-2">
              <div className="flex flex-col gap-1">
                <DropZone
                  label="X"
                  value={activeChart.xField}
                  isActive={dragOverSlot === "x"}
                  onDragEnter={handleDragEnter("x")}
                  onDragOver={handleDragOver("x")}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop("x")}
                />
                <select
                  value={activeChart.xField}
                  onChange={(e) => applyEncoding("x", e.target.value)}
                  className="loom-input w-full text-xs py-1.5 font-mono"
                >
                  {columnStats.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
                {colType(activeChart.xField) && (
                  <p className="text-2xs text-loom-muted mt-0.5 font-mono">{colType(activeChart.xField)}</p>
                )}
              </div>
              {showY && (
                <div className="flex flex-col gap-1">
                  <DropZone
                    label="Y"
                    value={activeChart.yField ?? "—"}
                    isActive={dragOverSlot === "y"}
                    onDragEnter={handleDragEnter("y")}
                    onDragOver={handleDragOver("y")}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop("y")}
                  />
                  <select
                    value={activeChart.yField ?? ""}
                    onChange={(e) => applyEncoding("y", e.target.value)}
                    className="loom-input w-full text-xs py-1.5 font-mono"
                  >
                    <option value="">—</option>
                    {columnStats.map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  {activeChart.yField && colType(activeChart.yField) && (
                    <p className="text-2xs text-loom-muted mt-0.5 font-mono">{colType(activeChart.yField)}</p>
                  )}
                  {showAggregate && (
                    <>
                      <label className="text-2xs text-loom-muted mt-1">Aggregate (Y)</label>
                      <select
                        value={effectiveAggregate}
                        onChange={(e) => applyYAggregate(e.target.value as YAggregateOption)}
                        className="loom-input w-full text-xs py-1.5 font-mono"
                        title="Sum, average, count, min, or max for the Y column"
                      >
                        {Y_AGGREGATE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value} disabled={!activeChart.yField && opt.value !== "count"}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              )}
              {showColor && (
                <div className="flex flex-col gap-1">
                  <DropZone
                    label="Color"
                    value={activeChart.colorField ?? "None"}
                    isActive={dragOverSlot === "color"}
                    onDragEnter={handleDragEnter("color")}
                    onDragOver={handleDragOver("color")}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop("color")}
                  />
                  <select
                    value={activeChart.colorField ?? "__none__"}
                    onChange={(e) => applyEncoding("color", e.target.value)}
                    className="loom-input w-full text-xs py-1.5 font-mono"
                  >
                    <option value="__none__">None</option>
                    {columnStats.map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  {activeChart.colorField && colType(activeChart.colorField) && (
                    <p className="text-2xs text-loom-muted mt-0.5 font-mono">{colType(activeChart.colorField)}</p>
                  )}
                  {activeChart.kind === "bar" && activeChart.colorField && (
                    <p className="text-2xs text-loom-muted mt-0.5">
                      Use as subcategory: dodged / stacked / percent bars (see Active chart).
                    </p>
                  )}
                </div>
              )}
              {showSize && (
                <div className="flex flex-col gap-1">
                  <label className="text-2xs text-loom-muted">Size</label>
                  <select
                    value={activeChart.sizeField ?? "__none__"}
                    onChange={(e) => applyEncodingExtra("size", e.target.value)}
                    className="loom-input w-full text-xs py-1.5 font-mono"
                  >
                    <option value="__none__">None</option>
                    {numericCols.map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {showRow && (
                <div className="flex flex-col gap-1">
                  <label className="text-2xs text-loom-muted">Row (facet)</label>
                  <select
                    value={activeChart.rowField ?? "__none__"}
                    onChange={(e) => applyEncodingExtra("row", e.target.value)}
                    className="loom-input w-full text-xs py-1.5 font-mono"
                  >
                    <option value="__none__">None</option>
                    {nominalForRow.map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {showVisualEncoding && (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="text-2xs text-loom-muted">Glow by</label>
                    <select
                      value={activeChart.glowField ?? "__none__"}
                      onChange={(e) => applyEncodingExtra("glow", e.target.value)}
                      className="loom-input w-full text-xs py-1.5 font-mono"
                    >
                      <option value="__none__">None</option>
                      {columnStats.map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-2xs text-loom-muted">Outline by</label>
                    <select
                      value={activeChart.outlineField ?? "__none__"}
                      onChange={(e) => applyEncodingExtra("outline", e.target.value)}
                      className="loom-input w-full text-xs py-1.5 font-mono"
                    >
                      <option value="__none__">None</option>
                      {columnStats.map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-2xs text-loom-muted">Opacity by</label>
                    <select
                      value={activeChart.opacityField ?? "__none__"}
                      onChange={(e) => applyEncodingExtra("opacity", e.target.value)}
                      className="loom-input w-full text-xs py-1.5 font-mono"
                    >
                      <option value="__none__">None</option>
                      {columnStats.map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div className="pt-2 mt-2 border-t border-loom-border space-y-2">
                <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Tooltip</p>
                <p className="text-2xs text-loom-muted">
                  Hover shows values. Leave all unchecked to mirror encoding fields. Press L on the chart to lock or clear a row filter by link key.
                </p>
                <div className="max-h-32 overflow-y-auto space-y-1 border border-loom-border rounded p-1.5">
                  {columnStats.map((c) => (
                    <label key={c.name} className="flex items-center gap-2 text-2xs text-loom-text cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeChart.tooltipFields?.includes(c.name) ?? false}
                        onChange={(e) => {
                          const cur = new Set(activeChart.tooltipFields ?? []);
                          if (e.target.checked) cur.add(c.name);
                          else cur.delete(c.name);
                          applyTooltipFields([...cur]);
                        }}
                        className="rounded border-loom-border accent-loom-accent"
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => applyTooltipFields([])}
                  className="text-2xs text-loom-muted hover:text-loom-text"
                >
                  Reset tooltip columns (encoding default)
                </button>
                <div>
                  <label className="block text-2xs text-loom-muted mb-1">Link key for L</label>
                  <select
                    value={activeChart.tooltipKeyField ?? "__default__"}
                    onChange={(e) =>
                      applyTooltipKeyField(e.target.value === "__default__" ? null : e.target.value)
                    }
                    className="loom-input w-full text-xs py-1.5 font-mono"
                  >
                    <option value="__default__">Same as X field</option>
                    {columnStats.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Active chart — collapsible */}
      <div className="loom-card overflow-hidden">
        <button
          type="button"
          onClick={() => setActiveChartOpen((o) => !o)}
          className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-loom-elevated/50 rounded transition-colors"
        >
          <span className="text-xs font-semibold text-loom-text">Active chart</span>
          <span className="text-loom-muted text-xs">{activeChartOpen ? "▼" : "▶"}</span>
        </button>
        {activeChartOpen && (
          <div className="space-y-1.5 px-2 pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="loom-badge">{activeChart.kind}</span>
              <SaveChartViewButton />
            </div>
            <p className="text-2xs text-loom-muted">
              <span className="cursor-help border-b border-dotted border-loom-muted/50" title={aiSuggestionReason ?? getRecommendationReason(activeChart)}>
                Why?
              </span>
            </p>
            <div className="text-2xs font-mono text-loom-muted space-y-0.5">
              <p>X: {activeChart.xField}</p>
              {activeChart.yField && <p>Y: {activeChart.yField}</p>}
              {activeChart.colorField && <p>Color: {activeChart.colorField}</p>}
              {activeChart.sizeField && <p>Size: {activeChart.sizeField}</p>}
              {activeChart.rowField && <p>Row: {activeChart.rowField}</p>}
              {activeChart.glowField && <p>Glow: {activeChart.glowField}</p>}
              {activeChart.outlineField && <p>Outline: {activeChart.outlineField}</p>}
              {activeChart.opacityField && <p>Opacity: {activeChart.opacityField}</p>}
              <p className="text-loom-text">
                Showing {rowCount.toLocaleString()}
                {totalRows > rowCount ? ` of ${totalRows.toLocaleString()}` : ""} rows in chart
              </p>
              <p className="text-loom-muted">{aggSummary}</p>
            </div>
            {/* Chart-specific toggles */}
            {activeChart.kind === "bar" && activeChart.colorField && (
              <div className="mt-2">
                <label className="block text-2xs text-loom-muted mb-1">Bar layout (Color = subcategory)</label>
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
                          {
                            sizeField: activeChart.sizeField ?? null,
                            rowField: activeChart.rowField ?? null,
                            glowField: activeChart.glowField ?? null,
                            outlineField: activeChart.outlineField ?? null,
                            opacityField: activeChart.opacityField ?? null,
                            yAggregate: activeChart.yAggregate ?? null,
                            tooltipFields: activeChart.tooltipFields,
                            tooltipKeyField: activeChart.tooltipKeyField ?? null,
                            barStackMode: m,
                          },
                        );
                        if (rec) setActiveChart(rec);
                      }}
                      className={`px-1.5 py-0.5 text-2xs rounded ${barStackMode === m ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50" : "text-loom-muted border border-transparent hover:border-loom-border"}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {activeChart.kind === "scatter" && (
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
          </div>
        )}
      </div>

      {/* Visual — collapsible */}
      <div className="loom-card overflow-hidden">
        <button
          type="button"
          onClick={() => setVisualOpen((o) => !o)}
          className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-loom-elevated/50 rounded transition-colors"
        >
          <span className="text-xs font-semibold text-loom-text">Visual</span>
          <span className="text-loom-muted text-xs">{visualOpen ? "▼" : "▶"}</span>
        </button>
        {visualOpen && (
          <div className="space-y-4 px-2 pb-2">
            {/* Presets */}
            <div className="space-y-1.5">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Preset</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { name: "Minimal", overrides: { chartPadding: 30, showGrid: false, titleFontWeight: 400, axisFontSize: 9, legendPosition: "none" as const } },
                  { name: "Editorial", overrides: { fontFamily: "Instrument Serif", chartPadding: 60, titleFontWeight: 700, showGrid: true, gridStyle: "dashed" as const, barCornerRadius: 0 } },
                  { name: "High contrast", overrides: { axisLineWidth: 2, gridOpacity: 0.8, titleFontWeight: 700, axisFontSize: 11, showDataLabels: true } },
                ].map(({ name, overrides }) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setChartVisualOverrides((prev) => ({ ...prev, ...overrides }))}
                    className="px-2 py-1 text-2xs rounded border border-loom-border text-loom-text hover:border-loom-accent hover:bg-loom-accent/10"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            {/* Typography */}
            <div className="space-y-2">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Typography</p>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Font family</label>
                <select
                  value={chartVisualOverrides.fontFamily ?? "Inter"}
                  onChange={(e) => updateOverride("fontFamily", e.target.value)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {["Inter", "JetBrains Mono", "Space Grotesk", "DM Sans", "Instrument Serif"].map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Title weight</label>
                <select
                  value={chartVisualOverrides.titleFontWeight ?? 600}
                  onChange={(e) => updateOverride("titleFontWeight", Number(e.target.value))}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {[300, 400, 600, 700].map((w) => (
                    <option key={w} value={w}>{w === 300 ? "Light" : w === 400 ? "Regular" : w === 600 ? "Semibold" : "Bold"}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={chartVisualOverrides.titleItalic ?? false}
                  onChange={(e) => updateOverride("titleItalic", e.target.checked)}
                  className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                />
                Title italic
              </label>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Tick label rotation</label>
                <select
                  value={chartVisualOverrides.tickRotation ?? 0}
                  onChange={(e) => updateOverride("tickRotation", Number(e.target.value))}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {[0, 30, 45, 60, 90].map((deg) => (
                    <option key={deg} value={deg}>{deg}°</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Marks */}
            <div className="space-y-2">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Marks</p>
              {(activeChart.kind === "scatter" || activeChart.kind === "strip") && (
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
              {activeChart.kind === "bar" && (
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
              {["line", "area"].includes(activeChart.kind) && (
                <>
                  <div>
                    <label className="block text-2xs text-loom-muted mb-1">Line style</label>
                    <select
                      value={chartVisualOverrides.lineStrokeStyle ?? "solid"}
                      onChange={(e) => updateOverride("lineStrokeStyle", e.target.value)}
                      className="loom-input w-full text-xs py-1.5"
                    >
                      {["solid", "dashed", "dotted"].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
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

            {/* Axes & Grid */}
            <div className="space-y-2">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Axes & Grid</p>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Axis line color</label>
                <select
                  value={chartVisualOverrides.axisLineColor ?? "#2a2a30"}
                  onChange={(e) => updateOverride("axisLineColor", e.target.value)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {["#2a2a30", "#3a3a42", "#1a1a1f", "#4a4a52", "#e8e8ec"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
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
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Grid style</label>
                <select
                  value={chartVisualOverrides.gridStyle ?? "solid"}
                  onChange={(e) => updateOverride("gridStyle", e.target.value)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {["solid", "dashed", "dotted", "none"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
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
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Axis label color</label>
                <select
                  value={chartVisualOverrides.axisLabelColor ?? "#6b6b78"}
                  onChange={(e) => updateOverride("axisLabelColor", e.target.value)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {["#6b6b78", "#8a8a94", "#4a4a52", "#5b7c99", "#b8860b"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
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

            {/* Layout */}
            <div className="space-y-2">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Layout</p>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Chart padding (px)</label>
                <input
                  type="range"
                  min={20}
                  max={80}
                  value={chartVisualOverrides.chartPadding ?? 50}
                  onChange={(e) => updateOverride("chartPadding", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                />
                <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.chartPadding ?? 50}</span>
              </div>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Legend position</label>
                <select
                  value={chartVisualOverrides.legendPosition ?? "none"}
                  onChange={(e) => updateOverride("legendPosition", e.target.value)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {["none", "top-right", "bottom", "right"].map((p) => (
                    <option key={p} value={p}>{p === "none" ? "None" : p === "top-right" ? "Top right" : p}</option>
                  ))}
                </select>
              </div>
              {["bar", "pie"].includes(activeChart.kind) && (
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
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Facet by (small multiples)</label>
                <select
                  value={chartVisualOverrides.facetField ?? ""}
                  onChange={(e) => updateOverride("facetField", e.target.value || undefined)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  <option value="">None</option>
                  {(columnStats ?? []).map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
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
                  {["default", "gradient", "paper", "transparent"].map((b) => (
                    <option key={b} value={b}>{b === "default" ? "Default" : b === "gradient" ? "Gradient vignette" : b === "paper" ? "Paper" : "Transparent"}</option>
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
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Color palette</label>
                <select
                  value={chartVisualOverrides.colorPalette ?? "theme"}
                  onChange={(e) => updateOverride("colorPalette", e.target.value)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {COLOR_PALETTES.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Vega-Lite spec — collapsible */}
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
  );
}
