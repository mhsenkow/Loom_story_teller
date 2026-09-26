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
  aq: emptyBuffer(
    ["ts", "city", "latitude", "longitude", "pm2_5", "pm10", "ozone", "nitrogen_dioxide", "european_aqi"],
    ["TIMESTAMP", "VARCHAR", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE"],
  ),
  fx: emptyBuffer(
    ["as_of", "base", "quote", "rate", "change_pct"],
    ["DATE", "VARCHAR", "VARCHAR", "DOUBLE", "DOUBLE"],
  ),
  fema: emptyBuffer(
    ["id", "disaster_number", "state", "declaration_type", "declaration_title", "incident_type", "declaration_date", "incident_begin", "fy_declared"],
    ["VARCHAR", "INTEGER", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "TIMESTAMP", "TIMESTAMP", "INTEGER"],
  ),
  opensky: emptyBuffer(
    ["icao24", "callsign", "origin_country", "longitude", "latitude", "baro_altitude", "velocity", "true_track", "on_ground", "ts"],
    ["VARCHAR", "VARCHAR", "VARCHAR", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "BOOLEAN", "TIMESTAMP"],
  ),
  countries: emptyBuffer(
    ["name", "cca3", "region", "subregion", "population", "area", "density", "capital", "independent"],
    ["VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "BIGINT", "DOUBLE", "DOUBLE", "VARCHAR", "BOOLEAN"],
  ),
  spacex: emptyBuffer(
    ["id", "name", "date_utc", "success", "upcoming", "rocket", "flight_number", "details"],
    ["VARCHAR", "VARCHAR", "TIMESTAMP", "BOOLEAN", "BOOLEAN", "VARCHAR", "INTEGER", "VARCHAR"],
  ),
  nyc311: emptyBuffer(
    ["unique_key", "created_date", "complaint_type", "descriptor", "borough", "city", "latitude", "longitude", "status", "agency"],
    ["VARCHAR", "TIMESTAMP", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "DOUBLE", "DOUBLE", "VARCHAR", "VARCHAR"],
  ),
  covid: emptyBuffer(
    ["country", "cases", "today_cases", "deaths", "today_deaths", "recovered", "active", "cases_per_million", "deaths_per_million", "population", "continent"],
    ["VARCHAR", "BIGINT", "BIGINT", "BIGINT", "BIGINT", "BIGINT", "BIGINT", "DOUBLE", "DOUBLE", "BIGINT", "VARCHAR"],
  ),
  launches: emptyBuffer(
    ["id", "name", "net", "status", "pad", "location", "agency", "rocket", "orbital"],
    ["VARCHAR", "VARCHAR", "TIMESTAMP", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "BOOLEAN"],
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
  aq: 300_000,
  fx: 3_600_000,
  fema: 600_000,
  opensky: 30_000,
  countries: 0,
  spacex: 3_600_000,
  nyc311: 300_000,
  covid: 1_800_000,
  launches: 1_800_000,
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
      Number(j.altitude ?? 0),
      Number(j.velocity ?? 0),
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
      String(cur.time ?? new Date().toISOString()),
      String(city.name ?? ""),
      Number(city.lat ?? 0),
      Number(city.lon ?? 0),
      Number(cur.pm2_5 ?? 0),
      Number(cur.pm10 ?? 0),
      Number(cur.ozone ?? 0),
      Number(cur.nitrogen_dioxide ?? 0),
      Number(cur.european_aqi ?? 0),
    ]);
  }
  return out;
}

function parseFx(body: unknown): Cell[][] {
  const j = body as { base?: string; date?: string; rates?: Record<string, number> };
  if (!j.rates) return [];
  const base = String(j.base ?? "EUR");
  const asOf = String(j.date ?? "");
  return Object.entries(j.rates).map(([quote, rate]) => [
    asOf,
    base,
    quote,
    Number(rate),
    0,
  ]);
}

function parseFema(body: unknown): Cell[][] {
  const list = (body as { DisasterDeclarationsSummaries?: unknown[] })
    ?.DisasterDeclarationsSummaries;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 200).map((r) => {
    const row = r as Record<string, unknown>;
    return [
      String(row.id ?? row.disasterNumber ?? ""),
      Number(row.disasterNumber ?? 0),
      String(row.state ?? ""),
      String(row.declarationType ?? ""),
      String(row.declarationTitle ?? ""),
      String(row.incidentType ?? ""),
      row.declarationDate != null ? String(row.declarationDate) : null,
      row.incidentBeginDate != null ? String(row.incidentBeginDate) : null,
      Number(row.fyDeclared ?? 0),
    ];
  });
}

function parseOpensky(body: unknown): Cell[][] {
  const states = (body as { states?: unknown[]; time?: number })?.states;
  const time = Number((body as { time?: number })?.time ?? 0);
  if (!Array.isArray(states)) return [];
  const out: Cell[][] = [];
  for (const st of states.slice(0, 800)) {
    if (!Array.isArray(st) || st.length < 9) continue;
    const lon = st[5] == null ? null : Number(st[5]);
    const lat = st[6] == null ? null : Number(st[6]);
    if (lon == null || lat == null || Number.isNaN(lon) || Number.isNaN(lat)) continue;
    out.push([
      String(st[0] ?? ""),
      String(st[1] ?? "").trim(),
      String(st[2] ?? ""),
      lon,
      lat,
      Number(st[7] ?? 0),
      Number(st[9] ?? 0),
      Number(st[10] ?? 0),
      Boolean(st[8]),
      time ? new Date(time * 1000).toISOString() : new Date().toISOString(),
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
      population?: number;
      area?: number;
      capital?: string[];
      independent?: boolean;
    };
    const pop = Number(row.population ?? 0);
    const area = Number(row.area ?? 0);
    return [
      String(row.name?.common ?? ""),
      String(row.cca3 ?? ""),
      String(row.region ?? ""),
      String(row.subregion ?? ""),
      pop,
      area,
      area > 0 ? pop / area : 0,
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
      Number(row.flight_number ?? 0),
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
      Number(row.latitude ?? 0),
      Number(row.longitude ?? 0),
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
      Number(row.cases ?? 0),
      Number(row.todayCases ?? 0),
      Number(row.deaths ?? 0),
      Number(row.todayDeaths ?? 0),
      Number(row.recovered ?? 0),
      Number(row.active ?? 0),
      Number(row.casesPerOneMillion ?? 0),
      Number(row.deathsPerOneMillion ?? 0),
      Number(row.population ?? 0),
      String(row.continent ?? ""),
    ];
  });
}

function parseLaunches(body: unknown): Cell[][] {
  const list = (body as { results?: unknown[] })?.results;
  if (!Array.isArray(list)) return [];
  return list.map((r) => {
    const row = r as Record<string, unknown>;
    const status = row.status as { name?: string; abbrev?: string } | undefined;
    const pad = row.pad as { name?: string; location?: { name?: string } } | undefined;
    const agency = row.launch_service_provider as { name?: string } | undefined;
    const rocket = row.rocket as { configuration?: { full_name?: string; name?: string } } | undefined;
    const mission = row.mission as { type?: string } | undefined;
    return [
      String(row.id ?? ""),
      String(row.name ?? ""),
      row.net != null ? String(row.net) : null,
      String(status?.name ?? status?.abbrev ?? ""),
      String(pad?.name ?? ""),
      String(pad?.location?.name ?? ""),
      String(agency?.name ?? ""),
      String(rocket?.configuration?.full_name ?? rocket?.configuration?.name ?? ""),
      Boolean(mission?.type?.toLowerCase().includes("orbit")),
    ];
  });
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
  let rows: Cell[][] = [];
  if (kind === "usgs") rows = parseUsgs(body);
  else if (kind === "nws") rows = parseNws(body);
  else if (kind === "meteo") rows = parseMeteo(body);
  else if (kind === "world_bank") {
    buf.rows = [];
    buf.seenIds.clear();
    rows = parseWorldBank(body);
  } else if (kind === "iss") {
    rows = parseIss(body);
  } else if (kind === "hn") {
    buf.rows = [];
    buf.seenIds.clear();
    rows = parseHn(body);
  } else if (kind === "crypto") {
    buf.rows = [];
    buf.seenIds.clear();
    rows = parseCrypto(body);
  } else if (kind === "aq") {
    buf.rows = [];
    buf.seenIds.clear();
    rows = parseAq(body);
  } else if (kind === "fx") {
    buf.rows = [];
    buf.seenIds.clear();
    rows = parseFx(body);
  } else if (kind === "fema") {
    buf.rows = [];
    buf.seenIds.clear();
    rows = parseFema(body);
  } else if (kind === "opensky") {
    // Append snapshots so trailRibbon can stitch paths per icao24 over time.
    rows = parseOpensky(body);
  } else if (kind === "countries") {
    buf.rows = [];
    buf.seenIds.clear();
    rows = parseCountries(body);
  } else if (kind === "spacex") {
    buf.rows = [];
    buf.seenIds.clear();
    rows = parseSpacex(body);
  } else if (kind === "nyc311") {
    buf.rows = [];
    buf.seenIds.clear();
    rows = parseNyc311(body);
  } else if (kind === "covid") {
    buf.rows = [];
    buf.seenIds.clear();
    rows = parseCovid(body);
  } else if (kind === "launches") {
    buf.rows = [];
    buf.seenIds.clear();
    rows = parseLaunches(body);
  }

  if (kind === "opensky") {
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

  const idIdx =
    kind === "usgs" ||
    kind === "nws" ||
    kind === "hn" ||
    kind === "crypto" ||
    kind === "fema" ||
    kind === "spacex" ||
    kind === "nyc311" ||
    kind === "launches"
      ? 0
      : kind === "iss"
        ? 0 // timestamp — keep trail unique across seed + tip polls
        : undefined;
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
