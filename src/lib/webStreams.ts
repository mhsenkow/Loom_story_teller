// =================================================================
// Loom — Browser stream / poll sources (web UI)
// =================================================================
// Mirrors Tauri DuckDB buffering in-memory so Live Streams work on
// loom.ibm.io without the desktop app. Poll feeds go through the
// Worker (`/api/source/*`); Wikipedia uses EventSource (CORS-open).
// =================================================================

import type { ColumnInfo } from "./store";
import type { InspectResult, SourceKind, SourceStatus, StreamStatus } from "./tauri";
import { SOURCE_DEFS } from "./sourceRegistry";
import { treasuryDebt } from "../../workers/sourceTransforms";

const MAX_ROWS = 8_000;
const WIKI_SSE = "https://stream.wikimedia.org/v2/stream/recentchange";

export type Cell = string | number | boolean | null;

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
  /** Last upstream failure (cleared by the next good poll) — shown on the source card. */
  lastError: string | null;
  /** Row cap (oldest rows dropped past it). */
  maxRows: number;
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
    eventSource: null,
    seenIds: new Set(),
    lastCountAt: { count: 0, t: Date.now() },
    lastError: null,
    maxRows,
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

// Columns + types come from the registry so web buffers, desktop tables, and Query stay aligned
const sourceBufs = Object.fromEntries(
  SOURCE_DEFS.map((d) => [d.kind, emptyBuffer(d.columns, d.types, SOURCE_MAX_ROWS[d.kind])]),
) as Record<SourceKind, BufferState>;

const SOURCE_POLL_MS = Object.fromEntries(SOURCE_DEFS.map((d) => [d.kind, d.pollMs])) as Record<SourceKind, number>;

function trim(buf: BufferState) {
  if (buf.rows.length > buf.maxRows) {
    buf.rows = buf.rows.slice(buf.rows.length - buf.maxRows);
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
    last_error: buf.lastError,
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
      "?fields=record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt&sort=-record_date&page[size]=10000",
    transform: treasuryDebt,
  },
};

async function fetchSourceJson(kind: SourceKind): Promise<unknown> {
  const direct = DIRECT_SOURCES[kind];
  if (direct) {
    try {
      const res = await fetch(direct.url, { signal: AbortSignal.timeout(20_000) });
      if (res.ok) {
        const out = direct.transform(await res.json()) as { rows?: unknown[] };
        if (out.rows?.length) return out;
      }
    } catch {
      /* fall back to the Worker */
    }
  }
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
    const id = String(f.id ?? props.ids ?? "");
    out.push([
      id,
      numOrNullVal(props.mag),
      String(props.place ?? ""),
      props.time != null ? new Date(Number(props.time)).toISOString() : null,
      coords[1] ?? 0,
      coords[0] ?? 0,
      coords[2] ?? 0,
      String(props.magType ?? ""),
      String(props.status ?? ""),
      Number(props.tsunami ?? 0) === 1,
      numOrNullVal(props.sig),
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

/** Open-Meteo GMT times often omit an offset; mark them UTC like desktop does. */
function openMeteoUtc(t: unknown): string | null {
  if (typeof t !== "string" || !t) return null;
  const s = t.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  // "2026-10-02T14:00" or "…T14:00:00" → UTC
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    return s.length === 16 ? `${s}:00.000Z` : `${s}.000Z`;
  }
  return s;
}

/** ISO string for a date-ish value; numeric epoch s vs ms handled like parseChartTime. */
function isoOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : NaN;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const s = String(v).trim();
  if (!s) return null;
  const zoned = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : /^\d{4}-\d{2}-\d{2}T/.test(s) ? `${s}Z` : s;
  const t = Date.parse(zoned);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
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
        openMeteoUtc(times[i]),
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
  // Wide: one row per country-year (Worker pivots the indicators)
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return [
      String(row.country_code ?? ""),
      String(row.country_name ?? ""),
      numOrNullVal(row.yr),
      numOrNullVal(row.gdp_usd),
      numOrNullVal(row.gdp_per_capita),
      numOrNullVal(row.population),
      numOrNullVal(row.life_expectancy),
      numOrNullVal(row.co2_per_capita),
    ];
  });
}

function numOrNullVal(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
      numOrNullVal(coin.current_price),
      numOrNullVal(coin.market_cap),
      numOrNullVal(coin.total_volume),
      numOrNullVal(coin.price_change_percentage_24h),
      numOrNullVal(coin.market_cap_rank),
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
      numOrNullVal(hit.points),
      numOrNullVal(hit.num_comments),
      String(hit.url ?? ""),
      hit.created_at != null ? String(hit.created_at) : null,
    ];
  });
}

function parseLobsters(body: unknown): Cell[][] {
  if (!Array.isArray(body)) return [];
  return body.map((h) => {
    const s = h as Record<string, unknown>;
    const user = s.submitter_user;
    const author =
      typeof user === "string"
        ? user
        : user && typeof user === "object"
          ? String((user as { username?: string }).username ?? "")
          : "";
    return [
      String(s.short_id ?? ""),
      String(s.title ?? ""),
      author,
      numOrNullVal(s.score),
      numOrNullVal(s.comment_count),
      String(s.url ?? ""),
      Array.isArray(s.tags) ? (s.tags as string[]).join(",") : String(s.tags ?? ""),
      s.created_at != null ? String(s.created_at) : null,
    ];
  });
}

function parseIss(body: unknown): Cell[][] {
  const list = Array.isArray(body) ? body : [body];
  const out: Cell[][] = [];
  for (const item of list) {
    const j = item as Record<string, unknown>;
    if (j.latitude == null || j.longitude == null) continue;
    out.push([
      j.timestamp != null
        ? new Date(Number(j.timestamp) * 1000).toISOString()
        : new Date().toISOString(),
      Number(j.latitude),
      Number(j.longitude),
      numOrNullVal(j.altitude),
      numOrNullVal(j.velocity),
      String(j.visibility ?? ""),
    ]);
  }
  return out;
}

function parseAq(body: unknown): Cell[][] {
  const cities = (body as { cities?: unknown[] })?.cities;
  if (!Array.isArray(cities)) return [];
  const out: Cell[][] = [];
  for (const c of cities) {
    const city = c as {
      name?: string;
      lat?: number;
      lon?: number;
      current?: Record<string, unknown>;
    };
    const cur = city.current ?? {};
    out.push([
      openMeteoUtc(cur.time) ?? new Date().toISOString(),
      String(city.name ?? ""),
      numOrNullVal(city.lat),
      numOrNullVal(city.lon),
      numOrNullVal(cur.pm2_5),
      numOrNullVal(cur.pm10),
      numOrNullVal(cur.ozone),
      numOrNullVal(cur.nitrogen_dioxide),
      numOrNullVal(cur.european_aqi),
    ]);
  }
  return out;
}

function parseFx(body: unknown): Cell[][] {
  const j = body as {
    base?: string;
    date?: string;
    rates?: Record<string, number | Record<string, number>>;
  };
  if (!j?.rates || typeof j.rates !== "object") return [];
  const base = String(j.base ?? "EUR");
  const entries = Object.entries(j.rates);
  // `/latest` shape: { date, rates: { USD: 1.08, … } }
  if (entries.length > 0 && typeof entries[0]![1] === "number") {
    const asOf = String(j.date ?? "");
    return entries.map(([quote, rate]) => [asOf, base, quote, Number(rate), 0]);
  }
  // Time series: { rates: { "2026-07-03": { USD: 1.08, … }, … } } → one row per (date, quote),
  // change_pct vs. the previous available day for that quote (null on its first day).
  const out: Cell[][] = [];
  const prev = new Map<string, number>();
  const days = entries
    .filter(([, v]) => v && typeof v === "object")
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [day, quotes] of days) {
    for (const [quote, raw] of Object.entries(quotes as Record<string, number>)) {
      const rate = Number(raw);
      if (!Number.isFinite(rate)) continue;
      const before = prev.get(quote);
      const change =
        before != null && before !== 0 ? Math.round(((rate - before) / before) * 100 * 10_000) / 10_000 : null;
      out.push([day, base, quote, rate, change]);
      prev.set(quote, rate);
    }
  }
  return out;
}

function parseFema(body: unknown): Cell[][] {
  const list = (body as { DisasterDeclarationsSummaries?: unknown[] })
    ?.DisasterDeclarationsSummaries;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 200).map((r) => {
    const row = r as Record<string, unknown>;
    return [
      String(row.id ?? row.disasterNumber ?? ""),
      numOrNullVal(row.disasterNumber),
      String(row.state ?? ""),
      String(row.declarationType ?? ""),
      String(row.declarationTitle ?? ""),
      String(row.incidentType ?? ""),
      row.declarationDate != null ? String(row.declarationDate) : null,
      row.incidentBeginDate != null ? String(row.incidentBeginDate) : null,
      numOrNullVal(row.fyDeclared),
    ];
  });
}

function parseOpensky(body: unknown): Cell[][] {
  const states = (body as { states?: unknown[]; time?: number })?.states;
  const snapTime = Number((body as { time?: number })?.time ?? 0);
  if (!Array.isArray(states)) return [];
  const out: Cell[][] = [];
  for (const st of states.slice(0, 800)) {
    if (!Array.isArray(st) || st.length < 9) continue;
    const lon = st[5] == null ? null : Number(st[5]);
    const lat = st[6] == null ? null : Number(st[6]);
    if (lon == null || lat == null || Number.isNaN(lon) || Number.isNaN(lat)) continue;
    // Prefer last_contact (4) then time_position (3) over the poll snapshot time.
    const contact = Number(st[4] ?? st[3] ?? snapTime) || 0;
    out.push([
      String(st[0] ?? ""),
      String(st[1] ?? "").trim(),
      String(st[2] ?? ""),
      lon,
      lat,
      numOrNullVal(st[7]),
      numOrNullVal(st[9]),
      numOrNullVal(st[10]),
      Boolean(st[8]),
      contact
        ? new Date(contact * 1000).toISOString()
        : new Date().toISOString(),
    ]);
  }
  return out;
}

function parseCountries(body: unknown): Cell[][] {
  if (!Array.isArray(body)) return [];
  return body.map((r) => {
    const row = r as {
      name?: { common?: string };
      cca3?: string;
      region?: string;
      subregion?: string;
      population?: number | null;
      area?: number | null;
      capital?: string[];
      independent?: boolean;
    };
    const pop = numOrNullVal(row.population);
    const area = numOrNullVal(row.area);
    return [
      String(row.name?.common ?? ""),
      String(row.cca3 ?? ""),
      String(row.region ?? ""),
      String(row.subregion ?? ""),
      pop,
      area,
      pop != null && area != null && area > 0 ? pop / area : null,
      String(row.capital?.[0] ?? ""),
      Boolean(row.independent),
    ];
  });
}

function parseSpacex(body: unknown): Cell[][] {
  if (!Array.isArray(body)) return [];
  const start = Math.max(0, body.length - 120);
  return body.slice(start).map((r) => {
    const row = r as Record<string, unknown>;
    return [
      String(row.id ?? ""),
      String(row.name ?? ""),
      row.date_utc != null ? String(row.date_utc) : null,
      Boolean(row.success),
      Boolean(row.upcoming),
      String(row.rocket ?? ""),
      numOrNullVal(row.flight_number),
      String(row.details ?? "").slice(0, 280),
    ];
  });
}

function parseNyc311(body: unknown): Cell[][] {
  if (!Array.isArray(body)) return [];
  return body.map((r) => {
    const row = r as Record<string, unknown>;
    return [
      String(row.unique_key ?? ""),
      row.created_date != null ? String(row.created_date) : null,
      String(row.complaint_type ?? ""),
      String(row.descriptor ?? ""),
      String(row.borough ?? ""),
      String(row.city ?? ""),
      numOrNullVal(row.latitude),
      numOrNullVal(row.longitude),
      String(row.status ?? ""),
      String(row.agency ?? ""),
    ];
  });
}

function parseCovid(body: unknown): Cell[][] {
  if (!Array.isArray(body)) return [];
  return body.map((r) => {
    const row = r as Record<string, unknown>;
    return [
      String(row.country ?? ""),
      numOrNullVal(row.cases),
      numOrNullVal(row.todayCases),
      numOrNullVal(row.deaths),
      numOrNullVal(row.todayDeaths),
      numOrNullVal(row.recovered),
      numOrNullVal(row.active),
      numOrNullVal(row.casesPerOneMillion),
      numOrNullVal(row.deathsPerOneMillion),
      numOrNullVal(row.population),
      String(row.continent ?? ""),
    ];
  });
}

function parseLaunches(body: unknown): Cell[][] {
  const list = (body as { results?: unknown[] })?.results;
  if (!Array.isArray(list)) return [];
  // Launch Library 2 normal mode has objects; list mode has plain strings
  // (pad, location, lsp_name, mission, rocket only in the "Rocket | Mission" name).
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return list.map((r) => {
    const row = r as Record<string, unknown>;
    const status = row.status as { name?: string; abbrev?: string } | undefined;
    const pad = row.pad as { name?: string; location?: { name?: string } } | string | undefined;
    const padObj = typeof pad === "object" && pad ? pad : undefined;
    const agency = row.launch_service_provider as { name?: string } | undefined;
    const rocket = row.rocket as { configuration?: { full_name?: string; name?: string } } | undefined;
    const mission = row.mission as { type?: string; orbit?: { name?: string; abbrev?: string } | null } | string | undefined;
    const missionObj = typeof mission === "object" && mission ? mission : undefined;
    const name = String(row.name ?? "");
    const orbitName = String(missionObj?.orbit?.name ?? missionObj?.orbit?.abbrev ?? "");
    const orbital = orbitName
      ? !/sub-?orbit/i.test(orbitName)
      : Boolean(missionObj?.type?.toLowerCase().includes("orbit"));
    return [
      String(row.id ?? ""),
      name,
      row.net != null ? String(row.net) : null,
      String(status?.name ?? status?.abbrev ?? ""),
      String(padObj?.name ?? str(pad)),
      String(padObj?.location?.name ?? str(row.location)),
      String(agency?.name ?? str(row.lsp_name)),
      String(
        rocket?.configuration?.full_name ??
          rocket?.configuration?.name ??
          (name.includes(" | ") ? name.split(" | ")[0] : ""),
      ),
      orbital,
    ];
  });
}

function parseEonet(body: unknown): Cell[][] {
  const events = (body as { events?: unknown[] })?.events;
  if (!Array.isArray(events)) return [];
  const out: Cell[][] = [];
  for (const e of events) {
    const ev = e as {
      id?: string;
      title?: string;
      closed?: string | null;
      categories?: { title?: string }[];
      sources?: { id?: string }[];
      geometry?: {
        date?: string;
        type?: string;
        coordinates?: unknown;
        magnitudeValue?: number | null;
        magnitudeUnit?: string | null;
      }[];
    };
    // Latest geometry point (events like storms carry a track)
    let latest: NonNullable<typeof ev.geometry>[number] | undefined;
    let latestT = -Infinity;
    for (const g of ev.geometry ?? []) {
      const t = Date.parse(String(g.date ?? ""));
      const tt = Number.isNaN(t) ? -Infinity : t;
      if (!latest || tt >= latestT) {
        latest = g;
        latestT = tt;
      }
    }
    if (!latest) continue;
    const ll = eonetLonLat(latest.type, latest.coordinates);
    if (!ll) continue;
    out.push([
      String(ev.id ?? ""),
      String(ev.title ?? ""),
      String(ev.categories?.[0]?.title ?? ""),
      String(ev.sources?.[0]?.id ?? ""),
      isoOrNull(latest.date),
      ll[1],
      ll[0],
      numOrNullVal(latest.magnitudeValue),
      latest.magnitudeUnit != null ? String(latest.magnitudeUnit) : null,
      ev.closed ? "closed" : "open",
    ]);
  }
  return out;
}

/** EONET geometry → [lon, lat]; Polygon → centroid (vertex mean) of the first ring. */
function eonetLonLat(type: string | undefined, coords: unknown): [number, number] | null {
  if (type === "Polygon" && Array.isArray(coords) && Array.isArray(coords[0])) {
    let ring = (coords[0] as unknown[]).filter(
      (p): p is number[] => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])),
    );
    if (ring.length > 1) {
      const [f, l] = [ring[0]!, ring[ring.length - 1]!];
      if (f[0] === l[0] && f[1] === l[1]) ring = ring.slice(0, -1);
    }
    if (ring.length === 0) return null;
    const lon = ring.reduce((n, p) => n + Number(p[0]), 0) / ring.length;
    const lat = ring.reduce((n, p) => n + Number(p[1]), 0) / ring.length;
    return [lon, lat];
  }
  if (Array.isArray(coords) && coords.length >= 2) {
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) return [lon, lat];
  }
  return null;
}

function parseCitibike(body: unknown): Cell[][] {
  const stations = (body as { stations?: unknown[] })?.stations;
  if (!Array.isArray(stations)) return [];
  return stations.map((s) => {
    const st = s as Record<string, unknown>;
    return [
      String(st.station_id ?? ""),
      String(st.name ?? ""),
      numOrNullVal(st.latitude),
      numOrNullVal(st.longitude),
      numOrNullVal(st.capacity),
      numOrNullVal(st.bikes_available),
      numOrNullVal(st.ebikes_available),
      numOrNullVal(st.docks_available),
      numOrNullVal(st.pct_full),
      Boolean(st.is_renting),
      isoOrNull(st.ts),
    ];
  });
}

/** NOAA G-scale from Kp (thirds notation: 4.67 = "5-" counts as Kp 5). */
export function stormLevel(kp: number | null): string {
  if (kp == null) return "";
  const k = Math.round(kp);
  if (k >= 9) return "G5";
  if (k >= 5) return `G${k - 4}`;
  return "G0";
}

function parseSpaceWeather(body: unknown): Cell[][] {
  if (!Array.isArray(body)) return [];
  let rows: Record<string, unknown>[];
  // Legacy shape: [["time_tag","Kp","a_running","station_count"], [...], …]
  if (Array.isArray(body[0])) {
    const header = (body[0] as unknown[]).map(String);
    rows = body.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r as unknown[])[i]])));
  } else {
    rows = body as Record<string, unknown>[];
  }
  const out: Cell[][] = [];
  for (const r of rows) {
    const tag = String(r.time_tag ?? "");
    if (!tag) continue;
    // time_tag is UTC without a zone ("2026-09-25T00:00:00")
    const ts = isoOrNull(/[zZ]|[+-]\d\d:?\d\d$/.test(tag) ? tag : `${tag.replace(" ", "T")}Z`);
    const kp = numOrNullVal(r.Kp ?? r.kp);
    out.push([ts, kp, numOrNullVal(r.a_running), numOrNullVal(r.station_count), stormLevel(kp)]);
  }
  return out;
}

function parseUkCarbon(body: unknown): Cell[][] {
  const data = (body as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return [];
  return data.map((d) => {
    const row = d as { from?: string; intensity?: { forecast?: number; actual?: number | null; index?: string } };
    return [
      isoOrNull(row.from),
      numOrNullVal(row.intensity?.forecast),
      numOrNullVal(row.intensity?.actual),
      row.intensity?.index != null ? String(row.intensity.index) : null,
    ];
  });
}

const WIKI_SKIP_ARTICLE = new Set(["Main_Page", "-"]);
const WIKI_SKIP_NS =
  /^(Special|File|Wikipedia|Portal|Talk|Help|Category|Template|User|Draft|Module|MediaWiki|TimedText)(_talk)?:/;

function parsePageviews(body: unknown): Cell[][] {
  const item = (body as { items?: unknown[] })?.items?.[0] as
    | { year?: string; month?: string; day?: string; articles?: { article?: string; views?: number }[] }
    | undefined;
  if (!item || !Array.isArray(item.articles)) return [];
  const day = item.year && item.month && item.day ? `${item.year}-${item.month}-${item.day}` : null;
  const out: Cell[][] = [];
  for (const a of item.articles) {
    const name = String(a.article ?? "");
    if (!name || WIKI_SKIP_ARTICLE.has(name) || WIKI_SKIP_NS.test(name)) continue;
    out.push([out.length + 1, name.replace(/_/g, " "), numOrNullVal(a.views), day]);
    if (out.length >= 100) break;
  }
  return out;
}

function parseClimate(body: unknown): Cell[][] {
  const data = (body as { data?: Record<string, unknown> })?.data;
  if (!data || typeof data !== "object") return [];
  const out: Cell[][] = [];
  for (const key of Object.keys(data).sort()) {
    const m = key.match(/^(\d{4})(\d{2})$/);
    if (!m) continue;
    const raw = data[key];
    // Values are { departure } (current API), { anomaly }, or a bare number
    const v =
      raw && typeof raw === "object"
        ? numOrNullVal((raw as { departure?: unknown; anomaly?: unknown }).departure ??
            (raw as { anomaly?: unknown }).anomaly)
        : numOrNullVal(raw);
    if (v == null || v <= -999) continue;
    out.push([`${m[1]}-${m[2]}-01`, Number(m[1]), Number(m[2]), v]);
  }
  return out;
}

/**
 * Worker `{ columns, rows }` bodies (gdacs, buoys, mbta, aurora, asteroids,
 * steam, bitcoin, debt) → rows in registry column order, matched by column
 * name and coerced to the registry type. A column the Worker doesn't send
 * comes through as null; missing numbers stay null (never 0).
 */
function parseColumnar(kind: SourceKind): SourceParser {
  const def = SOURCE_DEFS.find((d) => d.kind === kind)!;
  return (body) => {
    const b = body as { columns?: unknown; rows?: unknown };
    if (!Array.isArray(b?.columns) || !Array.isArray(b.rows)) return [];
    const from = def.columns.map((c) => (b.columns as unknown[]).indexOf(c));
    const coerce = def.types.map((t) => CELL_COERCE[t] ?? strCell);
    const out: Cell[][] = [];
    for (const r of b.rows) {
      if (!Array.isArray(r)) continue;
      out.push(from.map((i, c) => (i < 0 ? null : coerce[c]!(r[i]))));
    }
    return out;
  };
}

function strCell(v: unknown): string | null {
  return v == null || v === "" ? null : String(v);
}

const CELL_COERCE: Record<string, (v: unknown) => Cell> = {
  DOUBLE: numOrNullVal,
  FLOAT: numOrNullVal,
  INTEGER: numOrNullVal,
  BIGINT: numOrNullVal,
  BOOLEAN: (v) => (v == null ? null : v === true || v === 1 || v === "true"),
  TIMESTAMP: isoOrNull,
  DATE: (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : isoOrNull(v)?.slice(0, 10) ?? null),
  VARCHAR: strCell,
};

type SourceParser = (body: unknown) => Cell[][];

const SOURCE_PARSERS: Record<SourceKind, SourceParser> = {
  usgs: parseUsgs,
  eonet: parseEonet,
  gdacs: parseColumnar("gdacs"),
  nws: parseNws,
  meteo: parseMeteo,
  aq: parseAq,
  ukcarbon: parseUkCarbon,
  climate: parseClimate,
  buoys: parseColumnar("buoys"),
  firms: parseColumnar("firms"),
  nwis: parseColumnar("nwis"),
  opensky: parseOpensky,
  citibike: parseCitibike,
  mbta: parseColumnar("mbta"),
  nyc311: parseNyc311,
  iss: parseIss,
  launches: parseLaunches,
  spacex: parseSpacex,
  spaceweather: parseSpaceWeather,
  aurora: parseColumnar("aurora"),
  asteroids: parseColumnar("asteroids"),
  starlink: parseColumnar("starlink"),
  hn: parseHn,
  lobsters: parseLobsters,
  pageviews: parsePageviews,
  steam: parseColumnar("steam"),
  crypto: parseCrypto,
  bitcoin: parseColumnar("bitcoin"),
  fx: parseFx,
  debt: parseColumnar("debt"),
  fema: parseFema,
  covid: parseCovid,
  countries: parseCountries,
  world_bank: parseWorldBank,
};

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
  fema: { mode: "replace", key: 0 },
  covid: { mode: "replace" },
  countries: { mode: "replace" },
  world_bank: { mode: "replace" },
};

/** Parse a `/api/source/<kind>` body into rows in registry column order. */
export function parseSourceRows(kind: SourceKind, body: unknown): Cell[][] {
  return SOURCE_PARSERS[kind](body);
}

async function pollSourceOnce(kind: SourceKind) {
  const buf = sourceBufs[kind];
  let body: unknown;
  // Sparse ISS buffer → seed one orbit so ribbons aren't a single tip.
  if (kind === "iss" && buf.rows.length < 3) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      const res = await fetch("/api/source/iss_trail", { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) body = await res.json();
    } catch {
      /* fall through to live tip */
    }
  }
  if (body === undefined) body = await fetchSourceJson(kind);
  const rows = parseSourceRows(kind, body);

  if (kind === "opensky") {
    // Append snapshots so trailRibbon can stitch paths per icao24 over time.
    for (const row of rows) {
      const id = `${String(row[0] ?? "")}|${String(row[9] ?? "")}`;
      if (id !== "|" && buf.seenIds.has(id)) continue;
      if (id !== "|") buf.seenIds.add(id);
      buf.rows.push(row);
      buf.totalEvents += 1;
    }
    trim(buf);
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
    const idStr = String(meta.id ?? "0").replace(/\D/g, "") || "0";
    const id = Number(idStr) || Date.now();
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
  // A failed poll must not strand the feed: record the error, keep the schedule, and let
  // the next poll recover (load-once feeds retry every minute until they have data).
  const poll = async () => {
    try {
      await pollSourceOnce(kind);
      buf.lastError = null;
    } catch (e) {
      buf.lastError = e instanceof Error ? e.message : String(e);
    }
  };
  await poll();
  const ms = SOURCE_POLL_MS[kind] || (buf.rows.length === 0 ? 60_000 : 0);
  if (ms > 0) {
    buf.pollTimer = setInterval(() => {
      if (SOURCE_POLL_MS[kind] === 0 && buf.rows.length > 0 && buf.pollTimer) {
        clearInterval(buf.pollTimer);
        buf.pollTimer = null;
        return;
      }
      void poll();
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
