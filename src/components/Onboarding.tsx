// =================================================================
// Onboarding — Discover interesting charts on first open
// =================================================================
// Scans live feeds for “something chartable right now”, then offers
// one-click jumps that load the source and open Chart.
// =================================================================

"use client";

import { useEffect, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { scanDiscoverStories, DISCOVER_SEEN_KEY, type DiscoverStory } from "@/lib/discoverStories";
import { recommendSourceStory } from "@/lib/recommendations";
import { sourceStatus } from "@/lib/tauri";

export function Onboarding() {
  const [show, setShow] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<"scan" | "ready" | "error">("scan");
  const [stories, setStories] = useState<DiscoverStory[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const {
    setSelectedFile,
    setColumnStats,
    setSampleRows,
    setChartRecs,
    setActiveChart,
    setVegaSpec,
    setViewMode,
    setPanelTab,
    setStreamActive,
    setSourceStatus,
    setDataRegionOpen,
    setDataSourcesExpanded,
    setToast,
  } = useLoomStore();

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const runScan = () => {
      setPhase("scan");
      setShow(true);
      void (async () => {
        try {
          const found = await Promise.race([
            scanDiscoverStories(5),
            new Promise<DiscoverStory[]>((resolve) => {
              window.setTimeout(() => resolve([]), 10_000);
            }),
          ]);
          if (cancelled) return;
          setStories(found);
          setPhase(found.length ? "ready" : "error");
        } catch {
          if (!cancelled) setPhase("error");
        }
      })();
    };

    const id = window.setTimeout(() => {
      try {
        if (window.localStorage.getItem(DISCOVER_SEEN_KEY)) {
          setShow(false);
          return;
        }
      } catch {
        setShow(false);
        return;
      }
      runScan();
    }, 0);

    const onForce = () => {
      try {
        window.localStorage.removeItem(DISCOVER_SEEN_KEY);
      } catch {
        /* ignore */
      }
      runScan();
    };
    window.addEventListener("loom-discover", onForce);

    return () => {
      cancelled = true;
      window.clearTimeout(id);
      window.removeEventListener("loom-discover", onForce);
    };
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISCOVER_SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  const openStory = async (story: DiscoverStory) => {
    setOpeningId(story.id);
    try {
      try {
        const s = await sourceStatus(story.kind);
        setSourceStatus(story.kind, s);
      } catch {
        /* status optional */
      }
      const file = {
        path: story.streamPath,
        name: story.fileName,
        extension: "stream",
        row_count: story.sample.total_rows,
        size_bytes: 0,
      };
      setSelectedFile(file);
      setColumnStats(story.stats);
      setSampleRows(story.sample);
      setStreamActive(true);
      const seq = recommendSourceStory(story.kind, story.stats, story.sample);
      const charts = seq.charts.length ? seq.charts : [story.chart];
      const preferred =
        charts.find((c) => c.kind === story.chart.kind && c.title === story.chart.title) ??
        charts.find((c) => c.kind === story.chart.kind) ??
        charts[0]!;
      setChartRecs(charts);
      setActiveChart(preferred);
      setVegaSpec(null);
      setViewMode("chart");
      setPanelTab("chart");
      setDataRegionOpen(false);
      setDataSourcesExpanded(false);
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
        const st = useLoomStore.getState();
        if (st.sidebarOpen) st.toggleSidebar();
        if (st.panelOpen) st.togglePanel();
      }
      setToast(`Opened · ${story.hook}`);
      dismiss();
    } catch (e) {
      setToast(`Couldn’t open: ${e instanceof Error ? e.message : e}`);
    } finally {
      setOpeningId(null);
    }
  };

  const browseSources = () => {
    setDataRegionOpen(true);
    setDataSourcesExpanded(true);
    dismiss();
  };

  if (show !== true) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/55"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-desc"
    >
      <div className="loom-card max-w-lg w-full p-4 sm:p-6 space-y-4 bg-loom-surface border border-loom-border shadow-xl max-h-[min(90dvh,640px)] flex flex-col mb-[var(--safe-bottom)]">
        <div className="flex items-start justify-between gap-3 shrink-0">
          <div>
            <h2 id="onboarding-title" className="text-base font-semibold text-loom-text tracking-tight">
              What’s interesting right now
            </h2>
            <p id="onboarding-desc" className="text-2xs text-loom-muted mt-1 max-w-[42ch] leading-snug">
              Loom scanned live feeds for chart-ready stories. Pick one to jump straight in.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="text-loom-muted hover:text-loom-text text-lg leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          {phase === "scan" && (
            <div className="py-10 text-center space-y-2">
              <p className="text-sm text-loom-text">Scanning feeds…</p>
              <p className="text-2xs text-loom-muted">Quakes, space, news, markets, weather</p>
              <div className="mx-auto mt-3 h-1 w-32 rounded-full bg-loom-elevated overflow-hidden">
                <div className="h-full w-1/2 bg-loom-accent animate-pulse rounded-full" />
              </div>
            </div>
          )}

          {phase === "error" && (
            <div className="py-8 text-center space-y-3">
              <p className="text-sm text-loom-text">Couldn’t reach live feeds just now.</p>
              <p className="text-2xs text-loom-muted">Open Data & sources to browse catalogs and connect manually.</p>
              <button type="button" onClick={browseSources} className="loom-btn-primary text-xs px-3 py-1.5">
                Browse data sources
              </button>
            </div>
          )}

          {phase === "ready" && (
            <ul className="space-y-2">
              {stories.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={openingId != null}
                    onClick={() => void openStory(s)}
                    className="w-full text-left border border-loom-border rounded-md p-3 bg-loom-surface/60 hover:border-loom-accent/50 hover:bg-loom-accent/5 transition-colors disabled:opacity-60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-loom-text leading-snug">{s.hook}</p>
                        <p className="text-2xs text-loom-muted mt-0.5 leading-snug">{s.blurb}</p>
                      </div>
                      <span className="text-2xs text-loom-accent shrink-0 capitalize tabular-nums">
                        {openingId === s.id ? "Opening…" : s.chartKind}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1 shrink-0 border-t border-loom-border/60">
          <button type="button" onClick={browseSources} className="text-2xs text-loom-muted hover:text-loom-text">
            Browse all sources
          </button>
          <button type="button" onClick={dismiss} className="loom-btn-ghost text-xs px-2.5 py-1.5">
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
