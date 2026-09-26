// =================================================================
// Onboarding — Discover interesting charts on first open
// =================================================================
// Scans live feeds for “something chartable right now”, then offers
// one-click jumps that load the source and open Chart.
// Stories stream in progressively as each feed responds; the modal
// presents them as a filterable / sortable card grid.
// =================================================================

"use client";

import { useEffect, useMemo, useState } from "react";
import { useLoomStore } from "@/lib/store";
import {
  scanDiscoverStories,
  DISCOVER_SEEN_KEY,
  DISCOVER_STORY_LIMIT,
  type DiscoverStory,
} from "@/lib/discoverStories";
import { recommendSourceStory, recommendStreamStory } from "@/lib/recommendations";
import { ALL_SOURCE_KINDS, sourceStatus, streamStatus } from "@/lib/tauri";
import { ODD_CHART_KIND_OPTIONS } from "@/lib/oddCharts";
import { GEO_MAP_KIND_OPTIONS, isGeoFamilyKind } from "@/lib/geoMaps";

type SortMode = "score" | "category" | "chart" | "source" | "name";

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
  ["radar", "Radar"],
  ["choropleth", "Choropleth"],
  ["forceBubble", "Force bubble"],
  ["waterfall", "Waterfall"],
  ["ridgeline", "Ridgeline"],
  ["funnel", "Funnel"],
  ["parallel", "Parallel"],
  ["scatter3d", "Orbit 3D"],
  ["trailRibbon", "Trail ribbons"],
  ["quakeTerrain", "Quake terrain"],
  ["firefly", "Firefly"],
  ["loomWeave", "Loom weave"],
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
  const [sortMode, setSortMode] = useState<SortMode>("score");

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
      setStories([]);
      setShow(true);
      setCategoryFilter("all");
      setChartFilter("all");
      setSortMode("score");
      setScannedHint(`Scanning ${ALL_SOURCE_KINDS.length + 1} live feeds…`);
      void (async () => {
        try {
          const found = await Promise.race([
            scanDiscoverStories({
              limit: DISCOVER_STORY_LIMIT,
              includeWiki: true,
              onStory: (story, soFar) => {
                if (cancelled) return;
                setStories(soFar);
                setPhase("ready");
                const sources = new Set(soFar.map((s) => s.kind)).size;
                setScannedHint(
                  `${soFar.length} stories · ${sources}/${ALL_SOURCE_KINDS.length + 1} feeds`,
                );
                void story;
              },
            }),
            new Promise<DiscoverStory[]>((resolve) => {
              window.setTimeout(() => resolve([]), 22_000);
            }),
          ]);
          if (cancelled) return;
          const final = found.length ? found : [];
          setStories(final);
          setPhase(final.length ? "ready" : "error");
        } catch {
          if (!cancelled) setPhase((p) => (p === "ready" ? p : "error"));
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

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of stories) set.add(s.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
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
  }, [stories, categoryFilter, chartFilter, sortMode]);

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
        if (story.kind === "wiki") {
          const s = await streamStatus();
          useLoomStore.getState().setStreamStatus(s);
        } else {
          const s = await sourceStatus(story.kind);
          setSourceStatus(story.kind, s);
        }
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
      const seq =
        story.kind === "wiki"
          ? recommendStreamStory(story.stats, story.sample)
          : recommendSourceStory(story.kind, story.stats, story.sample);
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

  const clearFilters = () => {
    setCategoryFilter("all");
    setChartFilter("all");
    setSortMode("score");
  };

  const filtersActive = categoryFilter !== "all" || chartFilter !== "all" || sortMode !== "score";

  const exploreSummary = useMemo(() => {
    const parts: string[] = [];
    if (categoryFilter !== "all") parts.push(categoryFilter);
    if (chartFilter !== "all") parts.push(chartKindLabel(chartFilter));
    if (phase === "scan" && stories.length > 0) return scannedHint;
    if (parts.length === 0) {
      return `${visible.length} live ${visible.length === 1 ? "story" : "stories"} across open data`;
    }
    return `${visible.length} ${visible.length === 1 ? "story" : "stories"} · ${parts.join(" · ")}`;
  }, [categoryFilter, chartFilter, phase, stories.length, scannedHint, visible.length]);

  if (show !== true) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 loom-overlay animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-desc"
    >
      <div className="loom-card max-w-5xl w-full p-3 sm:p-5 space-y-0 bg-loom-surface border border-loom-border shadow-loom-lg max-h-[min(94dvh,900px)] flex flex-col rounded-t-2xl sm:rounded-xl animate-slide-up mb-[var(--safe-bottom)] sm:mb-0">
        {/* Title → explore strip: one continuous header, controls read as part of the sentence */}
        <header className="shrink-0 pb-3 mb-3 border-b border-loom-border/50 space-y-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <h2
                  id="onboarding-title"
                  className="text-[1.05rem] sm:text-lg font-semibold text-loom-text tracking-tight leading-tight"
                >
                  What’s interesting right now
                </h2>
                {(phase === "ready" || stories.length > 0) && (
                  <span className="text-2xs font-mono text-loom-muted tabular-nums">
                    {visible.length}
                    {visible.length !== stories.length ? `/${stories.length}` : ""}
                  </span>
                )}
              </div>
              <p id="onboarding-desc" className="text-2xs text-loom-muted leading-relaxed">
                {phase === "scan" && stories.length === 0
                  ? scannedHint
                  : exploreSummary}
              </p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="loom-btn-ghost min-h-8 min-w-8 flex items-center justify-center text-loom-muted text-lg leading-none rounded-md -mt-0.5"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {(phase === "ready" || stories.length > 0) && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] uppercase tracking-[0.12em] text-loom-muted/80 shrink-0 hidden sm:inline">
                  Explore
                </span>
                <div
                  className="flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-0.5 px-0.5"
                  role="group"
                  aria-label="Topic"
                >
                  <div className="flex items-center gap-0.5 w-max">
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
                <div className="flex items-center gap-1.5 shrink-0 pl-1 border-l border-loom-border/60">
                  <label htmlFor="discover-sort" className="sr-only">
                    Sort stories
                  </label>
                  <select
                    id="discover-sort"
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as SortMode)}
                    className="appearance-none bg-transparent border-0 text-2xs text-loom-muted hover:text-loom-text focus:outline-none focus:text-loom-text cursor-pointer pr-4 max-w-[7.5rem]"
                    style={{
                      backgroundImage:
                        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%23888' d='M0 0l5 6 5-6z'/%3E%3C/svg%3E\")",
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 0.15rem center",
                    }}
                    title="Sort"
                  >
                    <option value="score">Best match</option>
                    <option value="category">Category</option>
                    <option value="source">Source</option>
                    <option value="chart">Chart type</option>
                    <option value="name">Name A–Z</option>
                  </select>
                  {filtersActive && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-[10px] text-loom-muted hover:text-loom-accent transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {chartKinds.length > 1 && (
                <div
                  className="flex items-center gap-2 min-w-0"
                  role="group"
                  aria-label="Chart type"
                >
                  <span className="text-[10px] uppercase tracking-[0.12em] text-loom-muted/80 shrink-0 hidden sm:inline">
                    As
                  </span>
                  <div className="flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex items-center gap-x-1.5 w-max text-2xs text-loom-muted">
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
          )}
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          {phase === "scan" && stories.length === 0 && (
            <div className="py-10 text-center space-y-2">
              <p className="text-sm text-loom-text">Scanning open data…</p>
              <p className="text-2xs text-loom-muted">{scannedHint}</p>
              <div className="mx-auto mt-3 h-1 w-32 rounded-full bg-loom-elevated overflow-hidden">
                <div className="h-full w-1/2 bg-loom-accent animate-pulse rounded-full" />
              </div>
            </div>
          )}

          {phase === "error" && stories.length === 0 && (
            <div className="py-8 text-center space-y-3">
              <p className="text-sm text-loom-text">Couldn’t reach live feeds just now.</p>
              <p className="text-2xs text-loom-muted">Open Data &amp; sources to browse catalogs and connect manually.</p>
              <button type="button" onClick={browseSources} className="loom-btn-primary text-xs px-3 py-1.5">
                Browse data sources
              </button>
            </div>
          )}

          {(phase === "ready" || stories.length > 0) && visible.length === 0 && (
            <div className="py-10 text-center space-y-2">
              <p className="text-sm text-loom-text">No stories match these filters.</p>
              <button type="button" onClick={clearFilters} className="text-2xs text-loom-accent hover:underline">
                Clear filters
              </button>
            </div>
          )}

          {(phase === "ready" || stories.length > 0) && visible.length > 0 && (
            <ul className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-1.5 list-none m-0 p-0">
              {visible.map((s) => (
                <li key={s.id} className="min-w-0">
                  <button
                    type="button"
                    disabled={openingId != null}
                    onClick={() => void openStory(s)}
                    className={`
                      group w-full h-full text-left border border-loom-border rounded-lg p-2
                      bg-loom-elevated/40 hover:border-loom-accent/50 hover:bg-loom-accent/5
                      transition-colors disabled:opacity-60 flex flex-col gap-1 min-h-[5.25rem]
                      ${openingId === s.id ? "border-loom-accent ring-1 ring-loom-accent/30" : ""}
                    `}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-[9px] uppercase tracking-wider font-medium text-loom-muted truncate leading-tight">
                        {s.category}
                        <span className="text-loom-muted/50 mx-0.5">·</span>
                        <span className="normal-case tracking-normal font-normal">{s.fileName}</span>
                      </span>
                      <span
                        className="shrink-0 text-[9px] px-1 py-px rounded bg-loom-bg/70 border border-loom-border/70 text-loom-accent leading-tight"
                        title={s.chartKind}
                      >
                        {chartKindLabel(s.chartKind)}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-loom-text leading-snug line-clamp-2 group-hover:text-loom-accent transition-colors">
                      {s.hook}
                    </p>
                    <p className="text-[10px] text-loom-muted leading-snug line-clamp-1 mt-auto">{s.blurb}</p>
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className="text-[9px] font-mono text-loom-muted/70 tabular-nums"
                        title={`Match score ${Math.round(s.score)}`}
                      >
                        {Math.round(s.score)}
                      </span>
                      <span className="text-[9px] text-loom-muted opacity-0 group-hover:opacity-100 transition-opacity">
                        {openingId === s.id ? "…" : "→"}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 shrink-0 pt-1 border-t border-loom-border/60">
          <button type="button" onClick={browseSources} className="text-2xs text-loom-muted hover:text-loom-accent">
            Browse all sources
          </button>
          <button type="button" onClick={dismiss} className="loom-btn-ghost text-xs px-2.5 py-1.5">
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
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
        min-h-7 px-2.5 text-[11px] rounded-full border transition-colors whitespace-nowrap
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
        whitespace-nowrap transition-colors underline-offset-4
        ${pressed
          ? "text-loom-text font-medium underline decoration-loom-accent/70"
          : "text-loom-muted hover:text-loom-text"}
      `}
    >
      {label}
    </button>
  );
}
