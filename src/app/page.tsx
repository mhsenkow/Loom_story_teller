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
import type { DashboardSlot, DashboardLayoutTemplate, ViewMode } from "@/lib/store";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { DetailPanel } from "@/components/DetailPanel";
import { PreviewFooter } from "@/components/PreviewFooter";
import { ExplorerView } from "@/components/ExplorerView";
import { ChartView } from "@/components/ChartView";
import { QueryView } from "@/components/QueryView";
import { DiveView } from "@/components/DiveView";
import { ThemeApplicator } from "@/components/ThemeApplicator";
import { HydrateStore } from "@/components/HydrateStore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toast } from "@/components/Toast";
import { PromptDialog } from "@/components/PromptDialog";
import { Onboarding } from "@/components/Onboarding";
import { WhatsNew } from "@/components/WhatsNew";
import { requestWhatsNew } from "@/lib/changelog";
import { FeedbackNotes } from "@/components/FeedbackNotes";
import { SuiteMenu } from "@/components/SuiteMenu";
import { VizSwipeDeck } from "@/components/VizSwipeDeck";
import { ShareSheet } from "@/components/ShareSheet";
import { useMobileLiveEdit, MOBILE_LIVE_EDIT_SHEET } from "@/lib/useMediaQuery";
import { WebSessionResume } from "@/components/WebSessionResume";
import { useEffect, useCallback } from "react";
import { createGitHubIssue, getGitHubNewIssueUrl, isTauri, openExternalUrl } from "@/lib/tauri";
import {
  captureChartViewPreview,
  captureStoryDashboardPreviews,
} from "@/lib/captureStoryPreviews";

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
    previewCapture,
    setToast,
  } = useLoomStore();
  const active = dashboards.find((d) => d.id === activeDashboardId);
  const [focusedSlot, setFocusedSlot] = useState<DashboardSlot | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const capturingThis =
    !!previewCapture && !!active && previewCapture.dashboardId === active.id;

  const getSlotLabel = (viewType: "table" | "chart" | "query" | "snapshot", viewId: string) => {
    if (viewType === "table") return tableViews.find((x) => x.id === viewId)?.name ?? viewId;
    if (viewType === "chart") return chartViews.find((x) => x.id === viewId)?.name ?? viewId;
    if (viewType === "snapshot") return querySnapshots.find((x) => x.id === viewId)?.name ?? viewId;
    return queryViews.find((x) => x.id === viewId)?.name ?? viewId;
  };

  const getSlotSource = (viewType: "table" | "chart" | "query" | "snapshot", viewId: string): string | null => {
    if (viewType === "chart") return chartViews.find((x) => x.id === viewId)?.fileName ?? null;
    if (viewType === "table") return tableViews.find((x) => x.id === viewId)?.name ?? null;
    if (viewType === "query") return queryViews.find((x) => x.id === viewId)?.name ?? null;
    return querySnapshots.find((x) => x.id === viewId)?.name ?? null;
  };

  const handleApply = (viewType: "table" | "chart" | "query" | "snapshot", viewId: string) => {
    if (viewType === "table") applyTableView(viewId);
    else if (viewType === "chart") applyChartView(viewId);
    else if (viewType === "query") applyQueryView(viewId);
    else applyQuerySnapshot(viewId);
    // apply* already collapses the dashboard canvas; land in the live editor view
    setViewMode(viewType === "table" || viewType === "snapshot" ? "explorer" : viewType === "chart" ? "chart" : "query");
    setPanelTab(viewType === "table" || viewType === "snapshot" ? "stats" : viewType === "chart" ? "chart" : "stats");
    onCollapse();
  };

  const openLiveView = (slot: DashboardSlot) => {
    handleApply(slot.viewType, slot.viewId);
    setFocusedSlot(null);
    setToast(
      slot.viewType === "chart"
        ? "Opened live chart"
        : slot.viewType === "query"
          ? "Opened query"
          : "Opened in Explorer",
    );
  };

  const handleBackFromFocus = useCallback(() => setFocusedSlot(null), [setFocusedSlot]);

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

  const layout = (active.layoutTemplate ?? "auto") as DashboardLayoutTemplate;
  const gridClass =
    layout === "1x1"
      ? "grid-cols-1"
      : layout === "2x1"
        ? "grid-cols-2"
        : layout === "2x2"
          ? "grid-cols-2"
          : layout === "3x2"
            ? "grid-cols-3"
            : layout === "stream"
              ? "grid-cols-3"
              : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
  const gridStyle =
    layout === "1+2"
      ? { display: "grid", gridTemplateColumns: "1fr 1fr", gridAutoRows: "minmax(140px, 1fr)" } as React.CSSProperties
      : layout === "stream"
        ? { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridAutoRows: "minmax(160px, 1fr)" } as React.CSSProperties
        : undefined;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-loom-border bg-loom-surface/50 flex-shrink-0 flex-wrap">
        <h2 className="text-sm font-semibold text-loom-text">{active.name}</h2>
        <div className="flex items-center gap-2 flex-wrap">
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
          <button
            type="button"
            disabled={!!previewCapture}
            onClick={async () => {
              setToast("Recapturing all chart previews…");
              await captureStoryDashboardPreviews(active.id);
            }}
            className="text-2xs px-2 py-0.5 rounded border border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated disabled:opacity-50"
            title="Re-render PNG thumbnails for every chart in this story"
          >
            Recapture previews
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
          <div
            className={layout === "1+2" ? "grid gap-3" : `grid ${gridClass} gap-3`}
            style={gridStyle}
          >
            {active.slots.map((slot, idx) => {
              const label = getSlotLabel(slot.viewType, slot.viewId);
              const chartView = slot.viewType === "chart" ? chartViews.find((x) => x.id === slot.viewId) : null;
              const snapshotUrl = chartView?.snapshotImageDataUrl ?? null;
              const is1p2First = layout === "1+2" && idx === 0;
              const isStreamHero = layout === "stream" && idx === 0;
              const isChart = slot.viewType === "chart";
              const waitingPreview = isChart && !snapshotUrl;
              const busy = retryingId === slot.viewId || (capturingThis && waitingPreview);
              return (
                <div
                  key={slot.id}
                  className={`loom-card p-3 text-left border border-loom-border rounded-lg flex flex-col min-h-[140px] aspect-[4/3] hover:border-loom-accent/50 transition-colors`}
                  style={is1p2First ? { gridRow: "span 2" } : isStreamHero ? { gridColumn: "span 2", gridRow: "span 1" } : undefined}
                >
                  <span className="text-2xs font-medium text-loom-muted uppercase tracking-wider shrink-0">{slot.viewType}</span>
                  <button
                    type="button"
                    onClick={() => openLiveView(slot)}
                    title="Open live view"
                    className="mt-1 flex-1 min-h-0 w-full rounded overflow-hidden bg-loom-bg/50 flex items-center justify-center hover:ring-1 hover:ring-loom-accent/40 transition-shadow"
                  >
                    {snapshotUrl ? (
                      <img src={snapshotUrl} alt="" className="w-full h-full object-contain pointer-events-none" />
                    ) : busy ? (
                      <div className="flex flex-col items-center gap-2 px-3">
                        <span className="inline-block w-5 h-5 rounded-full border-2 border-loom-border border-t-loom-accent animate-spin" aria-hidden />
                        <span className="text-2xs text-loom-muted">Loading preview…</span>
                      </div>
                    ) : (
                      <span className="text-2xs text-loom-muted px-2 text-center">Open to view</span>
                    )}
                  </button>
                  <p className="text-xs font-medium text-loom-text truncate shrink-0 mt-1.5" title={label}>
                    {label}
                  </p>
                  <div className="flex items-center justify-between gap-1.5 mt-0.5 shrink-0 flex-wrap">
                    <button
                      type="button"
                      onClick={() => openLiveView(slot)}
                      className="text-2xs text-loom-accent hover:underline font-medium"
                    >
                      {isChart ? "Open chart" : slot.viewType === "query" ? "Open query" : "Open"}
                    </button>
                    <div className="flex items-center gap-2">
                      {snapshotUrl && (
                        <button
                          type="button"
                          className="text-2xs text-loom-muted hover:text-loom-text hover:underline"
                          onClick={() => setFocusedSlot(slot)}
                          title="Fullscreen snapshot preview"
                        >
                          Preview
                        </button>
                      )}
                      {isChart && !busy && (
                        <button
                          type="button"
                          className="text-2xs text-loom-muted hover:text-loom-accent hover:underline disabled:opacity-50"
                          disabled={!!previewCapture || retryingId !== null}
                          onClick={async () => {
                            setRetryingId(slot.viewId);
                            try {
                              const ok = await captureChartViewPreview(slot.viewId);
                              useLoomStore.getState().setDashboardsExpanded(true);
                              setToast(ok ? "Preview updated" : "Preview failed — open chart and try again");
                            } finally {
                              setRetryingId(null);
                            }
                          }}
                        >
                          {snapshotUrl ? "Recapture" : "Retry"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
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
              <button
                type="button"
                onClick={() => openLiveView(focusedSlot)}
                className="text-xs px-3 py-1.5 rounded border border-loom-accent bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 font-medium shrink-0"
              >
                Open live
              </button>
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
                      onClick={() => openLiveView(focusedSlot)}
                      className="text-xs px-3 py-1.5 rounded border border-loom-accent text-loom-accent hover:bg-loom-accent/10"
                    >
                      Open live chart
                    </button>
                  </div>
                );
              })()}
              {focusedSlot.viewType !== "chart" && (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-loom-muted">{getSlotLabel(focusedSlot.viewType, focusedSlot.viewId)}</p>
                  {getSlotSource(focusedSlot.viewType, focusedSlot.viewId) && (
                    <p className="text-2xs text-loom-muted">{getSlotSource(focusedSlot.viewType, focusedSlot.viewId)}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => openLiveView(focusedSlot)}
                    className="text-xs px-3 py-1.5 rounded border border-loom-accent text-loom-accent hover:bg-loom-accent/10"
                  >
                    Open live
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
  const { viewMode, setViewMode, dataSourcesExpanded: sourcesFlag, sidebarOpen, dashboardsExpanded, previewCapture, socialExportReady } = useLoomStore();
  // Sources only take over the canvas while the sidebar showing them is open.
  const dataSourcesExpanded = sourcesFlag && sidebarOpen;
  return (
    <>
      <ThemeApplicator />
      <HydrateStore />
      <WebSessionResume />
      <WhatsNew />
      <Onboarding />
      <ErrorBoundary>
        <HomeContent
          viewMode={viewMode}
          setViewMode={setViewMode}
          dataSourcesExpanded={dataSourcesExpanded}
          dashboardsExpanded={dashboardsExpanded}
          previewCapture={previewCapture}
          socialExportReady={socialExportReady}
        />
      </ErrorBoundary>
      <PromptDialog />
      <FeedbackNotes />
      <VizSwipeDeck />
      <ShareSheet />
      <Toast />
    </>
  );
}

const PANEL_TABS = ["stats", "chart", "export", "smart", "dashboards", "settings"] as const;

/** GitHub issue bodies must stay small; base64 images blow past limits quickly. */
const FEEDBACK_IMAGE_MAX_MARKDOWN_CHARS = 48_000;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

/** Resize / re-encode as JPEG so data URL fits in issue body (best-effort). */
async function shrinkImageDataUrlForGithub(dataUrl: string, maxLen: number): Promise<string | null> {
  if (typeof Image === "undefined" || typeof document === "undefined") {
    return dataUrl.length <= maxLen ? dataUrl : null;
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let maxSide = 1280;
      let quality = 0.82;
      const encode = (): string => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w <= 0 || h <= 0) return "";
        const scale = Math.min(1, maxSide / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        if (!ctx) return "";
        ctx.drawImage(img, 0, 0, cw, ch);
        return canvas.toDataURL("image/jpeg", quality);
      };
      let out = encode();
      while (out.length > maxLen && maxSide > 400) {
        maxSide = Math.round(maxSide * 0.72);
        quality = Math.max(0.35, quality - 0.12);
        out = encode();
      }
      resolve(out && out.length <= maxLen ? out : null);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function HomeContent({
  viewMode,
  setViewMode,
  dataSourcesExpanded,
  dashboardsExpanded,
  previewCapture,
  socialExportReady,
}: {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  dataSourcesExpanded: boolean;
  dashboardsExpanded: boolean;
  previewCapture: {
    dashboardId: string;
    current: number;
    total: number;
    label: string;
  } | null;
  socialExportReady: boolean;
}) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const liveEdit = useMobileLiveEdit();
  const [helpTab, setHelpTab] = useState<"shortcuts" | "feedback">("shortcuts");
  const [feedbackTitle, setFeedbackTitle] = useState("");
  const [feedbackBody, setFeedbackBody] = useState("");
  const [feedbackImage, setFeedbackImage] = useState<File | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const feedbackFileRef = useRef<HTMLInputElement>(null);
  const setPanelTab = useLoomStore((s) => s.setPanelTab);
  const setToast = useLoomStore((s) => s.setToast);

  // Mobile: start with drawers closed so the chart canvas owns the screen
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => {
      if (mq.matches) {
        useLoomStore.setState({ sidebarOpen: false, panelOpen: false });
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing =
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);

      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) {
        setShortcutsOpen((o) => !o);
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        setShortcutsOpen(false);
        if (useLoomStore.getState().socialExportReady) {
          useLoomStore.getState().setSocialExportReady(false);
          useLoomStore.getState().setSocialExportTarget(null);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "6") {
        const i = parseInt(e.key, 10) - 1;
        if (i >= 0 && i < PANEL_TABS.length) {
          setPanelTab(PANEL_TABS[i]);
          e.preventDefault();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (typing) return;

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
        case "4":
          setViewMode("dive");
          break;
        case "[":
          useLoomStore.getState().toggleSidebar();
          e.preventDefault();
          break;
        case "]":
          useLoomStore.getState().togglePanel();
          e.preventDefault();
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
        try {
          let dataUrl = await readFileAsDataUrl(feedbackImage);
          if (dataUrl.length > FEEDBACK_IMAGE_MAX_MARKDOWN_CHARS) {
            const smaller = await shrinkImageDataUrlForGithub(dataUrl, FEEDBACK_IMAGE_MAX_MARKDOWN_CHARS);
            if (smaller) {
              dataUrl = smaller;
              setToast("Screenshot was resized for GitHub.");
            } else {
              setToast("Screenshot too large for GitHub; opening issue without it — add the image on the issue page.");
              dataUrl = "";
            }
          }
          imageBase64 = dataUrl.length > 0 ? dataUrl : null;
        } catch (err) {
          console.error("Feedback image read failed:", err);
          setToast("Could not read that image. Try PNG or JPEG.");
        }
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
        } catch (e) {
          console.error("createGitHubIssue:", e);
          const url = getGitHubNewIssueUrl(title, body);
          await openUrl(url);
          setToast(
            feedbackImage && imageBase64
              ? "GitHub returned an error (often body too large). Browser opened — paste your screenshot there."
              : feedbackImage
                ? "Open the issue and paste your screenshot (Ctrl+V or drag the file)."
                : "Opening GitHub to submit feedback",
          );
        }
      } else {
        try {
          const url = await createGitHubIssue(title, body, imageBase64);
          setToast("Issue created!");
          await openUrl(url);
          setFeedbackTitle("");
          setFeedbackBody("");
          setFeedbackImage(null);
          if (feedbackFileRef.current) feedbackFileRef.current.value = "";
          setShortcutsOpen(false);
        } catch (e) {
          console.error("createGitHubIssue (web):", e);
          const url = getGitHubNewIssueUrl(title, body);
          await openUrl(url);
          setToast(
            feedbackImage
              ? "Opened GitHub — paste your screenshot there (API may need a token)."
              : "Opening GitHub to submit feedback",
          );
        }
      }
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-dvh max-h-dvh w-screen bg-loom-bg transition-theme overflow-hidden">
      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 loom-overlay animate-fade-in"
          onClick={() => setShortcutsOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Help: shortcuts and feedback"
        >
          <div
            className="loom-card max-w-md w-full p-4 sm:p-5 space-y-3.5 bg-loom-surface border border-loom-border shadow-loom-lg rounded-t-2xl sm:rounded-xl animate-slide-up max-h-[min(90dvh,40rem)] overflow-y-auto mb-[var(--safe-bottom)] sm:mb-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="loom-seg">
                <button
                  type="button"
                  onClick={() => setHelpTab("shortcuts")}
                  aria-pressed={helpTab === "shortcuts"}
                  className="loom-seg-item"
                >
                  Shortcuts
                </button>
                <button
                  type="button"
                  onClick={() => setHelpTab("feedback")}
                  aria-pressed={helpTab === "feedback"}
                  className="loom-seg-item"
                >
                  Feedback
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                className="loom-btn-ghost p-1.5 rounded-md min-h-9 min-w-9"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {helpTab === "shortcuts" && (
              <ul className="text-xs text-loom-text space-y-2.5 leading-relaxed">
                <li><kbd className="loom-kbd">1</kbd> Explorer · <kbd className="loom-kbd">2</kbd> Chart · <kbd className="loom-kbd">3</kbd> Query · <kbd className="loom-kbd">4</kbd> Dive</li>
                <li><kbd className="loom-kbd">⌘1</kbd>–<kbd className="loom-kbd">⌘6</kbd> Panel tabs (Stats → Settings)</li>
                <li><kbd className="loom-kbd">[</kbd> Sidebar · <kbd className="loom-kbd">]</kbd> Right panel</li>
                <li className="pt-1 text-loom-muted font-medium text-2xs uppercase tracking-wider">Scatter</li>
                <li>Two-finger scroll pans · pinch / mouse wheel zooms toward cursor · double-click resets</li>
                <li className="md:hidden">On phone: chart fills the screen · Scan for viz cards · swipe Keep / Skip · Edit opens Encoding</li>
                <li><kbd className="loom-kbd">+</kbd>/<kbd className="loom-kbd">−</kbd> Zoom · <kbd className="loom-kbd">0</kbd> Reset · arrows pan (Shift = faster)</li>
                <li><kbd className="loom-kbd">V</kbd> Pan · <kbd className="loom-kbd">C</kbd> Crosshair · <kbd className="loom-kbd">G</kbd> Lasso</li>
                <li><kbd className="loom-kbd">Shift</kbd>+drag brush select · <kbd className="loom-kbd">L</kbd> Link tooltip · <kbd className="loom-kbd">Esc</kbd> Clear</li>
                <li className="pt-1"><kbd className="loom-kbd">⌘</kbd><kbd className="loom-kbd ml-1">Enter</kbd> Run query · <kbd className="loom-kbd">?</kbd> This help</li>
                <li className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShortcutsOpen(false);
                      requestWhatsNew();
                    }}
                    className="text-loom-accent hover:underline"
                  >
                    See what’s new in Loom →
                  </button>
                </li>
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
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    ref={feedbackFileRef}
                    id="loom-feedback-screenshot"
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                    className="sr-only"
                    onChange={(e) => setFeedbackImage(e.target.files?.[0] ?? null)}
                  />
                  <label
                    htmlFor="loom-feedback-screenshot"
                    className="loom-btn-ghost text-xs px-2 py-1 cursor-pointer shrink-0"
                  >
                    {feedbackImage ? `Attached: ${feedbackImage.name}` : "Attach screenshot"}
                  </label>
                  {feedbackImage && (
                    <button
                      type="button"
                      onClick={() => {
                        setFeedbackImage(null);
                        const el = feedbackFileRef.current;
                        if (el) el.value = "";
                      }}
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
      {!socialExportReady && <TopBar onOpenShortcuts={() => setShortcutsOpen(true)} />}

      {/* Main Body: Sidebar + Canvas + Panel. When dataSourcesExpanded, sidebar takes over. */}
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {!socialExportReady && <Sidebar />}

          {/* Canvas Area — hidden when Data & sources is expanded; shows dashboard when dashboards expanded */}
          <main
            className={`relative bg-loom-bg overflow-hidden transition-[flex] duration-200 flex flex-col ${dataSourcesExpanded && !socialExportReady ? "w-0 min-w-0 flex-shrink-0" : "flex-1 min-w-0"}`}
            style={liveEdit && !socialExportReady ? { paddingBottom: MOBILE_LIVE_EDIT_SHEET } : undefined}
          >
            {dashboardsExpanded && !socialExportReady ? (
              <DashboardCanvas onCollapse={() => useLoomStore.getState().setDashboardsExpanded(false)} />
            ) : (
              <>
                {!dataSourcesExpanded && viewMode === "explorer" && !socialExportReady && <ExplorerView />}
                {(!dataSourcesExpanded || socialExportReady) && (viewMode === "chart" || socialExportReady) && <ChartView />}
                {!dataSourcesExpanded && viewMode === "query" && !socialExportReady && <QueryView />}
                {!dataSourcesExpanded && viewMode === "dive" && !socialExportReady && <DiveView />}
              </>
            )}
            {previewCapture && (
              <div
                className="absolute inset-0 z-40 flex items-center justify-center bg-loom-bg/75 backdrop-blur-[2px]"
                role="status"
                aria-live="polite"
                aria-busy="true"
              >
                <div className="loom-card px-5 py-4 flex flex-col items-center gap-3 max-w-sm mx-4 shadow-lg border border-loom-border">
                  <span className="inline-block w-7 h-7 rounded-full border-2 border-loom-border border-t-loom-accent animate-spin" aria-hidden />
                  <p className="text-sm font-medium text-loom-text text-center">Building story previews</p>
                  <p className="text-2xs text-loom-muted text-center leading-relaxed">{previewCapture.label}</p>
                  {previewCapture.total > 0 && (
                    <div className="w-full h-1.5 rounded-full bg-loom-elevated overflow-hidden">
                      <div
                        className="h-full bg-loom-accent transition-[width] duration-300 ease-out"
                        style={{
                          width: `${Math.min(100, (previewCapture.current / previewCapture.total) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
            {socialExportReady && !previewCapture && (
              <div className="absolute top-2 right-2 z-30 flex items-center gap-2">
                <span className="text-2xs font-mono text-loom-muted bg-loom-surface/90 border border-loom-border rounded px-2 py-1">
                  Share ready · Esc to exit
                </span>
                <button
                  type="button"
                  className="text-2xs px-2 py-1 rounded border border-loom-border bg-loom-surface text-loom-text hover:border-loom-accent"
                  onClick={() => {
                    useLoomStore.getState().setSocialExportReady(false);
                    useLoomStore.getState().setSocialExportTarget(null);
                  }}
                >
                  Exit
                </button>
              </div>
            )}
          </main>

          {!socialExportReady && <DetailPanel />}
        </div>

        {/* Preview as footer — suite waffle docks just above it (rides expand/collapse) */}
        {!socialExportReady && (
          <div className="relative shrink-0">
            <SuiteMenu />
            <PreviewFooter />
          </div>
        )}
      </div>
    </div>
  );
}
