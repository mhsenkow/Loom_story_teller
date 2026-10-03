// =================================================================
// Loom — Worker upstream transforms (pure, no fetch / no Workers APIs)
// =================================================================
// `/api/source/<kind>` sometimes has to stitch, trim, or re-shape an
// upstream so the browser parsers in src/lib/webStreams.ts keep reading
// one stable shape (e.g. ADSB.lol → OpenSky `states`, CoinPaprika →
// CoinGecko markets). Kept free of fetch/caches so Vitest can cover it.
// =================================================================

type Json = Record<string, unknown>;

const asObj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---- Cities (Open-Meteo weather + air quality) ----

export const WORLD_CITIES = [
  { name: "New York", lat: 40.71, lon: -74.01 },
  { name: "Los Angeles", lat: 34.05, lon: -118.24 },
  { name: "Mexico City", lat: 19.43, lon: -99.13 },
  { name: "São Paulo", lat: -23.55, lon: -46.63 },
  { name: "London", lat: 51.51, lon: -0.13 },
  { name: "Moscow", lat: 55.76, lon: 37.62 },
  { name: "Cairo", lat: 30.04, lon: 31.24 },
  { name: "Lagos", lat: 6.52, lon: 3.38 },
  { name: "Mumbai", lat: 19.08, lon: 72.88 },
  { name: "Beijing", lat: 39.9, lon: 116.41 },
  { name: "Tokyo", lat: 35.68, lon: 139.69 },
  { name: "Sydney", lat: -33.87, lon: 151.21 },
] as const;

/** Open-Meteo multi-location answer (array, or a bare object for one city) → `{ cities }`. */
export function openMeteoCities(
  body: unknown,
  key: "hourly" | "current",
  cities: readonly { name: string; lat: number; lon: number }[] = WORLD_CITIES,
): { cities: { name: string; lat: number; lon: number; hourly?: Json; current?: Json }[] } {
  const list = Array.isArray(body) ? body : [body];
  const out = [];
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i]!;
    const entry = asObj(list[i]);
    if (!entry[key]) continue;
    out.push({ name: city.name, lat: city.lat, lon: city.lon, [key]: asObj(entry[key]) });
  }
  return { cities: out };
}

// ---- NWS alerts ----

const NWS_PROPS = [
  "id",
  "event",
  "headline",
  "severity",
  "certainty",
  "urgency",
  "areaDesc",
  "senderName",
  "effective",
  "expires",
  "status",
  "category",
  "sent",
] as const;

/** Full NWS active-alerts FeatureCollection (~1.7 MB) → newest `max` features, parser fields only. */
export function trimNwsAlerts(body: unknown, max = 150): { type: "FeatureCollection"; features: Json[] } {
  const feats = asArr(asObj(body).features).map((f) => asObj(f));
  const when = (f: Json) => {
    const p = asObj(f.properties);
    const t = Date.parse(String(p.sent ?? p.effective ?? ""));
    return Number.isNaN(t) ? 0 : t;
  };
  feats.sort((a, b) => when(b) - when(a));
  return {
    type: "FeatureCollection",
    features: feats.slice(0, max).map((f) => {
      const p = asObj(f.properties);
      const props: Json = {};
      for (const k of NWS_PROPS) if (p[k] !== undefined) props[k] = p[k];
      return { id: f.id ?? p.id ?? "", properties: props };
    }),
  };
}

// ---- Crypto (CoinPaprika fallback → CoinGecko markets shape) ----

export function paprikaToGecko(body: unknown): Json[] {
  return asArr(body).map((t) => {
    const c = asObj(t);
    const usd = asObj(asObj(c.quotes).USD);
    return {
      id: String(c.id ?? ""),
      symbol: String(c.symbol ?? "").toLowerCase(),
      name: String(c.name ?? ""),
      current_price: numOrNull(usd.price),
      market_cap: numOrNull(usd.market_cap),
      total_volume: numOrNull(usd.volume_24h),
      price_change_percentage_24h: numOrNull(usd.percent_change_24h),
      market_cap_rank: numOrNull(c.rank),
    };
  });
}

// ---- Aircraft (ADSB.lol fallback → OpenSky `states`) ----

/** Query points spread over the contiguous US (250 nm radius each). */
export const ADSB_POINTS = [
  { name: "New York", lat: 40.7, lon: -74.0 },
  { name: "Chicago", lat: 41.9, lon: -87.6 },
  { name: "Dallas", lat: 32.9, lon: -97.0 },
  { name: "Denver", lat: 39.7, lon: -104.9 },
  { name: "Los Angeles", lat: 34.0, lon: -118.2 },
] as const;

const FT_TO_M = 0.3048;
const KT_TO_MS = 0.514444;

/**
 * ADSB.lol `/v2/point` answers → OpenSky `/states/all` shape. Points are
 * interleaved round-robin so any prefix (the parser keeps the first 800)
 * stays spread across the country; aircraft seen by two points are deduped
 * by hex. State vector indices follow OpenSky: 0 icao24, 1 callsign,
 * 2 origin_country, 3 time_position, 4 last_contact, 5 lon, 6 lat,
 * 7 baro_altitude (m), 8 on_ground, 9 velocity (m/s), 10 true_track,
 * 11 vertical_rate (m/s), 12 sensors, 13 geo_altitude (m), 14 squawk,
 * 15 spi, 16 position_source.
 */
export function adsbToOpensky(
  bodies: unknown[],
  max = 2000,
): { time: number; source: string; states: unknown[][] } {
  let nowMs = 0;
  const lists = bodies.map((b) => {
    const o = asObj(b);
    nowMs = Math.max(nowMs, Number(o.now ?? 0) || 0);
    return asArr(o.ac).map((a) => asObj(a));
  });
  if (!nowMs) nowMs = Date.now();
  const time = Math.floor(nowMs / 1000);
  const seen = new Set<string>();
  const states: unknown[][] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest && states.length < max; i++) {
    for (const list of lists) {
      const a = list[i];
      if (!a) continue;
      const hex = String(a.hex ?? "").toLowerCase();
      const lat = numOrNull(a.lat);
      const lon = numOrNull(a.lon);
      if (!hex || lat == null || lon == null || seen.has(hex)) continue;
      seen.add(hex);
      const onGround = a.alt_baro === "ground";
      const altFt = onGround ? 0 : numOrNull(a.alt_baro);
      const geomFt = numOrNull(a.alt_geom);
      const gs = numOrNull(a.gs);
      const rate = numOrNull(a.baro_rate ?? a.geom_rate);
      const seenPos = numOrNull(a.seen_pos) ?? 0;
      states.push([
        hex,
        String(a.flight ?? "").trim(),
        "",
        Math.round(time - seenPos),
        Math.round(time - (numOrNull(a.seen) ?? 0)),
        lon,
        lat,
        altFt == null ? null : Math.round(altFt * FT_TO_M * 10) / 10,
        onGround,
        gs == null ? null : Math.round(gs * KT_TO_MS * 100) / 100,
        numOrNull(a.track),
        rate == null ? null : Math.round(rate * FT_TO_M / 60 * 100) / 100,
        null,
        geomFt == null ? null : Math.round(geomFt * FT_TO_M * 10) / 10,
        a.squawk != null ? String(a.squawk) : null,
        false,
        0,
      ]);
      if (states.length >= max) break;
    }
  }
  return { time, source: "adsb.lol", states };
}

// ---- SpaceX history (Launch Library 2 → SpaceX v5 launch shape) ----

/** LL2 `/launch/previous/?lsp__name=SpaceX` (list or normal mode) → objects `parseSpacex` reads. */
export function ll2ToSpacex(body: unknown): Json[] {
  return asArr(asObj(body).results).map((r) => {
    const row = asObj(r);
    const name = String(row.name ?? "");
    const [rocketFromName, missionFromName] = name.includes(" | ") ? name.split(" | ") : ["", name];
    const status = asObj(row.status);
    const mission = asObj(row.mission);
    const rocketCfg = asObj(asObj(row.rocket).configuration);
    const count = numOrNull(row.agency_launch_attempt_count);
    // list mode: `mission` is a string; normal mode: `{ name, description, … }`
    const missionName = typeof row.mission === "string" ? row.mission : String(mission.name ?? "");
    return {
      id: String(row.id ?? ""),
      name: missionName || missionFromName || name,
      date_utc: row.net != null ? String(row.net) : null,
      success: String(status.abbrev ?? "") === "Success",
      upcoming: false,
      rocket: String(rocketCfg.name ?? rocketCfg.full_name ?? "") || rocketFromName || "",
      flight_number: count,
      details: typeof mission.description === "string" ? mission.description : null,
    };
  });
}

// ---- Countries (mledoze/countries + World Bank population → REST Countries v3.1 shape) ----

/** Codes where mledoze and the World Bank disagree. */
const CCA3_TO_WB: Record<string, string> = { UNK: "XKX" };

export function mergeCountries(mledoze: unknown, wbPopulation: unknown): Json[] {
  const pop = new Map<string, number>();
  const wbRows = Array.isArray(wbPopulation) ? asArr(wbPopulation[1]) : [];
  for (const e of wbRows) {
    const o = asObj(e);
    const code = String(o.countryiso3code ?? "");
    const v = numOrNull(o.value);
    if (code && v != null) pop.set(code, v);
  }
  return asArr(mledoze).map((c) => {
    const o = asObj(c);
    const cca3 = String(o.cca3 ?? "");
    const capital = asArr(o.capital).map(String);
    return {
      name: { common: String(asObj(o.name).common ?? "") },
      cca3,
      region: String(o.region ?? ""),
      subregion: String(o.subregion ?? ""),
      population: pop.get(CCA3_TO_WB[cca3] ?? cca3) ?? null,
      area: numOrNull(o.area),
      capital,
      independent: Boolean(o.independent),
    };
  });
}

// ---- World Bank (wide country-year rows) ----

export const WB_WIDE_INDICATORS = [
  { id: "NY.GDP.MKTP.CD", column: "gdp_usd" },
  { id: "NY.GDP.PCAP.CD", column: "gdp_per_capita" },
  { id: "SP.POP.TOTL", column: "population" },
  { id: "SP.DYN.LE00.IN", column: "life_expectancy" },
  { id: "EN.GHG.CO2.PC.CE.AR5", column: "co2_per_capita" },
] as const;

/**
 * `countryList` = `/v2/country?format=json&per_page=400` (aggregates have
 * `region.id === "NA"`); `bodies[i]` = indicator `WB_WIDE_INDICATORS[i]`
 * answers (`[meta, rows]`). Returns one row per real country-year with at
 * least one non-null indicator.
 */
export function worldBankWide(countryList: unknown, bodies: unknown[]): { rows: Json[] } {
  const real = new Map<string, string>();
  const list = Array.isArray(countryList) ? asArr(countryList[1]) : [];
  for (const c of list) {
    const o = asObj(c);
    const region = asObj(o.region);
    if (String(region.id ?? "").trim() === "NA") continue;
    const id = String(o.id ?? "");
    if (id) real.set(id, String(o.name ?? id).trim());
  }
  const byKey = new Map<string, Json>();
  WB_WIDE_INDICATORS.forEach((ind, i) => {
    const body = bodies[i];
    const rows = Array.isArray(body) ? asArr(body[1]) : [];
    for (const e of rows) {
      const o = asObj(e);
      const code = String(o.countryiso3code ?? "");
      if (!real.has(code)) continue;
      const v = numOrNull(o.value);
      if (v == null) continue;
      const yr = Number(o.date ?? 0);
      if (!yr) continue;
      const key = `${code}|${yr}`;
      let row = byKey.get(key);
      if (!row) {
        row = { country_code: code, country_name: real.get(code) ?? String(asObj(o.country).value ?? code), yr };
        for (const w of WB_WIDE_INDICATORS) row[w.column] = null;
        byKey.set(key, row);
      }
      row[ind.column] = v;
    }
  });
  const rows = [...byKey.values()].sort(
    (a, b) => Number(b.yr) - Number(a.yr) || String(a.country_code).localeCompare(String(b.country_code)),
  );
  return { rows };
}

// ---- Citi Bike (GBFS station_information ⨝ station_status) ----

/**
 * Compact station rows with the registry column names. `pct_full` is a
 * percentage 0–100 (bikes available ÷ capacity, capped at 100; null when
 * capacity is 0). Stations that are not installed are dropped.
 */
export function joinCitibike(info: unknown, status: unknown): { stations: Json[] } {
  const infoById = new Map<string, Json>();
  for (const s of asArr(asObj(asObj(info).data).stations)) {
    const o = asObj(s);
    infoById.set(String(o.station_id ?? ""), o);
  }
  const stations: Json[] = [];
  for (const s of asArr(asObj(asObj(status).data).stations)) {
    const st = asObj(s);
    const id = String(st.station_id ?? "");
    const inf = infoById.get(id);
    if (!inf) continue;
    if (st.is_installed === 0 || st.is_installed === false) continue;
    const lat = numOrNull(inf.lat);
    const lon = numOrNull(inf.lon);
    if (lat == null || lon == null) continue;
    const capacity = numOrNull(inf.capacity) ?? 0;
    const bikes = numOrNull(st.num_bikes_available) ?? 0;
    let ebikes = numOrNull(st.num_ebikes_available);
    if (ebikes == null) {
      // GBFS v2.1+: vehicle_types_available [{vehicle_type_id, count}]
      const vt = asArr(st.vehicle_types_available).map(asObj);
      ebikes = vt.length
        ? vt.filter((v) => /e|electric/i.test(String(v.vehicle_type_id ?? ""))).reduce((n, v) => n + (numOrNull(v.count) ?? 0), 0)
        : 0;
    }
    const reported = numOrNull(st.last_reported);
    stations.push({
      station_id: id,
      name: String(inf.name ?? ""),
      latitude: lat,
      longitude: lon,
      capacity,
      bikes_available: bikes,
      ebikes_available: ebikes,
      docks_available: numOrNull(st.num_docks_available) ?? 0,
      pct_full: capacity > 0 ? Math.min(100, Math.round((bikes / capacity) * 1000) / 10) : null,
      is_renting: st.is_renting === 1 || st.is_renting === true,
      ts: reported != null && reported > 1e9 ? new Date(reported * 1000).toISOString() : null,
    });
  }
  return { stations };
}

// ---- UK carbon intensity (yesterday + today, half-hourly) ----

export function mergeUkCarbon(...bodies: unknown[]): { data: Json[] } {
  const byFrom = new Map<string, Json>();
  for (const b of bodies) {
    for (const r of asArr(asObj(b).data)) {
      const o = asObj(r);
      const from = String(o.from ?? "");
      if (from) byFrom.set(from, o);
    }
  }
  return { data: [...byFrom.values()].sort((a, b) => String(a.from).localeCompare(String(b.from))) };
}

// ---- Dates ----

/** `YYYY-MM-DD` for `daysAgo` days before `now` (UTC). */
export function utcDay(daysAgo: number, now = Date.now()): string {
  return new Date(now - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

// =================================================================
// Columnar feeds: `{ columns, rows }` with the registry column names in
// registry order (src/lib/sourceRegistry.ts). The browser parser maps by
// name, so a column added to the registry before the Worker learns it
// shows up as nulls instead of shifting every other value.
// =================================================================

export interface Columnar {
  columns: string[];
  rows: unknown[][];
  /** Optional feed-level metadata (e.g. forecast time). */
  meta?: Json;
}

/** Raw string (numbers stringified); empty / missing → null. Matches desktop `js()`. */
const strOrNull = (v: unknown): string | null => {
  if (v == null || typeof v === "object" || typeof v === "boolean") return null;
  const s = String(v);
  return s ? s : null;
};

/** ISO UTC for an ISO-ish timestamp; zone-less values (`2026-10-02T21:00:00`) are UTC. */
export function utcIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const zoned = /[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(" ", "T")}Z`;
  const t = Date.parse(zoned);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// ---- GDACS disaster alerts ----

export const GDACS_COLUMNS = [
  "id", "event_type", "title", "alert_level", "alert_score", "country",
  "latitude", "longitude", "start_ts", "end_ts", "severity", "severity_unit",
];

const GDACS_TYPES: Record<string, string> = {
  EQ: "Earthquake",
  TC: "Tropical cyclone",
  FL: "Flood",
  VO: "Volcano",
  WF: "Wildfire",
  DR: "Drought",
};

/** Vertex mean of a ring (closing vertex excluded) → [lon, lat]. */
function ringCentroid(ring: unknown): [number, number] | null {
  let pts = asArr(ring)
    .map((p) => asArr(p).map(numOrNull))
    .filter((p): p is [number, number] => p.length >= 2 && p[0] != null && p[1] != null);
  if (pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1]) {
    pts = pts.slice(0, -1);
  }
  if (pts.length === 0) return null;
  return [pts.reduce((n, p) => n + p[0], 0) / pts.length, pts.reduce((n, p) => n + p[1], 0) / pts.length];
}

/** Point → its coordinates; else feature bbox center; else polygon centroid (same order as desktop). */
function featureLonLat(f: Json): [number, number] | null {
  const g = asObj(f.geometry);
  if (g.type === "Point") {
    const [lon, lat] = asArr(g.coordinates).map(numOrNull);
    if (lon != null && lat != null) return [lon, lat];
  }
  const bbox = asArr(f.bbox).slice(0, 4).map(numOrNull);
  if (bbox.length === 4 && bbox.every((n) => n != null)) {
    return [((bbox[0] as number) + (bbox[2] as number)) / 2, ((bbox[1] as number) + (bbox[3] as number)) / 2];
  }
  if (g.type === "Polygon") return ringCentroid(asArr(g.coordinates)[0]);
  if (g.type === "MultiPolygon") return ringCentroid(asArr(asArr(g.coordinates)[0])[0]);
  return null;
}

/**
 * GDACS `geteventlist/SEARCH` GeoJSON → one row per event (`eventtype`+`eventid`).
 * A repeated event keeps its latest copy (`todate`, then `episodeid`) at its
 * first-appearance position. Zone-less dates are UTC; features without
 * coordinates are kept with null lat/lon.
 */
export function gdacsEvents(body: unknown): Columnar {
  const byId = new Map<string, { rank: [number, number]; row: unknown[] }>();
  for (const feat of asArr(asObj(body).features)) {
    const f = asObj(feat);
    const p = asObj(f.properties);
    const code = strOrNull(p.eventtype);
    const eventId = strOrNull(p.eventid);
    if (!code || !eventId) continue;
    const id = `${code}${eventId}`;
    const ll = featureLonLat(f);
    const sev = asObj(p.severitydata);
    const end = utcIso(p.todate);
    const rank: [number, number] = [end ? Date.parse(end) : -Infinity, numOrNull(p.episodeid) ?? 0];
    const prev = byId.get(id);
    if (prev && (prev.rank[0] > rank[0] || (prev.rank[0] === rank[0] && prev.rank[1] > rank[1]))) continue;
    byId.set(id, {
      rank,
      row: [
        id,
        GDACS_TYPES[code] ?? code,
        strOrNull(p.name) ?? strOrNull(p.description),
        strOrNull(p.alertlevel),
        numOrNull(p.alertscore),
        strOrNull(p.country),
        ll ? ll[1] : null,
        ll ? ll[0] : null,
        utcIso(p.fromdate),
        end,
        numOrNull(sev.severity),
        strOrNull(sev.severityunit),
      ],
    });
  }
  return { columns: GDACS_COLUMNS, rows: [...byId.values()].map((e) => e.row) };
}

// ---- NOAA NDBC buoys (latest_obs.txt, whitespace-aligned text) ----

export const BUOY_COLUMNS = [
  "station", "latitude", "longitude", "ts", "wind_dir", "wind_speed_ms", "gust_ms",
  "wave_height_m", "wave_period_s", "pressure_hpa", "air_temp_c", "water_temp_c",
];

/** `MM` = missing. Header row: `#STN LAT LON YYYY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES …`. */
export function ndbcLatestObs(text: string): Columnar {
  const lines = text.split(/\r?\n/);
  const header = lines.find((l) => l.startsWith("#") && /\bLAT\b/.test(l));
  const names = (header ?? "#STN LAT LON YYYY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES PTDY ATMP WTMP DEWP VIS TIDE")
    .replace(/^#/, "")
    .trim()
    .split(/\s+/);
  const at = (n: string) => names.indexOf(n);
  const ix = {
    stn: at("STN"), lat: at("LAT"), lon: at("LON"), yy: at("YYYY"), mo: at("MM"), dd: at("DD"), hh: at("hh"), mi: at("mm"),
    wdir: at("WDIR"), wspd: at("WSPD"), gst: at("GST"), wvht: at("WVHT"), dpd: at("DPD"), pres: at("PRES"), atmp: at("ATMP"), wtmp: at("WTMP"),
  };
  const seen = new Set<string>();
  const rows: unknown[][] = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) continue;
    const f = line.trim().split(/\s+/);
    const val = (i: number) => (i < 0 || f[i] == null || f[i] === "MM" ? null : numOrNull(f[i]));
    const station = f[ix.stn];
    const lat = val(ix.lat);
    const lon = val(ix.lon);
    if (!station || lat == null || lon == null || seen.has(station)) continue;
    seen.add(station);
    const [y, mo, d, h, mi] = [ix.yy, ix.mo, ix.dd, ix.hh, ix.mi].map(val);
    const ts =
      y != null && mo != null && d != null && h != null && mi != null
        ? new Date(Date.UTC(y, mo - 1, d, h, mi)).toISOString()
        : null;
    rows.push([
      station, lat, lon, ts,
      val(ix.wdir), val(ix.wspd), val(ix.gst), val(ix.wvht), val(ix.dpd), val(ix.pres), val(ix.atmp), val(ix.wtmp),
    ]);
  }
  return { columns: BUOY_COLUMNS, rows };
}

// ---- MBTA vehicles (JSON:API with included routes) ----

export const MBTA_COLUMNS = [
  "id", "label", "route", "route_type", "latitude", "longitude", "bearing", "speed_mph", "status", "occupancy", "ts",
];

const MBTA_ROUTE_TYPES: Record<number, string> = {
  0: "Light rail",
  1: "Subway",
  2: "Commuter rail",
  3: "Bus",
  4: "Ferry",
};

/** `IN_TRANSIT_TO` → "In transit to"; empty / missing → null (same as desktop). */
export function humanizeEnum(v: unknown): string | null {
  const raw = strOrNull(v);
  if (!raw) return null;
  const s = raw.replace(/_/g, " ").toLowerCase();
  return s[0]!.toUpperCase() + s.slice(1);
}

const MS_TO_MPH = 3600 / 1609.344;

/**
 * Route = `short_name`, else `long_name`, else the route id (also when the
 * route is missing from `included`, with route_type null). Speed m/s → mph.
 */
export function mbtaVehicles(body: unknown): Columnar {
  const o = asObj(body);
  const routes = new Map<string, { name: string; type: string | null }>();
  for (const inc of asArr(o.included)) {
    const r = asObj(inc);
    const id = strOrNull(r.id);
    if (r.type !== "route" || !id) continue;
    const a = asObj(r.attributes);
    const t = numOrNull(a.type);
    routes.set(id, {
      name: strOrNull(a.short_name) ?? strOrNull(a.long_name) ?? id,
      type: t != null ? MBTA_ROUTE_TYPES[t] ?? null : null,
    });
  }
  const rows: unknown[][] = [];
  for (const v of asArr(o.data)) {
    const veh = asObj(v);
    const id = strOrNull(veh.id);
    if (!id) continue;
    const a = asObj(veh.attributes);
    const routeId = strOrNull(asObj(asObj(asObj(veh.relationships).route).data).id);
    const route = routeId ? routes.get(routeId) ?? { name: routeId, type: null } : null;
    const speed = numOrNull(a.speed);
    rows.push([
      id,
      strOrNull(a.label),
      route?.name ?? null,
      route?.type ?? null,
      numOrNull(a.latitude),
      numOrNull(a.longitude),
      numOrNull(a.bearing),
      speed == null ? null : speed * MS_TO_MPH,
      humanizeEnum(a.current_status),
      humanizeEnum(a.occupancy_status),
      utcIso(a.updated_at),
    ]);
  }
  return { columns: MBTA_COLUMNS, rows };
}

// ---- NOAA SWPC OVATION aurora (1° grid → 2° cells) ----

export const AURORA_COLUMNS = ["longitude", "latitude", "probability", "ts"];

/**
 * `coordinates` = [lon 0–359, lat −90…90, probability] on a 1° grid (65k points).
 * 2° cells keyed by their even south-west corner (floor(x / 2) × 2 on the raw
 * grid, then lon > 180 → lon − 360), max rounded probability per cell, cells
 * < `minProb` dropped — identical to desktop. Quiet nights give ≈3k cells; a
 * big storm widens the ovals, so the web keeps at most `maxCells` (the most
 * likely) to stay under the 8k browser buffer.
 */
export function auroraCells(body: unknown, minProb = 3, maxCells = 6_000): Columnar {
  const o = asObj(body);
  const ts = utcIso(o["Forecast Time"]);
  const cells = new Map<string, [number, number, number]>();
  for (const c of asArr(o.coordinates)) {
    if (!Array.isArray(c) || c.length < 3) continue;
    const [lon, lat, p0] = c.map(numOrNull);
    if (lon == null || lat == null || p0 == null) continue;
    const cx = Math.floor(Math.floor(lon) / 2) * 2;
    const cy = Math.floor(Math.floor(lat) / 2) * 2;
    const p = Math.round(p0);
    const key = `${cx}|${cy}`;
    const prev = cells.get(key);
    if (!prev || p > prev[2]) cells.set(key, [cx > 180 ? cx - 360 : cx, cy, p]);
  }
  const rows = [...cells.values()]
    .filter((c) => c[2] >= minProb)
    .sort((a, b) => b[2] - a[2] || a[1] - b[1] || a[0] - b[0])
    .slice(0, maxCells)
    .map(([lon, lat, p]) => [lon, lat, p, ts]);
  return { columns: AURORA_COLUMNS, rows, meta: { ts } };
}

// ---- NASA JPL CNEOS close approaches ----

export const ASTEROID_COLUMNS = [
  "designation", "name", "approach_ts", "distance_ld", "distance_km", "velocity_kms", "abs_magnitude", "diameter_m",
];

const AU_KM = 149_597_870.7;
const AU_LD = 389.17;
const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** CAD `cd` ("2026-Oct-05 13:42", TDB ≈ UTC) → ISO UTC. */
export function cadDate(cd: unknown): string | null {
  const m = String(cd ?? "").match(/^(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/);
  if (!m || !MONTHS[m[2]!]) return null;
  return utcIso(`${m[1]}-${MONTHS[m[2]!]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ? m[6].padStart(2, "0") : "00"}`);
}

/** Diameter (m) from absolute magnitude H at geometric albedo 0.14. */
export function diameterFromH(h: number | null, albedo = 0.14): number | null {
  if (h == null) return null;
  return (1329 / Math.sqrt(albedo)) * 10 ** (-h / 5) * 1000;
}

export function cneosApproaches(body: unknown): Columnar {
  const o = asObj(body);
  const fields = asArr(o.fields).map(String);
  const at = (n: string) => fields.indexOf(n);
  const ix = { des: at("des"), cd: at("cd"), dist: at("dist"), v: at("v_rel"), h: at("h"), name: at("fullname") };
  const rows: unknown[][] = [];
  for (const r of asArr(o.data)) {
    if (!Array.isArray(r)) continue;
    const get = (i: number) => (i < 0 ? undefined : r[i]);
    const dist = numOrNull(get(ix.dist));
    const h = numOrNull(get(ix.h));
    const des = strOrNull(get(ix.des));
    if (!des) continue;
    const name = get(ix.name);
    rows.push([
      des,
      typeof name === "string" && name.trim() ? name.trim() : null,
      cadDate(get(ix.cd)),
      dist == null ? null : dist * AU_LD,
      dist == null ? null : dist * AU_KM,
      numOrNull(get(ix.v)),
      h,
      diameterFromH(h),
    ]);
  }
  return { columns: ASTEROID_COLUMNS, rows };
}

// ---- SteamSpy top 100 (last two weeks) ----

export const STEAM_COLUMNS = [
  "appid", "name", "developer", "peak_players", "positive", "negative", "positive_pct", "owners_min", "price_usd", "discount_pct",
];

/** Object keyed by appid (appid falls back to the key). Values unrounded, like desktop. */
export function steamTop(body: unknown): Columnar {
  const rows: unknown[][] = [];
  for (const [key, v] of Object.entries(asObj(body))) {
    const g = asObj(v);
    const pos = numOrNull(g.positive);
    const neg = numOrNull(g.negative);
    const owners = String(g.owners ?? "").split("..")[0]!.replace(/[^\d]/g, "");
    const price = numOrNull(g.price);
    // top100in2weeks reports average_2weeks as 0 for every game; the discount varies
    const discount = numOrNull(g.discount);
    rows.push([
      strOrNull(g.appid) ?? key,
      strOrNull(g.name),
      strOrNull(g.developer),
      numOrNull(g.ccu),
      pos,
      neg,
      pos != null && neg != null && pos + neg > 0 ? (pos / (pos + neg)) * 100 : null,
      owners ? Number(owners) : null,
      price == null ? null : price / 100,
      discount,
    ]);
  }
  rows.sort((a, b) => (Number(b[3]) || 0) - (Number(a[3]) || 0));
  return { columns: STEAM_COLUMNS, rows };
}

// ---- mempool.space blocks ----

export const BITCOIN_COLUMNS = [
  "height", "ts", "tx_count", "size_mb", "median_fee_sat_vb", "total_fees_btc", "reward_btc", "pool",
];

/** `/api/v1/blocks[/:height]` pages (15 blocks each, with `extras`) → one row per height, newest first. */
export function mempoolBlocks(pages: unknown[]): Columnar {
  const byHeight = new Map<number, unknown[]>();
  for (const page of pages) {
    for (const b of asArr(page)) {
      const blk = asObj(b);
      const height = numOrNull(blk.height);
      if (height == null || byHeight.has(height)) continue;
      const ex = asObj(blk.extras);
      const t = numOrNull(blk.timestamp);
      const size = numOrNull(blk.size);
      const fees = numOrNull(ex.totalFees);
      const reward = numOrNull(ex.reward);
      byHeight.set(height, [
        height,
        t == null ? null : new Date(t * 1000).toISOString(),
        numOrNull(blk.tx_count),
        size == null ? null : size / 1e6,
        numOrNull(ex.medianFee),
        fees == null ? null : fees / 1e8,
        reward == null ? null : reward / 1e8,
        strOrNull(asObj(ex.pool).name),
      ]);
    }
  }
  return { columns: BITCOIN_COLUMNS, rows: [...byHeight.entries()].sort((a, b) => b[0] - a[0]).map((e) => e[1]) };
}

/** Lowest height in a mempool page (for the next `/blocks/:height` request). */
export function mempoolLowestHeight(page: unknown): number | null {
  const hs = asArr(page).map((b) => numOrNull(asObj(b).height)).filter((h): h is number => h != null);
  return hs.length ? Math.min(...hs) : null;
}

// ---- US Treasury debt to the penny ----

export const DEBT_COLUMNS = ["record_date", "total_debt", "held_by_public", "intragovernmental"];

/** Fiscal Data `debt_to_penny` (amounts are strings; early years say "null") → ascending by date. */
export function treasuryDebt(body: unknown): Columnar {
  const byDate = new Map<string, unknown[]>();
  for (const r of asArr(asObj(body).data)) {
    const o = asObj(r);
    const date = String(o.record_date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const num = (v: unknown) => (v === "null" ? null : numOrNull(v));
    byDate.set(date, [date, num(o.tot_pub_debt_out_amt), num(o.debt_held_public_amt), num(o.intragov_hold_amt)]);
  }
  return {
    columns: DEBT_COLUMNS,
    rows: [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((e) => e[1]),
  };
}
