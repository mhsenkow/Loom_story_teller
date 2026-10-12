// =================================================================
// Loom — Discover feed hooks (LOOM-184)
// =================================================================
// One function per live source; DISCOVER_HOOKS is exhaustive over DiscoverKind.
// =================================================================

import type { ChartRecommendation } from "./recommendations";
import type { QueryResult } from "./store";
import type { DiscoverKind } from "./discoverStories";
import { applyChartTimeWindow } from "./chartTime";
import { stormLevel } from "./webStreams";

export type DiscoverHookResult = {
  hook: string;
  blurb: string;
  score: number;
  preferKind?: string;
  category: string;
};

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

function maxFiniteAt(sample: QueryResult, col: string): { value: number; row: number } | null {
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

type DiscoverHookFn = (n: number, sample: QueryResult, chart: ChartRecommendation) => DiscoverHookResult;

function hook_usgs(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let maxMag = 0;
      let place = "";
      for (let r = 0; r < sample.rows.length; r++) {
        const m = numAt(sample, r, "magnitude");
        if (m > maxMag) {
          maxMag = m;
          place = strAt(sample, r, "place");
        }
      }
      if (maxMag >= 5) {
        return {
          hook: `M${maxMag.toFixed(1)} quake${place ? ` — ${place}` : ""}`,
          blurb: chart.subtitle || "Map it and see the cluster.",
          score: 98,
          preferKind: "geoPoints",
          category: "Earth",
        };
      }
      return {
        hook: `${n} earthquakes in the past day`,
        blurb: chart.title,
        score: 80 + Math.min(15, n),
        preferKind: "globe",
        category: "Earth",
      };
}

function hook_hn(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let best = 0;
      let title = "";
      for (let r = 0; r < sample.rows.length; r++) {
        const p = numAt(sample, r, "points");
        if (p > best) {
          best = p;
          title = strAt(sample, r, "title");
        }
      }
      const short = title.length > 52 ? `${title.slice(0, 50)}…` : title;
      return {
        hook: short ? `${best} pts · ${short}` : `${n} stories on HN`,
        blurb: chart.subtitle || "Scores vs discussion.",
        score: 70 + Math.min(25, best / 20),
        preferKind: "scatter",
        category: "News",
      };
}

function hook_lobsters(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let best = 0;
      let title = "";
      for (let r = 0; r < sample.rows.length; r++) {
        const p = numAt(sample, r, "score");
        if (p > best) {
          best = p;
          title = strAt(sample, r, "title");
        }
      }
      const short = title.length > 52 ? `${title.slice(0, 50)}…` : title;
      return {
        hook: short ? `${best} · ${short}` : `${n} stories on Lobsters`,
        blurb: chart.subtitle || "Scores vs discussion.",
        score: 68 + Math.min(25, best / 5),
        preferKind: "scatter",
        category: "News",
      };
}

function hook_firms(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  const peak = maxFiniteAt(sample, "frp");
      return {
        hook: peak
          ? `${n.toLocaleString()} US fire hotspots · peak FRP ${peak.value.toFixed(0)}`
          : `${n.toLocaleString()} US fire hotspots`,
        blurb: chart.subtitle || "VIIRS active fires on the map.",
        score: 75 + Math.min(20, n / 50),
        preferKind: "geoPoints",
        category: "Earth",
      };
}

function hook_nwis(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let peak = 0;
      let site = "";
      for (let r = 0; r < sample.rows.length; r++) {
        const q = numAt(sample, r, "discharge_cfs");
        if (q > peak) {
          peak = q;
          site = strAt(sample, r, "site_name");
        }
      }
      const short = site.length > 40 ? `${site.slice(0, 38)}…` : site;
      return {
        hook: short ? `${short} · ${Math.round(peak).toLocaleString()} cfs` : `${n} river gauge readings`,
        blurb: chart.subtitle || "Discharge over the past two days.",
        score: 72 + Math.min(20, Math.log10(peak + 1) * 4),
        preferKind: "line",
        category: "Earth",
      };
}

function hook_starlink(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  return {
        hook: `${n.toLocaleString()} Starlink sats · orbital elements`,
        blurb: chart.subtitle || "Inclination vs mean motion.",
        score: 70 + Math.min(20, n / 200),
        preferKind: "scatter",
        category: "Space",
      };
}

function hook_crypto(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let bestAbs = 0;
      let sym = "";
      let chg = 0;
      for (let r = 0; r < sample.rows.length; r++) {
        const c = numAt(sample, r, "change_24h_pct");
        if (Math.abs(c) > bestAbs) {
          bestAbs = Math.abs(c);
          chg = c;
          sym = strAt(sample, r, "symbol");
        }
      }
      const sign = chg >= 0 ? "+" : "";
      return {
        hook: sym ? `${sym} ${sign}${chg.toFixed(1)}% today` : `${n} crypto markets`,
        blurb: chart.title,
        score: 75 + Math.min(20, bestAbs),
        preferKind: "isoScatter",
        category: "Markets",
      };
}

function hook_iss(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  const lat = numAt(sample, 0, "latitude");
      const lon = numAt(sample, 0, "longitude");
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        return {
          hook: `ISS over ${lat.toFixed(1)}°, ${lon.toFixed(1)}°`,
          blurb: "Great-circle path on the globe.",
          score: 88,
          preferKind: "globeTrail",
          category: "Space",
        };
      }
      return {
        hook: "Track the ISS live",
        blurb: chart.title,
        score: 85,
        preferKind: "geoPoints",
        category: "Space",
      };
}

function hook_nws(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let severe = 0;
      for (let r = 0; r < sample.rows.length; r++) {
        const sev = strAt(sample, r, "severity").toLowerCase();
        if (sev.includes("extreme") || sev.includes("severe")) severe += 1;
      }
      return {
        hook: severe > 0 ? `${severe} severe US weather alerts` : `${n} active NWS alerts`,
        blurb: chart.subtitle || chart.title,
        score: severe > 0 ? 92 : 70 + Math.min(15, n / 5),
        preferKind: "bar",
        category: "Weather",
      };
}

function hook_meteo(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  // Latest observation per city (buffer holds ~2 days of hourly rows)
      const latest = new Map<string, { ts: string; temp: number; precip: number }>();
      const nowMs = Date.now();
      for (let r = 0; r < sample.rows.length; r++) {
        const city = strAt(sample, r, "city");
        if (!city) continue;
        const ts = strAt(sample, r, "ts");
        const tsMs = Date.parse(ts);
        if (Number.isNaN(tsMs) || tsMs > nowMs) continue;
        const temp = numAt(sample, r, "temperature");
        const precip = numAt(sample, r, "precipitation");
        const prev = latest.get(city);
        if (!prev || ts > prev.ts) {
          latest.set(city, {
            ts,
            temp: Number.isFinite(temp) ? temp : NaN,
            precip: Number.isFinite(precip) ? precip : 0,
          });
        }
      }
      let hottest = -Infinity;
      let city = "";
      let wettest = -Infinity;
      let wetCity = "";
      for (const [c, v] of latest) {
        if (Number.isFinite(v.temp) && v.temp > hottest) {
          hottest = v.temp;
          city = c;
        }
        if (v.precip > wettest) {
          wettest = v.precip;
          wetCity = c;
        }
      }
      if (Number.isFinite(hottest) && city) {
        return {
          hook: `${city} hottest now at ${hottest.toFixed(1)}°C`,
          blurb:
            wettest > 0.2
              ? `${wetCity} seeing rain · ${chart.subtitle || chart.title}`
              : chart.subtitle || chart.title,
          score: 78 + Math.min(12, Math.max(0, hottest) / 4),
          preferKind: "geoBubbles",
          category: "Weather",
        };
      }
      return {
        hook: "World weather snapshot",
        blurb: chart.subtitle || chart.title,
        score: 72,
        preferKind: "geoBubbles",
        category: "Weather",
      };
}

function hook_world_bank(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  // Longest-lived country in the most recent year with data
      let bestYr = -Infinity;
      for (let r = 0; r < sample.rows.length; r++) {
        const y = numAt(sample, r, "yr");
        if (Number.isFinite(numAt(sample, r, "life_expectancy")) && y > bestYr) bestYr = y;
      }
      let topLe = -Infinity;
      let topCountry = "";
      for (let r = 0; r < sample.rows.length; r++) {
        if (numAt(sample, r, "yr") !== bestYr) continue;
        const le = numAt(sample, r, "life_expectancy");
        if (le > topLe) {
          topLe = le;
          topCountry = strAt(sample, r, "country_name");
        }
      }
      if (topCountry && Number.isFinite(topLe)) {
        return {
          hook: `${topCountry} lives longest · ${topLe.toFixed(1)} years (${bestYr})`,
          blurb: chart.subtitle || chart.title,
          score: 84,
          preferKind: "choropleth",
          category: "Global",
        };
      }
      return {
        hook: "Wealth, health, and CO₂ by country",
        blurb: chart.title,
        score: 76,
        preferKind: "choropleth",
        category: "Global",
      };
}

function hook_aq(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let worst = -Infinity;
      let city = "";
      for (let r = 0; r < sample.rows.length; r++) {
        const pm = numAt(sample, r, "pm2_5");
        if (pm > worst) {
          worst = pm;
          city = strAt(sample, r, "city");
        }
      }
      if (city && Number.isFinite(worst)) {
        const level = worst >= 55 ? "unhealthy" : worst >= 35 ? "elevated" : "moderate";
        return {
          hook: `${city} PM2.5 ${worst.toFixed(0)} µg/m³ (${level})`,
          blurb: chart.subtitle || "Compare cities on fine particulate pollution.",
          score: 80 + Math.min(15, worst / 10),
          preferKind: "geoBubbles",
          category: "Air",
        };
      }
      return {
        hook: "City air quality snapshot",
        blurb: chart.title,
        score: 74,
        preferKind: "geoBubbles",
        category: "Air",
      };
}

function hook_fx(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  // Biggest single-day move in the 90-day window
      let bestAbs = 0;
      let move = 0;
      let quote = "";
      let day = "";
      for (let r = 0; r < sample.rows.length; r++) {
        const chg = numAt(sample, r, "change_pct");
        if (Number.isFinite(chg) && Math.abs(chg) > bestAbs) {
          bestAbs = Math.abs(chg);
          move = chg;
          quote = strAt(sample, r, "quote");
          day = strAt(sample, r, "as_of").slice(0, 10);
        }
      }
      if (quote) {
        return {
          hook: `EUR/${quote} ${move > 0 ? "+" : ""}${move.toFixed(2)}% in a day${day ? ` (${day})` : ""}`,
          blurb: chart.subtitle || chart.title,
          score: 73 + Math.min(18, bestAbs * 8),
          preferKind: "box",
          category: "Markets",
        };
      }
      return {
        hook: "Euro exchange rates, past 90 days",
        blurb: chart.title,
        score: 70,
        preferKind: "box",
        category: "Markets",
      };
}

function hook_fema(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let newest = "";
      let state = "";
      let disaster = "";
      for (let r = 0; r < sample.rows.length; r++) {
        const d = strAt(sample, r, "declaration_date");
        if (d > newest) {
          newest = d;
          state = strAt(sample, r, "state");
          disaster = strAt(sample, r, "incident_type") || strAt(sample, r, "declaration_title");
        }
      }
      return {
        hook: disaster
          ? `${disaster}${state ? ` · ${state}` : ""}`
          : `${n} FEMA disaster declarations`,
        blurb: chart.subtitle || "US declarations by type and state.",
        score: 79,
        preferKind: "choropleth",
        category: "US",
      };
}

function hook_opensky(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  const planes = new Set<string>();
      for (let r = 0; r < sample.rows.length; r++) {
        const id = strAt(sample, r, "icao24");
        if (id) planes.add(id);
      }
      const count = planes.size || n;
      return {
        hook: `${count} aircraft over the US right now`,
        blurb: chart.subtitle || "Flight paths wrapped on the globe.",
        score: 86 + Math.min(10, count / 50),
        preferKind: "globeTrail",
        category: "Transit",
      };
}

function hook_countries(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let topPop = 0;
      let topName = "";
      for (let r = 0; r < sample.rows.length; r++) {
        const p = numAt(sample, r, "population");
        if (p > topPop) {
          topPop = p;
          topName = strAt(sample, r, "name");
        }
      }
      return {
        hook: topName
          ? `${topName} leads population (~${(topPop / 1e9).toFixed(2)}B)`
          : `${n} countries loaded`,
        blurb: chart.subtitle || "Countries filled by population.",
        score: 83,
        preferKind: "choropleth",
        category: "Global",
      };
}

function hook_spacex(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let ok = 0;
      let fail = 0;
      for (let r = 0; r < sample.rows.length; r++) {
        const upcoming = sample.rows[r]?.[colIndex(sample, "upcoming")];
        if (upcoming === true || upcoming === "true") continue;
        const s = sample.rows[r]?.[colIndex(sample, "success")];
        if (s == null || s === "") continue;
        if (s === true || s === "true") ok += 1;
        else fail += 1;
      }
      const finished = ok + fail;
      const rate = finished > 0 ? Math.round((100 * ok) / finished) : 0;
      return {
        hook:
          finished > 0
            ? `SpaceX · ${rate}% success across ${finished} finished flights`
            : `${n} SpaceX flights on the books`,
        blurb: chart.subtitle || chart.title,
        score: 81,
        preferKind: "bar",
        category: "Space",
      };
}

function hook_nyc311(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  const counts = new Map<string, number>();
      for (let r = 0; r < sample.rows.length; r++) {
        const t = strAt(sample, r, "complaint_type");
        if (!t) continue;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      let top = "";
      let topN = 0;
      for (const [k, v] of counts) {
        if (v > topN) {
          topN = v;
          top = k;
        }
      }
      return {
        hook: top ? `NYC 311 · ${top} leads (${topN})` : `${n} recent NYC 311 tickets`,
        blurb: chart.subtitle || "Map complaints or break down by borough.",
        score: 87,
        preferKind: "geoPoints",
        category: "Cities",
      };
}

function hook_covid(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let topCases = 0;
      let topCountry = "";
      let topToday = 0;
      let todayCountry = "";
      for (let r = 0; r < sample.rows.length; r++) {
        const c = numAt(sample, r, "cases");
        const t = numAt(sample, r, "today_cases");
        const name = strAt(sample, r, "country");
        if (c > topCases) {
          topCases = c;
          topCountry = name;
        }
        if (t > topToday) {
          topToday = t;
          todayCountry = name;
        }
      }
      return {
        hook:
          topToday > 100
            ? `${todayCountry} +${Math.round(topToday).toLocaleString()} reported new cases (upstream daily; often laggy)`
            : `${topCountry} leads cumulative cases`,
        blurb: chart.subtitle || chart.title,
        score: 84 + Math.min(10, topToday > 100 ? topToday / 5000 : 0),
        preferKind: "choropleth",
        category: "Health",
      };
}

function hook_launches(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let soonest = Infinity;
      let next = "";
      for (let r = 0; r < sample.rows.length; r++) {
        const net = strAt(sample, r, "net");
        const t = Date.parse(net);
        if (!Number.isFinite(t) || t < Date.now() - 86_400_000) continue;
        if (t < soonest) {
          soonest = t;
          next = strAt(sample, r, "name") || strAt(sample, r, "agency");
        }
      }
      if (!next) {
        next = strAt(sample, 0, "name") || strAt(sample, 0, "agency");
      }
      return {
        hook: next ? `Next up · ${next}` : `${n} upcoming launches`,
        blurb: chart.subtitle || "Agencies, pads, and rockets on the calendar.",
        score: 85,
        preferKind: "bar",
        category: "Space",
      };
}

function hook_eonet(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  const counts = new Map<string, number>();
      for (let r = 0; r < sample.rows.length; r++) {
        const c = strAt(sample, r, "category");
        if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      const [topCat, topN] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
      return {
        hook: topCat ? `${topN} ${topCat.toLowerCase()} active right now` : `${n} natural events tracked by NASA`,
        blurb: chart.subtitle || "Wildfires, storms, and volcanoes on the map.",
        score: 86 + Math.min(8, n / 40),
        preferKind: "geoPoints",
        category: "Earth",
      };
}

function hook_citibike(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let bikes = 0;
      let empty = 0;
      let measured = 0;
      for (let r = 0; r < sample.rows.length; r++) {
        const b = numAt(sample, r, "bikes_available");
        if (!Number.isFinite(b)) continue;
        measured += 1;
        bikes += b;
        if (b === 0) empty += 1;
      }
      if (!measured) {
        return {
          hook: `${n} Citi Bike docks`,
          blurb: chart.subtitle || "Every NYC dock right now.",
          score: 60,
          preferKind: "geoPoints",
          category: "Cities",
        };
      }
      return {
        hook: `${Math.round(bikes).toLocaleString()} Citi Bikes free · ${empty} docks empty`,
        blurb: chart.subtitle || "Every NYC dock right now.",
        score: bikes > 0 ? 84 : 62,
        preferKind: "geoPoints",
        category: "Cities",
      };
}

function hook_spaceweather(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  const peak = maxFiniteAt(sample, "kp");
      const kp = peak?.value ?? NaN;
      const g = Number.isFinite(kp) ? stormLevel(kp) : "";
      const storm = g && g !== "G0" ? g : "";
      return {
        hook: storm
          ? `Geomagnetic storm this week · Kp ${kp.toFixed(1)} (${storm})`
          : Number.isFinite(kp)
            ? `Quiet sun · Kp peaked at ${kp.toFixed(1)}`
            : "Space weather this week",
        blurb: chart.subtitle || "Kp 5+ means auroras farther from the poles.",
        score: storm ? 92 : 74,
        preferKind: "line",
        category: "Space",
      };
}

function hook_ukcarbon(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  // Newest half hour with a measurement, else the newest forecast
      let newestTs = "";
      let value = NaN;
      let index = "";
      for (let r = 0; r < sample.rows.length; r++) {
        const ts = strAt(sample, r, "ts");
        const v = Number.isFinite(numAt(sample, r, "actual")) ? numAt(sample, r, "actual") : numAt(sample, r, "forecast");
        if (Number.isFinite(v) && ts > newestTs) {
          newestTs = ts;
          value = v;
          index = strAt(sample, r, "intensity_index");
        }
      }
      return {
        hook: Number.isFinite(value) ? `UK grid at ${Math.round(value)} gCO₂/kWh${index ? ` (${index})` : ""}` : "Britain's grid carbon today",
        blurb: chart.subtitle || chart.title,
        score: 78,
        preferKind: "line",
        category: "Energy",
      };
}

function hook_pageviews(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let best = -Infinity;
      let title = "";
      let day = "";
      for (let r = 0; r < sample.rows.length; r++) {
        const v = numAt(sample, r, "views");
        if (Number.isFinite(v) && v > best) {
          best = v;
          title = strAt(sample, r, "article");
          day = strAt(sample, r, "day");
        }
      }
      const when = day || "recently";
      return {
        hook: title ? `#1 on Wikipedia ${when}: ${title}` : `What the world read ${when}`,
        blurb: Number.isFinite(best) ? `${Math.round(best).toLocaleString()} views · ${chart.subtitle || chart.title}` : chart.title,
        score: 88,
        preferKind: "bar",
        category: "Culture",
      };
}

function hook_climate(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  // Average anomaly for the latest complete year
      const byYear = new Map<number, number[]>();
      for (let r = 0; r < sample.rows.length; r++) {
        const y = numAt(sample, r, "year");
        const a = numAt(sample, r, "anomaly_c");
        if (!Number.isFinite(y) || !Number.isFinite(a)) continue;
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y)!.push(a);
      }
      const full = [...byYear.entries()].filter(([, v]) => v.length === 12).sort((a, b) => b[0] - a[0])[0];
      const avg = full ? full[1].reduce((s, v) => s + v, 0) / 12 : NaN;
      return {
        hook: full ? `${full[0]} ran ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}°C vs the 20th century` : "Global temperature since 1880",
        blurb: chart.subtitle || chart.title,
        score: 87,
        preferKind: "line",
        category: "Climate",
      };
}

function hook_gdacs(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let red = 0;
      let orange = 0;
      let worst = "";
      let worstScore = -Infinity;
      for (let r = 0; r < sample.rows.length; r++) {
        const lvl = strAt(sample, r, "alert_level");
        if (lvl === "Red") red += 1;
        if (lvl === "Orange") orange += 1;
        const sc = numAt(sample, r, "alert_score");
        if (sc > worstScore) {
          worstScore = sc;
          worst = strAt(sample, r, "title");
        }
      }
      return {
        hook: red ? `${red} red disaster alert${red > 1 ? "s" : ""} worldwide` : orange ? `${orange} orange disaster alerts worldwide` : `${n} disasters being tracked`,
        blurb: worst ? `Most severe: ${worst}` : chart.subtitle || chart.title,
        score: red ? 95 : orange ? 88 : 78,
        preferKind: "geoBubbles",
        category: "Earth",
      };
}

function hook_buoys(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let maxWave = -Infinity;
      let station = "";
      for (let r = 0; r < sample.rows.length; r++) {
        const h = numAt(sample, r, "wave_height_m");
        if (h > maxWave) {
          maxWave = h;
          station = strAt(sample, r, "station");
        }
      }
      return {
        hook: Number.isFinite(maxWave) ? `${maxWave.toFixed(1)} m waves at buoy ${station}` : `${n} ocean buoys reporting`,
        blurb: chart.subtitle || "Waves, wind, and water temperature at sea.",
        score: 76 + Math.min(14, Math.max(0, maxWave) * 2),
        preferKind: "geoBubbles",
        category: "Earth",
      };
}

function hook_mbta(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  return {
        hook: `${n} MBTA vehicles moving in Boston`,
        blurb: chart.subtitle || "Every bus and train, live.",
        score: 82,
        preferKind: "geoPoints",
        category: "Cities",
      };
}

function hook_aurora(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let peakN = -Infinity;
      let peakS = -Infinity;
      for (let r = 0; r < sample.rows.length; r++) {
        const p = numAt(sample, r, "probability");
        if (!Number.isFinite(p)) continue;
        if (numAt(sample, r, "latitude") >= 0) peakN = Math.max(peakN, p);
        else peakS = Math.max(peakS, p);
      }
      const peak = Math.max(peakN, peakS);
      if (!Number.isFinite(peak)) {
        return {
          hook: "Aurora forecast map",
          blurb: chart.subtitle || "Where the northern and southern lights are likely.",
          score: 65,
          preferKind: "geoBubbles",
          category: "Space",
        };
      }
      return {
        hook: peak >= 50 ? `Strong aurora: up to ${Math.round(peak)}% chance overhead` : `Aurora chance peaks at ${Math.round(peak)}% right now`,
        blurb: chart.subtitle || "Where the northern and southern lights are likely.",
        score: 70 + Math.min(25, peak / 3),
        preferKind: "geoBubbles",
        category: "Space",
      };
}

function hook_asteroids(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let closest = Infinity;
      let name = "";
      for (let r = 0; r < sample.rows.length; r++) {
        const d = numAt(sample, r, "distance_ld");
        if (d < closest) {
          closest = d;
          name = strAt(sample, r, "name");
        }
      }
      return {
        hook: Number.isFinite(closest)
          ? `${name || "An asteroid"} passes ${closest < 1 ? "inside the Moon's orbit" : `at ${closest.toFixed(1)}× the Moon's distance`}`
          : "Asteroids passing Earth soon",
        blurb: `${n} close approaches in the next 60 days`,
        score: closest < 1 ? 94 : 84,
        preferKind: "bubble",
        category: "Space",
      };
}

function hook_steam(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  const peak = maxFiniteAt(sample, "peak_players");
      const name = peak ? strAt(sample, peak.row, "name") : "";
      return {
        hook: name
          ? `${name} · ${Math.round(peak!.value).toLocaleString()} playing now`
          : "What gamers are playing",
        blurb: chart.subtitle || "Live concurrent players (CCU) on Steam.",
        score: 83,
        preferKind: "bar",
        category: "Culture",
      };
}

function hook_bitcoin(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  const counts = new Map<string, number>();
      for (let r = 0; r < sample.rows.length; r++) {
        const p = strAt(sample, r, "pool");
        if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
      }
      const [pool, blocks] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
      return {
        hook: pool ? `${pool} mined ${blocks} of the last ${n} Bitcoin blocks` : `The last ${n} Bitcoin blocks`,
        blurb: chart.subtitle || chart.title,
        score: 80,
        preferKind: "bar",
        category: "Markets",
      };
}

function hook_debt(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let latest = "";
      let total = NaN;
      for (let r = 0; r < sample.rows.length; r++) {
        const d = strAt(sample, r, "record_date");
        if (d > latest) {
          latest = d;
          total = numAt(sample, r, "total_debt");
        }
      }
      return {
        hook: Number.isFinite(total) ? `US debt: $${(total / 1e12).toFixed(2)} trillion` : "US national debt since 1993",
        blurb: chart.subtitle || chart.title,
        score: 81,
        preferKind: "line",
        category: "Economy",
      };
}

function hook_wiki(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  return {
        hook: `${n} recent Wikipedia edits`,
        blurb: chart.subtitle || "Watch the live edit stream.",
        score: 82,
        preferKind: "bar",
        category: "Culture",
      };
}

function hookDefault(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  return {
      hook: chart.title,
      blurb: chart.subtitle,
      score: chart.score,
      category: "Live",
    };
}

export const DISCOVER_HOOKS: { [K in DiscoverKind]: DiscoverHookFn } = {
  "usgs": hook_usgs,
  "hn": hook_hn,
  "lobsters": hook_lobsters,
  "firms": hook_firms,
  "nwis": hook_nwis,
  "starlink": hook_starlink,
  "crypto": hook_crypto,
  "iss": hook_iss,
  "nws": hook_nws,
  "meteo": hook_meteo,
  "world_bank": hook_world_bank,
  "aq": hook_aq,
  "fx": hook_fx,
  "fema": hook_fema,
  "opensky": hook_opensky,
  "countries": hook_countries,
  "spacex": hook_spacex,
  "nyc311": hook_nyc311,
  "covid": hook_covid,
  "launches": hook_launches,
  "eonet": hook_eonet,
  "citibike": hook_citibike,
  "spaceweather": hook_spaceweather,
  "ukcarbon": hook_ukcarbon,
  "pageviews": hook_pageviews,
  "climate": hook_climate,
  "gdacs": hook_gdacs,
  "buoys": hook_buoys,
  "mbta": hook_mbta,
  "aurora": hook_aurora,
  "asteroids": hook_asteroids,
  "steam": hook_steam,
  "bitcoin": hook_bitcoin,
  "debt": hook_debt,
  "wiki": hook_wiki,
};

export function discoverHookFor(
  kind: DiscoverKind,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  const n = sample.total_rows || sample.rows.length;
  const fn = DISCOVER_HOOKS[kind] ?? hookDefault;
  return fn(n, sample, chart);
}
