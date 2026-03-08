// =================================================================
// Loom — Main Page
// =================================================================
// Composes the three-panel layout:
//   [Sidebar] [MainCanvas] [DetailPanel]
// The main canvas switches between Explorer, Chart, and Query views
// based on the current viewMode in the Zustand store.
// =================================================================

"use client";

import { useState, useRef } from "react";
import { useLoomStore } from "@/lib/store";
import type { DashboardSlot } from "@/lib/store";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { DetailPanel } from "@/components/DetailPanel";
import { PreviewFooter } from "@/components/PreviewFooter";
import { ExplorerView } from "@/components/ExplorerView";
import { ChartView } from "@/components/ChartView";
import { QueryView } from "@/components/QueryView";
import { ThemeApplicator } from "@/components/ThemeApplicator";
import { HydrateStore } from "@/components/HydrateStore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toast } from "@/components/Toast";
import { PromptDialog } from "@/components/PromptDialog";
import { Onboarding } from "@/components/Onboarding";
import { useEffect, useCallback } from "react";
import { createGitHubIssue, getGitHubNewIssueUrl, isTauri, openExternalUrl } from "@/lib/tauri";

/** Open a URL: in Tauri use backend (default browser), in web use new tab. */
async function openUrl(url: string): Promise<void> {
  if (isTauri()) {
    await openExternalUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** Dashboard canvas: full-width grid of view cards when dashboard is expanded. */
function DashboardCanvas({ onCollapse }: { onCollapse: () => void }) {
  const {
    dashboards,
    activeDashboardId,
    tableViews,
    chartViews,
    queryViews,
    querySnapshots,
    applyTableView,
    applyChartView,
    applyQueryView,
    applyQuerySnapshot,
    setViewMode,
    setPanelTab,
    setDashboardRefresh,
  } = useLoomStore();
  const active = dashboards.find((d) => d.id === activeDashboardId);
  const [focusedSlot, setFocusedSlot] = useState<DashboardSlot | null>(null);

  const getSlotLabel = (viewType: "table" | "chart" | "query" | "snapshot", viewId: string) => {
    if (viewType === "table") return tableViews.find((x) => x.id === viewId)?.name ?? viewId;
    if (viewType === "chart") return chartViews.find((x) => x.id === viewId)?.name ?? viewId;
    if (viewType === "snapshot") return querySnapshots.find((x) => x.id === viewId)?.name ?? viewId;
    return queryViews.find((x) => x.id === viewId)?.name ?? viewId;
  };

  const handleApply = (viewType: "table" | "chart" | "query" | "snapshot", viewId: string) => {
    if (viewType === "table") applyTableView(viewId);
    else if (viewType === "chart") applyChartView(viewId);
    else if (viewType === "query") applyQueryView(viewId);
    else applyQuerySnapshot(viewId);
    setViewMode(viewType === "table" || viewType === "snapshot" ? "explorer" : viewType === "chart" ? "chart" : "query");
    setPanelTab(viewType === "table" || viewType === "snapshot" ? "stats" : viewType === "chart" ? "chart" : "stats");
  };

  const handleBackFromFocus = useCallback(() => setFocusedSlot(null), []);

  useEffect(() => {
    if (!focusedSlot) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleBackFromFocus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedSlot, handleBackFromFocus]);

  if (!active) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 p-8 text-center">
        <p className="text-sm text-loom-muted">No dashboard selected</p>
        <p className="text-2xs text-loom-muted mt-1">Open the Dashboards tab in the panel and select or create one.</p>
        <button type="button" onClick={onCollapse} className="mt-4 text-xs px-3 py-1.5 rounded border border-loom-border text-loom-muted hover:text-loom-text">
          Collapse
        </button>
      </div>
    );
  }

  const refreshIntervalOptions: { value: typeof active.refreshInterval; label: string }[] = [
    { value: "manual", label: "Manual" },
    { value: "1m", label: "1 min" },
    { value: "5m", label: "5 min" },
    { value: "15m", label: "15 min" },
    { value: "1h", label: "1 hour" },
    { value: "1d", label: "1 day" },
  ];
  const lastRefreshed = active.lastRefreshedAt ? new Date(active.lastRefreshedAt) : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-loom-border bg-loom-surface/50 flex-shrink-0 flex-wrap">
        <h2 className="text-sm font-semibold text-loom-text">{active.name}</h2>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-loom-muted">Refresh:</span>
          <select
            value={active.refreshInterval ?? "manual"}
            onChange={(e) => setDashboardRefresh(active.id, (e.target.value as typeof active.refreshInterval) || "manual")}
            className="text-2xs px-1.5 py-0.5 rounded border border-loom-border bg-loom-surface text-loom-text"
          >
            {refreshIntervalOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setDashboardRefresh(active.id, null, Date.now())}
            className="text-2xs px-2 py-0.5 rounded border border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated"
            title="Mark as refreshed now"
          >
            Refresh
          </button>
          {lastRefreshed && (
            <span className="text-2xs text-loom-muted" title={lastRefreshed.toLocaleString()}>
              Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="text-xs px-2 py-1 rounded border border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated"
          title="Collapse to panel"
        >
          Collapse
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {active.slots.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-sm text-loom-muted">No views in this dashboard</p>
            <p className="text-2xs text-loom-muted mt-1">Add table, chart, query, or snapshot views from the Dashboards tab.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {active.slots.map((slot) => {
              const label = getSlotLabel(slot.viewType, slot.viewId);
              const chartView = slot.viewType === "chart" ? chartViews.find((x) => x.id === slot.viewId) : null;
              const snapshotUrl = chartView?.snapshotImageDataUrl ?? null;
              return (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => setFocusedSlot(slot)}
                  className="loom-card p-3 text-left hover:border-loom-accent hover:bg-loom-elevated/50 transition-colors border border-loom-border rounded-lg flex flex-col min-h-[140px] aspect-[4/3]"
                >
                  <span className="text-2xs font-medium text-loom-muted uppercase tracking-wider shrink-0">{slot.viewType}</span>
                  {snapshotUrl ? (
                    <div className="mt-1 flex-1 min-h-0 w-full rounded overflow-hidden bg-loom-bg/50 flex items-center justify-center">
                      <img src={snapshotUrl} alt="" className="w-full h-full object-contain" />
                    </div>
                  ) : (
                    <div className="mt-1 flex-1 min-h-0 rounded bg-loom-bg/30 flex items-center justify-center">
                      <span className="text-2xs text-loom-muted">{label}</span>
                    </div>
                  )}
                  <p className="text-xs font-medium text-loom-text truncate shrink-0 mt-1.5" title={label}>
                    {label}
                  </p>
                  <p className="text-2xs text-loom-muted shrink-0 mt-0.5">Click to focus</p>
                </button>
              );
            })}
          </div>
        )}

        {/* Focused slot modal: chart/content without editing UI, with Back to dashboard */}
        {focusedSlot && (
          <div
            className="fixed inset-0 z-50 flex flex-col bg-loom-bg"
            role="dialog"
            aria-modal="true"
            aria-label="Focused view"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-loom-border bg-loom-surface/80 shrink-0">
              <button
                type="button"
                onClick={handleBackFromFocus}
                className="text-xs px-3 py-1.5 rounded border border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated"
              >
                ← Back to dashboard
              </button>
              <p className="text-sm font-medium text-loom-text truncate flex-1 text-center">
                {getSlotLabel(focusedSlot.viewType, focusedSlot.viewId)}
              </p>
              <div className="w-32" />
            </div>
            <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4">
              {focusedSlot.viewType === "chart" && (() => {
                const cv = chartViews.find((x) => x.id === focusedSlot.viewId);
                const url = cv?.snapshotImageDataUrl ?? null;
                if (url) {
                  return <img src={url} alt="" className="max-w-full max-h-full object-contain shadow-lg rounded" />;
                }
                return (
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-sm text-loom-muted">No preview for this chart.</p>
                    <button
                      type="button"
                      onClick={() => { handleApply(focusedSlot.viewType, focusedSlot.viewId); handleBackFromFocus(); }}
                      className="text-xs px-3 py-1.5 rounded border border-loom-accent text-loom-accent hover:bg-loom-accent/10"
                    >
                      Open in editor
                    </button>
                  </div>
                );
              })()}
              {focusedSlot.viewType !== "chart" && (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-loom-muted">{getSlotLabel(focusedSlot.viewType, focusedSlot.viewId)}</p>
                  <button
                    type="button"
                    onClick={() => { handleApply(focusedSlot.viewType, focusedSlot.viewId); handleBackFromFocus(); }}
                    className="text-xs px-3 py-1.5 rounded border border-loom-accent text-loom-accent hover:bg-loom-accent/10"
                  >
                    Open in editor
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const { viewMode, setViewMode, dataSourcesExpanded, dashboardsExpanded } = useLoomStore();
  return (
    <>
      <ThemeApplicator />
      <HydrateStore />
      <Onboarding />
      <ErrorBoundary>
        <HomeContent viewMode={viewMode} setViewMode={setViewMode} dataSourcesExpanded={dataSourcesExpanded} dashboardsExpanded={dashboardsExpanded} />
      </ErrorBoundary>
      <PromptDialog />
      <Toast />
    </>
  );
}

const PANEL_TABS = ["stats", "chart", "export", "smart", "dashboards", "settings"] as const;

function HomeContent({
  viewMode,
  setViewMode,
  dataSourcesExpanded,
  dashboardsExpanded,
}: {
  viewMode: "explorer" | "chart" | "query";
  setViewMode: (m: "explorer" | "chart" | "query") => void;
  dataSourcesExpanded: boolean;
  dashboardsExpanded: boolean;
}) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [helpTab, setHelpTab] = useState<"shortcuts" | "feedback">("shortcuts");
  const [feedbackTitle, setFeedbackTitle] = useState("");
  const [feedbackBody, setFeedbackBody] = useState("");
  const [feedbackImage, setFeedbackImage] = useState<File | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const feedbackFileRef = useRef<HTMLInputElement>(null);
  const setPanelTab = useLoomStore((s) => s.setPanelTab);
  const setToast = useLoomStore((s) => s.setToast);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setShortcutsOpen((o) => !o);
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        setShortcutsOpen(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "5") {
        const i = parseInt(e.key, 10) - 1;
        if (i >= 0 && i < PANEL_TABS.length) {
          setPanelTab(PANEL_TABS[i]);
          e.preventDefault();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (document.activeElement?.tagName === "TEXTAREA") return;
      if (document.activeElement?.tagName === "INPUT") return;

      switch (e.key) {
        case "1":
          setViewMode("explorer");
          break;
        case "2":
          setViewMode("chart");
          break;
        case "3":
          setViewMode("query");
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setViewMode, setPanelTab]);

  const handleFeedbackSubmit = async () => {
    const title = feedbackTitle.trim() || "Loom feedback";
    const body = feedbackBody.trim() || "(no description)";
    if (!title && !body) return;
    setFeedbackSubmitting(true);
    try {
      let imageBase64: string | null = null;
      if (feedbackImage) {
        imageBase64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(feedbackImage);
        });
      }
      if (isTauri()) {
        try {
          const url = await createGitHubIssue(title, body, imageBase64);
          setToast("Issue created!");
          await openUrl(url);
          setFeedbackTitle("");
          setFeedbackBody("");
          setFeedbackImage(null);
          if (feedbackFileRef.current) feedbackFileRef.current.value = "";
          setShortcutsOpen(false);
        } catch {
          const url = getGitHubNewIssueUrl(title, body);
          await openUrl(url);
          setToast(feedbackImage ? "Open the issue and paste your screenshot (Ctrl+V)" : "Opening GitHub to submit feedback");
        }
      } else {
        const url = getGitHubNewIssueUrl(title, body);
        await openUrl(url);
        setToast(feedbackImage ? "Open the issue and paste your screenshot (Ctrl+V)" : "Opening GitHub to submit feedback");
      }
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-loom-bg transition-theme">
      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setShortcutsOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Help: shortcuts and feedback"
        >
          <div
            className="loom-card max-w-md w-full p-4 space-y-3 bg-loom-surface border border-loom-border shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex gap-1 rounded bg-loom-elevated/50 p-0.5">
                <button
                  type="button"
                  onClick={() => setHelpTab("shortcuts")}
                  className={`px-2.5 py-1 text-xs font-medium rounded ${helpTab === "shortcuts" ? "bg-loom-accent text-white" : "text-loom-muted hover:text-loom-text"}`}
                >
                  Shortcuts
                </button>
                <button
                  type="button"
                  onClick={() => setHelpTab("feedback")}
                  className={`px-2.5 py-1 text-xs font-medium rounded ${helpTab === "feedback" ? "bg-loom-accent text-white" : "text-loom-muted hover:text-loom-text"}`}
                >
                  Feedback
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                className="loom-btn-ghost p-1 rounded"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {helpTab === "shortcuts" && (
              <ul className="text-xs text-loom-text space-y-2">
                <li><kbd className="px-1.5 py-0.5 rounded bg-loom-elevated font-mono">1</kbd> Explorer</li>
                <li><kbd className="px-1.5 py-0.5 rounded bg-loom-elevated font-mono">2</kbd> Chart</li>
                <li><kbd className="px-1.5 py-0.5 rounded bg-loom-elevated font-mono">3</kbd> Query</li>
                <li><kbd className="px-1.5 py-0.5 rounded bg-loom-elevated font-mono">⌘1</kbd>–<kbd className="px-1.5 py-0.5 rounded bg-loom-elevated font-mono">⌘5</kbd> Panel: Stats, Chart, Export, Smart, Settings</li>
                <li><kbd className="px-1.5 py-0.5 rounded bg-loom-elevated font-mono">⌘</kbd><kbd className="px-1.5 py-0.5 rounded bg-loom-elevated font-mono ml-1">Enter</kbd> Run query (in Query view)</li>
                <li><kbd className="px-1.5 py-0.5 rounded bg-loom-elevated font-mono">?</kbd> This help</li>
              </ul>
            )}

            {helpTab === "feedback" && (
              <div className="space-y-3">
                <p className="text-xs text-loom-muted">Submit feedback or a bug report as a GitHub issue for this repo.</p>
                <input
                  type="text"
                  placeholder="Title (optional)"
                  value={feedbackTitle}
                  onChange={(e) => setFeedbackTitle(e.target.value)}
                  className="loom-input w-full text-xs px-2 py-1.5"
                />
                <textarea
                  placeholder="Describe your feedback or paste a screenshot after opening the issue…"
                  value={feedbackBody}
                  onChange={(e) => setFeedbackBody(e.target.value)}
                  rows={3}
                  className="loom-input w-full text-xs px-2 py-1.5 resize-y min-h-[72px]"
                />
                <div className="flex items-center gap-2">
                  <input
                    ref={feedbackFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setFeedbackImage(e.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    onClick={() => feedbackFileRef.current?.click()}
                    className="loom-btn-ghost text-xs px-2 py-1"
                  >
                    {feedbackImage ? `📎 ${feedbackImage.name}` : "Attach screenshot"}
                  </button>
                  {feedbackImage && (
                    <button
                      type="button"
                      onClick={() => { setFeedbackImage(null); feedbackFileRef.current && (feedbackFileRef.current.value = ""); }}
                      className="text-loom-muted hover:text-loom-text text-xs"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleFeedbackSubmit}
                  disabled={feedbackSubmitting}
                  className="loom-btn-primary w-full text-xs py-1.5"
                >
                  {feedbackSubmitting ? "Submitting…" : "Open GitHub issue"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Top Bar spans full width */}
      <TopBar onOpenShortcuts={() => setShortcutsOpen(true)} />

      {/* Main Body: Sidebar + Canvas + Panel. When dataSourcesExpanded, sidebar takes over. */}
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <Sidebar />

          {/* Canvas Area — hidden when Data & sources is expanded; shows dashboard when dashboards expanded */}
          <main className={`bg-loom-bg overflow-hidden transition-[flex] duration-200 flex flex-col ${dataSourcesExpanded ? "w-0 min-w-0 flex-shrink-0" : "flex-1 min-w-0"}`}>
            {dashboardsExpanded ? (
              <DashboardCanvas onCollapse={() => useLoomStore.getState().setDashboardsExpanded(false)} />
            ) : (
              <>
                {!dataSourcesExpanded && viewMode === "explorer" && <ExplorerView />}
                {!dataSourcesExpanded && viewMode === "chart" && <ChartView />}
                {!dataSourcesExpanded && viewMode === "query" && <QueryView />}
              </>
            )}
          </main>

          <DetailPanel />
        </div>

        {/* Preview as footer */}
        <PreviewFooter />
      </div>
    </div>
  );
}
