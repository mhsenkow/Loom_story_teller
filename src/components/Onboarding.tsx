// =================================================================
// Onboarding — Discover interesting charts on first open
// =================================================================
// Scans live feeds for “something chartable right now”, then offers
// one-click jumps that load the source and open Chart.
// Stories stream in progressively as each feed responds; the modal
// presents them as a filterable / sortable card grid.
// =================================================================

"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ThemeCycleButton } from "@/components/ThemeCycleButton";
import { Dialog } from "@/components/ui/Dialog";
import { useLoomStore } from "@/lib/store";
import { openDataSources } from "@/components/StartHere";
import { DiscoverStoryCard } from "@/components/DiscoverStoryCard";
import {
  DISCOVER_PAGE_SIZE,
  DISCOVER_SETTING_FILTERS,
  discoverChartLabel,
  matchesDiscoverSearch,
  matchesDiscoverSetting,
  rankDiscoverStories,
  groupDiscoverStories,
  type DiscoverSettingFilter,
} from "@/lib/discoverPresentation";
import {
  discoverFlowColumnCount,
  discoverFlowTiers,
  type DiscoverFlowTier,
} from "@/lib/discoverFlowLayout";
import {
  scanDiscoverStories,
  refreshDiscoverStories,
  requestDiscoverScan,
  getDiscoverScanSummary,
  applyDiversityFilters,
  DISCOVER_SEEN_KEY,
  discoverStoryLimit,
  getDiscoverStoryCache,
  getDiscoverCacheSavedAt,
  consumeDiscoverRefreshRequest,
  setDiscoverStoryCache,
  retainDiscoverFeed,
  consumeDiscoverForceRequest,
  type DiscoverStory,
  type DiscoverKind,
} from "@/lib/discoverStories";
import { activateDataset } from "@/lib/datasetPipeline";
import {
  isDiscoverCacheFresh,
  readDiscoverDailyCache,
  writeDiscoverDailyCache,
} from "@/lib/discoverDailyCache";
import {
  ALL_SOURCE_KINDS,
  sourceStart,
  sourceStatus,
  streamStart,
  streamStatus,
} from "@/lib/tauri";
import { SOURCE_BY_KIND } from "@/lib/sourceRegistry";
import {
  discoverAffinityMap,
  HIDDEN_RANK_PENALTY,
} from "@/lib/sourcePreferences";
import { isGeoFamilyKind } from "@/lib/geoMaps";
import { DISCOVER_FAMILIES, discoverFamily } from "@/lib/discoverChartCatalog";
import { discoverSpotlights } from "@/lib/discoverRanking";
import {
  resolveStartupIntent,
  shouldOpenOnboarding,
} from "@/lib/startupIntent";
import { getLastSession } from "@/lib/persist";
import { editorialDiscoverStory } from "@/lib/discoverEditorial";
import {
  planDiscoverRefresh,
  discoverFreshness,
} from "@/lib/discoverFreshness";
import {
  changedDiscoverKinds,
  withDiscoverCheckTimes,
  stampDiscoverDataChanges,
} from "@/lib/discoverUpdates";
import {
  readDiscoverBrowseState,
  saveDiscoverBrowseState,
  type DiscoverBrowseState,
  type DiscoverLayout,
  type DiscoverSize,
  type DiscoverSort,
} from "@/lib/discoverBrowseState";

type SortMode = DiscoverSort;
type GalleryLayout = DiscoverLayout;
const GALLERY_LAYOUTS: {
  value: GalleryLayout;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    value: "flow",
    label: "Flow",
    icon: "▦",
    description: "A mix of large and small stories",
  },
  {
    value: "tiles",
    label: "Tiles",
    icon: "⊞",
    description: "An even grid with square chart previews",
  },
  {
    value: "masonry",
    label: "Masonry",
    icon: "▥",
    description: "A compact wall of stories",
  },
  {
    value: "list",
    label: "List",
    icon: "☰",
    description: "Quickly scan stories in rows",
  },
];
const SIZE_OPTIONS: {
  value: DiscoverSize;
  label: string;
  short: string;
  description: string;
}[] = [
  {
    value: "compact",
    label: "Compact",
    short: "S",
    description: "Denser cards for scanning more stories",
  },
  {
    value: "comfort",
    label: "Comfort",
    short: "M",
    description: "Balanced card size",
  },
  {
    value: "broadsheet",
    label: "Broadsheet",
    short: "L",
    description: "Larger headlines and charts",
  },
];
const SORT_LABELS: Record<SortMode, string> = {
  score: "Recommended",
  category: "Category",
  source: "Source",
  chart: "Chart type",
  name: "Name A–Z",
};

export function Onboarding() {
  const [initialBrowse] = useState(readDiscoverBrowseState);
  const [show, setShow] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<"scan" | "ready" | "error">("scan");
  const [stories, setStories] = useState<DiscoverStory[]>([]);
  const storiesRef = useRef(stories);
  storiesRef.current = stories;
  const [search, setSearch] = useState(initialBrowse.search);
  const deferredSearch = useDeferredValue(search);
  const [settingFilter, setSettingFilter] = useState<DiscoverSettingFilter>(
    initialBrowse.settingFilter,
  );
  const [shownCount, setShownCount] = useState(initialBrowse.shownCount);
  const [scanning, setScanning] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(initialBrowse.filtersOpen);
  const [layout, setLayout] = useState<GalleryLayout>(initialBrowse.layout);
  const [size, setSize] = useState<DiscoverSize>(initialBrowse.size);
  const [flowColumns, setFlowColumns] = useState(1);
  const [pendingStories, setPendingStories] = useState<DiscoverStory[] | null>(
    null,
  );
  const [now, setNow] = useState(Date.now);
  // Check labels tick independently; freshness ranking changes only when picks are accepted.
  const [rankedAt, setRankedAt] = useState(Date.now);
  const [chosenVariants, setChosenVariants] = useState<Record<string, string>>(
    {},
  );
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const openingRef = useRef(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [scannedHint, setScannedHint] = useState(
    `Scanning ${ALL_SOURCE_KINDS.length + 1} live feeds…`,
  );
  const [categoryFilter, setCategoryFilter] = useState(
    initialBrowse.categoryFilter,
  );
  const [chartFilter, setChartFilter] = useState(initialBrowse.chartFilter);
  const [sourceFilter, setSourceFilter] = useState(initialBrowse.sourceFilter);
  const [sortMode, setSortMode] = useState<SortMode>(initialBrowse.sortMode);
  const [showHiddenSources, setShowHiddenSources] = useState(false);
  const sourcePrefs = useLoomStore((s) => s.sourcePrefs);
  const whatsNewOpen = useLoomStore((s) => s.whatsNewOpen);
  const setViewMode = useLoomStore((s) => s.setViewMode);
  const setPanelTab = useLoomStore((s) => s.setPanelTab);
  const setSourceStatus = useLoomStore((s) => s.setSourceStatus);
  const setDataRegionOpen = useLoomStore((s) => s.setDataRegionOpen);
  const setDataSourcesExpanded = useLoomStore((s) => s.setDataSourcesExpanded);
  const setToast = useLoomStore((s) => s.setToast);
  const scanAbortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLUListElement>(null);
  const scrollPositionRef = useRef(initialBrowse.scrollTop);
  const browseRef = useRef<DiscoverBrowseState>(initialBrowse);
  const showRef = useRef(show);
  useEffect(() => {
    showRef.current = show;
  }, [show]);

  useEffect(() => {
    browseRef.current = {
      search,
      categoryFilter,
      chartFilter,
      sourceFilter,
      settingFilter,
      sortMode,
      layout,
      size,
      filtersOpen,
      shownCount,
      scrollTop: scrollPositionRef.current,
    };
    saveDiscoverBrowseState(browseRef.current);
  }, [
    search,
    categoryFilter,
    chartFilter,
    sourceFilter,
    settingFilter,
    sortMode,
    layout,
    size,
    filtersOpen,
    shownCount,
  ]);
  useEffect(() => {
    const save = () =>
      saveDiscoverBrowseState({
        ...browseRef.current,
        scrollTop: scrollPositionRef.current,
      });
    window.addEventListener("pagehide", save);
    return () => {
      save();
      window.removeEventListener("pagehide", save);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    let lastAttempt = 0;
    let warmup: number | undefined;
    let hydration: ReturnType<typeof readDiscoverDailyCache> | null = null;

    const applyStories = (list: DiscoverStory[]) => {
      setStories(list.map(editorialDiscoverStory));
      setRankedAt(Date.now());
      setPendingStories(null);
      setSavedAt(getDiscoverCacheSavedAt());
      setPhase(list.length ? "ready" : "scan");
      setScannedHint(
        `${new Set(list.map((story) => story.kind)).size} sources · ${list.length} chart ideas`,
      );
    };
    const hydrate = async () => {
      if (getDiscoverStoryCache()?.length) return;
      hydration ??= readDiscoverDailyCache();
      const stored = await hydration;
      if (stored && !getDiscoverStoryCache()?.length)
        setDiscoverStoryCache(stored.stories, stored.savedAt);
    };
    const runScan = async (
      opts: { refresh?: boolean; background?: boolean } = {},
    ) => {
      if (!opts.background) {
        setShow(true);
      }
      if (scanAbortRef.current) return;
      const warm = getDiscoverStoryCache();
      const mayReplace =
        !opts.background || !showRef.current || !storiesRef.current.length;
      if (warm?.length && mayReplace) applyStories(warm);
      await hydrate();
      if (cancelled) return;
      const cached = getDiscoverStoryCache();
      if (cached?.length && mayReplace) applyStories(cached);
      if (scanAbortRef.current) return;
      if (!opts.refresh && isDiscoverCacheFresh(getDiscoverCacheSavedAt())) {
        setScanning(false);
        return;
      }
      if (!opts.refresh && lastAttempt && Date.now() - lastAttempt < 300_000)
        return;
      lastAttempt = Date.now();
      const gen = ++generation;
      const abort = new AbortController();
      scanAbortRef.current = abort;
      setScanning(true);
      if (!cached?.length) setPhase("scan");
      try {
        const found = await scanDiscoverStories({
          limit: discoverStoryLimit(),
          includeWiki: true,
          signal: abort.signal,
          commitCache: false,
          onStory: (_story, soFar) => {
            if (
              cancelled ||
              abort.signal.aborted ||
              gen !== generation ||
              cached?.length
            )
              return;
            setDiscoverStoryCache(soFar, null);
            applyStories(soFar);
          },
        });
        if (cancelled || abort.signal.aborted || gen !== generation) return;
        if (found.length) {
          const supplied = new Set(found.map((story) => story.kind));
          const merged = applyDiversityFilters(
            stampDiscoverDataChanges(cached ?? [], [
              ...found,
              ...(cached ?? [])
                .filter((story) => !supplied.has(story.kind))
                .map((story) => ({ ...story, snapshotCached: true })),
            ]),
            discoverStoryLimit(),
          );
          setDiscoverStoryCache(merged);
          void writeDiscoverDailyCache(
            merged,
            getDiscoverCacheSavedAt() ?? Date.now(),
          );
          if (
            cached?.length &&
            showRef.current &&
            changedDiscoverKinds(storiesRef.current, merged).size
          )
            setPendingStories(merged);
          else if (cached?.length && showRef.current) {
            setStories(withDiscoverCheckTimes(storiesRef.current, merged));
            setPendingStories(null);
          } else applyStories(merged);
          const summary = getDiscoverScanSummary();
          const unavailable =
            summary.failedKinds.length +
            summary.timedOutKinds.length +
            summary.emptyKinds.length +
            (summary.wikiFailed || summary.wikiTimedOut ? 1 : 0);
          if (unavailable && !(cached?.length && showRef.current))
            setScannedHint(
              `${new Set(found.map((story) => story.kind)).size} sources · ${found.length} chart ideas · ${unavailable} unavailable`,
            );
        } else if (cached?.length) {
          setScannedHint("Couldn’t refresh · showing saved picks");
        } else setPhase("error");
      } catch {
        if (!cancelled && !abort.signal.aborted) {
          if (cached?.length)
            setScannedHint("Couldn’t refresh · showing saved picks");
          else setPhase("error");
        }
      } finally {
        if (scanAbortRef.current === abort) {
          scanAbortRef.current = null;
          if (!cancelled) setScanning(false);
        }
      }
    };
    const onRequest = () => {
      consumeDiscoverForceRequest();
      void runScan({ refresh: consumeDiscoverRefreshRequest() });
    };
    const onDailyCheck = () => {
      if (
        document.visibilityState === "visible" &&
        !isDiscoverCacheFresh(getDiscoverCacheSavedAt())
      )
        void runScan({ background: true });
    };
    const initial = window.setTimeout(() => {
      if (consumeDiscoverForceRequest()) {
        void runScan({ refresh: consumeDiscoverRefreshRequest() });
        return;
      }
      let hasDiscoverSeen = false;
      try {
        hasDiscoverSeen = !!window.localStorage.getItem(DISCOVER_SEEN_KEY);
      } catch {
        /* private mode still supports discovery */
      }
      const intent = resolveStartupIntent({
        hash: window.location.hash,
        hasDiscoverSeen,
        hasLastSession: !!getLastSession()?.filePath,
        neospaceHandoff: window.location.search.includes("neospace=1"),
      });
      const open = shouldOpenOnboarding(intent);
      setShow(open);
      if (open) void runScan();
      else {
        void hydrate().then(() => {
          if (cancelled) return;
          const cached = getDiscoverStoryCache();
          if (cached?.length) applyStories(cached);
        });
        // Give a resumed/shared chart the first paint and network slots.
        warmup = window.setTimeout(onDailyCheck, 5_000);
      }
    }, 0);
    const daily = window.setInterval(onDailyCheck, 60_000);
    window.addEventListener("loom-discover", onRequest);
    document.addEventListener("visibilitychange", onDailyCheck);
    return () => {
      cancelled = true;
      generation += 1;
      scanAbortRef.current?.abort();
      scanAbortRef.current = null;
      window.clearTimeout(initial);
      window.clearTimeout(warmup);
      window.clearInterval(daily);
      window.removeEventListener("loom-discover", onRequest);
      document.removeEventListener("visibilitychange", onDailyCheck);
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
    return Array.from(set).sort((a, b) =>
      discoverChartLabel(a).localeCompare(discoverChartLabel(b)),
    );
  }, [stories]);

  // ♥ / Less / Hide per feed — display-only; story.score (and the daily cache) stay untouched.
  const sourceAffinity = useMemo(
    () =>
      discoverAffinityMap(
        [...new Set(stories.map((s) => s.kind))],
        sourcePrefs,
      ),
    [stories, sourcePrefs],
  );
  const hiddenSourceCount = useMemo(
    () =>
      Object.values(sourceAffinity).filter((v) => v === HIDDEN_RANK_PENALTY)
        .length,
    [sourceAffinity],
  );

  const visible = useMemo(() => {
    if (show !== true) return [];
    let list = stories.filter(
      (story) =>
        matchesDiscoverSearch(story, deferredSearch) &&
        matchesDiscoverSetting(story.chart, settingFilter),
    );
    if (categoryFilter !== "all") {
      list = list.filter((s) => s.category === categoryFilter);
    }
    if (sourceFilter !== "all") {
      list = list.filter((s) => s.kind === sourceFilter);
    } else if (!showHiddenSources && hiddenSourceCount) {
      list = list.filter((s) => sourceAffinity[s.kind] !== HIDDEN_RANK_PENALTY);
    }
    if (chartFilter === "maps") {
      list = list.filter((s) => isGeoFamilyKind(s.chartKind));
    } else if (chartFilter.startsWith("family:")) {
      list = list.filter(
        (s) => discoverFamily(s.chartKind) === chartFilter.slice(7),
      );
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
  }, [
    stories,
    sourceAffinity,
    hiddenSourceCount,
    showHiddenSources,
    categoryFilter,
    sourceFilter,
    chartFilter,
    sortMode,
    deferredSearch,
    settingFilter,
    show,
  ]);

  const groups = useMemo(() => {
    const questions = groupDiscoverStories(visible);
    if (sortMode !== "score") return questions;
    const byStory = new Map(
      questions.map((group) => [group.stories[0]!, group]),
    );
    return rankDiscoverStories([...byStory.keys()], (story) => {
      const affinity = sourceAffinity[story.kind] ?? 0;
      const fresh = story.dataChangedAt
        ? Math.max(
            0,
            Math.min(1, 1 - (rankedAt - story.dataChangedAt) / 900_000),
          ) * 4
        : 0;
      return (
        story.score + (affinity === HIDDEN_RANK_PENALTY ? 0 : affinity) + fresh
      );
    }).map((story) => byStory.get(story)!);
  }, [visible, sortMode, sourceAffinity, rankedAt]);
  const spotlights = useMemo(
    () => discoverSpotlights(groups.map((g) => g.stories[0]!)),
    [groups],
  );
  const familyCounts = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const story of stories) {
      if (
        !showHiddenSources &&
        sourceAffinity[story.kind] === HIDDEN_RANK_PENALTY
      )
        continue;
      const family = discoverFamily(story.chartKind);
      const sources = counts.get(family) ?? new Set<string>();
      sources.add(story.kind);
      counts.set(family, sources);
    }
    return counts;
  }, [stories, sourceAffinity, showHiddenSources]);
  const chooseVariant = useCallback((groupId: string, storyId: string) => {
    setChosenVariants((previous) => ({ ...previous, [groupId]: storyId }));
  }, []);

  const dismiss = useCallback(() => {
    scrollPositionRef.current =
      scrollRef.current?.scrollTop ?? scrollPositionRef.current;
    saveDiscoverBrowseState({
      ...browseRef.current,
      scrollTop: scrollPositionRef.current,
    });
    try {
      window.localStorage.setItem(DISCOVER_SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  }, []);

  const openStory = useCallback(
    (story: DiscoverStory, opts?: { dest?: "chart" | "inspect" }) => {
      if (openingRef.current) return;
      openingRef.current = true;
      const dest = opts?.dest ?? "chart";
      retainDiscoverFeed(story.kind);
      setOpeningId(story.id);
      try {
        // Keep the evidence people selected stable while its feed reconnects.
        const { stats, sample } = story;
        const file = {
          path: story.streamPath,
          name: story.fileName,
          extension: "stream",
          row_count: sample.total_rows,
          size_bytes: 0,
          ...(story.capturedAt
            ? { capturedAt: new Date(story.capturedAt).toISOString() }
            : {}),
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
        const charts = stories
          .filter((candidate) => candidate.kind === story.kind)
          .map((candidate) => candidate.chart);
        const openChart = story.chart;
        activateDataset({
          file,
          stats,
          sample,
          charts: [openChart, ...charts.filter((c) => c.id !== openChart.id)],
          active: openChart,
        });
        useLoomStore.getState().setDiscoverReturnPath(file.path);
        // The hook ("M5.8 quake — …") is the headline people came for; keep it on the chart.
        if (story.hook && story.hook !== openChart.title) {
          useLoomStore
            .getState()
            .setChartTitleOverride(openChart.id, story.hook);
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
        if (
          typeof window !== "undefined" &&
          window.matchMedia("(max-width: 767px)").matches
        ) {
          const st = useLoomStore.getState();
          if (st.sidebarOpen) st.toggleSidebar();
          // Inspect needs the panel; chart-open still collapses chrome on phones.
          if (dest !== "inspect" && st.panelOpen) st.togglePanel();
        }
        dismiss();
        // Cached charts open immediately. Reconnect without holding the tap hostage to a poll.
        void (async () => {
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
        })();
      } catch (e) {
        setToast(`Couldn’t open: ${e instanceof Error ? e.message : e}`);
      } finally {
        openingRef.current = false;
        setOpeningId(null);
      }
    },
    [
      stories,
      setViewMode,
      setPanelTab,
      setSourceStatus,
      setDataRegionOpen,
      setDataSourcesExpanded,
      setToast,
      dismiss,
    ],
  );
  const inspectStory = useCallback(
    (story: DiscoverStory) => openStory(story, { dest: "inspect" }),
    [openStory],
  );

  const browseSources = () => {
    openDataSources();
    dismiss();
  };

  const clearFilters = () => {
    setCategoryFilter("all");
    setChartFilter("all");
    setSourceFilter("all");
    setSortMode("score");
    setSearch("");
    setSettingFilter("all");
  };

  const filtersActive =
    categoryFilter !== "all" ||
    chartFilter !== "all" ||
    sourceFilter !== "all" ||
    settingFilter !== "all" ||
    search.trim() !== "" ||
    sortMode !== "score";
  /** Nothing to clear: every story left comes from a source the user hid (sort order doesn't narrow). */
  const onlyHiddenSourcesLeft =
    categoryFilter === "all" &&
    chartFilter === "all" &&
    sourceFilter === "all" &&
    settingFilter === "all" &&
    search.trim() === "" &&
    !showHiddenSources &&
    hiddenSourceCount > 0;
  const closeRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const displayed = groups.slice(0, shownCount);
  const loadMore = useCallback(() => {
    setShownCount((count) =>
      Math.min(count + DISCOVER_PAGE_SIZE, groups.length),
    );
  }, [groups.length]);

  useEffect(() => {
    const target = moreRef.current;
    const root = scrollRef.current;
    if (!target || !root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        loadMore();
      },
      { root, rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [show, whatsNewOpen, shownCount, groups.length, loadMore]);

  // Measure the natural card height, keeping DOM order and existing cards stable
  // as more stories arrive. CSS columns would rebalance the whole feed on append.
  useLayoutEffect(() => {
    const gallery = galleryRef.current;
    if (
      layout !== "masonry" ||
      !gallery ||
      typeof ResizeObserver === "undefined"
    )
      return;
    const measure = (card: HTMLElement) => {
      const gridStyle = getComputedStyle(gallery);
      const row = parseFloat(gridStyle.gridAutoRows);
      const gap = parseFloat(gridStyle.rowGap);
      if (!row || !Number.isFinite(gap)) return;
      const span = Math.ceil(
        (card.getBoundingClientRect().height + gap) / (row + gap),
      );
      card.parentElement?.style.setProperty("--discover-span", String(span));
    };
    const cards = gallery.querySelectorAll<HTMLElement>(".discover-story");
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) measure(entry.target as HTMLElement);
    });
    gallery.dataset.masonry = "true";
    for (const card of cards) {
      measure(card);
      observer.observe(card);
    }
    return () => {
      observer.disconnect();
      delete gallery.dataset.masonry;
      for (const card of cards)
        card.parentElement?.style.removeProperty("--discover-span");
    };
  }, [layout, show, whatsNewOpen, shownCount, visible, chosenVariants]);

  useLayoutEffect(() => {
    const gallery = galleryRef.current;
    if (layout !== "flow" || !gallery || typeof ResizeObserver === "undefined")
      return;
    const measure = () => {
      const narrow = window.matchMedia("(max-width: 767px)").matches;
      const columns = discoverFlowColumnCount(
        getComputedStyle(gallery).gridTemplateColumns,
        narrow,
      );
      setFlowColumns((current) => (current === columns ? current : columns));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(gallery);
    return () => observer.disconnect();
  }, [layout, show, whatsNewOpen, shownCount, displayed.length]);

  const flowTiers = useMemo((): DiscoverFlowTier[] => {
    if (layout !== "flow") return [];
    const featured = displayed.map(
      (group) =>
        !filtersActive && spotlights.has(group.stories[0]!.id),
    );
    return discoverFlowTiers(displayed.length, flowColumns, featured);
  }, [layout, displayed, filtersActive, spotlights, flowColumns]);
  const tierSpan = (tier: DiscoverFlowTier | undefined) =>
    tier === "lead" ? (flowColumns >= 5 ? 3 : 2) : tier === "wide" ? 2 : 1;

  const filterKey = JSON.stringify([
    categoryFilter,
    chartFilter,
    sourceFilter,
    settingFilter,
    deferredSearch,
    sortMode,
  ]);
  const previousBrowseKey = useRef({ filterKey, layout });
  useEffect(() => {
    if (
      previousBrowseKey.current.filterKey !== filterKey ||
      previousBrowseKey.current.layout !== layout
    ) {
      if (previousBrowseKey.current.filterKey !== filterKey)
        setShownCount(DISCOVER_PAGE_SIZE);
      scrollPositionRef.current = 0;
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
    previousBrowseKey.current = { filterKey, layout };
  }, [filterKey, layout]);
  const hasStories = stories.length > 0;
  useLayoutEffect(() => {
    if (show && !whatsNewOpen && hasStories && scrollRef.current)
      scrollRef.current.scrollTop = scrollPositionRef.current;
  }, [show, whatsNewOpen, hasStories]);

  const refreshAttempts = useRef(new Map<DiscoverKind, number>());
  useEffect(() => {
    if (!hasStories) return;
    const check = async () => {
      if (document.visibilityState !== "visible" || scanAbortRef.current)
        return;
      const cached = getDiscoverStoryCache();
      if (!cached?.length) return;
      const viewport = scrollRef.current?.getBoundingClientRect();
      const candidates = Array.from(
        galleryRef.current?.querySelectorAll<HTMLElement>("li[data-source]") ??
          [],
      )
        .filter((item) => {
          const box = item.getBoundingClientRect();
          return (
            !!viewport &&
            box.bottom >= viewport.top &&
            box.top <= viewport.bottom
          );
        })
        .map((item) => item.dataset.source as DiscoverKind);
      const timestamp = Date.now();
      setNow(timestamp);
      const kinds = planDiscoverRefresh(
        cached,
        candidates,
        [...ALL_SOURCE_KINDS, "wiki"],
        refreshAttempts.current,
        timestamp,
      );
      if (!kinds.length) return;
      for (const kind of kinds) refreshAttempts.current.set(kind, timestamp);
      const abort = new AbortController();
      scanAbortRef.current = abort;
      setScanning(true);
      try {
        const updated = await refreshDiscoverStories(
          cached,
          kinds,
          abort.signal,
        );
        if (abort.signal.aborted || updated === cached) return;
        for (const kind of kinds) {
          const fresh = updated.find((story) => story.kind === kind);
          if (fresh && !discoverFreshness(fresh).due)
            refreshAttempts.current.delete(kind);
        }
        const dailySavedAt = getDiscoverCacheSavedAt();
        setDiscoverStoryCache(updated, dailySavedAt);
        if (dailySavedAt != null)
          void writeDiscoverDailyCache(updated, dailySavedAt);
        if (
          showRef.current &&
          changedDiscoverKinds(storiesRef.current, updated).size
        )
          setPendingStories(updated);
        else {
          setStories(
            showRef.current
              ? withDiscoverCheckTimes(storiesRef.current, updated)
              : updated.map(editorialDiscoverStory),
          );
          if (!showRef.current) setRankedAt(timestamp);
          setPendingStories(null);
        }
      } catch {
        /* Keep saved picks; due feeds retry after the backoff. */
      } finally {
        if (scanAbortRef.current === abort) {
          scanAbortRef.current = null;
          setScanning(false);
        }
      }
    };
    const first = window.setTimeout(
      () => {
        void check();
      },
      showRef.current ? 1000 : 5000,
    );
    const timer = window.setInterval(() => {
      void check();
    }, 60_000);
    const onVisibility = () => {
      void check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onVisibility);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onVisibility);
    };
  }, [show, whatsNewOpen, hasStories, shownCount, filterKey]);

  const acceptUpdates = () => {
    if (!pendingStories) return;
    setStories(pendingStories.map(editorialDiscoverStory));
    setRankedAt(Date.now());
    setSavedAt(getDiscoverCacheSavedAt());
    setScannedHint(
      `${new Set(pendingStories.map((story) => story.kind)).size} sources · ${pendingStories.length} chart ideas`,
    );
    setPendingStories(null);
  };
  const pendingSourceCount = useMemo(
    () =>
      pendingStories ? changedDiscoverKinds(stories, pendingStories).size : 0,
    [stories, pendingStories],
  );

  if (show !== true || whatsNewOpen) return null;
  const showFilters = stories.length > 0;
  const statusLine = filtersActive
    ? `${groups.length} matching stories`
    : `${groups.length} stories · ${chartKinds.length} chart types`;
  const statusExtra = scanning
    ? stories.length
      ? " · updating…"
      : ` · ${sources.length} sources found · scanning…`
    : /unavailable|Couldn’t/.test(scannedHint)
      ? ` · ${scannedHint.replace(/^.*?(\d+ unavailable)$/, "$1")}`
      : "";

  return (
    <Dialog
      open
      onClose={dismiss}
      labelledBy="onboarding-title"
      describedBy="onboarding-desc"
      initialFocusRef={closeRef}
      zIndex={200}
      stage
      panelClassName="discover-landing"
    >
      <header className="discover-header">
        <div className="discover-masthead">
          <div className="discover-masthead-top">
            <h2 id="onboarding-title">The world, in perspective.</h2>
            <div className="discover-header-actions">
              {showFilters && (
                <>
                  <div
                    className="discover-size-picker"
                    role="group"
                    aria-label="Card size"
                  >
                    {SIZE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-label={`${option.label} size`}
                        aria-pressed={size === option.value}
                        title={`${option.label}: ${option.description}`}
                        onClick={() => setSize(option.value)}
                      >
                        {option.short}
                      </button>
                    ))}
                  </div>
                  <div
                    className="discover-layout-picker"
                    role="group"
                    aria-label="Story layout"
                  >
                    {GALLERY_LAYOUTS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-label={`${option.label} view`}
                        aria-pressed={layout === option.value}
                        title={`${option.label}: ${option.description}`}
                        onClick={() => setLayout(option.value)}
                      >
                        <span aria-hidden>{option.icon}</span>
                        <span className="discover-layout-label">{option.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <span className="discover-header-chrome">
              <ThemeCycleButton />
              {showFilters && (
                <button
                  type="button"
                  className="discover-filter-toggle"
                  aria-controls="discover-filters"
                  aria-expanded={filtersOpen}
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  {filtersOpen
                    ? "Hide"
                    : filtersActive
                      ? "Filters ·"
                      : "Filters"}{" "}
                  <span aria-hidden>{filtersOpen ? "−" : "+"}</span>
                </button>
              )}
              {showFilters && (
                <button
                  type="button"
                  onClick={() => requestDiscoverScan({ refresh: true })}
                  disabled={scanning || !!openingId}
                  className="discover-icon-button"
                  data-spinning={scanning || undefined}
                  aria-label={scanning ? "Refreshing stories" : "Refresh"}
                  title={[
                    scanning
                      ? "Updating picks in background"
                      : "Refresh stories from all sources",
                    savedAt != null
                      ? `Daily scan ${new Date(savedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                >
                  <span aria-hidden>↻</span>
                </button>
              )}
              <button
                ref={closeRef}
                type="button"
                onClick={dismiss}
                className="discover-icon-button"
                aria-label="Close"
              >
                ×
              </button>
              </span>
            </div>
          </div>
          <p id="onboarding-desc" className="sr-only">
            Fresh perspectives on open data. Pick a chart. Make it yours.
          </p>
          {showFilters && (
            <div
              id="discover-filters"
              className="discover-sentence"
              data-expanded={filtersOpen}
            >
              <span className="discover-sentence-lead" aria-hidden>
                showing
              </span>
              <label>
                <span className="sr-only">Perspective</span>
                <select
                  value={chartFilter}
                  onChange={(event) => setChartFilter(event.target.value)}
                >
                  <option value="all">All perspectives</option>
                  <option value="maps">Maps &amp; globes</option>
                  <optgroup label="Ways to explore">
                    {Object.entries(DISCOVER_FAMILIES)
                      .filter(([key]) => familyCounts.has(key))
                      .map(([key, family]) => (
                        <option key={key} value={`family:${key}`}>
                          {family.label} ({familyCounts.get(key)!.size})
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Chart types">
                    {chartKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {discoverChartLabel(kind)}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <span aria-hidden>in</span>
              <label>
                <span className="sr-only">Topic</span>
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="all">All topics</option>
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
              <span aria-hidden>from</span>
              <label>
                <span className="sr-only">Source</span>
                <select
                  value={sourceFilter}
                  onChange={(event) => setSourceFilter(event.target.value)}
                >
                  <option value="all">All sources</option>
                  {sources.map((source) => (
                    <option key={source.kind} value={source.kind}>
                      {source.fileName}
                    </option>
                  ))}
                </select>
              </label>
              <span aria-hidden>with</span>
              <label>
                <span className="sr-only">Settings</span>
                <select
                  value={settingFilter}
                  onChange={(event) =>
                    setSettingFilter(event.target.value as DiscoverSettingFilter)
                  }
                >
                  {DISCOVER_SETTING_FILTERS.map((setting) => (
                    <option key={setting.value} value={setting.value}>
                      {setting.label}
                    </option>
                  ))}
                </select>
              </label>
              <span aria-hidden>by</span>
              <label>
                <span className="sr-only">Sort</span>
                <select
                  value={sortMode}
                  onChange={(event) =>
                    setSortMode(event.target.value as SortMode)
                  }
                >
                  {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                    <option key={mode} value={mode}>
                      {SORT_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </label>
              {filtersActive && (
                <button
                  type="button"
                  className="discover-clear-inline"
                  onClick={clearFilters}
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="discover-scroll"
        onScroll={(event) => {
          scrollPositionRef.current = event.currentTarget.scrollTop;
        }}
        aria-busy={scanning && !stories.length}
      >
        {!stories.length && phase === "scan" && (
          <div className="discover-loading" role="status">
            <p className="discover-kicker">Finding your next story</p>
            <h3>A world of data. A fresh perspective.</h3>
            <p>
              Checking {ALL_SOURCE_KINDS.length + 1} sources for chart ideas.
              Stories appear as each source responds.
            </p>
            <div className="discover-skeletons" aria-hidden="true">
              {[0, 1, 2].map((key) => (
                <div key={key} />
              ))}
            </div>
          </div>
        )}
        {!stories.length && phase === "error" && (
          <div className="discover-empty" role="status">
            <h3>The feeds are taking a moment.</h3>
            <p>
              Try again, or explore the sample datasets and open data catalogs.
            </p>
            <div className="flex gap-3 justify-center mt-4">
              <button
                type="button"
                onClick={() => requestDiscoverScan({ refresh: true })}
                className="loom-btn-primary px-4 min-h-11 rounded-lg"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={browseSources}
                className="loom-btn-ghost px-4 min-h-11"
              >
                Browse datasets
              </button>
            </div>
          </div>
        )}
        {showFilters && !visible.length && (
          <div className="discover-empty">
            {onlyHiddenSourcesLeft ? (
              <>
                <h3>All current stories come from sources you hid.</h3>
                <p>Show them for now, or browse other datasets.</p>
                <button
                  type="button"
                  onClick={() => setShowHiddenSources(true)}
                  className="loom-btn-primary mt-4 px-4 min-h-11 rounded-lg"
                >
                  Show hidden sources
                </button>
              </>
            ) : (
              <>
                <h3>No stories match yet.</h3>
                <p>
                  Try a broader search or clear a filter to see more perspectives.
                </p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="loom-btn-primary mt-4 px-4 min-h-11 rounded-lg"
                >
                  Clear filters
                </button>
              </>
            )}
          </div>
        )}
        {displayed.length > 0 && (
          <>
            <ul
              ref={galleryRef}
              id="onboarding-stories"
              className={`discover-grid discover-layout-${layout}`}
              data-size={size}
            >
              {displayed.map((group, index) => {
                const story =
                  group.stories.find(
                    (candidate) => candidate.id === chosenVariants[group.id],
                  ) ?? group.stories[0]!;
                const featured =
                  !filtersActive &&
                  spotlights.has(group.stories[0]!.id) &&
                  (layout === "flow" || layout === "masonry");
                const tier =
                  layout === "flow"
                    ? (flowTiers[index] ?? "standard")
                    : "standard";
                const span = layout === "flow" ? tierSpan(tier) : 1;
                return (
                  <li
                    key={group.id}
                    data-source={story.kind}
                    data-tier={tier}
                    className={
                      span >= 3
                        ? "discover-grid-lead"
                        : span === 2
                          ? featured
                            ? "discover-grid-lead"
                            : "discover-grid-wide"
                          : tier === "brief"
                            ? "discover-grid-brief"
                            : ""
                    }
                  >
                    <DiscoverStoryCard
                      story={story}
                      featured={featured}
                      tier={tier}
                      opening={openingId === story.id}
                      disabled={!!openingId}
                      onOpen={openStory}
                      onInspect={inspectStory}
                      now={now}
                      variants={group.stories}
                      groupId={group.id}
                      onChooseVariant={chooseVariant}
                    />
                  </li>
                );
              })}
            </ul>
            {groups.length > displayed.length && (
              <button
                ref={moreRef}
                type="button"
                className="discover-more"
                onClick={loadMore}
              >
                More chart ideas{" "}
                <span className="text-loom-muted">
                  ({groups.length - displayed.length} more)
                </span>{" "}
                ↓
              </button>
            )}
          </>
        )}
      </div>

      {showFilters && (
        <footer className="discover-footer">
          <div className="discover-footer-meta">
            <p role="status">
              {statusLine}
              {statusExtra}
            </p>
            {pendingStories && (
              <button
                type="button"
                onClick={acceptUpdates}
                className="discover-updates-ready"
              >
                New data ready · {pendingSourceCount}{" "}
                {pendingSourceCount === 1 ? "source" : "sources"} · Show
              </button>
            )}
            {(hiddenSourceCount > 0 || showHiddenSources) && (
              <button
                type="button"
                onClick={() => setShowHiddenSources((v) => !v)}
                aria-pressed={showHiddenSources}
                data-testid="discover-hidden-toggle"
              >
                {showHiddenSources
                  ? "Hide hidden"
                  : `${hiddenSourceCount} hidden · Show`}
              </button>
            )}
            <button
              type="button"
              onClick={browseSources}
              className="discover-header-link"
            >
              Your data <span aria-hidden>↗</span>
            </button>
            <details className="discover-method">
              <summary>How picks work</summary>
              <p>
                We consider every chart type against each source, check the
                observed data, then balance useful signals with a mix of topics,
                sources, and perspectives. Related views stay together. Your
                source preferences help shape the order.
              </p>
            </details>
          </div>
          <label className="discover-search">
            <span className="sr-only">
              Search stories, sources, charts, and settings
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a story, chart, or setting…"
            />
            {search ? (
              <button
                type="button"
                className="discover-search-clear"
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                ×
              </button>
            ) : null}
            <span aria-hidden className="discover-search-icon">
              ⌕
            </span>
          </label>
        </footer>
      )}
    </Dialog>
  );
}
