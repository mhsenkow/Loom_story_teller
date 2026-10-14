// =================================================================
// Loom — Discover stories (intro scan)
// =================================================================
// Probes live feeds for “interesting right now” hooks, then hands
// chart-ready recommendations back to the onboarding modal.
// Progressive: callers can stream stories as each source finishes.
// =================================================================

import { recommendSourceStory, recommendStreamStory } from "./recommendations";
import type { ChartRecommendation } from "./recommendations";
import type { ColumnInfo, QueryResult } from "./store";
import { applyChartTimeWindow } from "./chartTime";
import {
  ALL_SOURCE_KINDS,
  isMobileOs,
  sourceSnapshot,
  sourceStart,
  sourceStop,
  sourceStatus,
  streamSnapshot,
  streamStart,
  streamStop,
  streamStatus,
  type SourceKind,
} from "./tauri";
import { SOURCE_DEFS } from "./sourceRegistry";
import { stormLevel } from "./webStreams";

export type DiscoverKind = SourceKind | "wiki";

export interface DiscoverStory {
  id: string;
  kind: DiscoverKind;
  streamPath: string;
  fileName: string;
  /** Short hook — what is interesting right now */
  hook: string;
  /** Why / what chart you’ll see */
  blurb: string;
  /** Soft category chip for the modal */
  category: string;
  chartKind: string;
  chart: ChartRecommendation;
  score: number;
  stats: ColumnInfo[];
  sample: QueryResult;
}

/** localStorage flag — after first dismiss, intro scan stays quiet until cleared. */
export const DISCOVER_SEEN_KEY = "loom-discover-v1";

/**
 * Set when the user taps “What’s interesting” so a just-mounted Onboarding
 * still opens even if it missed the `loom-discover` event (common on iPad
 * when the modal wasn’t mounted yet) and even when a last session would
 * otherwise suppress cold-start onboarding.
 */
let pendingDiscoverForce = false;

/** Clear the dismiss flag and ask Onboarding to scan again. */
export function requestDiscoverScan(): void {
  if (typeof window === "undefined") return;
  pendingDiscoverForce = true;
  try {
    window.localStorage.removeItem(DISCOVER_SEEN_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("loom-discover"));
}

/** True once per explicit Discover request (button / menu). */
export function consumeDiscoverForceRequest(): boolean {
  if (!pendingDiscoverForce) return false;
  pendingDiscoverForce = false;
  return true;
}

/** Test helper — reset the pending force flag. */
export function clearDiscoverForceRequest(): void {
  pendingDiscoverForce = false;
}

/** All poll sources (same set as Sidebar live cards). */
const SCAN_KINDS: readonly SourceKind[] = ALL_SOURCE_KINDS;

/** Cap on stories shown in the discover grid (primary + alts across every feed). */
export const DISCOVER_STORY_LIMIT = 10_000;

/** iPad / iPhone / Android — fewer cards so the grid stays snappy. */
export const DISCOVER_STORY_LIMIT_MOBILE = 120;

/** How many chart variants to keep per live source (kinds + encodings). */
export const VARIANTS_PER_SOURCE = 40;

/** Fewer encodings per feed on mobile — probe + thumbs cost less. */
export const VARIANTS_PER_SOURCE_MOBILE = 6;

/** Story cap for the current device (120 on iPad/phone, full set on desktop). */
export function discoverStoryLimit(): number {
  return isMobileOs() ? DISCOVER_STORY_LIMIT_MOBILE : DISCOVER_STORY_LIMIT;
}

function variantsPerSource(): number {
  return isMobileOs() ? VARIANTS_PER_SOURCE_MOBILE : VARIANTS_PER_SOURCE;
}

/** Session cache so closing What’s interesting and reopening stays instant. */
let discoverStoryCache: DiscoverStory[] | null = null;

/** Sources discover started for probing — stopped after scan unless retained. */
const discoverStartedSources = new Set<SourceKind>();
let discoverStartedWiki = false;

/** Keep a probed feed running after the user picks it from discover. */
export function retainDiscoverFeed(kind: DiscoverKind): void {
  if (kind === "wiki") discoverStartedWiki = false;
  else discoverStartedSources.delete(kind);
}

export async function stopDiscoverProbes(): Promise<void> {
  const kinds = [...discoverStartedSources];
  discoverStartedSources.clear();
  await Promise.all(kinds.map((k) => sourceStop(k)));
  if (discoverStartedWiki) {
    discoverStartedWiki = false;
    await streamStop();
  }
}

export function getDiscoverStoryCache(): DiscoverStory[] | null {
  return discoverStoryCache;
}

export function setDiscoverStoryCache(stories: DiscoverStory[]): void {
  discoverStoryCache = stories.length ? stories : null;
}

export function clearDiscoverStoryCache(): void {
  discoverStoryCache = null;
}

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

/** Max finite value in a column (ignores null/NaN so hooks never say “peak FRP NaN”). */
function maxFiniteAt(
  sample: QueryResult,
  col: string,
): { value: number; row: number } | null {
  let best = -Infinity;
  let row = -1;
  for (let r = 0; r < sample.rows.length; r++) {
    const v = numAt(sample, r, col);
    if (Number.isFinite(v) && v > best) {
      best = v;
      row = r;
    }
  }
  return row < 0 ? null : { value: best, row };
}

/** Sample for a chart’s Time window — hooks should match what the chart will show. */
function sampleForChart(chart: ChartRecommendation, sample: QueryResult): QueryResult {
  if (!chart.timeWindow || chart.timeWindow === "all" || !chart.timeWindowField) return sample;
  const slice = applyChartTimeWindow(sample.rows, sample.columns, chart);
  if (!slice.filtered || slice.kept === 0) return sample;
  return { ...sample, rows: slice.rows };
}

/** Alt charts demote hard so one hot feed doesn’t flood the top of Discover. */
function altStoryScore(primaryScore: number, altIdx: number): number {
  return Math.max(18, Math.round(primaryScore * 0.52) - 8 * altIdx);
}

function chartVariantKey(chart: ChartRecommendation): string {
  return [
    chart.kind,
    chart.xField,
    chart.yField ?? "",
    chart.colorField ?? "",
    chart.sizeField ?? "",
    chart.rowField ?? "",
    chart.topN ?? "",
    chart.y2Field ?? "",
    chart.comparePrevious ? "1" : "",
    chart.barStackMode ?? "",
    chart.rollingWindow ?? "",
    chart.yScale ?? "",
    chart.seriesNormalize ?? "",
    chart.residualOverlay ? "1" : "",
    chart.anomalyHighlight ? "1" : "",
    chart.bumpMode ?? "",
    chart.timeWindowField ?? "",
    chart.timeWindow ?? "",
  ].join("|");
}

/** Drop time-windowed charts that keep zero rows in the live sample. */
function chartHasRowsInWindow(chart: ChartRecommendation, sample: QueryResult): boolean {
  if (!chart.timeWindow || chart.timeWindow === "all" || !chart.timeWindowField) return true;
  const slice = applyChartTimeWindow(sample.rows, sample.columns, chart);
  return !slice.filtered || slice.kept > 0;
}

function pickPreferredChart(
  charts: ChartRecommendation[],
  preferKind?: string,
): ChartRecommendation | null {
  if (!charts.length) return null;
  if (preferKind) {
    const hit = charts.find((c) => c.kind === preferKind);
    if (hit) return hit;
  }
  return charts[0]!;
}

import { discoverHookFor } from "./discoverHooks";
export { discoverHookFor } from "./discoverHooks";


const FILE_NAMES: Record<DiscoverKind, string> = {
  ...(Object.fromEntries(SOURCE_DEFS.map((d) => [d.kind, d.fileName])) as Record<SourceKind, string>),
  wiki: "Wikipedia Live",
};

type ProbeStatus = "ok" | "empty" | "error" | "timeout";

/** Wait until a feed has rows (or give up). Cold starts often need >220ms. */
async function waitForSourceRows(
  kind: SourceKind,
  maxWaitMs = 6_000,
): Promise<Awaited<ReturnType<typeof sourceSnapshot>> | null> {
  const started = Date.now();
  let delay = kind === "iss" || kind === "opensky" || kind === "countries" ? 400 : 250;
  while (Date.now() - started < maxWaitMs) {
    const snap = await sourceSnapshot(kind, 400);
    if (snap.sample.rows.length) return snap;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(900, Math.round(delay * 1.35));
  }
  const last = await sourceSnapshot(kind, 400);
  return last.sample.rows.length ? last : null;
}

async function probeKindWithStatus(
  kind: SourceKind,
): Promise<{ stories: DiscoverStory[]; status: ProbeStatus }> {
  try {
    const status = await sourceStatus(kind);
    if (!status.running) {
      await sourceStart(kind);
      discoverStartedSources.add(kind);
    }
    const snap = await waitForSourceRows(kind);
    if (!snap) return { stories: [], status: "empty" };
    const story = recommendSourceStory(kind, snap.stats, snap.sample, {
      discoverProbe: true,
      chartLimit: variantsPerSource(),
    });
    if (!story.charts.length) return { stories: [], status: "empty" };

    const charts = story.charts.filter((c) => chartHasRowsInWindow(c, snap.sample));
    if (!charts.length) return { stories: [], status: "empty" };

    const out: DiscoverStory[] = [];
    const seed = discoverHookFor(kind, snap.sample, charts[0]!);
    const chart0 = pickPreferredChart(charts, seed.preferKind) ?? charts[0]!;
    const primary = discoverHookFor(kind, sampleForChart(chart0, snap.sample), chart0);
    const usedKeys = new Set<string>([chartVariantKey(chart0)]);
    out.push({
      id: `discover-${kind}`,
      kind,
      streamPath: `stream://${kind}`,
      fileName: FILE_NAMES[kind] ?? kind,
      hook: primary.hook,
      blurb: primary.blurb,
      category: primary.category,
      chartKind: chart0.kind,
      chart: chart0,
      score: primary.score,
      stats: snap.stats,
      sample: snap.sample,
    });

    const maxVariants = variantsPerSource();
    let altIdx = 0;
    for (const alt of charts) {
      if (out.length >= maxVariants) break;
      if (alt.id === chart0.id) continue;
      const key = chartVariantKey(alt);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      altIdx += 1;
      out.push({
        id: `discover-${kind}-alt${altIdx}`,
        kind,
        streamPath: `stream://${kind}`,
        fileName: FILE_NAMES[kind] ?? kind,
        hook: alt.title,
        blurb: alt.subtitle || primary.blurb,
        category: primary.category,
        chartKind: alt.kind,
        chart: alt,
        score: altStoryScore(primary.score, altIdx),
        stats: snap.stats,
        sample: snap.sample,
      });
    }
    return { stories: out, status: "ok" };
  } catch {
    return { stories: [], status: "error" };
  }
}

async function waitForWikiRows(maxWaitMs = 6_000): Promise<Awaited<ReturnType<typeof streamSnapshot>> | null> {
  const started = Date.now();
  let delay = 400;
  while (Date.now() - started < maxWaitMs) {
    const snap = await streamSnapshot(300);
    if (snap.sample.rows.length) return snap;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(900, Math.round(delay * 1.35));
  }
  const last = await streamSnapshot(300);
  return last.sample.rows.length ? last : null;
}

async function probeWikiWithStatus(): Promise<{ stories: DiscoverStory[]; status: ProbeStatus }> {
  try {
    const status = await streamStatus();
    if (!status.running) {
      await streamStart();
      discoverStartedWiki = true;
    }
    const snap = await waitForWikiRows();
    if (!snap) return { stories: [], status: "empty" };
    const story = recommendStreamStory(snap.stats, snap.sample);
    if (!story.charts.length) return { stories: [], status: "empty" };
    const charts = story.charts.filter((c) => chartHasRowsInWindow(c, snap.sample));
    if (!charts.length) return { stories: [], status: "empty" };
    const out: DiscoverStory[] = [];
    const seed = discoverHookFor("wiki", snap.sample, charts[0]!);
    const chart0 = pickPreferredChart(charts, seed.preferKind) ?? charts[0]!;
    const hooked = discoverHookFor("wiki", sampleForChart(chart0, snap.sample), chart0);
    const usedKeys = new Set<string>([chartVariantKey(chart0)]);
    out.push({
      id: "discover-wiki",
      kind: "wiki",
      streamPath: "stream://wiki",
      fileName: FILE_NAMES.wiki,
      hook: hooked.hook,
      blurb: hooked.blurb,
      category: hooked.category,
      chartKind: chart0.kind,
      chart: chart0,
      score: hooked.score,
      stats: snap.stats,
      sample: snap.sample,
    });
    const maxVariants = variantsPerSource();
    let altIdx = 0;
    for (const chart of charts) {
      if (out.length >= maxVariants) break;
      if (chart.id === chart0.id) continue;
      const key = chartVariantKey(chart);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      altIdx += 1;
      out.push({
        id: `discover-wiki-alt${altIdx}`,
        kind: "wiki",
        streamPath: "stream://wiki",
        fileName: FILE_NAMES.wiki,
        hook: chart.title,
        blurb: chart.subtitle || hooked.blurb,
        category: hooked.category,
        chartKind: chart.kind,
        chart,
        score: altStoryScore(hooked.score, altIdx),
        stats: snap.stats,
        sample: snap.sample,
      });
    }
    return { stories: out, status: "ok" };
  } catch {
    return { stories: [], status: "error" };
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

export interface DiscoverScanSummary {
  failedKinds: SourceKind[];
  emptyKinds: SourceKind[];
  timedOutKinds: SourceKind[];
  wikiFailed: boolean;
  wikiTimedOut: boolean;
}

let lastDiscoverScanSummary: DiscoverScanSummary = {
  failedKinds: [],
  emptyKinds: [],
  timedOutKinds: [],
  wikiFailed: false,
  wikiTimedOut: false,
};

export function getDiscoverScanSummary(): DiscoverScanSummary {
  return lastDiscoverScanSummary;
}

export interface ScanDiscoverOptions {
  limit?: number;
  includeWiki?: boolean;
  signal?: AbortSignal;
  /** Called as each story arrives (progressive UI). */
  onStory?: (story: DiscoverStory, soFar: DiscoverStory[]) => void;
}

/** Scan every live feed in parallel; return top stories by score. */
export async function scanDiscoverStories(
  limitOrOpts: number | ScanDiscoverOptions = DISCOVER_STORY_LIMIT,
): Promise<DiscoverStory[]> {
  const opts: ScanDiscoverOptions =
    typeof limitOrOpts === "number" ? { limit: limitOrOpts } : limitOrOpts;
  const limit = opts.limit ?? discoverStoryLimit();
  const includeWiki = opts.includeWiki !== false;
  const isAborted = () => opts.signal?.aborted === true;
  const collected: DiscoverStory[] = [];
  const summary: DiscoverScanSummary = {
    failedKinds: [],
    emptyKinds: [],
    timedOutKinds: [],
    wikiFailed: false,
    wikiTimedOut: false,
  };

  let pendingFlush: DiscoverStory[] = [];
  let flushScheduled = false;
  const flushPending = () => {
    flushScheduled = false;
    if (isAborted()) {
      pendingFlush = [];
      return;
    }
    if (!pendingFlush.length) return;
    const batch = pendingFlush;
    pendingFlush = [];
    for (const story of batch) collected.push(story);
    collected.sort((a, b) => b.score - a.score);
    if (collected.length > limit) collected.length = limit;
    const last = batch[batch.length - 1]!;
    opts.onStory?.(last, collected.slice());
  };
  const pushMany = (batch: DiscoverStory[]) => {
    if (isAborted()) return;
    if (!batch.length) return;
    pendingFlush.push(...batch);
    if (flushScheduled) return;
    flushScheduled = true;
    const schedule =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (fn: () => void) => setTimeout(fn, 16);
    schedule(flushPending);
  };

  const jobs: Promise<void>[] = SCAN_KINDS.map(async (k) => {
    if (isAborted()) return;
    const result = await withTimeout(probeKindWithStatus(k), 10_000);
    if (isAborted()) return;
    if (result === null) {
      summary.timedOutKinds.push(k);
      return;
    }
    if (result.status === "error") summary.failedKinds.push(k);
    else if (result.status === "empty") summary.emptyKinds.push(k);
    pushMany(result.stories);
  });
  if (includeWiki) {
    jobs.push(
      (async () => {
        if (isAborted()) return;
        const result = await withTimeout(probeWikiWithStatus(), 10_000);
        if (isAborted()) return;
        if (result === null) {
          summary.wikiTimedOut = true;
          return;
        }
        if (result.status === "error") summary.wikiFailed = true;
        pushMany(result.stories);
      })(),
    );
  }
  await Promise.all(jobs);
  if (isAborted()) {
    pendingFlush = [];
    await stopDiscoverProbes();
    return [];
  }
  flushPending();
  await stopDiscoverProbes();
  lastDiscoverScanSummary = summary;

  // Apply diversity filters before picking top stories
  const top = applyDiversityFilters(collected, limit);
  setDiscoverStoryCache(top);
  return top;
}

/**
 * Rank stories for Discover with soft diversity caps.
 * Quotas are relative to the *output* limit (not the huge candidate pool),
 * so one feed with dozens of chart variants can't flood the grid.
 */
export function applyDiversityFilters(stories: DiscoverStory[], limit: number): DiscoverStory[] {
  if (!stories.length || limit <= 0) return [];
  const sorted = [...stories].sort((a, b) => b.score - a.score);
  if (sorted.length <= limit) return sorted;

  const maxPerSource = Math.max(2, Math.ceil(limit * 0.2));
  const maxPerCategory = Math.max(3, Math.ceil(limit * 0.35));
  const maxPerChart = Math.max(3, Math.ceil(limit * 0.3));

  const selected: DiscoverStory[] = [];
  const used = new Set<string>();
  const sourceCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const chartCounts = new Map<string, number>();

  const tryAdd = (story: DiscoverStory, enforceCaps: boolean): boolean => {
    if (used.has(story.id) || selected.length >= limit) return false;
    if (enforceCaps) {
      if ((sourceCounts.get(story.kind) ?? 0) >= maxPerSource) return false;
      if ((categoryCounts.get(story.category) ?? 0) >= maxPerCategory) return false;
      if ((chartCounts.get(story.chartKind) ?? 0) >= maxPerChart) return false;
    }
    selected.push(story);
    used.add(story.id);
    sourceCounts.set(story.kind, (sourceCounts.get(story.kind) ?? 0) + 1);
    categoryCounts.set(story.category, (categoryCounts.get(story.category) ?? 0) + 1);
    chartCounts.set(story.chartKind, (chartCounts.get(story.chartKind) ?? 0) + 1);
    return true;
  };

  // Pass 1: one top story from each category (up to 5) so the grid isn't mono-topic.
  const byCategory = new Map<string, DiscoverStory[]>();
  for (const s of sorted) {
    const list = byCategory.get(s.category);
    if (list) list.push(s);
    else byCategory.set(s.category, [s]);
  }
  const categories = [...byCategory.keys()].sort((a, b) => {
    const maxA = byCategory.get(a)![0]!.score;
    const maxB = byCategory.get(b)![0]!.score;
    return maxB - maxA;
  });
  for (const cat of categories.slice(0, 5)) {
    const top = byCategory.get(cat)![0]!;
    tryAdd(top, false);
  }

  // Pass 2: fill by score with all caps.
  for (const story of sorted) {
    if (selected.length >= limit) break;
    tryAdd(story, true);
  }

  // Pass 3: relax chart/category caps; keep per-source cap so one feed can't flood.
  if (selected.length < limit) {
    for (const story of sorted) {
      if (selected.length >= limit) break;
      if (used.has(story.id)) continue;
      if ((sourceCounts.get(story.kind) ?? 0) >= maxPerSource) continue;
      tryAdd(story, false);
    }
  }

  // Pass 4: last resort fill (sparse candidate sets only).
  if (selected.length < limit) {
    for (const story of sorted) {
      if (selected.length >= limit) break;
      tryAdd(story, false);
    }
  }

  return selected.sort((a, b) => b.score - a.score);
}
