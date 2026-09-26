// =================================================================
// Loom — Browser stream / poll sources (web UI)
// =================================================================
// Mirrors Tauri DuckDB buffering in-memory so Live Streams work on
// loom.ibm.io without the desktop app. Poll feeds go through the
// Worker (`/api/source/*`); Wikipedia uses EventSource (CORS-open).
// =================================================================

import type { ColumnInfo } from "./store";
import type { InspectResult, SourceKind, SourceStatus, StreamStatus } from "./tauri";

const MAX_ROWS = 8_000;
const WIKI_SSE = "https://stream.wikimedia.org/v2/stream/recentchange";

type Cell = string | number | boolean | null;

interface BufferState {
  columns: string[];
  types: string[];
  rows: Cell[][];
  running: boolean;
  totalEvents: number;
  startedAt: number | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  eventSource: EventSource | null;
  seenIds: Set<string>;
  lastCountAt: { count: number; t: number };
}

function emptyBuffer(columns: string[], types: string[]): BufferState {
  return {
    columns,
    types,
    rows: [],
    running: false,
    totalEvents: 0,
    startedAt: null,
    pollTimer: null,
    eventSource: null,
    seenIds: new Set(),
    lastCountAt: { count: 0, t: Date.now() },
  };
}

const wikiBuf = emptyBuffer(
  ["id", "wiki", "title", "user", "bot", "minor", "namespace", "edit_type", "old_len", "new_len", "delta", "ts", "server_name", "comment"],
  ["BIGINT", "VARCHAR", "VARCHAR", "VARCHAR", "BOOLEAN", "BOOLEAN", "INTEGER", "VARCHAR", "BIGINT", "BIGINT", "BIGINT", "TIMESTAMP", "VARCHAR", "VARCHAR"],
);

const sourceBufs: Record<SourceKind, BufferState> = {
  usgs: emptyBuffer(
    ["id", "magnitude", "place", "ts", "latitude", "longitude", "depth", "mag_type", "status", "tsunami", "sig", "net"],
    ["VARCHAR", "DOUBLE", "VARCHAR", "TIMESTAMP", "DOUBLE", "DOUBLE", "DOUBLE", "VARCHAR", "VARCHAR", "BOOLEAN", "INTEGER", "VARCHAR"],
  ),
  meteo: emptyBuffer(
    ["ts", "city", "latitude", "longitude", "temperature", "humidity", "wind_speed", "precipitation", "weather_code", "pressure", "cloud_cover"],
    ["TIMESTAMP", "VARCHAR", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "INTEGER", "DOUBLE", "DOUBLE"],
  ),
  nws: emptyBuffer(
    ["id", "event", "headline", "severity", "certainty", "urgency", "area_desc", "sender_name", "effective", "expires", "status", "category"],
    ["VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "TIMESTAMP", "TIMESTAMP", "VARCHAR", "VARCHAR"],
  ),
  world_bank: emptyBuffer(
    ["country_code", "country_name", "indicator_id", "indicator_name", "yr", "value"],
    ["VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "INTEGER", "DOUBLE"],
  ),
  iss: emptyBuffer(
    ["ts", "latitude", "longitude", "altitude_km", "velocity_kmh", "visibility"],
    ["TIMESTAMP", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "VARCHAR"],
  ),
  hn: emptyBuffer(
    ["id", "title", "author", "points", "num_comments", "url", "created_at"],
    ["VARCHAR", "VARCHAR", "VARCHAR", "INTEGER", "INTEGER", "VARCHAR", "TIMESTAMP"],
  ),
  crypto: emptyBuffer(
    ["id", "symbol", "name", "price_usd", "market_cap", "volume_24h", "change_24h_pct", "rank"],
    ["VARCHAR", "VARCHAR", "VARCHAR", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "INTEGER"],
  ),
};

const SOURCE_POLL_MS: Record<SourceKind, number> = {
  usgs: 60_000,
  meteo: 300_000,
  nws: 120_000,
  world_bank: 0,
  iss: 15_000,
  hn: 120_000,
  crypto: 60_000,
};

function trim(buf: BufferState) {
  if (buf.rows.length > MAX_ROWS) {
    buf.rows = buf.rows.slice(buf.rows.length - MAX_ROWS);
  }
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
  }
  trim(buf);
}

function statsFromBuffer(buf: BufferState): ColumnInfo[] {
  return buf.columns.map((name, i) => {
    const type = buf.types[i]!;
    const values = buf.rows.map((r) => r[i]);
    const nonNull = values.filter((v) => v !== null && v !== undefined);
    const distinct = new Set(nonNull.map(String)).size;
    const isNum = ["DOUBLE", "INTEGER", "BIGINT", "FLOAT"].includes(type);
    const nums = isNum
      ? nonNull.map(Number).filter((n) => !Number.isNaN(n))
      : [];
    return {
      name,
      data_type: type,
      null_count: values.length - nonNull.length,
      distinct_count: distinct,
      min_value:
        isNum && nums.length > 0
          ? String(Math.min(...nums))
          : nonNull.length > 0
            ? String(nonNull[0])
            : null,
      max_value:
        isNum && nums.length > 0
          ? String(Math.max(...nums))
          : nonNull.length > 0
            ? String(nonNull[nonNull.length - 1])
            : null,
    };
  });
}

function snapshotFromBuffer(buf: BufferState, limit = 500): InspectResult {
  const rows = buf.rows.slice(-limit).reverse();
  return {
    stats: statsFromBuffer(buf),
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
  const elapsed = Math.max(0.001, (now - buf.lastCountAt.t) / 1000);
  const delta = buf.totalEvents - buf.lastCountAt.count;
  const eps = Math.round((delta / elapsed) * 10) / 10;
  buf.lastCountAt = { count: buf.totalEvents, t: now };
  const uptime =
    buf.startedAt != null ? Math.max(0, now / 1000 - buf.startedAt) : 0;
  return {
    running: buf.running,
    total_events: buf.totalEvents,
    events_per_sec: eps,
    buffer_rows: buf.rows.length,
    wikis_seen: extra?.wikis_seen ?? 0,
    started_at: buf.startedAt,
    uptime_secs: uptime,
  };
}

async function fetchSourceJson(kind: SourceKind): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`/api/source/${kind}`, { signal: ctrl.signal });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || `Source ${kind} failed (${res.status})`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseUsgs(body: unknown): Cell[][] {
  const features = (body as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];
  const out: Cell[][] = [];
  for (const feat of features) {
    const f = feat as {
      id?: string;
      properties?: Record<string, unknown>;
      geometry?: { coordinates?: number[] };
    };
    const props = f.properties ?? {};
    const coords = f.geometry?.coordinates ?? [];
    const id = String(props.ids ?? f.id ?? "");
    out.push([
      id,
      Number(props.mag ?? 0),
      String(props.place ?? ""),
      props.time != null ? new Date(Number(props.time)).toISOString() : null,
      coords[1] ?? 0,
      coords[0] ?? 0,
      coords[2] ?? 0,
      String(props.magType ?? ""),
      String(props.status ?? ""),
      Number(props.tsunami ?? 0) === 1,
      Number(props.sig ?? 0),
      String(props.net ?? ""),
    ]);
  }
  return out;
}

function parseNws(body: unknown): Cell[][] {
  const features = (body as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];
  const out: Cell[][] = [];
  for (const feat of features) {
    const f = feat as { id?: string; properties?: Record<string, unknown> };
    const p = f.properties ?? {};
    out.push([
      String(f.id ?? p.id ?? ""),
      String(p.event ?? ""),
      String(p.headline ?? ""),
      String(p.severity ?? ""),
      String(p.certainty ?? ""),
      String(p.urgency ?? ""),
      String(p.areaDesc ?? ""),
      String(p.senderName ?? ""),
      p.effective != null ? String(p.effective) : null,
      p.expires != null ? String(p.expires) : null,
      String(p.status ?? ""),
      String(p.category ?? ""),
    ]);
  }
  return out;
}

function parseMeteo(body: unknown): Cell[][] {
  const cities = (body as { cities?: unknown[] })?.cities;
  if (!Array.isArray(cities)) return [];
  const out: Cell[][] = [];
  for (const c of cities) {
    const city = c as {
      name: string;
      lat: number;
      lon: number;
      hourly?: Record<string, unknown[]>;
    };
    const h = city.hourly ?? {};
    const times = (h.time ?? []) as string[];
    for (let i = 0; i < times.length; i++) {
      out.push([
        times[i] ?? null,
        city.name,
        city.lat,
        city.lon,
        numAt(h.temperature_2m, i),
        numAt(h.relative_humidity_2m, i),
        numAt(h.wind_speed_10m, i),
        numAt(h.precipitation, i),
        numAt(h.weather_code, i),
        numAt(h.pressure_msl, i),
        numAt(h.cloud_cover, i),
      ]);
    }
  }
  return out;
}

function numAt(arr: unknown[] | undefined, i: number): number | null {
  const v = arr?.[i];
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function parseWorldBank(body: unknown): Cell[][] {
  const rows = (body as { rows?: unknown[] })?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return [
      String(row.country_code ?? ""),
      String(row.country_name ?? ""),
      String(row.indicator_id ?? ""),
      String(row.indicator_name ?? ""),
      Number(row.yr ?? 0),
      row.value == null ? null : Number(row.value),
    ];
  });
}

function parseCrypto(body: unknown): Cell[][] {
  const list = Array.isArray(body) ? body : (body as { coins?: unknown[] })?.coins;
  if (!Array.isArray(list)) return [];
  return list.map((c) => {
    const coin = c as Record<string, unknown>;
    return [
      String(coin.id ?? ""),
      String(coin.symbol ?? "").toUpperCase(),
      String(coin.name ?? ""),
      Number(coin.current_price ?? 0),
      Number(coin.market_cap ?? 0),
      Number(coin.total_volume ?? 0),
      Number(coin.price_change_percentage_24h ?? 0),
      Number(coin.market_cap_rank ?? 0),
    ];
  });
}

function parseHn(body: unknown): Cell[][] {
  const hits = (body as { hits?: unknown[] })?.hits;
  if (!Array.isArray(hits)) return [];
  return hits.map((h) => {
    const hit = h as Record<string, unknown>;
    return [
      String(hit.objectID ?? ""),
      String(hit.title ?? hit.story_title ?? ""),
      String(hit.author ?? ""),
      Number(hit.points ?? 0),
      Number(hit.num_comments ?? 0),
      String(hit.url ?? ""),
      hit.created_at != null ? String(hit.created_at) : null,
    ];
  });
}

function parseIss(body: unknown): Cell[][] {
  const j = body as Record<string, unknown>;
  if (j.latitude == null || j.longitude == null) return [];
  return [[
    j.timestamp != null
      ? new Date(Number(j.timestamp) * 1000).toISOString()
      : new Date().toISOString(),
    Number(j.latitude),
    Number(j.longitude),
    Number(j.altitude ?? 0),
    Number(j.velocity ?? 0),
    String(j.visibility ?? ""),
  ]];
}

async function pollSourceOnce(kind: SourceKind) {
  const buf = sourceBufs[kind];
  const body = await fetchSourceJson(kind);
  let rows: Cell[][] = [];
  if (kind === "usgs") rows = parseUsgs(body);
  else if (kind === "nws") rows = parseNws(body);
  else if (kind === "meteo") rows = parseMeteo(body);
  else if (kind === "world_bank") {
    buf.rows = [];
    buf.seenIds.clear();
    rows = parseWorldBank(body);
  } else if (kind === "iss") rows = parseIss(body);
  else if (kind === "hn") {
    buf.rows = [];
    buf.seenIds.clear();
    rows = parseHn(body);
  } else if (kind === "crypto") {
    buf.rows = [];
    buf.seenIds.clear();
    rows = parseCrypto(body);
  }
  const idIdx =
    kind === "usgs" || kind === "nws" || kind === "hn" || kind === "crypto" ? 0 : undefined;
  pushRows(buf, rows, idIdx);
}

function parseWikiEvent(raw: string): Cell[] | null {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const meta = j.meta as Record<string, unknown> | undefined;
    if (!meta) return null;
    const idStr = String(meta.id ?? "0").replace(/\D/g, "") || "0";
    const id = Number(idStr) || Date.now();
    const len = j.length as { old?: number; new?: number } | undefined;
    const oldLen = Number(len?.old ?? 0);
    const newLen = Number(len?.new ?? 0);
    const ts = Number(j.timestamp ?? 0);
    return [
      id,
      String(j.wiki ?? ""),
      String(j.title ?? ""),
      String(j.user ?? "anonymous"),
      Boolean(j.bot),
      Boolean(j.minor),
      Number(j.namespace ?? 0),
      String(j.type ?? "edit"),
      oldLen,
      newLen,
      newLen - oldLen,
      ts ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
      String(j.server_name ?? ""),
      String(j.comment ?? ""),
    ];
  } catch {
    return null;
  }
}

// ---- Public API (used from tauri.ts when !isTauri) ----

export async function webStreamStart(): Promise<void> {
  if (wikiBuf.running) return;
  wikiBuf.running = true;
  wikiBuf.startedAt = Math.floor(Date.now() / 1000);
  wikiBuf.totalEvents = wikiBuf.totalEvents; // keep buffer across reconnects
  try {
    const es = new EventSource(WIKI_SSE);
    wikiBuf.eventSource = es;
    es.onmessage = (ev) => {
      const row = parseWikiEvent(ev.data);
      if (!row) return;
      pushRows(wikiBuf, [row], 0);
    };
    es.onerror = () => {
      /* EventSource auto-reconnects; leave running */
    };
  } catch (e) {
    wikiBuf.running = false;
    wikiBuf.startedAt = null;
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export async function webStreamStop(): Promise<void> {
  wikiBuf.eventSource?.close();
  wikiBuf.eventSource = null;
  wikiBuf.running = false;
  wikiBuf.startedAt = null;
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
}

export async function webSourceStart(kind: SourceKind): Promise<void> {
  const buf = sourceBufs[kind];
  if (buf.running) return;
  buf.running = true;
  buf.startedAt = Math.floor(Date.now() / 1000);
  await pollSourceOnce(kind);
  const ms = SOURCE_POLL_MS[kind];
  if (ms > 0) {
    buf.pollTimer = setInterval(() => {
      pollSourceOnce(kind).catch(() => {});
    }, ms);
  }
}

export async function webSourceStop(kind: SourceKind): Promise<void> {
  const buf = sourceBufs[kind];
  if (buf.pollTimer) {
    clearInterval(buf.pollTimer);
    buf.pollTimer = null;
  }
  buf.running = false;
  buf.startedAt = null;
}

export async function webSourceStatus(kind: SourceKind): Promise<SourceStatus> {
  return statusFromBuffer(sourceBufs[kind]);
}

export async function webSourceSnapshot(
  kind: SourceKind,
  limit?: number,
): Promise<InspectResult> {
  return snapshotFromBuffer(sourceBufs[kind], limit ?? 500);
}

export async function webSourceClear(kind: SourceKind): Promise<void> {
  const buf = sourceBufs[kind];
  buf.rows = [];
  buf.seenIds.clear();
  buf.totalEvents = 0;
}

export async function webCreateGitHubIssue(
  title: string,
  body: string,
  imageBase64?: string | null,
): Promise<string> {
  const res = await fetch("/api/feedback", {
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
