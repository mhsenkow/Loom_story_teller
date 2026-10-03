// =================================================================
// Loom — Changelog ("What's new")
// =================================================================
// Newest release first. Shipping something user-visible? Add an entry
// at the top with a new `id` — returning users see the What's new modal
// once (before the discover scan), then it lives behind the quiet
// "What's new" links in the sidebar header, Settings, and Help.
// =================================================================

export interface ChangelogItem {
  title: string;
  detail: string;
}

export interface ChangelogRelease {
  /** Unique, sortable — bump for every release (date, plus a suffix if two ship the same day). */
  id: string;
  /** ISO date shown to people. */
  date: string;
  title: string;
  /** One line under the title. */
  summary?: string;
  items: ChangelogItem[];
}

export const CHANGELOG: ChangelogRelease[] = [
  {
    id: "2026-10-02e",
    date: "2026-10-02",
    title: "Thousands more datasets, and charts that switch cleanly",
    summary: "Two new catalogs, eight new live feeds, four new packs — and every chart type checked against real data.",
    items: [
      {
        title: "City & state open data",
        detail:
          "Search NYC, Chicago, San Francisco, Seattle, Austin, state portals, and the CDC from Data & sources — 311 calls, trees, crashes, inspections, permits — and chart any table in a tap.",
      },
      {
        title: "TidyTuesday",
        detail:
          "Browse every weekly community dataset since 2018 — over 400 weeks of ready-to-chart data, from Olympics to coffee ratings. Filter by topic and tap a file to chart it.",
      },
      {
        title: "Eight new live feeds",
        detail:
          "Every Boston bus and train moving now, the aurora forecast, UN disaster alerts worldwide, asteroids passing Earth, ocean buoys, Bitcoin blocks, Steam's most-played games, and the US national debt since 1993.",
      },
      {
        title: "New packs",
        detail: "Gapminder's wealth-and-health data, every M7+ earthquake since 1900, every Nobel laureate, and FiveThirtyEight's candy ranking.",
      },
      {
        title: "Switching chart types just works",
        detail:
          "Change a scatter into a bar, pie, funnel, or box and Loom picks a sensible category instead of turning every number into its own group. Lines use dates when there are any, and long daily series roll up to weeks or months.",
      },
      {
        title: "Reference lines, trails, and marginals",
        detail:
          "“Add reference line”, “Connect points”, and “Marginal distributions” now draw on the chart — reference lines land on the value axis even when bars run sideways.",
      },
      {
        title: "Sharper 3D and maps",
        detail: "3D scatter and firefly fill the frame instead of a tiny speck, and maps no longer color countries from unrelated numbers.",
      },
      {
        title: "Steadier panels",
        detail:
          "“What’s interesting right now” keeps one screen-fitted size while you filter, instead of shrinking and jumping. On phones the detail sheet no longer resizes between tabs, and rows that scroll sideways fade at the edge so you can tell there’s more.",
      },
    ],
  },
  {
    id: "2026-10-02d",
    date: "2026-10-02",
    title: "More live data, and every feed fixed up",
    summary: "Six new feeds, nine new open datasets, and a tune-up of every connection in Data & sources.",
    items: [
      {
        title: "Six new live feeds",
        detail:
          "NASA's tracked wildfires, storms, and volcanoes on a map; every Citi Bike dock in New York right now; NOAA space weather (when to expect auroras); Britain's grid carbon every half hour; yesterday's most-read Wikipedia articles; and global temperature since 1880, with a climate spiral.",
      },
      {
        title: "Feeds that work again",
        detail:
          "Weather alerts, crypto prices, live aircraft, SpaceX history, and world countries had stopped loading — they're back, with backups when an upstream service is busy. Earthquakes now show the past day instead of the past hour.",
      },
      {
        title: "Richer data in every feed",
        detail:
          "Weather and air quality cover 12 cities, exchange rates show 90 days of history, and World Bank data now charts GDP per person against life expectancy (CO₂ per person is back too). Opening a feed loads all of it, not just the newest 500 rows.",
      },
      {
        title: "Whole datasets, not the first page",
        detail:
          "Curated packs and your own CSVs load completely (up to about 1.5 million cells), and charts total every row — no more sums from a small preview. New packs: CO₂ per person, life expectancy, GDP, renewables, long-run population, the Keeling curve, every confirmed exoplanet, 35,000 power plants, and US cities.",
      },
      {
        title: "Easier to browse",
        detail: "Live feeds are grouped — Earth & climate, Cities & transport, Space, Web & markets, Countries & history — and each card links to where its data comes from.",
      },
    ],
  },
  {
    id: "2026-10-02c",
    date: "2026-10-02",
    title: "Every chart, easier to read",
    summary: "A pass over every chart type so the numbers, labels, and colors say what they mean.",
    items: [
      {
        title: "Links that reopen your chart",
        detail:
          "Copy chart link (in Share) or the address bar now reopens the exact chart — same data, chart type, fields, headline, colors, and look. Works for live feeds, demo data, and open-data files; for your own files, the other person opens the same file and the chart appears.",
      },
      {
        title: "Round numbers on every axis",
        detail:
          "Axes tick at 0, 20, 40 — not 3.7k and 7.4k — and gridlines sit right on those values. Dates read as Jan, Feb, Mar instead of 0.2, 0.4.",
      },
      {
        title: "Labels you can actually read",
        detail:
          "Category names are no longer cut off after nine letters. Bar charts with long names turn sideways automatically, and crowded axes angle or thin their labels instead of overlapping.",
      },
      {
        title: "Tooltips show the number",
        detail:
          "Hover a bar, slice, bin, or cell to see its total, average, or share — not just one row that happened to be underneath.",
      },
      {
        title: "Color only when it means something",
        detail:
          "Single-series charts use one color. When color encodes a field, a legend appears on its own, tucked into the emptiest corner.",
      },
      {
        title: "Sharper chart types",
        detail:
          "Box plots mark outliers, pies roll small slices into Other with percentages, treemaps use squarer tiles, waterfalls end with a total, and heatmaps and hexbins come with a color key that works in light and dark themes.",
      },
    ],
  },
  {
    id: "2026-10-02b",
    date: "2026-10-02",
    title: "Deeper dives",
    summary: "Dive picks up the rest of Scuba’s toolkit — and a few things Scuba never had.",
    items: [
      {
        title: "Make your own columns",
        detail:
          "Add a derived column like hour(ts), lower(country), or CASE WHEN delta > 0 THEN 'add' ELSE 'cut' END, then filter and group by it like any other column. It shows up in the SQL too.",
      },
      {
        title: "Drag to zoom, Back to undo",
        detail:
          "Drag across the time series to zoom in; double-click to zoom out. Or type any window, like “-3 hours” or “yesterday”. Every change is a step in your browser history, so Back takes you to your previous question.",
      },
      {
        title: "Smarter filters",
        detail:
          "Pick several values at once from suggestions drawn from your data, or match with contains, LIKE, or a regex.",
      },
      {
        title: "More ways to measure",
        detail:
          "p5 through p99.9, first and last seen on time columns, a hits column with each group’s share, and lowest-first ranking. With several metrics, each gets its own chart panel.",
      },
      {
        title: "Easier to read",
        detail:
          "Hover a crowded chart to highlight the nearest line, click to pin the readout, and choose how empty buckets look. Axis labels line up with real dates, and you can pick which columns Samples shows and sort by any of them.",
      },
    ],
  },
  {
    id: "2026-10-02",
    date: "2026-10-02",
    title: "Made for your phone",
    summary: "Find something fun, chart it, and share it — all from your phone.",
    items: [
      {
        title: "One-tap Share",
        detail:
          "Share renders your chart as a Square, Portrait, Story, or Wide image with feed-sized text, then opens your phone’s share sheet. Get link makes a page that previews nicely in iMessage, Slack, and X.",
      },
      {
        title: "Start with something interesting",
        detail:
          "Every empty screen now leads with “What’s interesting right now” — live quakes, flights, Hacker News, crypto, weather — and opens the best one as a chart, headline included.",
      },
      {
        title: "Edit while you watch",
        detail: "On phones, Edit opens a half-height sheet so the chart stays visible and updates as you change it.",
      },
      {
        title: "Charts that fit tall screens",
        detail:
          "Bar charts turn sideways on tall screens so long labels stay readable, and world maps now fill the width.",
      },
      {
        title: "Touch that works",
        detail:
          "Tap for tooltips, drag a finger to scrub across a chart, spin 3D charts, and long-press a table column to profile it. Text fields no longer zoom the page.",
      },
    ],
  },
  {
    id: "2026-09-30",
    date: "2026-09-30",
    title: "Dive and the data cube",
    items: [
      {
        title: "Dive",
        detail:
          "Slice and dice event data: pick a time window, filter, group by, compare against last week, and click any value to drill in. The whole query lives in the link.",
      },
      {
        title: "Data cube 3D",
        detail:
          "Rows × columns × depth as voxels. Swap axes, slice a layer, and dock a linked pivot table.",
      },
      {
        title: "Searchable chart picker",
        detail: "Type to find any of the 50+ chart types, with a “Fits this table” filter.",
      },
    ],
  },
  {
    id: "2026-09-26",
    date: "2026-09-26",
    title: "Maps and 3D scenes",
    items: [
      {
        title: "Geography charts",
        detail: "Choropleths, point and bubble maps, hex maps, globes, and arc maps.",
      },
      {
        title: "GPU scenes",
        detail: "Orbit 3D, firefly, trail ribbons, quake terrain, and loom weave.",
      },
      {
        title: "Richer discover",
        detail: "“What’s interesting right now” scans more live feeds and suggests more kinds of charts.",
      },
    ],
  },
  {
    id: "2026-09-25",
    date: "2026-09-25",
    title: "Swipe for chart ideas",
    items: [
      {
        title: "Deep scan swipe deck",
        detail: "Swipe through a deck of chart ideas — Keep or Skip — and Loom learns what you like, on your device.",
      },
      {
        title: "Looks and social framing",
        detail: "Visual presets (Tufte, Bauhaus, Newspaper…) and aspect presets for social posts.",
      },
    ],
  },
];

/** localStorage: id of the newest release this browser has seen. */
export const WHATS_NEW_SEEN_KEY = "loom-whats-new-seen";

export function latestRelease(): ChangelogRelease | undefined {
  return CHANGELOG[0];
}

/** Releases newer than `seenId` (all of them when nothing was seen). */
export function unseenReleases(seenId: string | null): ChangelogRelease[] {
  if (!seenId) return CHANGELOG;
  return CHANGELOG.filter((r) => r.id > seenId);
}

/** Ask the What's new modal to open (from Settings, Help, the sidebar…). */
export function requestWhatsNew(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("loom-whats-new"));
}
