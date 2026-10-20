// =================================================================
// Loom — Poll-source parsers (DOM-free)
// =================================================================
// `/api/source/<kind>` body → rows in registry column order. No window /
// document / EventSource / storage here, so the Worker (lib ES2022, no DOM)
// can import `parseSourceRows` too. webStreams.ts re-exports it.
// =================================================================

import type { SourceKind } from "./sourceRegistry";
import { SOURCE_DEFS } from "./sourceRegistry";
import { nycWallToUtcIso } from "./zonedTime";

export type Cell = string | number | boolean | null;

/** GeoJSON FeatureCollection guard — malformed bodies must not become empty charts (LOOM-095). */
export function assertUsgsBody(body: unknown): asserts body is { type?: string; features: unknown[] } {
  if (!body || typeof body !== "object") {
    throw new Error("Unexpected USGS response");
  }
  const features = (body as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    throw new Error("Unexpected USGS response");
  }
}

function parseUsgs(body: unknown): Cell[][] {
  assertUsgsBody(body);
  const features = body.features;
  const out: Cell[][] = [];
  for (const feat of features) {
    const f = feat as {
      id?: string;
      properties?: Record<string, unknown>;
      geometry?: { coordinates?: number[] };
    };
    const props = f.properties ?? {};
    const coords = f.geometry?.coordinates ?? [];
    const hasCoords = coords.length >= 2 && coords[0] != null && coords[1] != null;
    const id = String(f.id ?? props.ids ?? "");
    out.push([
      id,
      numOrNullVal(props.mag),
      strCell(props.place),
      props.time != null ? new Date(Number(props.time)).toISOString() : null,
      hasCoords ? numOrNullVal(coords[1]) : null,
      hasCoords ? numOrNullVal(coords[0]) : null,
      coords.length >= 3 ? numOrNullVal(coords[2]) : null,
      strCell(props.magType),
      strCell(props.status),
      Number(props.tsunami ?? 0) === 1,
      numOrNullVal(props.sig),
      strCell(props.net),
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
      strCell(f.id ?? p.id) ?? "",
      strCell(p.event) ?? "",
      strCell(p.headline) ?? "",
      strCell(p.severity) ?? "",
      strCell(p.certainty) ?? "",
      strCell(p.urgency) ?? "",
      strCell(p.areaDesc) ?? "",
      strCell(p.senderName) ?? "",
      isoOrNull(p.effective),
      isoOrNull(p.expires),
      strCell(p.status) ?? "",
      strCell(p.category) ?? "",
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
  let zoned = s;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    zoned = s;
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    zoned = `${s}Z`;
  } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
    zoned = `${s.replace(" ", "T")}Z`;
  }
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

export function numOrNullVal(v: unknown): number | null {
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
    return entries.map(([quote, rate]) => [asOf, base, quote, Number(rate), null]);
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
  const cap = SOURCE_DEFS.find((d) => d.kind === "spacex")?.parserRowCap ?? 120;
  const start = Math.max(0, body.length - cap);
  return body.slice(start).map((r) => {
    const row = r as Record<string, unknown>;
    const successRaw = row.success;
    const success =
      successRaw === null || successRaw === undefined
        ? null
        : typeof successRaw === "boolean"
          ? successRaw
          : Boolean(successRaw);
    return [
      String(row.id ?? ""),
      String(row.name ?? ""),
      row.date_utc != null ? String(row.date_utc) : null,
      success,
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
      nycWallToUtcIso(row.created_date),
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
  usafacts_states: parseColumnar("usafacts_states"),
  usafacts_nation: parseColumnar("usafacts_nation"),
  fema: parseFema,
  covid: parseCovid,
  countries: parseCountries,
  world_bank: parseWorldBank,
  // 2026-10 batch: the Worker sends `{ columns, rows }` (workers/extraSources.ts)
  fireballs: parseColumnar("fireballs"),
  satellites: parseColumnar("satellites"),
  internet_outages: parseColumnar("internet_outages"),
  faa_delays: parseColumnar("faa_delays"),
  lobbying: parseColumnar("lobbying"),
  fda_recalls: parseColumnar("fda_recalls"),
  vehicle_recalls: parseColumnar("vehicle_recalls"),
  arxiv: parseColumnar("arxiv"),
  github_events: parseColumnar("github_events"),
  books: parseColumnar("books"),
  nyc_inspections: parseColumnar("nyc_inspections"),
  chicago_crime: parseColumnar("chicago_crime"),
  nyc_parking: parseColumnar("nyc_parking"),
  powerball: parseColumnar("powerball"),
  fed_spending: parseColumnar("fed_spending"),
  bikeshare: parseColumnar("bikeshare"),
  bluesky: parseColumnar("bluesky"),
  bgp: parseColumnar("bgp"),
};

/** Parse a `/api/source/<kind>` body into rows in registry column order. */
export function parseSourceRows(kind: SourceKind, body: unknown): Cell[][] {
  return SOURCE_PARSERS[kind](body);
}
