// =================================================================
// Loom — Discover stories (intro scan)
// =================================================================
// Probes live feeds for “interesting right now” hooks, then hands
// chart-ready recommendations back to the onboarding modal.
// =================================================================

import { recommendSourceStory } from "./recommendations";
import type { ChartRecommendation } from "./recommendations";
import type { ColumnInfo, QueryResult } from "./store";
import {
  sourceSnapshot,
  sourceStart,
  sourceStatus,
  type SourceKind,
} from "./tauri";

export interface DiscoverStory {
  id: string;
  kind: SourceKind;
  streamPath: string;
  fileName: string;
  /** Short hook — what is interesting right now */
  hook: string;
  /** Why / what chart you’ll see */
  blurb: string;
  chartKind: string;
  chart: ChartRecommendation;
  score: number;
  stats: ColumnInfo[];
  sample: QueryResult;
}

/** localStorage flag — after first dismiss, intro scan stays quiet until cleared. */
export const DISCOVER_SEEN_KEY = "loom-discover-v1";

/** Clear the dismiss flag and ask Onboarding to scan again. */
export function requestDiscoverScan(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DISCOVER_SEEN_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("loom-discover"));
}

const SCAN_KINDS: SourceKind[] = ["usgs", "hn", "crypto", "iss", "nws", "meteo"];

function colIndex(sample: QueryResult, name: string): number {
  return sample.columns.indexOf(name);
}

function numAt(sample: QueryResult, row: number, col: string): number {
  const i = colIndex(sample, col);
  if (i < 0) return NaN;
  const v = sample.rows[row]?.[i];
  return typeof v === "number" ? v : Number(v);
}

function strAt(sample: QueryResult, row: number, col: string): string {
  const i = colIndex(sample, col);
  if (i < 0) return "";
  return String(sample.rows[row]?.[i] ?? "");
}

function hookFor(
  kind: SourceKind,
  sample: QueryResult,
  chart: ChartRecommendation,
): { hook: string; blurb: string; score: number } {
  const n = sample.total_rows || sample.rows.length;

  if (kind === "usgs") {
    let maxMag = 0;
    let place = "";
    for (let r = 0; r < sample.rows.length; r++) {
      const m = numAt(sample, r, "magnitude");
      if (m > maxMag) {
        maxMag = m;
        place = strAt(sample, r, "place");
      }
    }
    if (maxMag >= 5) {
      return {
        hook: `M${maxMag.toFixed(1)} quake${place ? ` — ${place}` : ""}`,
        blurb: chart.subtitle || "Map it and see the cluster.",
        score: 98,
      };
    }
    return {
      hook: `${n} earthquakes in the past hour`,
      blurb: chart.title,
      score: 80 + Math.min(15, n),
    };
  }

  if (kind === "hn") {
    let best = 0;
    let title = "";
    for (let r = 0; r < sample.rows.length; r++) {
      const p = numAt(sample, r, "points");
      if (p > best) {
        best = p;
        title = strAt(sample, r, "title");
      }
    }
    const short = title.length > 52 ? `${title.slice(0, 50)}…` : title;
    return {
      hook: short ? `${best} pts · ${short}` : `${n} stories on HN`,
      blurb: chart.subtitle || "Scores vs discussion.",
      score: 70 + Math.min(25, best / 20),
    };
  }

  if (kind === "crypto") {
    let bestAbs = 0;
    let sym = "";
    let chg = 0;
    for (let r = 0; r < sample.rows.length; r++) {
      const c = numAt(sample, r, "change_24h_pct");
      if (Math.abs(c) > bestAbs) {
        bestAbs = Math.abs(c);
        chg = c;
        sym = strAt(sample, r, "symbol");
      }
    }
    const sign = chg >= 0 ? "+" : "";
    return {
      hook: sym ? `${sym} ${sign}${chg.toFixed(1)}% today` : `${n} crypto markets`,
      blurb: chart.title,
      score: 75 + Math.min(20, bestAbs),
    };
  }

  if (kind === "iss") {
    const lat = numAt(sample, 0, "latitude");
    const lon = numAt(sample, 0, "longitude");
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      return {
        hook: `ISS over ${lat.toFixed(1)}°, ${lon.toFixed(1)}°`,
        blurb: "Start an orbital trail scatter.",
        score: 88,
      };
    }
    return { hook: "Track the ISS live", blurb: chart.title, score: 85 };
  }

  if (kind === "nws") {
    let severe = 0;
    for (let r = 0; r < sample.rows.length; r++) {
      const sev = strAt(sample, r, "severity").toLowerCase();
      if (sev.includes("extreme") || sev.includes("severe")) severe += 1;
    }
    return {
      hook: severe > 0 ? `${severe} severe US weather alerts` : `${n} active NWS alerts`,
      blurb: chart.subtitle || chart.title,
      score: severe > 0 ? 92 : 70 + Math.min(15, n / 5),
    };
  }

  if (kind === "meteo") {
    return {
      hook: "Five-city weather snapshot",
      blurb: chart.subtitle || chart.title,
      score: 72,
    };
  }

  return { hook: chart.title, blurb: chart.subtitle, score: chart.score };
}

const FILE_NAMES: Record<SourceKind, string> = {
  usgs: "USGS Quakes",
  meteo: "World Weather",
  nws: "NWS Alerts",
  world_bank: "World Bank",
  iss: "ISS Track",
  hn: "HN Front Page",
  crypto: "Crypto Markets",
};

/** Warm a source and return a chart-ready discover story, or null if empty/failed. */
async function probeKind(kind: SourceKind): Promise<DiscoverStory | null> {
  try {
    const status = await sourceStatus(kind);
    if (!status.running) {
      await sourceStart(kind);
    }
    // Brief settle for first poll inserts
    await new Promise((r) => setTimeout(r, kind === "iss" ? 400 : 200));
    const snap = await sourceSnapshot(kind, 300);
    if (!snap.sample.rows.length) return null;
    const story = recommendSourceStory(kind, snap.stats, snap.sample);
    const chart = story.charts[0];
    if (!chart) return null;
    const { hook, blurb, score } = hookFor(kind, snap.sample, chart);
    return {
      id: `discover-${kind}`,
      kind,
      streamPath: `stream://${kind}`,
      fileName: FILE_NAMES[kind] ?? kind,
      hook,
      blurb,
      chartKind: chart.kind,
      chart,
      score,
      stats: snap.stats,
      sample: snap.sample,
    };
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch(() => {
        clearTimeout(t);
        resolve(null);
      });
  });
}

/** Scan several live feeds in parallel; return top stories by score. */
export async function scanDiscoverStories(limit = 5): Promise<DiscoverStory[]> {
  const results = await Promise.all(
    SCAN_KINDS.map((k) => withTimeout(probeKind(k), 7_000)),
  );
  return results
    .filter((x): x is DiscoverStory => x != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
