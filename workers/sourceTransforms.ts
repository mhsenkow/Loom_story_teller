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
