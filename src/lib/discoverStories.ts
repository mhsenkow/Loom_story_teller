// =================================================================
// Loom — Discover stories (intro scan)
// =================================================================
// Probes live feeds for “interesting right now” hooks, then hands
// chart-ready recommendations back to the onboarding modal.
// Progressive: callers can stream stories as each source finishes.
// =================================================================

import { recommendSourceStory, recommendStreamStory } from "./recommendations";
import type { ChartRecommendation } from "./recommendations";
import { discoverRecipeKey, discoverRecipeId } from "./discoverChartCatalog";
import { createDiscoverAssessor, type DiscoverInsight } from "./discoverSignals";
import { orderDiscoverStories } from "./discoverRanking";
import { discoverSnapshotFingerprint, stampDiscoverDataChanges } from "./discoverUpdates";
import type { ColumnInfo, QueryResult } from "./store";
import { applyChartTimeWindow } from "./chartTime";
import { qualifyDiscoverChart } from "./discoverChartQuality";
import { editorialDiscoverStory } from "./discoverEditorial";
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
import { SOURCE_BY_KIND, SOURCE_DEFS, SOURCE_EXPLORE_ROWS } from "./sourceRegistry";
import { discoverAffinityMap } from "./sourcePreferences";

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
  /** When this snapshot was checked, distinct from the observation dates in its rows. */
  capturedAt?: number;
  snapshotCached?: boolean;
  /** Snapshot evidence used for ranking and the card's explanation. */
  insight?: DiscoverInsight;
  quality?: number;
  /** Actual content change, separate from a successful unchanged poll. */
  dataChangedAt?: number;
  /** The feed's evidence-based headline (carries discoverHookFor's hook); leads its question group. */
  headline?: boolean;
}

/** TLDR + credit for What’s interesting data chips (hover bubble / inspect). */
export interface DiscoverSourceBrief {
  label: string;
  /** One-line “what is this feed”. */
  tldr: string;
  credit: string;
  homepage: string;
}

const WIKI_BRIEF: DiscoverSourceBrief = {
  label: "Wikipedia Live",
  tldr: "Recent edits across Wikimedia projects as they happen — titles, bots, and language editions.",
  credit: "Wikimedia recent changes · CC BY-SA",
  homepage: "https://www.wikimedia.org/",
};

export function discoverSourceBrief(kind: DiscoverKind): DiscoverSourceBrief {
  if (kind === "wiki") return WIKI_BRIEF;
  const def = SOURCE_BY_KIND[kind];
  return {
    label: def.label,
    tldr: def.description,
    credit: def.attribution,
    homepage: def.homepage,
  };
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
let pendingDiscoverRefresh = false;

/** Clear the dismiss flag and ask Onboarding to scan again. */
export function requestDiscoverScan(opts?: { refresh?: boolean }): void {
  if (typeof window === "undefined") return;
  pendingDiscoverForce = true;
  pendingDiscoverRefresh = opts?.refresh === true;
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
  pendingDiscoverRefresh = false;
}

export function consumeDiscoverRefreshRequest(): boolean {
  const refresh = pendingDiscoverRefresh;
  pendingDiscoverRefresh = false;
  return refresh;
}

/** All poll sources (same set as Sidebar live cards). */
const SCAN_KINDS: readonly SourceKind[] = ALL_SOURCE_KINDS;

/** Cap on stories shown in the discover grid (primary + alts across every feed). */
export const DISCOVER_STORY_LIMIT = 10_000;

/** iPad / iPhone / Android — fewer cards so the grid stays snappy. */
export const DISCOVER_STORY_LIMIT_MOBILE = 120;

/** How many chart variants to keep per live source (kinds + encodings). */
export const VARIANTS_PER_SOURCE = 160;

/** Consider the same breadth on mobile; only the final gallery is capped. */
export const VARIANTS_PER_SOURCE_MOBILE = VARIANTS_PER_SOURCE;

/** Story cap for the current device (120 on iPad/phone, full set on desktop). */
export function discoverStoryLimit(): number {
  return isMobileOs() ? DISCOVER_STORY_LIMIT_MOBILE : DISCOVER_STORY_LIMIT;
}

function variantsPerSource(): number {
  return isMobileOs() ? VARIANTS_PER_SOURCE_MOBILE : VARIANTS_PER_SOURCE;
}

/** Session cache so closing What’s interesting and reopening stays instant. */
let discoverStoryCache: DiscoverStory[] | null = null;
let discoverCacheSavedAt: number | null = null;

/** Sources discover started for probing — stopped after scan unless retained. */
const discoverStartedSources = new Map<SourceKind, symbol>();
let discoverStartedWiki: symbol | null = null;
const activeDiscoverScans = new Set<symbol>();
const retainedDiscoverFeeds = new Set<DiscoverKind>();

/** Keep a probed feed running after the user picks it from discover. */
export function retainDiscoverFeed(kind: DiscoverKind): void {
  if (activeDiscoverScans.size) retainedDiscoverFeeds.add(kind);
  if (kind === "wiki") discoverStartedWiki = null;
  else discoverStartedSources.delete(kind);
}

export async function stopDiscoverProbes(owner?: symbol): Promise<void> {
  const kinds = [...discoverStartedSources.entries()]
    .filter(([, session]) => !owner || session === owner).map(([kind]) => kind);
  for (const kind of kinds) discoverStartedSources.delete(kind);
  const stopWiki = discoverStartedWiki && (!owner || discoverStartedWiki === owner);
  if (stopWiki) discoverStartedWiki = null;
  await Promise.allSettled([
    ...kinds.map((kind) => sourceStop(kind)),
    ...(stopWiki ? [streamStop()] : []),
  ]);
}

async function finishDiscoverProbes(owner: symbol): Promise<void> {
  await stopDiscoverProbes(owner);
  activeDiscoverScans.delete(owner);
  if (!activeDiscoverScans.size) retainedDiscoverFeeds.clear();
}

export function getDiscoverStoryCache(): DiscoverStory[] | null {
  return discoverStoryCache;
}

export function getDiscoverCacheSavedAt(): number | null {
  return discoverCacheSavedAt;
}

export function setDiscoverStoryCache(stories: DiscoverStory[], savedAt: number | null = Date.now()): void {
  discoverStoryCache = stories.length ? stories : null;
  discoverCacheSavedAt = stories.length ? savedAt : null;
}

export function clearDiscoverStoryCache(): void {
  discoverStoryCache = null;
  discoverCacheSavedAt = null;
}

/** Sample for a chart’s Time window — hooks should match what the chart will show. */
function sampleForChart(chart: ChartRecommendation, sample: QueryResult): QueryResult {
  if (!chart.timeWindow || chart.timeWindow === "all" || !chart.timeWindowField) return sample;
  const slice = applyChartTimeWindow(sample.rows, sample.columns, chart);
  if (!slice.filtered || slice.kept === 0) return sample;
  return { ...sample, rows: slice.rows, total_rows: slice.kept };
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
  signal?: AbortSignal,
  checkedAfter?: number,
): Promise<Awaited<ReturnType<typeof sourceSnapshot>> | null> {
  const started = Date.now();
  let delay = kind === "iss" || kind === "opensky" || kind === "countries" ? 400 : 250;
  while (Date.now() - started < maxWaitMs && !signal?.aborted) {
    const snap = await sourceSnapshot(kind, SOURCE_EXPLORE_ROWS);
    if (snap.sample.rows.length) {
      if (checkedAfter == null) return snap;
      const status = await sourceStatus(kind);
      const captured = status.last_success_at ?? (status.last_ok_at != null ? status.last_ok_at * 1000 : undefined);
      if ((captured == null && !status.snapshot_stale) || (captured != null && captured >= checkedAfter) || status.last_error) return snap;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(900, Math.round(delay * 1.35));
  }
  return null;
}

/** Build hooks and variants against the exact snapshot that opens on click. */
function* buildDiscoverStorySteps(
  kind: DiscoverKind,
  stats: ColumnInfo[],
  sample: QueryResult,
  candidates: ChartRecommendation[],
  maxVariants = VARIANTS_PER_SOURCE,
  snapshot: { capturedAt?: number; snapshotCached?: boolean } = {},
): Generator<void, DiscoverStory[]> {
  const windowHasRows = new Map<string, boolean>();
  const hasRows = (chart: ChartRecommendation) => {
    const key = `${chart.timeWindowField ?? ""}|${chart.timeWindow ?? "all"}`;
    if (!windowHasRows.has(key)) windowHasRows.set(key, chartHasRowsInWindow(chart, sample));
    return windowHasRows.get(key)!;
  };
  const charts = candidates.map((chart) => qualifyDiscoverChart(kind, chart)).filter((chart): chart is ChartRecommendation => !!chart).filter((chart) => {
    const fields = [chart.xField, chart.yField, chart.colorField, chart.sizeField,
      chart.rowField, chart.y2Field, chart.timeWindowField, chart.zField, chart.timeField,
      chart.trailId, chart.shapeField, chart.emojiField, chart.opacityField, chart.glowField, chart.outlineField];
    return fields.every((field) => !field || sample.columns.includes(field))
      && hasRows(chart);
  });
  if (!sample.rows.length || !charts.length || maxVariants <= 0) return [];
  const seed = discoverHookFor(kind, sample, charts[0]!);
  const primaryChart = pickPreferredChart(charts, seed.preferKind)!;
  const primary = discoverHookFor(kind, sampleForChart(primaryChart, sample), primaryChart);
  const makeStory = (chart: ChartRecommendation, index: number): DiscoverStory => editorialDiscoverStory({
    id: `discover-${kind}${index ? `-alt${index}` : ""}`,
    kind,
    streamPath: `stream://${kind}`,
    fileName: FILE_NAMES[kind] ?? kind,
    hook: index ? chart.title : primary.hook,
    blurb: index ? chart.subtitle || primary.blurb : primary.blurb,
    category: primary.category,
    chartKind: chart.kind,
    chart,
    score: primary.score,
    stats,
    sample,
    ...snapshot,
  });
  const assess = createDiscoverAssessor(stats, sample, kind);
  const used = new Set<string>();
  const all: DiscoverStory[] = [];
  let considered = 0;
  for (const chart of [primaryChart, ...charts.filter((c) => c !== primaryChart)]) {
    if (considered++ % 24 === 0) yield;
    const key = discoverRecipeKey(chart);
    if (used.has(key)) continue;
    used.add(key);
    const evidence = assess(chart);
    if (!evidence) continue;
    const story = makeStory(chart, chart === primaryChart ? 0 : 1);
    story.quality = evidence.quality;
    story.insight = evidence.insight;
    story.score = Math.round(primary.score * 0.3 + chart.score * 0.3
      + evidence.quality * 0.25 + evidence.insight.strength * 15);
    if (chart === primaryChart) {
      story.headline = true;
      story.score += 5;
    }
    // IDs depend on the recipe, not a changing rank or completion order.
    story.id = `discover-${kind}-${chart.id}-${discoverRecipeId(chart)}`;
    all.push(story);
  }
  const ranked = [...all].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const bestByKind = new Map<string, DiscoverStory>();
  for (const story of ranked) if (!bestByKind.has(story.chartKind)) bestByKind.set(story.chartKind, story);
  // Preserve every viable kind when it fits, before spending slots on settings.
  const representatives = [...bestByKind.values()];
  // The headline hook is the landing page's best text — never lose it to a sibling of the same kind.
  const head = all.find((s) => s.headline);
  if (head && !representatives.some((s) => s.id === head.id)) {
    // When every slot is already a kind representative, the headline takes its own kind's slot.
    const sameKind = representatives.findIndex((s) => s.chartKind === head.chartKind);
    if (representatives.length >= maxVariants && sameKind >= 0) representatives[sameKind] = head;
    else representatives.unshift(head);
  }
  const represented = new Set(representatives.map((s) => s.id));
  const out = representatives.length <= maxVariants
    ? [...representatives, ...orderDiscoverStories(all.filter((s) => !represented.has(s.id)), (s) => s.score, maxVariants - representatives.length)]
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    : orderDiscoverStories(all, (s) => s.score, maxVariants);
  return out;
}

export function buildDiscoverStories(...args: Parameters<typeof buildDiscoverStorySteps>): DiscoverStory[] {
  const work = buildDiscoverStorySteps(...args);
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}

/** Feed probes yield during qualification so the broader search does not hold taps. */
export async function buildDiscoverStoriesAsync(
  args: Parameters<typeof buildDiscoverStorySteps>, signal?: AbortSignal,
): Promise<DiscoverStory[]> {
  const work = buildDiscoverStorySteps(...args);
  let step = work.next();
  while (!step.done) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) return [];
    step = work.next();
  }
  return step.value;
}

async function probeKindWithStatus(
  kind: SourceKind,
  signal: AbortSignal,
  owner: symbol,
): Promise<{ stories: DiscoverStory[]; status: ProbeStatus }> {
  try {
    if (signal?.aborted) return { stories: [], status: "empty" };
    if (discoverStartedSources.has(kind)) discoverStartedSources.set(kind, owner);
    const status = await sourceStatus(kind);
    const startedAt = Date.now();
    if (signal?.aborted) return { stories: [], status: "empty" };
    // Load-once feeds keep a running flag but no timer. Recheck them daily,
    // preserving their buffer and the user's connection after this probe.
    const lastCapture = status.snapshot_captured_at ?? status.last_success_at ?? (status.last_ok_at != null ? status.last_ok_at * 1000 : undefined);
    const restartOnce = status.running && SOURCE_BY_KIND[kind].pollMs === 0
      && (lastCapture == null || startedAt - lastCapture >= 86_400_000);
    if (restartOnce) await sourceStop(kind);
    if (!status.running || restartOnce) {
      if (!status.running && !retainedDiscoverFeeds.has(kind)) discoverStartedSources.set(kind, owner);
      await sourceStart(kind);
    }
    if (signal.aborted) {
      await stopDiscoverProbes(owner);
      return { stories: [], status: "empty" };
    }
    const snap = await waitForSourceRows(kind, 6_000, signal, !status.running || restartOnce ? startedAt - 1000 : undefined);
    if (!snap || signal?.aborted) return { stories: [], status: "empty" };
    const currentStatus = await sourceStatus(kind);
    const story = recommendSourceStory(kind, snap.stats, snap.sample, {
      discoverProbe: true,
      chartLimit: DISCOVER_STORY_LIMIT,
    });
    const stories = await buildDiscoverStoriesAsync([kind, snap.stats, snap.sample, story.charts, variantsPerSource(), {
      capturedAt: currentStatus.snapshot_captured_at ?? currentStatus.last_success_at ?? (currentStatus.last_ok_at != null ? currentStatus.last_ok_at * 1000 : Date.now()),
      snapshotCached: currentStatus.snapshot_stale === true || !!currentStatus.last_error,
    }], signal);
    return { stories, status: currentStatus.last_error ? "error" : stories.length ? "ok" : "empty" };
  } catch {
    return { stories: [], status: "error" };
  }
}

async function waitForWikiRows(maxWaitMs = 6_000, signal?: AbortSignal, previous?: QueryResult): Promise<Awaited<ReturnType<typeof streamSnapshot>> | null> {
  const started = Date.now();
  let delay = 400;
  while (Date.now() - started < maxWaitMs && !signal?.aborted) {
    const snap = await streamSnapshot(SOURCE_EXPLORE_ROWS);
    if (snap.sample.rows.length && (!previous || discoverSnapshotFingerprint(snap.sample) !== discoverSnapshotFingerprint(previous))) return snap;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(900, Math.round(delay * 1.35));
  }
  return null;
}

async function probeWikiWithStatus(signal: AbortSignal, owner: symbol): Promise<{ stories: DiscoverStory[]; status: ProbeStatus }> {
  try {
    if (signal?.aborted) return { stories: [], status: "empty" };
    if (discoverStartedWiki) discoverStartedWiki = owner;
    const status = await streamStatus();
    if (signal?.aborted) return { stories: [], status: "empty" };
    if (!status.running) {
      if (!retainedDiscoverFeeds.has("wiki")) discoverStartedWiki = owner;
      await streamStart();
    }
    if (signal.aborted) {
      await stopDiscoverProbes(owner);
      return { stories: [], status: "empty" };
    }
    // A reconnected SSE stream may still contain yesterday's buffer. Wait for
    // an inserted event rather than stopping the probe before the first event.
    const previous = !status.running ? (await streamSnapshot(SOURCE_EXPLORE_ROWS)).sample : undefined;
    const snap = await waitForWikiRows(6_000, signal, previous);
    if (!snap || signal?.aborted) return { stories: [], status: "empty" };
    const story = recommendStreamStory(snap.stats, snap.sample, { discoverProbe: true });
    const stories = await buildDiscoverStoriesAsync(["wiki", snap.stats, snap.sample, story.charts, variantsPerSource(), { capturedAt: Date.now() }], signal);
    return { stories, status: stories.length ? "ok" : "empty" };
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
  /** Feeds the Worker reports as down for hours — skipped instead of probed. */
  restingKinds: SourceKind[];
  wikiFailed: boolean;
  wikiTimedOut: boolean;
}

let lastDiscoverScanSummary: DiscoverScanSummary = {
  failedKinds: [],
  emptyKinds: [],
  timedOutKinds: [],
  restingKinds: [],
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
  /** Restrict upkeep to due feeds; a full daily sweep still uses every source. */
  kinds?: readonly DiscoverKind[];
  /** Partial refreshes merge with the gallery before committing. */
  commitCache?: boolean;
  /** Called as each story arrives (progressive UI). */
  onStory?: (story: DiscoverStory, soFar: DiscoverStory[]) => void;
}

/** Scan feeds in bounded, yielding batches; return a diverse set of ideas. */
export async function scanDiscoverStories(
  limitOrOpts: number | ScanDiscoverOptions = {},
): Promise<DiscoverStory[]> {
  const opts: ScanDiscoverOptions =
    typeof limitOrOpts === "number" ? { limit: limitOrOpts } : limitOrOpts;
  const limit = opts.limit ?? discoverStoryLimit();
  const includeWiki = opts.includeWiki !== false;
  const owner = Symbol("discover-scan");
  activeDiscoverScans.add(owner);
  const controller = new AbortController();
  const abort = () => controller.abort();
  opts.signal?.addEventListener("abort", abort, { once: true });
  if (opts.signal?.aborted) controller.abort();
  const isAborted = () => controller.signal.aborted;
  const collected: DiscoverStory[] = [];
  const summary: DiscoverScanSummary = {
    failedKinds: [],
    emptyKinds: [],
    timedOutKinds: [],
    restingKinds: [],
    wikiFailed: false,
    wikiTimedOut: false,
  };

  // Loved feeds survive the mobile cap and are probed first; hidden ones go last.
  const affinity = discoverAffinityMap([...SCAN_KINDS, "wiki"]);
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
    const last = batch[batch.length - 1]!;
    opts.onStory?.(last, applyDiversityFilters(collected, limit, affinity));
  };
  const pushMany = (batch: DiscoverStory[]) => {
    if (isAborted()) return;
    if (!batch.length) return;
    pendingFlush.push(...batch);
    if (flushScheduled) return;
    flushScheduled = true;
    setTimeout(flushPending, collected.length ? 150 : 16);
  };

  // Skip feeds that have been failing for hours: each would only burn a 10 s
  // probe slot and a timeout. Health is advisory — unreachable means scan all.
  const { loadFeedHealth, isFeedResting } = await import("./sourceHealth");
  const health = await loadFeedHealth({ timeoutMs: 2_500 });
  const priority: readonly SourceKind[] = ["usgs", "hn", "meteo", "crypto", "spaceweather", "countries"];
  const orderedKinds = [...SCAN_KINDS].filter((kind) => {
    if (opts.kinds && !opts.kinds.includes(kind)) return false;
    if (isFeedResting(kind, health)) {
      summary.restingKinds.push(kind);
      return false;
    }
    return true;
  }).sort((a, b) => {
    const order = (kind: SourceKind) => { const index = priority.indexOf(kind); return index < 0 ? priority.length : index; };
    return (affinity[b] ?? 0) - (affinity[a] ?? 0) || order(a) - order(b);
  });
  const jobs: (() => Promise<void>)[] = orderedKinds.map((k) => async () => {
    if (isAborted()) return;
    const result = await withTimeout(probeKindWithStatus(k, controller.signal, owner), 10_000);
    if (isAborted()) return;
    if (result === null) {
      summary.timedOutKinds.push(k);
      return;
    }
    if (result.status === "error") summary.failedKinds.push(k);
    else if (result.status === "empty") summary.emptyKinds.push(k);
    pushMany(result.stories);
  });
  if (includeWiki && (!opts.kinds || opts.kinds.includes("wiki"))) {
    jobs.push(
      async () => {
        if (isAborted()) return;
        const result = await withTimeout(probeWikiWithStatus(controller.signal, owner), 10_000);
        if (isAborted()) return;
        if (result === null) {
          summary.wikiTimedOut = true;
          return;
        }
        if (result.status === "error") summary.wikiFailed = true;
        pushMany(result.stories);
      },
    );
  }
  let nextJob = 0;
  const worker = async () => {
    while (!isAborted() && nextJob < jobs.length) {
      const job = jobs[nextJob++]!;
      await job();
      // Let taps, search and canvas paints run between completed feed jobs.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  await Promise.all(Array.from({ length: isMobileOs() ? 3 : 6 }, worker));
  opts.signal?.removeEventListener("abort", abort);
  if (isAborted()) {
    pendingFlush = [];
    await finishDiscoverProbes(owner);
    return [];
  }
  flushPending();
  controller.abort();
  await finishDiscoverProbes(owner);
  lastDiscoverScanSummary = summary;

  // Apply diversity filters before picking top stories (scores stay preference-free for the cache)
  const top = applyDiversityFilters(collected, limit, affinity);
  if (opts.commitCache !== false) setDiscoverStoryCache(top);
  if (top.length && opts.commitCache !== false) {
    void import("./discoverDailyCache").then(({ writeDiscoverDailyCache }) => writeDiscoverDailyCache(top));
  }
  return top;
}

/** Keep failed feeds and daily-sweep age; a partial check must not claim a full scan. */
export async function refreshDiscoverStories(
  stories: DiscoverStory[], kinds: readonly DiscoverKind[], signal?: AbortSignal,
): Promise<DiscoverStory[]> {
  if (!kinds.length) return stories;
  const updates = await scanDiscoverStories({ kinds, signal, commitCache: false });
  if (signal?.aborted || !updates.length) return stories;
  const captured = new Map<DiscoverKind, number>();
  for (const story of stories) captured.set(story.kind, Math.max(captured.get(story.kind) ?? 0, story.capturedAt ?? 0));
  const newer = updates.filter((story) => (story.capturedAt ?? 0) > (captured.get(story.kind) ?? 0));
  if (!newer.length) return stories;
  const changed = new Set(newer.map((story) => story.kind));
  const merged = [...stories.filter((story) => !changed.has(story.kind)), ...newer];
  const stamped = stampDiscoverDataChanges(stories, merged).map((story, i) => changed.has(story.kind) ? story : merged[i]!);
  return applyDiversityFilters(stamped, discoverStoryLimit(), discoverAffinityMap([...SCAN_KINDS, "wiki"]));
}

/**
 * Rank stories for Discover with soft diversity caps.
 * Quotas are relative to the *output* limit (not the huge candidate pool),
 * so one feed with dozens of chart variants can't flood the grid.
 * `affinity` (per feed kind, from sourcePreferences) only decides *which*
 * stories make the cut; returned stories keep their own scores and order.
 */
export function applyDiversityFilters(
  stories: DiscoverStory[],
  limit: number,
  affinity: Partial<Record<DiscoverKind, number>> = {},
): DiscoverStory[] {
  if (!stories.length || limit <= 0) return [];
  const byScore = (a: DiscoverStory, b: DiscoverStory) => b.score - a.score;
  if (stories.length <= limit) return [...stories].sort(byScore);
  const rank = (story: DiscoverStory) => story.score + (affinity[story.kind] ?? 0);
  const sorted = [...stories].sort((a, b) => rank(b) - rank(a));

  const maxPerSource = Math.max(2, Math.ceil(limit * 0.2));
  const selected = orderDiscoverStories(sorted, rank, limit, maxPerSource);
  if (selected.length < limit) {
    const used = new Set(selected.map((s) => s.id));
    selected.push(...orderDiscoverStories(sorted.filter((s) => !used.has(s.id)), rank, limit - selected.length));
  }
  return selected.sort(byScore);
}
