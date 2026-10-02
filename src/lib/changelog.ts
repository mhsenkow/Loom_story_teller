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
