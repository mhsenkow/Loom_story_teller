// =================================================================
// Loom — Worker transforms for the 2026-10 keyless feed batch
// =================================================================
// Pure upstream → `{ columns, rows }` transforms (registry column names)
// for fireballs, satellites, internet_outages, faa_delays, lobbying,
// fda_recalls, vehicle_recalls, arxiv, github_events, books,
// nyc_inspections, chicago_crime, nyc_parking, powerball, fed_spending,
// bikeshare, bluesky and bgp. The browser reads them with
// `parseColumnar` (webStreams.ts); desktop mirrors each in sources.rs
// (bluesky / bgp: desktop reads this Worker's output — see DOCS.md).
//
// Privacy: GitHub drops actor logins, lobbying drops lobbyist names and
// filer contacts, parking never selects plates, Bluesky keeps counts by
// language / hashtag only (no text, DIDs or handles).
// =================================================================

import { joinCitibike } from "./sourceTransforms";

type Json = Record<string, unknown>;
export type Columnar = { columns: string[]; rows: unknown[][] };

const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const clip = (v: unknown, max: number): string | null => {
  const s = str(v)?.replace(/\s+/g, " ") ?? null;
  return s && s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const round = (v: number, places: number) => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};
/** Socrata / naive timestamp text → "YYYY-MM-DDTHH:MM:SSZ" (wall time kept as-is). */
const naiveIso = (v: unknown): string | null => {
  const s = str(v);
  const m = s?.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/);
  if (m) return `${m[1]}T${m[2]!.length === 5 ? `${m[2]}:00` : m[2]}Z`;
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : null;
};
const isoDay = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const zonedIso = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

function columnar(columns: string[], objs: Json[]): Columnar {
  return { columns, rows: objs.map((o) => columns.map((c) => o[c] ?? null)) };
}

// ---- NASA JPL fireballs ----

export const FIREBALL_COLUMNS = ["ts", "latitude", "longitude", "altitude_km", "velocity_kms", "energy_e10j", "impact_kt"];

export function fireballRows(body: unknown): Columnar {
  const b = obj(body);
  const fields = arr(b.fields).map(String);
  const at = (r: unknown[], f: string) => r[fields.indexOf(f)];
  const out: Json[] = [];
  for (const raw of arr(b.data)) {
    const r = arr(raw);
    const ts = naiveIso(at(r, "date"));
    if (!ts) continue;
    const lat = num(at(r, "lat"));
    const lon = num(at(r, "lon"));
    out.push({
      ts,
      latitude: lat == null ? null : at(r, "lat-dir") === "S" ? -lat : lat,
      longitude: lon == null ? null : at(r, "lon-dir") === "W" ? -lon : lon,
      altitude_km: num(at(r, "alt")),
      velocity_kms: num(at(r, "vel")),
      energy_e10j: num(at(r, "energy")),
      impact_kt: num(at(r, "impact-e")),
    });
  }
  return columnar(FIREBALL_COLUMNS, out);
}

// ---- CelesTrak visual satellites ----

export const SATELLITE_COLUMNS = ["norad_id", "name", "object_type", "launch_year", "inclination", "period_min", "apogee_km", "perigee_km", "eccentricity", "epoch"];
const MU_EARTH = 398_600.4418; // km³/s²
const EARTH_RADIUS_KM = 6378.137;

export function satelliteObjectType(name: string): string {
  if (/\bR\/B\b/.test(name)) return "Rocket body";
  if (/\bDEB\b/.test(name)) return "Debris";
  return "Payload";
}

export function satelliteRows(body: unknown): Columnar {
  const out: Json[] = [];
  for (const raw of arr(body)) {
    const g = obj(raw);
    const mm = num(g.MEAN_MOTION);
    const e = num(g.ECCENTRICITY);
    let apogee: number | null = null;
    let perigee: number | null = null;
    if (mm != null && mm > 0 && e != null) {
      const n = (mm * 2 * Math.PI) / 86_400;
      const a = Math.cbrt(MU_EARTH / (n * n));
      apogee = round(a * (1 + e) - EARTH_RADIUS_KM, 1);
      perigee = round(a * (1 - e) - EARTH_RADIUS_KM, 1);
    }
    const name = String(g.OBJECT_NAME ?? "").trim();
    const year = num(String(g.OBJECT_ID ?? "").slice(0, 4));
    out.push({
      norad_id: num(g.NORAD_CAT_ID),
      name: name || null,
      object_type: satelliteObjectType(name),
      launch_year: year,
      inclination: num(g.INCLINATION),
      period_min: mm != null && mm > 0 ? round(1440 / mm, 2) : null,
      apogee_km: apogee,
      perigee_km: perigee,
      eccentricity: e,
      epoch: naiveIso(g.EPOCH),
    });
  }
  return columnar(SATELLITE_COLUMNS, out);
}

// ---- IODA internet outage alerts ----

export const IODA_COLUMNS = ["ts", "country_code", "country", "datasource", "level", "value", "history_value", "drop_pct"];
export const IODA_MAX_ROWS = 2000;

export function iodaWindow(nowMs: number): { from: number; until: number } {
  const until = Math.floor(nowMs / 1000 / 900) * 900; // 15-min buckets keep the URL cacheable
  return { from: until - 7 * 86_400, until };
}

export function iodaRows(body: unknown): Columnar {
  const out: Json[] = [];
  for (const raw of arr(obj(body).data)) {
    const a = obj(raw);
    const ent = obj(a.entity);
    if (ent.type !== "country") continue;
    const t = num(a.time);
    if (t == null) continue;
    const value = num(a.value);
    const hist = num(a.historyValue);
    out.push({
      ts: new Date(t * 1000).toISOString(),
      country_code: str(ent.code),
      country: str(ent.name),
      datasource: str(a.datasource),
      level: str(a.level),
      value,
      history_value: hist,
      drop_pct: value != null && hist != null && hist > 0 ? round((1 - value / hist) * 100, 1) : null,
    });
  }
  out.sort((x, y) => String(y.ts).localeCompare(String(x.ts)));
  return columnar(IODA_COLUMNS, out.slice(0, IODA_MAX_ROWS));
}

// ---- FAA NAS airport status (XML) ----

export const FAA_COLUMNS = ["airport", "status_type", "reason", "min_delay_min", "max_delay_min", "avg_delay_min", "trend", "updated"];

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function xmlDecode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return XML_ENTITIES[e.toLowerCase()] ?? m;
    });
}
/** Inner text of every `<tag …>…</tag>` (exact tag name) in `xml`. */
export function xmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  return [...xml.matchAll(re)].map((m) => m[1]!);
}
export function xmlText(xml: string, tag: string): string | null {
  const b = xmlBlocks(xml, tag)[0];
  return b == null ? null : str(xmlDecode(b));
}

/** "1 hour and 3 minutes", "45 minutes", "2 hours" → minutes. */
export function faaMinutes(s: string | null): number | null {
  if (!s) return null;
  const h = s.match(/(\d+)\s*hour/i);
  const m = s.match(/(\d+)\s*min/i);
  if (!h && !m) return null;
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

/** "Tue Oct 20 16:22:47 2026 GMT" → ISO. */
export function faaUpdateTime(s: string | null): string | null {
  const m = s?.match(/^\w{3} (\w{3}) +(\d{1,2}) (\d{2}:\d{2}:\d{2}) (\d{4})/);
  if (!m) return null;
  const mon = "JanFebMarAprMayJunJulAugSepOctNovDec".indexOf(m[1]!) / 3 + 1;
  if (mon < 1) return null;
  return `${m[4]}-${String(mon).padStart(2, "0")}-${m[2]!.padStart(2, "0")}T${m[3]}Z`;
}

export function faaRows(xml: string): Columnar {
  const updated = faaUpdateTime(xmlText(xml, "Update_Time"));
  const out: Json[] = [];
  const base = (b: string, status_type: string) => ({
    airport: xmlText(b, "ARPT"),
    status_type,
    reason: clip(xmlText(b, "Reason"), 160),
    min_delay_min: null as number | null,
    max_delay_min: null as number | null,
    avg_delay_min: null as number | null,
    trend: null as string | null,
    updated,
  });
  for (const b of xmlBlocks(xml, "Ground_Delay")) {
    out.push({ ...base(b, "Ground delay"), avg_delay_min: faaMinutes(xmlText(b, "Avg")), max_delay_min: faaMinutes(xmlText(b, "Max")) });
  }
  for (const b of xmlBlocks(xml, "Program")) out.push(base(b, "Ground stop"));
  for (const b of xmlBlocks(xml, "Delay")) {
    const ad = /<Arrival_Departure[^>]*Type="([^"]+)"/.exec(b)?.[1] ?? "";
    out.push({
      ...base(b, ad ? `${ad} delay` : "Delay"),
      min_delay_min: faaMinutes(xmlText(b, "Min")),
      max_delay_min: faaMinutes(xmlText(b, "Max")),
      trend: xmlText(b, "Trend"),
    });
  }
  for (const b of xmlBlocks(xml, "Airport")) out.push(base(b, "Closure"));
  return columnar(FAA_COLUMNS, out.filter((r) => r.airport));
}

// ---- Lobbying Disclosure Act filings ----

export const LOBBYING_COLUMNS = ["filing_id", "registrant", "client", "client_state", "filing_type", "filing_year", "filing_period", "amount_usd", "amount_kind", "issue_codes", "n_issues", "posted"];

export function lobbyingRows(body: unknown): Columnar {
  const out: Json[] = [];
  for (const raw of arr(obj(body).results)) {
    const f = obj(raw);
    const income = num(f.income);
    const expenses = num(f.expenses);
    const codes = [...new Set(arr(f.lobbying_activities).map((a) => str(obj(a).general_issue_code)).filter((c): c is string => !!c))];
    out.push({
      filing_id: str(f.filing_uuid),
      registrant: str(obj(f.registrant).name),
      client: str(obj(f.client).name),
      client_state: str(obj(f.client).state),
      filing_type: str(f.filing_type),
      filing_year: num(f.filing_year),
      filing_period: str(f.filing_period)?.replace(/_/g, " ") ?? null,
      amount_usd: income ?? expenses,
      amount_kind: income != null ? "income" : expenses != null ? "expenses" : null,
      issue_codes: codes.length ? codes.join(",") : null,
      n_issues: codes.length,
      posted: zonedIso(f.dt_posted),
    });
  }
  return columnar(LOBBYING_COLUMNS, out);
}

// ---- openFDA enforcement (food / drug / device) ----

export const FDA_COLUMNS = ["recall_number", "product_type", "classification", "status", "firm", "state", "country", "reason", "product", "quantity", "voluntary", "report_date", "initiated"];
export const FDA_CATEGORIES = ["food", "drug", "device"] as const;

export function fdaRows(bodies: unknown[]): Columnar {
  const out: Json[] = [];
  const seen = new Set<string>();
  for (const body of bodies) {
    for (const raw of arr(obj(body).results)) {
      const r = obj(raw);
      const id = str(r.recall_number);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        recall_number: id,
        product_type: str(r.product_type),
        classification: str(r.classification),
        status: str(r.status),
        firm: str(r.recalling_firm),
        state: str(r.state),
        country: str(r.country),
        reason: clip(r.reason_for_recall, 200),
        product: clip(r.product_description, 160),
        quantity: clip(r.product_quantity, 80),
        voluntary: str(r.voluntary_mandated),
        report_date: isoDay(r.report_date),
        initiated: isoDay(r.recall_initiation_date),
      });
    }
  }
  return columnar(FDA_COLUMNS, out);
}

// ---- NHTSA recalls ----

export const VEHICLE_RECALL_COLUMNS = ["nhtsa_id", "report_date", "manufacturer", "subject", "component", "recall_type", "potentially_affected", "park_outside", "do_not_drive"];
const yesNo = (v: unknown): boolean | null => {
  const s = str(v)?.toLowerCase();
  return s === "yes" ? true : s === "no" ? false : null;
};

export function vehicleRecallRows(body: unknown): Columnar {
  return columnar(
    VEHICLE_RECALL_COLUMNS,
    arr(body).map((raw) => {
      const r = obj(raw);
      return {
        nhtsa_id: str(r.nhtsa_id),
        report_date: isoDay(r.report_received_date),
        manufacturer: str(r.manufacturer),
        subject: clip(r.subject, 160),
        component: str(r.component),
        recall_type: str(r.recall_type),
        potentially_affected: num(r.potentially_affected),
        park_outside: yesNo(r.fire_risk_when_parked),
        do_not_drive: yesNo(r.do_not_drive),
      };
    }),
  );
}

// ---- arXiv (Atom XML) ----

export const ARXIV_COLUMNS = ["id", "title", "primary_category", "field", "n_categories", "n_authors", "published", "updated"];
/** One query per field — a combined OR query is all cs.* papers. */
export const ARXIV_QUERIES = ["cat:cs.AI", "cat:cs.LG", "cat:astro-ph*", "cat:q-bio*", "cat:econ*"];
export const ARXIV_PER_QUERY = 60;
const ARXIV_FIELDS: Record<string, string> = {
  cs: "Computer science",
  "astro-ph": "Astrophysics",
  "q-bio": "Biology",
  econ: "Economics",
  stat: "Statistics",
  math: "Mathematics",
  physics: "Physics",
  "q-fin": "Finance",
  eess: "Engineering",
};

export function arxivField(category: string): string {
  const archive = category.split(".")[0] ?? category;
  return ARXIV_FIELDS[archive] ?? (archive.includes("-") || archive === "hep" ? "Physics" : archive);
}

export function arxivRows(feeds: string[]): Columnar {
  const out: Json[] = [];
  const seen = new Set<string>();
  for (const xml of feeds) {
    for (const e of xmlBlocks(xml, "entry")) {
      const id = xmlText(e, "id")?.replace(/^https?:\/\/arxiv\.org\/abs\//, "") ?? null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const cats = [...e.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]!);
      const primary = /<arxiv:primary_category[^>]*term="([^"]+)"/.exec(e)?.[1] ?? cats[0] ?? null;
      out.push({
        id,
        title: clip(xmlText(e, "title"), 240),
        primary_category: primary,
        field: primary ? arxivField(primary) : null,
        n_categories: cats.length,
        n_authors: (e.match(/<author>/g) ?? []).length,
        published: zonedIso(xmlText(e, "published")),
        updated: zonedIso(xmlText(e, "updated")),
      });
    }
  }
  return columnar(ARXIV_COLUMNS, out);
}

// ---- GitHub public events (no actor logins) ----

export const GITHUB_COLUMNS = ["id", "event_type", "repo", "is_org", "ts"];

export function githubEventRows(body: unknown): Columnar {
  return columnar(
    GITHUB_COLUMNS,
    arr(body).map((raw) => {
      const e = obj(raw);
      return {
        id: str(e.id),
        event_type: str(e.type)?.replace(/Event$/, "") ?? null,
        repo: str(obj(e.repo).name),
        is_org: e.org != null,
        ts: zonedIso(e.created_at),
      };
    }),
  );
}

// ---- Books: Open Library trending + Gutenberg popular ----

export const BOOK_COLUMNS = ["site", "rank", "title", "author", "first_year", "editions", "downloads", "language"];
export const OPEN_LIBRARY_TOP = 50;

/** Gutenberg stores "Austen, Jane" — show "Jane Austen". */
export function gutenbergAuthor(name: string | null): string | null {
  if (!name) return null;
  const m = name.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}`.replace(/\s*\(.*?\)\s*/g, " ").trim() : name;
}

export function bookRows(openLibrary: unknown, gutenberg: unknown): Columnar {
  const out: Json[] = [];
  arr(obj(openLibrary).works)
    .slice(0, OPEN_LIBRARY_TOP)
    .forEach((raw, i) => {
      const w = obj(raw);
      const langs = arr(w.language).map(String);
      out.push({
        site: "Open Library",
        rank: i + 1,
        title: clip(w.title, 200),
        author: str(arr(w.author_name)[0]),
        first_year: num(w.first_publish_year),
        editions: num(w.edition_count),
        downloads: null,
        language: langs.includes("eng") ? "en" : (langs[0] ?? null),
      });
    });
  arr(obj(gutenberg).results).forEach((raw, i) => {
    const b = obj(raw);
    out.push({
      site: "Project Gutenberg",
      rank: i + 1,
      title: clip(b.title, 200),
      author: gutenbergAuthor(str(obj(arr(b.authors)[0]).name)),
      first_year: null,
      editions: null,
      downloads: num(b.download_count),
      language: str(arr(b.languages)[0]),
    });
  });
  return columnar(BOOK_COLUMNS, out);
}

// ---- Socrata city feeds ----

export const NYC_INSPECTION_COLUMNS = ["camis", "restaurant", "borough", "cuisine", "inspection_date", "grade", "score", "critical", "violation_code", "violation", "latitude", "longitude"];
const nonZeroCoord = (v: unknown) => {
  const n = num(v);
  return n == null || n === 0 ? null : n;
};

export function nycInspectionRows(body: unknown): Columnar {
  return columnar(
    NYC_INSPECTION_COLUMNS,
    arr(body).map((raw) => {
      const r = obj(raw);
      return {
        camis: str(r.camis),
        restaurant: str(r.dba),
        borough: str(r.boro),
        cuisine: str(r.cuisine_description),
        inspection_date: naiveIso(r.inspection_date),
        grade: str(r.grade),
        score: num(r.score),
        critical: str(r.critical_flag),
        violation_code: str(r.violation_code),
        violation: clip(r.violation_description, 160),
        latitude: nonZeroCoord(r.latitude),
        longitude: nonZeroCoord(r.longitude),
      };
    }),
  );
}

export const CHICAGO_CRIME_COLUMNS = ["id", "ts", "block", "primary_type", "description", "location_description", "arrest", "domestic", "district", "community_area", "latitude", "longitude"];
const boolish = (v: unknown): boolean | null => (v === true || v === "true" ? true : v === false || v === "false" ? false : null);

export function chicagoCrimeRows(body: unknown): Columnar {
  return columnar(
    CHICAGO_CRIME_COLUMNS,
    arr(body).map((raw) => {
      const r = obj(raw);
      return {
        id: str(r.id),
        ts: naiveIso(r.date),
        block: str(r.block),
        primary_type: str(r.primary_type),
        description: str(r.description),
        location_description: str(r.location_description),
        arrest: boolish(r.arrest),
        domestic: boolish(r.domestic),
        district: str(r.district),
        community_area: str(r.community_area),
        latitude: nonZeroCoord(r.latitude),
        longitude: nonZeroCoord(r.longitude),
      };
    }),
  );
}

export const NYC_PARKING_COLUMNS = ["summons_number", "issue_date", "violation_time", "violation", "fine_amount", "penalty_amount", "amount_due", "county", "plate_state", "issuing_agency", "precinct"];

export function nycParkingRows(body: unknown): Columnar {
  return columnar(
    NYC_PARKING_COLUMNS,
    arr(body).map((raw) => {
      const r = obj(raw);
      return {
        summons_number: str(r.summons_number),
        issue_date: isoDay(r.issue_date),
        violation_time: str(r.violation_time),
        violation: str(r.violation),
        fine_amount: num(r.fine_amount),
        penalty_amount: num(r.penalty_amount),
        amount_due: num(r.amount_due),
        county: str(r.county),
        plate_state: str(r.state),
        issuing_agency: str(r.issuing_agency),
        precinct: str(r.precinct),
      };
    }),
  );
}

export const POWERBALL_COLUMNS = ["draw_date", "yr", "n1", "n2", "n3", "n4", "n5", "powerball", "multiplier"];

export function powerballRows(body: unknown): Columnar {
  const out: Json[] = [];
  for (const raw of arr(body)) {
    const r = obj(raw);
    const day = isoDay(r.draw_date);
    const nums = String(r.winning_numbers ?? "").trim().split(/\s+/).map(num);
    if (!day || nums.length < 6) continue;
    out.push({
      draw_date: day,
      yr: Number(day.slice(0, 4)),
      n1: nums[0],
      n2: nums[1],
      n3: nums[2],
      n4: nums[3],
      n5: nums[4],
      powerball: nums[5],
      multiplier: num(r.multiplier),
    });
  }
  return columnar(POWERBALL_COLUMNS, out);
}

// ---- USAspending toptier agencies ----

export const FED_SPENDING_COLUMNS = ["agency", "abbreviation", "toptier_code", "fiscal_year", "budget_authority", "obligated", "outlays", "pct_of_total"];

export function fedSpendingRows(body: unknown): Columnar {
  return columnar(
    FED_SPENDING_COLUMNS,
    arr(obj(body).results).map((raw) => {
      const a = obj(raw);
      const pct = num(a.percentage_of_total_budget_authority);
      return {
        agency: str(a.agency_name),
        abbreviation: str(a.abbreviation),
        toptier_code: str(a.toptier_code),
        fiscal_year: num(a.active_fy),
        budget_authority: num(a.budget_authority_amount),
        obligated: num(a.obligated_amount),
        outlays: num(a.outlay_amount),
        // Upstream is a 0–1 share
        pct_of_total: pct == null ? null : round(pct * 100, 4),
      };
    }),
  );
}

// ---- GBFS bike share (several Lyft systems) ----

export const BIKESHARE_COLUMNS = ["system", "station_id", "name", "latitude", "longitude", "capacity", "bikes_available", "ebikes_available", "docks_available", "pct_full", "is_renting", "ts"];
export function bikeshareRows(systems: { system: string; info: unknown; status: unknown }[]): Columnar {
  const out: Json[] = [];
  for (const s of systems) {
    for (const st of joinCitibike(s.info, s.status).stations) out.push({ system: s.system, ...st });
  }
  return columnar(BIKESHARE_COLUMNS, out);
}

// ---- WebSocket samples (Bluesky Jetstream, RIPE RIS Live) ----

export const BLUESKY_COLUMNS = ["id", "ts", "dimension", "key", "posts", "window_secs", "posts_per_min"];
export const BGP_COLUMNS = ["id", "ts", "dimension", "key", "announcements", "withdrawals", "window_secs"];
export const WS_SAMPLE_MS = 5_000;
export const WS_MAX_MESSAGES = 20_000;
const TOP_LANGS = 15;
const TOP_TAGS = 20;
const TOP_ASNS = 25;

const minuteIso = (ms: number) => new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
const topN = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

/** Count Jetstream post creates by language and hashtag. Reads only `langs` and tag facets. */
export function blueskyRows(messages: string[], windowSecs: number, nowMs: number): Columnar {
  const langs = new Map<string, number>();
  const tags = new Map<string, number>();
  let total = 0;
  for (const raw of messages) {
    let m: Json;
    try {
      m = obj(JSON.parse(raw));
    } catch {
      continue;
    }
    const c = obj(m.commit);
    if (m.kind !== "commit" || c.operation !== "create" || c.collection !== "app.bsky.feed.post") continue;
    const rec = obj(c.record);
    total += 1;
    bump(langs, String(arr(rec.langs)[0] ?? "unknown").toLowerCase().split("-")[0] || "unknown");
    const seen = new Set<string>();
    for (const f of arr(rec.facets)) {
      for (const feat of arr(obj(f).features)) {
        const o = obj(feat);
        if (String(o.$type ?? "").endsWith("#tag") && typeof o.tag === "string") {
          const t = o.tag.trim().toLowerCase().slice(0, 64);
          if (t && !seen.has(t)) {
            seen.add(t);
            bump(tags, `#${t}`);
          }
        }
      }
    }
  }
  const ts = minuteIso(nowMs);
  const w = Math.max(1, windowSecs);
  const row = (dimension: string, key: string, posts: number) => ({
    id: `${ts}|${dimension}|${key}`,
    ts,
    dimension,
    key,
    posts,
    window_secs: w,
    posts_per_min: round((posts / w) * 60, 1),
  });
  const out: Json[] = total ? [row("total", "all posts", total)] : [];
  for (const [k, v] of topN(langs, TOP_LANGS)) out.push(row("language", k, v));
  for (const [k, v] of topN(tags, TOP_TAGS)) out.push(row("hashtag", k, v));
  return columnar(BLUESKY_COLUMNS, out);
}

/** "IPv4 /24" style bucket for a prefix. */
export function prefixBucket(prefix: string): string | null {
  const m = prefix.match(/\/(\d{1,3})$/);
  if (!m) return null;
  return `${prefix.includes(":") ? "IPv6" : "IPv4"} /${m[1]}`;
}

/** Aggregate RIS Live UPDATEs: announced prefixes per origin ASN, and both directions per prefix length. */
export function bgpRows(messages: string[], windowSecs: number, nowMs: number): Columnar {
  const byAsn = new Map<string, number>();
  const annLen = new Map<string, number>();
  const wdLen = new Map<string, number>();
  let ann = 0;
  let wd = 0;
  for (const raw of messages) {
    let m: Json;
    try {
      m = obj(JSON.parse(raw));
    } catch {
      continue;
    }
    if (m.type !== "ris_message") continue;
    const d = obj(m.data);
    if (d.type !== "UPDATE") continue;
    const path = arr(d.path);
    const last = path[path.length - 1];
    const origin = typeof last === "number" ? `AS${last}` : Array.isArray(last) ? `AS{${last.join(",")}}` : null;
    for (const a of arr(d.announcements)) {
      for (const p of arr(obj(a).prefixes)) {
        const b = prefixBucket(String(p));
        if (!b) continue;
        ann += 1;
        bump(annLen, b);
        if (origin) bump(byAsn, origin);
      }
    }
    for (const p of arr(d.withdrawals)) {
      const b = prefixBucket(String(p));
      if (!b) continue;
      wd += 1;
      bump(wdLen, b);
    }
  }
  const ts = minuteIso(nowMs);
  const w = Math.max(1, windowSecs);
  const row = (dimension: string, key: string, announcements: number | null, withdrawals: number | null) => ({
    id: `${ts}|${dimension}|${key}`,
    ts,
    dimension,
    key,
    announcements,
    withdrawals,
    window_secs: w,
  });
  const out: Json[] = ann || wd ? [row("total", "all updates", ann, wd)] : [];
  for (const [k, v] of topN(byAsn, TOP_ASNS)) out.push(row("origin_asn", k, v, null));
  const lens = new Map<string, number>();
  for (const [k, v] of annLen) bump(lens, k, v);
  for (const [k, v] of wdLen) bump(lens, k, v);
  for (const [k] of topN(lens, 20)) out.push(row("prefix_len", k, annLen.get(k) ?? 0, wdLen.get(k) ?? 0));
  return columnar(BGP_COLUMNS, out);
}
