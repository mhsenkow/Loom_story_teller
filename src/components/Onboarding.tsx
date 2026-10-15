// =================================================================
// Onboarding — Discover interesting charts on first open
// =================================================================
// Scans live feeds for “something chartable right now”, then offers
// one-click jumps that load the source and open Chart.
// Stories stream in progressively as each feed responds; the modal
// presents them as a filterable / sortable card grid.
// =================================================================

"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useLoomStore } from "@/lib/store";
import { openDataSources } from "@/components/StartHere";
import { ChartCard } from "@/components/ChartCard";
import { DiscoverSourceLink } from "@/components/DiscoverSourceLink";
import {
  scanDiscoverStories,
  getDiscoverScanSummary,
  DISCOVER_SEEN_KEY,
  discoverStoryLimit,
  getDiscoverStoryCache,
  setDiscoverStoryCache,
  clearDiscoverStoryCache,
  retainDiscoverFeed,
  stopDiscoverProbes,
  consumeDiscoverForceRequest,
  type DiscoverStory,
} from "@/lib/discoverStories";
import { activateDataset, shortlistFor, type DatasetShortlist } from "@/lib/datasetPipeline";
import { ALL_SOURCE_KINDS, sourceSnapshot, sourceStart, sourceStatus, streamStart, streamStatus } from "@/lib/tauri";
import { SOURCE_BY_KIND, SOURCE_EXPLORE_ROWS } from "@/lib/sourceRegistry";
import { ODD_CHART_KIND_OPTIONS } from "@/lib/oddCharts";
import { GEO_MAP_KIND_OPTIONS, isGeoFamilyKind } from "@/lib/geoMaps";
import { resolveStartupIntent, shouldOpenOnboarding } from "@/lib/startupIntent";
import { getLastSession } from "@/lib/persist";

type SortMode = "score" | "category" | "chart" | "source" | "name";
const SORT_LABELS: Record<SortMode, string> = {
  score: "Best match",
  category: "Category",
  source: "Source",
  chart: "Chart type",
  name: "Name A–Z",
};

const CHART_KIND_LABELS: Record<string, string> = Object.fromEntries([
  ...ODD_CHART_KIND_OPTIONS.map((o) => [o.value, o.label] as const),
  ...GEO_MAP_KIND_OPTIONS.map((o) => [o.value, o.label] as const),
  ["bar", "Bar"],
  ["line", "Line"],
  ["area", "Area"],
  ["scatter", "Scatter"],
  ["bubble", "Bubble"],
  ["histogram", "Histogram"],
  ["heatmap", "Heatmap"],
  ["pie", "Pie"],
  ["box", "Box"],
  ["strip", "Strip"],
  ["violin", "Violin"],
  ["hexbin", "Hexbin"],
  ["lollipop", "Lollipop"],
  ["dumbbell", "Dumbbell"],
  ["treemap", "Treemap"],
  ["sunburst", "Sunburst"],
  ["sankey", "Sankey"],
  ["network", "Network"],
  ["arcDiagram", "Arc diagram"],
  ["radar", "Radar"],
  ["choropleth", "Choropleth"],
  ["forceBubble", "Force bubble"],
  ["bucketField", "Bucket field"],
  ["waterfall", "Waterfall"],
  ["ridgeline", "Ridgeline"],
  ["funnel", "Funnel"],
  ["parallel", "Parallel"],
  ["scatter3d", "Orbit 3D"],
  ["trailRibbon", "Trail ribbons"],
  ["quakeTerrain", "Quake terrain"],
  ["firefly", "Firefly"],
  ["loomWeave", "Loom weave"],
  ["dataCube", "Data cube"],
]);

function chartKindLabel(kind: string): string {
  if (kind === "maps") return "Maps";
  return CHART_KIND_LABELS[kind] ?? kind;
}

export function Onboarding() {
  const [show, setShow] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<"scan" | "ready" | "error">("scan");
  const [stories, setStories] = useState<DiscoverStory[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [scannedHint, setScannedHint] = useState(
    `Scanning ${ALL_SOURCE_KINDS.length + 1} live feeds…`,
  );
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [chartFilter, setChartFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("score");
  const whatsNewOpen = useLoomStore((s) => s.whatsNewOpen);
  const setViewMode = useLoomStore((s) => s.setViewMode);
  const setPanelTab = useLoomStore((s) => s.setPanelTab);
  const setSourceStatus = useLoomStore((s) => s.setSourceStatus);
  const setDataRegionOpen = useLoomStore((s) => s.setDataRegionOpen);
  const setDataSourcesExpanded = useLoomStore((s) => s.setDataSourcesExpanded);
  const setToast = useLoomStore((s) => s.setToast);
  const scanAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    /** Bumps on each scan so a slow prior scan can’t wipe a newer one (or clear progressive cards). */
    let scanGen = 0;

    const applyStories = (list: DiscoverStory[], scanning: boolean) => {
      setStories(list);
      setPhase(list.length ? "ready" : scanning ? "scan" : "error");
      if (!list.length) return;
      const sources = new Set(list.map((s) => s.kind)).size;
      setScannedHint(
        `${list.length} stories · ${sources}/${ALL_SOURCE_KINDS.length + 1} feeds`,
      );
    };

    const runScan = (opts?: { force?: boolean }) => {
      const gen = ++scanGen;
      scanAbortRef.current?.abort();
      const scanAbort = new AbortController();
      scanAbortRef.current = scanAbort;
      setShow(true);
      setCategoryFilter("all");
      setChartFilter("all");
      setSourceFilter("all");
      setSortMode("score");

      // Reopen: show the last scan from memory instead of clearing and waiting again.
      // Explicit “What’s interesting” taps pass force so a partial cache can’t stick.
      if (opts?.force) clearDiscoverStoryCache();
      const cached = !opts?.force ? getDiscoverStoryCache() : null;
      if (cached?.length) {
        applyStories(cached, false);
        return;
      }

      setPhase("scan");
      setStories([]);
      setScannedHint(`Scanning ${ALL_SOURCE_KINDS.length + 1} live feeds…`);
      void (async () => {
        try {
          const found = await scanDiscoverStories({
            limit: discoverStoryLimit(),
            includeWiki: true,
            signal: scanAbort.signal,
            onStory: (_story, soFar) => {
              if (cancelled || scanAbort.signal.aborted || gen !== scanGen) return;
              setDiscoverStoryCache(soFar);
              applyStories(soFar, true);
            },
          });
          if (cancelled || scanAbort.signal.aborted || gen !== scanGen) return;
          if (found.length) {
            setDiscoverStoryCache(found);
            applyStories(found, false);
            const summary = getDiscoverScanSummary();
            const sources = new Set(found.map((s) => s.kind)).size;
            const totalFeeds = ALL_SOURCE_KINDS.length + 1;
            const unavailable =
              summary.failedKinds.length +
              summary.timedOutKinds.length +
              summary.emptyKinds.length +
              (summary.wikiFailed || summary.wikiTimedOut ? 1 : 0);
            if (unavailable > 0 || sources < Math.min(8, totalFeeds)) {
              setScannedHint(
                `${found.length} stories · ${sources}/${totalFeeds} feeds` +
                  (unavailable > 0 ? ` · ${unavailable} unavailable` : ""),
              );
            }
            return;
          }
          // Don’t wipe cards that already streamed in if the final pass is empty.
          setStories((prev) => {
            if (prev.length) {
              setDiscoverStoryCache(prev);
              setPhase("ready");
              return prev;
            }
            setPhase("error");
            return prev;
          });
        } catch {
          if (!cancelled && !scanAbort.signal.aborted && gen === scanGen) {
            setPhase((p) => (p === "ready" ? p : "error"));
          }
        } finally {
          if (scanAbortRef.current === scanAbort) scanAbortRef.current = null;
        }
      })();
    };

    const id = window.setTimeout(() => {
      // Explicit tap often mounts us after the event already fired — honor that.
      if (consumeDiscoverForceRequest()) {
        runScan({ force: true });
        return;
      }
      let hasDiscoverSeen = false;
      try {
        hasDiscoverSeen = !!window.localStorage.getItem(DISCOVER_SEEN_KEY);
      } catch {
        setShow(false);
        return;
      }
      const intent = resolveStartupIntent({
        hash: window.location.hash,
        hasDiscoverSeen,
        hasLastSession: !!getLastSession()?.filePath,
        neospaceHandoff: window.location.search.includes("neospace=1"),
      });
      if (!shouldOpenOnboarding(intent)) {
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
      // Listener path already received the event; drop the pending flag.
      consumeDiscoverForceRequest();
      runScan({ force: true });
    };
    window.addEventListener("loom-discover", onForce);

    return () => {
      cancelled = true;
      scanGen += 1;
      scanAbortRef.current?.abort();
      window.clearTimeout(id);
      window.removeEventListener("loom-discover", onForce);
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of stories) set.add(s.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [stories]);

  const sources = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of stories) {
      if (!map.has(s.kind)) map.set(s.kind, s.fileName);
    }
    return Array.from(map.entries())
      .map(([kind, fileName]) => ({ kind, fileName }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
  }, [stories]);

  const chartKinds = useMemo(() => {
    const set = new Set<string>();
    for (const s of stories) set.add(s.chartKind);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [stories]);

  const visible = useMemo(() => {
    let list = stories;
    if (categoryFilter !== "all") {
      list = list.filter((s) => s.category === categoryFilter);
    }
    if (sourceFilter !== "all") {
      list = list.filter((s) => s.kind === sourceFilter);
    }
    if (chartFilter === "maps") {
      list = list.filter((s) => isGeoFamilyKind(s.chartKind));
    } else if (chartFilter !== "all") {
      list = list.filter((s) => s.chartKind === chartFilter);
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortMode) {
        case "category": {
          const c = a.category.localeCompare(b.category);
          return c !== 0 ? c : b.score - a.score;
        }
        case "source": {
          const c = a.fileName.localeCompare(b.fileName);
          return c !== 0 ? c : b.score - a.score;
        }
        case "chart": {
          const c = a.chartKind.localeCompare(b.chartKind);
          return c !== 0 ? c : b.score - a.score;
        }
        case "name":
          return a.hook.localeCompare(b.hook);
        case "score":
        default:
          return b.score - a.score;
      }
    });
    return sorted;
  }, [stories, categoryFilter, sourceFilter, chartFilter, sortMode]);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISCOVER_SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    scanAbortRef.current?.abort();
    void stopDiscoverProbes();
    setShow(false);
  };

  const openStory = async (
    story: DiscoverStory,
    opts?: { dest?: "chart" | "inspect" },
  ) => {
    const dest = opts?.dest ?? "chart";
    scanAbortRef.current?.abort();
    retainDiscoverFeed(story.kind);
    setOpeningId(story.id);
    try {
      try {
        if (story.kind === "wiki") {
          const s0 = await streamStatus();
          if (!s0.running) await streamStart();
          const s = await streamStatus();
          useLoomStore.getState().setStreamStatus(s);
        } else {
          const s0 = await sourceStatus(story.kind);
          if (!s0.running) await sourceStart(story.kind);
          const s = await sourceStatus(story.kind);
          setSourceStatus(story.kind, s);
        }
      } catch {
        /* status optional */
      }
      // Discover probes with a small snapshot for thumbnails; open the story on
      // the same full buffer the sidebar uses so lines cover the whole window.
      let { stats, sample } = story;
      if (story.kind !== "wiki") {
        try {
          const full = await sourceSnapshot(story.kind, SOURCE_EXPLORE_ROWS);
          if (full.sample.rows.length >= story.sample.rows.length) ({ stats, sample } = full);
        } catch {
          /* keep the probe sample */
        }
      }
      const file = {
        path: story.streamPath,
        name: story.fileName,
        extension: "stream",
        row_count: sample.total_rows,
        size_bytes: 0,
        ...(story.kind === "wiki"
          ? {
              sourceHome: "https://www.wikimedia.org/",
              sourceCredit: "Wikimedia recent changes · CC BY-SA",
            }
          : {
              sourceHome: SOURCE_BY_KIND[story.kind]?.homepage,
              sourceCredit: SOURCE_BY_KIND[story.kind]?.attribution,
            }),
      };
      const shortlist: DatasetShortlist =
        story.kind === "wiki" ? { type: "stream" } : { type: "source", kind: story.kind };
      const seqCharts = shortlistFor(shortlist, file, stats, sample);
      const charts = seqCharts.length ? seqCharts : [story.chart];
      const preferred =
        charts.find((c) => c.kind === story.chart.kind && c.title === story.chart.title) ??
        charts.find((c) => c.kind === story.chart.kind) ??
        charts[0]!;
      // Open the exact Discover chart that was previewed (stack mode, encodings).
      const openChart = { ...preferred, ...story.chart, id: story.chart.id || preferred.id };
      activateDataset({
        file,
        stats,
        sample,
        charts: [openChart, ...charts.filter((c) => c.id !== openChart.id)],
        active: openChart,
      });
      // The hook ("M5.8 quake — …") is the headline people came for; keep it on the chart.
      if (story.hook && story.hook !== openChart.title) {
        useLoomStore.getState().setChartTitleOverride(openChart.id, story.hook);
      }
      if (dest === "inspect") {
        setViewMode("chart");
        setPanelTab("stats");
        // Keep the detail panel open so provenance + columns are visible.
        const st = useLoomStore.getState();
        if (!st.panelOpen) st.togglePanel();
        setToast(`Inspect · ${file.name}`);
      } else {
        setViewMode("chart");
        setPanelTab("chart");
        setToast(`Opened · ${story.hook}`);
      }
      setDataRegionOpen(false);
      setDataSourcesExpanded(false);
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
        const st = useLoomStore.getState();
        if (st.sidebarOpen) st.toggleSidebar();
        // Inspect needs the panel; chart-open still collapses chrome on phones.
        if (dest !== "inspect" && st.panelOpen) st.togglePanel();
      }
      dismiss();
    } catch (e) {
      setToast(`Couldn’t open: ${e instanceof Error ? e.message : e}`);
    } finally {
      setOpeningId(null);
    }
  };

  const browseSources = () => {
    openDataSources();
    dismiss();
  };

  const clearFilters = () => {
    setCategoryFilter("all");
    setChartFilter("all");
    setSourceFilter("all");
    setSortMode("score");
  };

  const topicFade = useEdgeFade<HTMLDivElement>();
  const sourceFade = useEdgeFade<HTMLDivElement>();
  const kindFade = useEdgeFade<HTMLDivElement>();

  const filtersActive =
    categoryFilter !== "all" || chartFilter !== "all" || sourceFilter !== "all" || sortMode !== "score";

  const exploreSummary = useMemo(() => {
    const parts: string[] = [];
    if (categoryFilter !== "all") parts.push(categoryFilter);
    if (sourceFilter !== "all") {
      parts.push(sources.find((s) => s.kind === sourceFilter)?.fileName ?? sourceFilter);
    }
    if (chartFilter !== "all") parts.push(chartKindLabel(chartFilter));
    if (phase === "scan" && stories.length > 0) return scannedHint;
    // Keep sparse-scan diagnostics visible (e.g. one warm feed → “38” space cards).
    if (parts.length === 0 && scannedHint.includes("feeds")) {
      return scannedHint;
    }
    if (parts.length === 0) {
      return `${visible.length} live ${visible.length === 1 ? "story" : "stories"} across open data`;
    }
    return `${visible.length} ${visible.length === 1 ? "story" : "stories"} · ${parts.join(" · ")}`;
  }, [
    categoryFilter,
    sourceFilter,
    chartFilter,
    phase,
    stories.length,
    scannedHint,
    visible.length,
    sources,
  ]);

  // The scan keeps streaming in the background while What's new is up, so
  // stories are ready the moment it closes.
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (show !== true) return;
    const t = window.requestAnimationFrame(() => {
      const btn =
        document.querySelector<HTMLElement>("#onboarding-stories button") ??
        closeRef.current;
      btn?.focus();
    });
    return () => window.cancelAnimationFrame(t);
  }, [show, visible.length, phase]);

  if (show !== true || whatsNewOpen) return null;

  const showFilters = phase === "ready" || stories.length > 0;

  const filterRows = showFilters ? (
    <div className="space-y-1.5 sm:space-y-2 min-w-0 overflow-hidden">
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
        <span className="text-[10px] uppercase tracking-[0.12em] text-loom-muted/80 shrink-0 hidden sm:inline">
          Explore
        </span>
        <div
          className="flex-1 min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          ref={topicFade.ref}
          style={topicFade.style}
          role="group"
          aria-label="Topic"
        >
          <div className="flex items-center gap-1 sm:gap-0.5 w-max pr-1">
            <FilterChip
              label="All"
              pressed={categoryFilter === "all"}
              onClick={() => setCategoryFilter("all")}
            />
            {categories.map((cat) => (
              <FilterChip
                key={cat}
                label={cat}
                pressed={categoryFilter === cat}
                onClick={() => setCategoryFilter(cat)}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 pl-1 border-l border-loom-border/60">
          <label htmlFor="discover-sort" className="sr-only">
            Sort stories
          </label>
          <span className="relative inline-flex items-center gap-1 min-h-9 sm:min-h-0 px-1 sm:px-0.5 text-xs sm:text-2xs text-loom-muted hover:text-loom-text focus-within:text-loom-text focus-within:ring-1 focus-within:ring-loom-accent/50 rounded">
            {SORT_LABELS[sortMode]}
            <svg width="8" height="5" viewBox="0 0 10 6" aria-hidden className="fill-current opacity-70">
              <path d="M0 0l5 6 5-6z" />
            </svg>
            <select
              id="discover-sort"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer appearance-none text-base"
              title="Sort"
            >
              {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
                <option key={m} value={m}>
                  {SORT_LABELS[m]}
                </option>
              ))}
            </select>
          </span>
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="min-h-9 sm:min-h-0 px-1.5 text-xs sm:text-[10px] text-loom-muted hover:text-loom-accent transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {sources.length > 1 && (
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-[0.12em] text-loom-muted/80 shrink-0 hidden sm:inline">
            From
          </span>
          <div
            className="flex-1 min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            ref={sourceFade.ref}
            style={sourceFade.style}
            role="group"
            aria-label="Source"
          >
            <div className="flex items-center gap-1 sm:gap-0.5 w-max pr-1">
              <FilterChip
                label="All"
                pressed={sourceFilter === "all"}
                onClick={() => setSourceFilter("all")}
              />
              {sources.map((src) => (
                <FilterChip
                  key={src.kind}
                  label={src.fileName}
                  pressed={sourceFilter === src.kind}
                  onClick={() => setSourceFilter(src.kind)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {chartKinds.length > 1 && (
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0" role="group" aria-label="Chart type">
          <span className="text-[10px] uppercase tracking-[0.12em] text-loom-muted/80 shrink-0 hidden sm:inline">
            As
          </span>
          <div
            className="flex-1 min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            ref={kindFade.ref}
            style={kindFade.style}
          >
            <div className="flex items-center gap-x-1.5 sm:gap-x-1.5 w-max pr-1 text-xs sm:text-2xs text-loom-muted">
              <ChartLink
                label="Any"
                pressed={chartFilter === "all"}
                onClick={() => setChartFilter("all")}
              />
              <span className="inline-flex items-center gap-x-1.5">
                <span className="text-loom-border select-none" aria-hidden>
                  ·
                </span>
                <ChartLink
                  label="Maps"
                  pressed={chartFilter === "maps"}
                  onClick={() => setChartFilter("maps")}
                />
              </span>
              {chartKinds.map((kind) => (
                <span key={kind} className="inline-flex items-center gap-x-1.5">
                  <span className="text-loom-border select-none" aria-hidden>
                    ·
                  </span>
                  <ChartLink
                    label={chartKindLabel(kind)}
                    pressed={chartFilter === kind}
                    onClick={() => setChartFilter(kind)}
                  />
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <Dialog
      open
      onClose={dismiss}
      labelledBy="onboarding-title"
      describedBy="onboarding-desc"
      initialFocusRef={closeRef}
      zIndex={200}
      stage
      panelClassName="p-3 sm:p-4 space-y-0 flex flex-col h-full"
    >
      <div className="flex flex-col min-w-0 min-h-0 h-full max-h-full space-y-0">
        {/* order: phone = title → stories → filters → footer; desktop = title → filters → stories → footer */}
        <header className="order-1 shrink-0 pb-1.5 sm:pb-3 mb-1 sm:mb-3 border-b border-loom-border/50">
          <div className="flex items-start gap-2 sm:gap-3">
            <div className="min-w-0 flex-1 space-y-0.5 sm:space-y-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2
                  id="onboarding-title"
                  className="text-base sm:text-lg font-semibold text-loom-text tracking-tight leading-tight"
                >
                  What’s interesting right now
                </h2>
                {showFilters && (
                  <span className="text-2xs font-mono text-loom-muted tabular-nums" aria-live="polite">
                    {visible.length}
                    {visible.length !== stories.length ? `/${stories.length}` : ""}
                  </span>
                )}
              </div>
              {/* Keep scan/error copy; once cards show, reclaim vertical space on phones */}
              <p
                id="onboarding-desc"
                className={`text-2xs text-loom-muted leading-relaxed ${
                  showFilters ? "hidden sm:block" : ""
                }`}
              >
                {phase === "scan" && stories.length === 0
                  ? scannedHint
                  : exploreSummary}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={dismiss}
              className="loom-btn-ghost min-h-9 min-w-9 sm:min-h-8 sm:min-w-8 flex items-center justify-center text-loom-muted text-lg leading-none rounded-md -mt-0.5"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </header>

        {filterRows ? (
          <div className="order-3 sm:order-2 shrink-0 pt-1.5 sm:pt-0 sm:pb-3 sm:mb-3 border-t sm:border-t-0 sm:border-b border-loom-border/50">
            {filterRows}
          </div>
        ) : null}

        <div className="order-2 sm:order-3 flex-1 min-h-0 overflow-y-auto overscroll-y-contain -mx-0.5 px-0.5 sm:-mx-1 sm:px-1 flex flex-col">
          {phase === "scan" && stories.length === 0 && (
            <div className="my-auto py-10 text-center space-y-2">
              <p className="text-sm text-loom-text">Scanning open data…</p>
              <p className="text-2xs text-loom-muted">{scannedHint}</p>
              <div className="mx-auto mt-3 h-1 w-32 rounded-full bg-loom-elevated overflow-hidden">
                <div className="h-full w-1/2 bg-loom-accent animate-pulse rounded-full" />
              </div>
            </div>
          )}

          {phase === "error" && stories.length === 0 && (
            <div className="my-auto py-8 text-center space-y-3">
              <p className="text-sm text-loom-text">Couldn’t reach live feeds just now.</p>
              <p className="text-2xs text-loom-muted">Open Data &amp; sources to browse catalogs and connect manually.</p>
              <button type="button" onClick={browseSources} className="loom-btn-primary text-xs px-3 py-1.5">
                Browse data sources
              </button>
            </div>
          )}

          {showFilters && visible.length === 0 && (
            <div className="my-auto py-10 text-center space-y-2">
              <p className="text-sm text-loom-text">No stories match these filters.</p>
              <button type="button" onClick={clearFilters} className="text-2xs text-loom-accent hover:underline">
                Clear filters
              </button>
            </div>
          )}

          {showFilters && visible.length > 0 && (
            <ul id="onboarding-stories" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 content-start gap-2 sm:gap-2.5 list-none m-0 p-0 pb-2 min-w-0 w-full">
              {visible.map((s) => (
                <li key={s.id} className="min-w-0 max-w-full animate-fade-in">
                  <div className="relative">
                    <span className="absolute top-1.5 left-1.5 z-10 text-[9px] uppercase tracking-wider font-medium text-loom-muted bg-loom-bg/85 border border-loom-border/70 rounded px-1 py-px max-w-[52%] truncate pointer-events-none">
                      {s.category}
                    </span>
                    <DiscoverSourceLink
                      kind={s.kind}
                      onInspect={() => void openStory(s, { dest: "inspect" })}
                    />
                    <ChartCard
                      rec={{
                        ...s.chart,
                        title: s.hook,
                        subtitle: s.blurb,
                      }}
                      data={s.sample}
                      isActive={openingId === s.id}
                      onClick={() => void openStory(s)}
                      micro
                      nativeTitle={false}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="order-4 flex items-center justify-between gap-2 shrink-0 pt-1 sm:pt-1 border-t border-loom-border/60">
          <button type="button" onClick={browseSources} className="text-xs sm:text-2xs text-loom-muted hover:text-loom-accent min-h-9 sm:min-h-0 px-1">
            Browse all sources
          </button>
          <button type="button" onClick={dismiss} className="loom-btn-ghost text-xs px-2 py-1 min-h-9 sm:min-h-0">
            Skip for now
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** Fades whichever edge of a horizontal scroller still has content past it, so a cut-off row reads as scrollable. */
function useEdgeFade<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [el]);
  const mask = `linear-gradient(to right, ${edges.left ? "transparent, black 1.5rem" : "black"}, ${edges.right ? "black calc(100% - 2rem), transparent" : "black"})`;
  const style: CSSProperties = edges.left || edges.right ? { maskImage: mask, WebkitMaskImage: mask } : {};
  return { ref: setEl, style };
}

function FilterChip({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`
        min-h-10 sm:min-h-7 px-3 sm:px-2.5 text-xs sm:text-[11px] rounded-full border transition-colors whitespace-nowrap
        ${pressed
          ? "bg-loom-text text-loom-bg border-loom-text font-medium"
          : "bg-transparent text-loom-muted border-transparent hover:text-loom-text hover:bg-loom-elevated/80"}
      `}
    >
      {label}
    </button>
  );
}

function ChartLink({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`
        whitespace-nowrap transition-colors underline-offset-4 min-h-9 sm:min-h-0 inline-flex items-center py-1.5 sm:py-0
        ${pressed
          ? "text-loom-text font-medium underline decoration-loom-accent/70"
          : "text-loom-muted hover:text-loom-text"}
      `}
    >
      {label}
    </button>
  );
}
