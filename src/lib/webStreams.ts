// =================================================================
// Loom — Browser stream / poll sources (web UI)
// =================================================================
// Mirrors Tauri DuckDB buffering in-memory so Live Streams work on
// loom.ibm.io without the desktop app. Poll feeds go through the
// Worker (`/api/source/*`); Wikipedia uses EventSource (CORS-open).
// =================================================================

import type { ColumnInfo } from "./store";
import type { InspectResult, SourceKind, SourceStatus, StreamStatus } from "./tauri";
import { SOURCE_BY_KIND, SOURCE_DEFS, effectivePollIntervalMs, sortRowsByOrderBy } from "./sourceRegistry";
import { treasuryDebt } from "../../workers/sourceTransforms";
import { numOrNullVal, parseSourceRows, type Cell } from "./sourceParsers";
export { parseSourceRows, stormLevel, assertUsgsBody } from "./sourceParsers";
import { readSourceSnapshotCache, writeSourceSnapshotCache } from "./sourceSnapshotCache";

const MAX_ROWS = 8_000;
const WIKI_SSE = "https://stream.wikimedia.org/v2/stream/recentchange";

export type { Cell } from "./sourceParsers";

interface BufferState {
  columns: string[];
  types: string[];
  rows: Cell[][];
  running: boolean;
  totalEvents: number;
  startedAt: number | null;
  pollTimer: ReturnType<typeof setTimeout> | null;
  pollInFlight: boolean;
  eventSource: EventSource | null;
  seenIds: Set<string>;
  rateSamples: { t: number; count: number }[];
  /** Last upstream failure (cleared by the next good poll) — shown on the source card. */
  lastError: string | null;
  lastSuccessAt: number | null;
  /** When tab is hidden, polling / SSE is suspended until visible again. */
  pausedForHidden?: boolean;
  /** True when buffer rows came from a persisted snapshot, not a live poll. */
  snapshotFromCache?: boolean;
  snapshotCapturedAt?: number | null;
  /** Row cap (oldest rows dropped past it). */
  maxRows: number;
  failStreak: number;
  nextRetryAt: number | null;
}

function emptyBuffer(columns: string[], types: string[], maxRows = MAX_ROWS): BufferState {
  return {
    columns,
    types,
    rows: [],
    running: false,
    totalEvents: 0,
    startedAt: null,
    pollTimer: null,
    pollInFlight: false,
    eventSource: null,
    seenIds: new Set(),
    rateSamples: [],
    lastError: null,
    lastSuccessAt: null,
    snapshotFromCache: false,
    snapshotCapturedAt: null,
    maxRows,
    failStreak: 0,
    nextRetryAt: null,
  };
}

const wikiBuf = emptyBuffer(
  ["id", "wiki", "title", "user", "bot", "minor", "namespace", "edit_type", "old_len", "new_len", "delta", "ts", "server_name", "comment"],
  ["BIGINT", "VARCHAR", "VARCHAR", "VARCHAR", "BOOLEAN", "BOOLEAN", "INTEGER", "VARCHAR", "BIGINT", "BIGINT", "BIGINT", "TIMESTAMP", "VARCHAR", "VARCHAR"],
);

/** Feeds whose full snapshot is larger than the default cap (debt: ~8.4k business days since 1993). */
const SOURCE_MAX_ROWS: Partial<Record<SourceKind, number>> = {
  debt: 12_000,
};

function bufferMaxRows(kind: SourceKind): number {
  const def = SOURCE_DEFS.find((d) => d.kind === kind);
  return def?.parserRowCap ?? SOURCE_MAX_ROWS[kind] ?? MAX_ROWS;
}

// Columns + types come from the registry so web buffers, desktop tables, and Query stay aligned
const sourceBufs = Object.fromEntries(
  SOURCE_DEFS.map((d) => [d.kind, emptyBuffer(d.columns, d.types, bufferMaxRows(d.kind))]),
) as Record<SourceKind, BufferState>;

const SOURCE_POLL_MS = Object.fromEntries(
  SOURCE_DEFS.map((d) => [d.kind, effectivePollIntervalMs(d.kind)]),
) as Record<SourceKind, number>;

const TRIM_BATCH_RATIO = 1.1;

function rebuildSeenIds(buf: BufferState, idIdx?: number) {
  if (idIdx == null) return;
  buf.seenIds.clear();
  for (const row of buf.rows) {
    const id = String(row[idIdx] ?? "");
    if (id) buf.seenIds.add(id);
  }
}

function trim(buf: BufferState, idIdx?: number) {
  const threshold = Math.ceil(buf.maxRows * TRIM_BATCH_RATIO);
  if (buf.rows.length <= threshold) return;
  buf.rows = buf.rows.slice(buf.rows.length - buf.maxRows);
  rebuildSeenIds(buf, idIdx);
}

function recordRateSample(buf: BufferState) {
  const now = Date.now();
  buf.rateSamples.push({ t: now, count: buf.totalEvents });
  const cutoff = now - 12_000;
  while (buf.rateSamples.length > 2 && buf.rateSamples[0]!.t < cutoff) {
    buf.rateSamples.shift();
  }
}

export function eventsPerSecFromBuffer(buf: BufferState): number {
  const samples = buf.rateSamples;
  if (samples.length < 2) return 0;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return 0;
  return Math.round(((last.count - first.count) / dt) * 10) / 10;
}

function pushRows(buf: BufferState, rows: Cell[][], idIdx?: number) {
  for (const row of rows) {
    if (idIdx != null) {
      const id = String(row[idIdx] ?? "");
      if (id && buf.seenIds.has(id)) continue;
      if (id) buf.seenIds.add(id);
    }
    buf.rows.push(row);
    buf.totalEvents += 1;
    recordRateSample(buf);
  }
  trim(buf, idIdx);
}

function statsFromRows(columns: string[], types: string[], rows: Cell[][]): ColumnInfo[] {
  return columns.map((name, i) => {
    const type = types[i]!;
    const values = rows.map((r) => r[i]);
    const nonNull = values.filter((v) => v !== null && v !== undefined);
    const distinct = new Set(nonNull.map(String)).size;
    const isNum = ["DOUBLE", "INTEGER", "BIGINT", "FLOAT"].includes(type);
    const isTime = type === "TIMESTAMP" || type === "DATE";
    const nums = isNum
      ? nonNull.map(Number).filter((n) => !Number.isNaN(n))
      : [];
    const strings = !isNum ? nonNull.map(String) : [];
    let min_value: string | null = null;
    let max_value: string | null = null;
    if (isNum && nums.length > 0) {
      min_value = String(Math.min(...nums));
      max_value = String(Math.max(...nums));
    } else if ((isTime || strings.length > 0) && strings.length > 0) {
      const sorted = [...strings].sort();
      min_value = sorted[0]!;
      max_value = sorted[sorted.length - 1]!;
    }
    return {
      name,
      data_type: type,
      null_count: values.length - nonNull.length,
      distinct_count: distinct,
      min_value,
      max_value,
    };
  });
}

function snapshotFromBuffer(buf: BufferState, limit = 500, orderBy?: string, keepNewest = false): InspectResult {
  // Match desktop DuckDB ORDER BY so Discover / Explore see the same “top” rows.
  // History feeds (oldest → newest) keep their most recent rows when limited.
  const sorted = orderBy ? sortRowsByOrderBy(buf.rows, buf.columns, orderBy) : null;
  const rows = (
    sorted
      ? keepNewest ? sorted.slice(-limit) : sorted.slice(0, limit)
      : buf.rows.slice(-limit).reverse()
  ) as Cell[][];
  return {
    stats: statsFromRows(buf.columns, buf.types, rows),
    sample: {
      columns: buf.columns,
      types: buf.types,
      rows,
      total_rows: buf.rows.length,
    },
  };
}

function statusFromBuffer(buf: BufferState, extra?: { wikis_seen?: number }): StreamStatus & SourceStatus {
  const now = Date.now();
  const uptime =
    buf.startedAt != null ? Math.max(0, now / 1000 - buf.startedAt) : 0;
  return {
    running: buf.running,
    total_events: buf.totalEvents,
    events_per_sec: eventsPerSecFromBuffer(buf),
    buffer_rows: buf.rows.length,
    wikis_seen: extra?.wikis_seen ?? 0,
    started_at: buf.startedAt,
    uptime_secs: uptime,
    last_error: buf.lastError,
    last_success_at: buf.lastSuccessAt,
    snapshot_stale: buf.snapshotFromCache ?? false,
    snapshot_captured_at: buf.snapshotCapturedAt ?? null,
  };
}

/**
 * Upstreams that fail from Cloudflare's edge but allow browser CORS: fetch them from the
 * visitor's own connection first (Worker as fallback). US Treasury's TLS handshake fails
 * from Workers (HTTP 525) while browsers connect fine.
 */
const DIRECT_SOURCES: Partial<Record<SourceKind, { url: string; transform: (body: unknown) => unknown }>> = {
  debt: {
    url:
      "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny" +
      "?fields=record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt&sort=-record_date&page%5Bsize%5D=10000",
    transform: treasuryDebt,
  },
  // CoinGecko 429s Cloudflare's shared egress (the Worker falls back to CoinPaprika,
  // which blocks it too); a visitor's own connection is fine. Same shape the Worker returns.
  crypto: {
    url: "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false",
    transform: (body) => body,
  },
};

/** Hosts the client contacts directly (native shells must allow them in CSP connect-src). */
export const DIRECT_FETCH_HOSTS: string[] = [
  new URL(WIKI_SSE).host,
  ...Object.values(DIRECT_SOURCES).map((d) => new URL(d!.url).host),
];

/** User-facing message for upstream / network failures (LOOM-167). */
export function formatStreamFetchError(kind: SourceKind, err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    return `${SOURCE_BY_KIND[kind]?.label ?? kind} timed out — retrying shortly`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|offline|load failed/i.test(msg)) {
    return "You appear offline — will retry when the connection returns";
  }
  const status = msg.match(/\((\d{3})\)/)?.[1];
  if (status === "429") return "Rate-limited upstream — retrying with backoff";
  if (status && Number(status) >= 500) return "Upstream temporarily unavailable — retrying";
  if (/unexpected token|json|syntax/i.test(msg)) {
    return "Unexpected response from data source — retrying";
  }
  return msg.length > 120 ? `${msg.slice(0, 117)}…` : msg;
}

async function fetchSourceJson(kind: SourceKind): Promise<unknown> {
  const direct = DIRECT_SOURCES[kind];
  if (direct) {
    try {
      const res = await fetch(direct.url, { signal: AbortSignal.timeout(20_000) });
      if (res.ok) {
        const out = direct.transform(await res.json()) as unknown[] | { rows?: unknown[] };
        const n = Array.isArray(out) ? out.length : (out.rows?.length ?? 0);
        if (n > 0) return out;
      }
    } catch {
      /* fall back to the Worker */
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const { apiUrl } = await import("./openDataCatalog");
    const res = await fetch(apiUrl(`/api/source/${kind}`), { signal: ctrl.signal });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || `Source ${kind} failed (${res.status})`);
    }
    const body = await res.json();
    writeSourceSnapshotCache(kind, body);
    return body;
  } finally {
    clearTimeout(timer);
  }
}


/**
 * How each feed's rows land in its buffer:
 * - `replace`: each response is the full current picture → swap the buffer
 *   (only when the response parsed to ≥1 row, so a bad poll keeps the last good data).
 * - `append`: accumulate across polls (quake log, alerts log, ISS trail).
 * `key` = column index used to drop duplicate rows (within a response for
 * replace, across polls for append).
 */
const SOURCE_MERGE: Record<SourceKind, { mode: "replace" | "append"; key?: number }> = {
  // Rolling USGS day feed + active NWS set — replace so revisions apply and
  // expired alerts / rolled-off quakes leave the buffer (matches desktop).
  usgs: { mode: "replace", key: 0 },
  eonet: { mode: "replace", key: 0 },
  gdacs: { mode: "replace", key: 0 },
  nws: { mode: "replace", key: 0 },
  meteo: { mode: "replace" },
  aq: { mode: "replace" },
  ukcarbon: { mode: "replace", key: 0 },
  climate: { mode: "replace", key: 0 },
  buoys: { mode: "replace", key: 0 },
  firms: { mode: "replace", key: 0 },
  nwis: { mode: "replace" },
  opensky: { mode: "append" }, // special-cased: snapshots stitched per icao24|ts
  citibike: { mode: "replace", key: 0 },
  mbta: { mode: "replace", key: 0 },
  nyc311: { mode: "replace", key: 0 },
  iss: { mode: "append", key: 0 }, // timestamp — keep trail unique across seed + tip polls
  launches: { mode: "replace", key: 0 },
  spacex: { mode: "replace", key: 0 },
  spaceweather: { mode: "replace", key: 0 },
  aurora: { mode: "replace" }, // one row per 2° cell by construction
  asteroids: { mode: "replace" }, // one object can make two passes in 60 days
  starlink: { mode: "replace", key: 0 },
  hn: { mode: "replace", key: 0 },
  lobsters: { mode: "replace", key: 0 },
  pageviews: { mode: "replace", key: 1 },
  steam: { mode: "replace", key: 0 },
  crypto: { mode: "replace", key: 0 },
  bitcoin: { mode: "replace", key: 0 },
  fx: { mode: "replace" },
  debt: { mode: "replace", key: 0 },
  usafacts_states: { mode: "replace" },
  usafacts_nation: { mode: "replace", key: 0 },
  fema: { mode: "replace", key: 0 },
  covid: { mode: "replace" },
  countries: { mode: "replace" },
  world_bank: { mode: "replace" },
  fireballs: { mode: "replace", key: 0 },
  satellites: { mode: "replace", key: 0 },
  internet_outages: { mode: "replace" },
  faa_delays: { mode: "replace" },
  lobbying: { mode: "replace", key: 0 },
  fda_recalls: { mode: "replace", key: 0 },
  vehicle_recalls: { mode: "replace", key: 0 },
  arxiv: { mode: "replace", key: 0 },
  github_events: { mode: "append", key: 0 }, // rolling sample — accumulate unique event ids
  books: { mode: "replace" },
  nyc_inspections: { mode: "replace" }, // one row per violation
  chicago_crime: { mode: "replace", key: 0 },
  nyc_parking: { mode: "replace", key: 0 },
  powerball: { mode: "replace", key: 0 },
  fed_spending: { mode: "replace", key: 2 },
  bikeshare: { mode: "replace" },
  bluesky: { mode: "append", key: 0 }, // per-minute counts — id = ts|dimension|key
  bgp: { mode: "append", key: 0 },
  nobel: { mode: "replace", key: 0 },
  trivia: { mode: "replace" },
  pokemon: { mode: "replace", key: 0 },
  met: { mode: "replace", key: 0 },
  openfood: { mode: "replace", key: 0 },
  radio: { mode: "replace", key: 0 },
};


function hydrateSourceBufferFromCache(kind: SourceKind): boolean {
  const buf = sourceBufs[kind];
  if (buf.rows.length > 0) return false;
  const cached = readSourceSnapshotCache(kind);
  if (!cached) return false;
  const rows = parseSourceRows(kind, cached.body);
  if (!rows.length) return false;
  const merge = SOURCE_MERGE[kind];
  if (merge.mode === "replace") {
    buf.rows = [];
    buf.seenIds.clear();
  }
  pushRows(buf, rows, merge.key);
  buf.snapshotFromCache = true;
  buf.snapshotCapturedAt = cached.capturedAt;
  buf.lastSuccessAt = cached.capturedAt;
  return true;
}

async function pollSourceOnce(kind: SourceKind) {
  const buf = sourceBufs[kind];
  let body: unknown;
  // Sparse ISS buffer → seed one orbit so ribbons aren't a single tip.
  if (kind === "iss" && buf.rows.length < 3) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      const { apiUrl } = await import("./openDataCatalog");
      const res = await fetch(apiUrl("/api/source/iss_trail"), { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) body = await res.json();
    } catch {
      /* fall through to live tip */
    }
  }
  if (body === undefined) {
    try {
      body = await fetchSourceJson(kind);
      sourceBufs[kind].snapshotFromCache = false;
      sourceBufs[kind].snapshotCapturedAt = null;
    } catch (e) {
      const cached = readSourceSnapshotCache(kind);
      if (cached && sourceBufs[kind].rows.length === 0) {
        body = cached.body;
        sourceBufs[kind].snapshotFromCache = true;
        sourceBufs[kind].snapshotCapturedAt = cached.capturedAt;
      } else {
        throw e;
      }
    }
  }
  const rows = parseSourceRows(kind, body);

  if (kind === "opensky") {
    // Append snapshots so trailRibbon can stitch paths per icao24 over time.
    for (const row of rows) {
      const id = `${String(row[0] ?? "")}|${String(row[9] ?? "")}`;
      if (id !== "|" && buf.seenIds.has(id)) continue;
      if (id !== "|") buf.seenIds.add(id);
      buf.rows.push(row);
      buf.totalEvents += 1;
      recordRateSample(buf);
    }
    trim(buf);
    buf.seenIds.clear();
    for (const row of buf.rows) {
      const id = `${String(row[0] ?? "")}|${String(row[9] ?? "")}`;
      if (id !== "|") buf.seenIds.add(id);
    }
    return;
  }

  const merge = SOURCE_MERGE[kind];
  if (merge.mode === "replace") {
    if (rows.length === 0) return;
    buf.rows = [];
    buf.seenIds.clear();
  }
  pushRows(buf, rows, merge.key);
}

function parseWikiEvent(raw: string): Cell[] | null {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const meta = j.meta as Record<string, unknown> | undefined;
    if (!meta) return null;
    const id =
      typeof j.id === "number" && Number.isFinite(j.id)
        ? j.id
        : Date.now();
    const len = j.length as { old?: number; new?: number } | undefined;
    const oldLen = numOrNullVal(len?.old);
    const newLen = numOrNullVal(len?.new);
    const ts = numOrNullVal(j.timestamp);
    return [
      id,
      String(j.wiki ?? ""),
      String(j.title ?? ""),
      String(j.user ?? "anonymous"),
      Boolean(j.bot),
      Boolean(j.minor),
      numOrNullVal(j.namespace),
      String(j.type ?? "edit"),
      oldLen,
      newLen,
      // A new page has no old length — its delta is its whole size
      (newLen ?? 0) - (oldLen ?? 0),
      ts ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
      String(j.server_name ?? ""),
      String(j.comment ?? ""),
    ];
  } catch {
    return null;
  }
}

// ---- Public API (used from tauri.ts when !isTauri) ----

let wikiReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wikiReconnectAttempt = 0;

function clearWikiReconnectTimer() {
  if (wikiReconnectTimer != null) {
    clearTimeout(wikiReconnectTimer);
    wikiReconnectTimer = null;
  }
}

function scheduleWikiReconnect() {
  if (!wikiBuf.running) return;
  clearWikiReconnectTimer();
  const delay = Math.min(60_000, 1000 * 2 ** Math.min(wikiReconnectAttempt, 6));
  wikiReconnectTimer = setTimeout(() => {
    wikiReconnectTimer = null;
    if (wikiBuf.running) void connectWikiEventSource();
  }, delay);
}

function connectWikiEventSource(): void {
  wikiBuf.eventSource?.close();
  wikiBuf.eventSource = null;
  try {
    const es = new EventSource(WIKI_SSE);
    wikiBuf.eventSource = es;
    es.onopen = () => {
      wikiReconnectAttempt = 0;
      wikiBuf.lastError = null;
    };
    es.onmessage = (ev) => {
      const row = parseWikiEvent(ev.data);
      if (!row) return;
      pushRows(wikiBuf, [row], 0);
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        wikiBuf.lastError = "Wikipedia stream disconnected";
        es.close();
        wikiBuf.eventSource = null;
        wikiReconnectAttempt += 1;
        scheduleWikiReconnect();
      }
    };
  } catch (e) {
    wikiBuf.lastError = e instanceof Error ? e.message : String(e);
    wikiReconnectAttempt += 1;
    scheduleWikiReconnect();
  }
}

export async function webStreamStart(): Promise<void> {
  if (wikiBuf.running) return;
  wikiBuf.running = true;
  wikiBuf.startedAt = Math.floor(Date.now() / 1000);
  wikiBuf.totalEvents = wikiBuf.totalEvents; // keep buffer across reconnects
  connectWikiEventSource();
}

export async function webStreamStop(): Promise<void> {
  clearWikiReconnectTimer();
  wikiBuf.eventSource?.close();
  wikiBuf.eventSource = null;
  wikiBuf.running = false;
  wikiBuf.startedAt = null;
  wikiReconnectAttempt = 0;
}

export async function webStreamStatus(): Promise<StreamStatus> {
  const wikis = new Set(wikiBuf.rows.map((r) => String(r[1] ?? ""))).size;
  return statusFromBuffer(wikiBuf, { wikis_seen: wikis });
}

export async function webStreamSnapshot(limit?: number): Promise<InspectResult> {
  return snapshotFromBuffer(wikiBuf, limit ?? 500);
}

export async function webStreamClear(): Promise<void> {
  wikiBuf.rows = [];
  wikiBuf.seenIds.clear();
  wikiBuf.totalEvents = 0;
  wikiBuf.rateSamples = [];
}

export async function webSourceStart(kind: SourceKind): Promise<void> {
  const buf = sourceBufs[kind];
  if (buf.running) return;
  buf.running = true;
  buf.startedAt = Math.floor(Date.now() / 1000);
  hydrateSourceBufferFromCache(kind);

  const basePollMs = () => SOURCE_POLL_MS[kind] || (buf.rows.length === 0 ? 60_000 : 0);

  const pollIntervalMs = () => {
    const base = basePollMs();
    if (base <= 0) return 0;
    const mult = Math.min(10, 2 ** Math.min(buf.failStreak, 4));
    return Math.round(base * mult * (0.85 + Math.random() * 0.3));
  };

  const runPoll = async () => {
    if (!buf.running || buf.pollInFlight || buf.pausedForHidden) return;
    buf.pollInFlight = true;
    try {
      await pollSourceOnce(kind);
      buf.lastError = null;
      buf.lastSuccessAt = Date.now();
      buf.failStreak = 0;
      buf.nextRetryAt = null;
    } catch (e) {
      buf.failStreak += 1;
      buf.lastError = formatStreamFetchError(kind, e);
      buf.nextRetryAt = Date.now() + pollIntervalMs();
    } finally {
      buf.pollInFlight = false;
    }
    if (!buf.running) return;
    const ms = pollIntervalMs();
    if (ms <= 0) return;
    if (SOURCE_POLL_MS[kind] === 0 && buf.rows.length > 0) return;
    buf.pollTimer = setTimeout(() => {
      buf.pollTimer = null;
      void runPoll();
    }, ms);
  };

  await runPoll();
}

export async function webSourceStop(kind: SourceKind): Promise<void> {
  const buf = sourceBufs[kind];
  buf.running = false;
  if (buf.pollTimer) {
    clearTimeout(buf.pollTimer);
    buf.pollTimer = null;
  }
  buf.startedAt = null;
}

export async function webSourceStatus(kind: SourceKind): Promise<SourceStatus> {
  return statusFromBuffer(sourceBufs[kind]);
}

export async function webSourceSnapshot(
  kind: SourceKind,
  limit?: number,
): Promise<InspectResult> {
  const def = SOURCE_BY_KIND[kind];
  return snapshotFromBuffer(sourceBufs[kind], limit ?? 500, def?.orderBy, def?.keepNewest);
}

export async function webSourceClear(kind: SourceKind): Promise<void> {
  const buf = sourceBufs[kind];
  buf.rows = [];
  buf.seenIds.clear();
  buf.totalEvents = 0;
  buf.rateSamples = [];
  buf.lastSuccessAt = null;
}

// ---- Tab visibility: pause polls / SSE while hidden (LOOM-081) ----

let visibilityHooked = false;
const pausedSources = new Set<SourceKind>();
let wikiPausedForHidden = false;

function pauseAllStreamWork() {
  if (wikiBuf.running && wikiBuf.eventSource) {
    wikiPausedForHidden = true;
    clearWikiReconnectTimer();
    wikiBuf.eventSource.close();
    wikiBuf.eventSource = null;
    wikiBuf.pausedForHidden = true;
  }
  for (const kind of SOURCE_DEFS.map((d) => d.kind)) {
    const buf = sourceBufs[kind];
    if (!buf.running) continue;
    if (buf.pollTimer) {
      clearTimeout(buf.pollTimer);
      buf.pollTimer = null;
    }
    buf.pausedForHidden = true;
    pausedSources.add(kind);
  }
}

async function resumeAllStreamWork() {
  if (wikiBuf.running && wikiPausedForHidden) {
    wikiPausedForHidden = false;
    wikiBuf.pausedForHidden = false;
    connectWikiEventSource();
  }
  for (const kind of [...pausedSources]) {
    pausedSources.delete(kind);
    const buf = sourceBufs[kind];
    if (!buf.running) continue;
    buf.pausedForHidden = false;
    const pollIntervalMs = () =>
      SOURCE_POLL_MS[kind] || (buf.rows.length === 0 ? 60_000 : 0);
    const runPoll = async () => {
      if (!buf.running || buf.pollInFlight || buf.pausedForHidden) return;
      buf.pollInFlight = true;
      try {
        await pollSourceOnce(kind);
        buf.lastError = null;
        buf.lastSuccessAt = Date.now();
      } catch (e) {
        buf.lastError = e instanceof Error ? e.message : String(e);
      } finally {
        buf.pollInFlight = false;
      }
      if (!buf.running || buf.pausedForHidden) return;
      const ms = pollIntervalMs();
      if (ms <= 0) return;
      if (SOURCE_POLL_MS[kind] === 0 && buf.rows.length > 0) return;
      buf.pollTimer = setTimeout(() => {
        buf.pollTimer = null;
        void runPoll();
      }, ms);
    };
    void runPoll();
  }
}

function ensureVisibilityHooks() {
  if (visibilityHooked || typeof document === "undefined") return;
  visibilityHooked = true;
  void import("./appActivity").then(({ subscribeAppActivity }) => {
    subscribeAppActivity((active) => {
      if (active) void resumeAllStreamWork();
      else if (wikiBuf.running || SOURCE_DEFS.some((d) => sourceBufs[d.kind].running)) {
        pauseAllStreamWork();
      }
    });
  });
}

ensureVisibilityHooks();

export async function webCreateGitHubIssue(
  title: string,
  body: string,
  imageBase64?: string | null,
): Promise<string> {
  const { apiUrl } = await import("./openDataCatalog");
  const res = await fetch(apiUrl("/api/feedback"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      body,
      imageBase64: imageBase64 ?? null,
      href: typeof window !== "undefined" ? window.location.href : "",
    }),
  });
  const json = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !json.url) {
    throw new Error(json.error || `Feedback failed (${res.status})`);
  }
  return json.url;
}
