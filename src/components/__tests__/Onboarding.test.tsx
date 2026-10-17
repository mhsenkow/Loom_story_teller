// The landing must open exactly the previewed chart, data and settings.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Onboarding } from "../Onboarding";
import { TopBar } from "../TopBar";
import { useLoomStore } from "@/lib/store";
import {
  clearDiscoverStoryCache,
  requestDiscoverScan,
  scanDiscoverStories,
  refreshDiscoverStories,
  setDiscoverStoryCache,
  discoverSourceBrief,
  type DiscoverStory,
} from "@/lib/discoverStories";
import { emptySourcePreferences } from "@/lib/sourcePreferences";
import { sourceSnapshot, sourceStart, sourceStatus } from "@/lib/tauri";

vi.mock("../ChartCard", () => ({
  ChartCard: () => <div aria-hidden="true">Preview</div>,
}));
vi.mock("@/lib/persist", async (original) => ({
  ...(await original<typeof import("@/lib/persist")>()),
  getLastSession: () => null,
}));
vi.mock("@/lib/discoverStories", async (original) => ({
  ...(await original<typeof import("@/lib/discoverStories")>()),
  scanDiscoverStories: vi.fn(async () => []),
  refreshDiscoverStories: vi.fn(async (stories) => stories),
}));
vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof import("@/lib/tauri")>()),
  sourceStatus: vi.fn(async () => ({ running: true, buffer_rows: 2 })),
  sourceStart: vi.fn(async () => {}),
  sourceStop: vi.fn(async () => {}),
  sourceSnapshot: vi.fn(),
}));

const base: DiscoverStory = {
  capturedAt: Date.now(),
  id: "discover-meteo",
  kind: "meteo",
  streamPath: "stream://meteo",
  fileName: "Weather",
  hook: "Temperatures by city",
  blurb: "A comparison of city readings",
  category: "Weather",
  chartKind: "bar",
  score: 90,
  chart: {
    id: "weather-bar",
    kind: "bar",
    title: "Temperature",
    subtitle: "",
    spec: {},
    score: 90,
    xField: "city",
    yField: "temperature",
    colorField: "group",
    rowField: "group",
    topN: 5,
    yAggregate: "mean",
    barStackMode: "percent",
  },
  sample: {
    columns: ["city", "temperature", "group"],
    types: ["VARCHAR", "DOUBLE", "VARCHAR"],
    rows: [
      ["Detroit", 12, "A"],
      ["London", 15, "B"],
    ],
    total_rows: 2,
  },
  stats: [
    {
      name: "city",
      data_type: "VARCHAR",
      null_count: 0,
      distinct_count: 2,
      min_value: "Detroit",
      max_value: "London",
    },
    {
      name: "temperature",
      data_type: "DOUBLE",
      null_count: 0,
      distinct_count: 2,
      min_value: "12",
      max_value: "15",
    },
    {
      name: "group",
      data_type: "VARCHAR",
      null_count: 0,
      distinct_count: 2,
      min_value: "A",
      max_value: "B",
    },
  ],
};

function distinctStories(count: number): DiscoverStory[] {
  return Array.from({ length: count }, (_, i) => ({
    ...base,
    id: `story-${i}`,
    hook: `Story ${i}`,
    chart: { ...base.chart, id: `chart-${i}`, yField: `reading_${i}` },
    sample: {
      ...base.sample,
      columns: [...base.sample.columns, `reading_${i}`],
      types: [...base.sample.types, "DOUBLE"],
      rows: base.sample.rows.map((row) => [...row, i]),
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(scanDiscoverStories).mockResolvedValue([]);
  vi.mocked(refreshDiscoverStories).mockImplementation(
    async (stories) => stories,
  );
  window.localStorage.clear();
  window.sessionStorage.clear();
  useLoomStore.setState({
    whatsNewOpen: false,
    selectedFile: null,
    chartRecs: [],
    activeChart: null,
    discoverReturnPath: null,
  });
  setDiscoverStoryCache([base]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearDiscoverStoryCache();
});

describe("discovery landing journey", () => {
  it("opens the selected snapshot and preserves its settings while resetting prior edits", async () => {
    useLoomStore.setState({
      chartVisualOverrides: { pointSize: 20 },
      viewTimeWindow: "1h",
      viewTimeField: "old_time",
    });
    render(<Onboarding />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open chart: Temperatures by city",
      }),
    );
    await waitFor(() =>
      expect(useLoomStore.getState().activeChart).toEqual(base.chart),
    );
    const state = useLoomStore.getState();
    expect(state.sampleRows).toBe(base.sample);
    expect(state.barStackMode).toBe("percent");
    expect(state.viewTimeWindow).toBe("all");
    expect(state.viewTimeField).toBeNull();
    expect(state.chartTitleOverrides[base.chart.id]).toBe(base.hook);
    expect(state.chartVisualOverrides.pointSize).toBeUndefined();
    expect(state.viewMode).toBe("chart");
    expect(sourceSnapshot).not.toHaveBeenCalled();
  });

  it("lifts loved sources, hides a source from its menu, and shows it again from the chip", async () => {
    useLoomStore.getState().setSourcePrefs(emptySourcePreferences());
    const quake: DiscoverStory = {
      ...base,
      id: "discover-usgs",
      kind: "usgs",
      streamPath: "stream://usgs",
      fileName: "USGS Quakes",
      hook: "Quakes today",
      category: "Earth",
      chartKind: "geoPoints",
      score: 84,
    };
    setDiscoverStoryCache([base, quake]);
    render(<Onboarding />);
    await screen.findByRole("button", {
      name: "Open chart: Temperatures by city",
    });
    const order = () =>
      screen
        .getAllByRole("article")
        .map((a) => a.getAttribute("data-source-ref"));
    expect(order()).toEqual(["feed:meteo", "feed:usgs"]);
    act(() => useLoomStore.getState().reactToSource("feed:usgs", "love"));
    expect(order()).toEqual(["feed:usgs", "feed:meteo"]);
    expect(quake.score).toBe(84);

    fireEvent.click(
      screen.getByRole("button", {
        name: `More for ${discoverSourceBrief("meteo").label}`,
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide source" }));
    expect(
      screen.queryByRole("button", {
        name: "Open chart: Temperatures by city",
      }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 hidden · Show" }));
    expect(
      screen.getByRole("button", { name: "Open chart: Temperatures by city" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: `More for ${discoverSourceBrief("meteo").label}`,
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Unhide source" }));
    expect(
      useLoomStore.getState().sourcePrefs.entries["feed:meteo"],
    ).toBeUndefined();
    useLoomStore.getState().setSourcePrefs(emptySourcePreferences());
  });

  it("searches settings, recovers from no matches, and opens provenance separately", async () => {
    render(<Onboarding />);
    const search = await screen.findByRole("searchbox");
    fireEvent.change(search, { target: { value: "100% stacked" } });
    expect(
      screen.getByRole("button", { name: "Open chart: Temperatures by city" }),
    ).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "asteroids" } });
    expect(screen.getByText("No stories match yet.")).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Clear filters" })[0]!,
    );
    fireEvent.click(screen.getByRole("button", { name: /Source & data/ }));
    await waitFor(() => expect(useLoomStore.getState().panelTab).toBe("stats"));
    expect(useLoomStore.getState().panelOpen).toBe(true);
    expect(useLoomStore.getState().selectedFile?.sourceHome).toMatch(/^https:/);
  });

  it("mounts one page of previews and reveals more on request", async () => {
    setDiscoverStoryCache(distinctStories(30));
    render(<Onboarding />);
    await screen.findByRole("button", { name: "Open chart: Story 0" });
    expect(screen.getAllByRole("article")).toHaveLength(24);
    fireEvent.click(screen.getByRole("button", { name: /More chart ideas/ }));
    expect(screen.getAllByRole("article")).toHaveLength(30);
    expect(scanDiscoverStories).not.toHaveBeenCalled();
  });

  it("appends a page when the bottom approaches and preserves the visible stories", async () => {
    let onIntersect!: IntersectionObserverCallback;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: IntersectionObserverCallback,
          options: IntersectionObserverInit,
        ) {
          onIntersect = callback;
          expect(options.root).toHaveClass("discover-scroll");
          expect(options.rootMargin).toContain("240px");
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    setDiscoverStoryCache(distinctStories(60));
    render(<Onboarding />);
    const first = await screen.findByRole("button", {
      name: "Open chart: Story 0",
    });
    await waitFor(() => expect(observe).toHaveBeenCalled());
    act(() =>
      onIntersect(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    expect(screen.getAllByRole("article")).toHaveLength(48);
    expect(screen.getByRole("button", { name: "Open chart: Story 0" })).toBe(
      first,
    );
    expect(disconnect).toHaveBeenCalled();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Story 5" },
    });
    expect(screen.getAllByRole("article").length).toBeLessThanOrEqual(24);
    expect(scanDiscoverStories).not.toHaveBeenCalled();
  });

  it("switches layouts and card sizes without losing filters or the chart settings", async () => {
    render(<Onboarding />);
    const search = await screen.findByRole("searchbox");
    fireEvent.change(search, { target: { value: "stacked" } });
    for (const label of ["Tiles", "Masonry", "List", "Flow"]) {
      const button = screen.getByRole("button", { name: `${label} view` });
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-pressed", "true");
      expect(search).toHaveValue("stacked");
      expect(screen.getAllByRole("article")).toHaveLength(1);
    }
    for (const label of ["Compact", "Broadsheet", "Comfort"]) {
      const button = screen.getByRole("button", { name: `${label} size` });
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-pressed", "true");
      expect(document.querySelector(".discover-grid")).toHaveAttribute(
        "data-size",
        label === "Compact"
          ? "compact"
          : label === "Broadsheet"
            ? "broadsheet"
            : "comfort",
      );
    }
    fireEvent.click(
      screen.getByRole("button", { name: "Open chart: Temperatures by city" }),
    );
    expect(useLoomStore.getState().activeChart).toEqual(base.chart);
  });

  it("reopens today's picks without another scan", async () => {
    render(<Onboarding />);
    await screen.findByRole("searchbox");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent(window, new Event("loom-discover"));
    await screen.findByRole("searchbox");
    expect(scanDiscoverStories).not.toHaveBeenCalled();
  });

  it("keeps yesterday's picks searchable while a daily update is pending", async () => {
    setDiscoverStoryCache([base], Date.now() - 2 * 86_400_000);
    let finish!: (stories: DiscoverStory[]) => void;
    vi.mocked(scanDiscoverStories).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<Onboarding />);
    const search = await screen.findByRole("searchbox");
    await waitFor(() => expect(scanDiscoverStories).toHaveBeenCalledTimes(1));
    fireEvent.change(search, { target: { value: "stacked" } });
    expect(
      screen.getByRole("button", { name: "Open chart: Temperatures by city" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/updating…/),
    ).toBeInTheDocument();
    finish([
      {
        ...base,
        id: "new",
        hook: "Fresh story",
        sample: {
          ...base.sample,
          rows: [
            ["Detroit", 22, "A"],
            ["London", 25, "B"],
          ],
        },
      },
    ]);
    fireEvent.click(
      await screen.findByRole("button", { name: /New data ready/ }),
    );
    await screen.findByRole("button", { name: "Open chart: Fresh story" });
    expect(search).toHaveValue("stacked");
  });

  it("opens cached data before the feed reconnects", async () => {
    const status = {
      running: false,
      buffer_rows: 2,
      total_events: 2,
      events_per_sec: 0,
      started_at: null,
      uptime_secs: 0,
    };
    vi.mocked(sourceStatus).mockResolvedValueOnce(status);
    let reconnect!: () => void;
    vi.mocked(sourceStart).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reconnect = resolve;
        }),
    );
    render(<Onboarding />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open chart: Temperatures by city",
      }),
    );
    expect(useLoomStore.getState().activeChart).toEqual(base.chart);
    expect(screen.queryByRole("searchbox")).toBeNull();
    await waitFor(() => expect(reconnect).toBeTypeOf("function"));
    reconnect();
  });

  it("allows an explicit refresh even when today's saved picks are fresh", async () => {
    render(<Onboarding />);
    const search = await screen.findByRole("searchbox");
    fireEvent.change(search, { target: { value: "stacked" } });
    act(() => requestDiscoverScan({ refresh: true }));
    await waitFor(() => expect(scanDiscoverStories).toHaveBeenCalledTimes(1));
    expect(search).toHaveValue("stacked");
  });

  it("returns from a chart to the same layout, filters and scroll position", async () => {
    render(
      <>
        <Onboarding />
        <TopBar />
      </>,
    );
    const search = await screen.findByRole("searchbox");
    fireEvent.change(search, { target: { value: "stacked" } });
    fireEvent.click(screen.getByRole("button", { name: "Masonry view" }));
    const scroll = document.querySelector<HTMLElement>(".discover-scroll")!;
    scroll.scrollTop = 320;
    fireEvent.scroll(scroll);
    fireEvent.click(
      screen.getByRole("button", { name: "Open chart: Temperatures by city" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Back to stories" }),
    );
    expect(await screen.findByRole("searchbox")).toHaveValue("stacked");
    expect(
      screen.getByRole("button", { name: "Masonry view" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".discover-scroll")!.scrollTop).toBe(320);
    expect(scanDiscoverStories).not.toHaveBeenCalled();
  });

  it("groups related perspectives and opens the exact chosen recipe", async () => {
    const alternative = {
      ...base,
      id: "weather-line",
      hook: "City temperature comparison",
      chartKind: "lollipop",
      chart: {
        ...base.chart,
        id: "line",
        kind: "lollipop" as const,
        yScale: "symlog" as const,
      },
    };
    setDiscoverStoryCache([base, alternative]);
    render(<Onboarding />);
    const select = await screen.findByRole("combobox", {
      name: /Chart perspective/,
    });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("2↗")).toBeInTheDocument();
    fireEvent.change(select, { target: { value: alternative.id } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open chart: City temperature comparison",
      }),
    );
    expect(useLoomStore.getState().activeChart).toEqual(alternative.chart);
    expect(useLoomStore.getState().sampleRows).toBe(base.sample);
  });

  it("browses by analytical question, shows snapshot evidence, and opens that recipe", async () => {
    const relationship: DiscoverStory = {
      ...base,
      id: "relationship",
      hook: "Temperature and humidity",
      chartKind: "scatter",
      chart: {
        ...base.chart,
        id: "relationship-chart",
        kind: "scatter",
        xField: "temperature",
        yField: "humidity",
        colorField: null,
        rowField: null,
      },
      sample: {
        ...base.sample,
        columns: [...base.sample.columns, "humidity"],
        types: [...base.sample.types, "DOUBLE"],
        rows: base.sample.rows.map((r) => [...r, 50]),
      },
      quality: 90,
      insight: {
        label: "Clear relationship",
        detail: "A measured relationship across 40 paired observations.",
        strength: 0.8,
      },
    };
    setDiscoverStoryCache([base, relationship]);
    render(<Onboarding />);
    const perspective = await screen.findByRole("combobox", {
      name: "Perspective",
    });
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText(relationship.insight!.detail)).toBeInTheDocument();
    fireEvent.change(perspective, { target: { value: "family:relationship" } });
    expect(perspective).toHaveValue("family:relationship");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.change(perspective, { target: { value: "all" } });
    expect(screen.getAllByRole("article")).toHaveLength(2);
    fireEvent.change(perspective, { target: { value: "family:relationship" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open chart: Temperature and humidity",
      }),
    );
    expect(useLoomStore.getState().activeChart).toEqual(relationship.chart);
  });

  it("refreshes a due visible feed without moving the story until updates are accepted", async () => {
    setDiscoverStoryCache([{ ...base, capturedAt: Date.now() - 3_600_000 }]);
    const fresh = {
      ...base,
      hook: "Fresh temperatures",
      capturedAt: Date.now(),
      sample: {
        ...base.sample,
        rows: [
          ["Detroit", 22, "A"],
          ["London", 25, "B"],
        ],
      },
    };
    vi.mocked(refreshDiscoverStories).mockResolvedValueOnce([fresh]);
    render(<Onboarding />);
    await screen.findByRole("button", {
      name: "Open chart: Temperatures by city",
    });
    const updates = await screen.findByRole(
      "button",
      { name: /New data ready/ },
      { timeout: 2000 },
    );
    expect(refreshDiscoverStories).toHaveBeenCalledWith(
      expect.any(Array),
      expect.arrayContaining(["meteo"]),
      expect.any(AbortSignal),
    );
    expect(
      screen.getByRole("button", { name: "Open chart: Temperatures by city" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open chart: Fresh temperatures" }),
    ).toBeNull();
    fireEvent.click(updates);
    expect(
      screen.getByRole("button", { name: "Open chart: Fresh temperatures" }),
    ).toBeInTheDocument();
    expect(scanDiscoverStories).not.toHaveBeenCalled();
  });

  it("quietly checks unchanged data without interrupting browsing", async () => {
    setDiscoverStoryCache([{ ...base, capturedAt: Date.now() - 3_600_000 }]);
    vi.mocked(refreshDiscoverStories).mockResolvedValueOnce([
      { ...base, capturedAt: Date.now() },
    ]);
    render(<Onboarding />);
    await screen.findByRole("searchbox");
    await waitFor(() => expect(refreshDiscoverStories).toHaveBeenCalled(), {
      timeout: 2000,
    });
    await screen.findByText("Checked just now");
    expect(screen.queryByRole("button", { name: /New data ready/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open chart: Temperatures by city" }),
    ).toBeInTheDocument();
  });

  it("keeps discovery up to date after dismissal without replacing the opened chart", async () => {
    setDiscoverStoryCache([{ ...base, capturedAt: Date.now() - 3_600_000 }]);
    render(<Onboarding />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open chart: Temperatures by city",
      }),
    );
    const active = useLoomStore.getState().activeChart;
    vi.mocked(refreshDiscoverStories).mockResolvedValueOnce([
      {
        ...base,
        hook: "New readings",
        capturedAt: Date.now(),
        sample: { ...base.sample, rows: [["Detroit", 22, "A"]] },
      },
    ]);
    fireEvent(window, new Event("online"));
    await waitFor(() => expect(refreshDiscoverStories).toHaveBeenCalled());
    expect(useLoomStore.getState().activeChart).toBe(active);
    fireEvent(window, new Event("loom-discover"));
    await screen.findByRole("button", { name: "Open chart: New readings" });
  });

  it("opens the exact emoji perspective with its field-bound mapping", async () => {
    const emoji: DiscoverStory = {
      ...base,
      id: "emoji",
      chartKind: "scatter",
      hook: "Weather symbols",
      chart: {
        ...base.chart,
        id: "emoji-chart",
        kind: "scatter",
        xField: "temperature",
        yField: "temperature",
        emojiField: "group",
        emojiMap: { field: "group", values: { A: "☀️", B: "🌧️" } },
        rowField: null,
      },
    };
    setDiscoverStoryCache([emoji]);
    render(<Onboarding />);
    await screen.findByRole("searchbox");
    fireEvent.change(screen.getByRole("combobox", { name: "Settings" }), {
      target: { value: "symbols" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open chart: Weather symbols" }),
    );
    expect(useLoomStore.getState().activeChart?.emojiMap).toEqual(
      emoji.chart.emojiMap,
    );
    expect(useLoomStore.getState().sampleRows).toBe(base.sample);
  });
});
