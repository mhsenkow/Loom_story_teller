// =================================================================
// Loom — Discover feed hooks (LOOM-184)
// =================================================================
// One function per live source; DISCOVER_HOOKS is exhaustive over DiscoverKind.
// Magnitude / severity tiers + seasonal score boosts for discover ranking.
// =================================================================

import type { ChartRecommendation } from "./recommendations";
import type { QueryResult } from "./store";
import type { DiscoverKind } from "./discoverStories";
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
  if (v == null || typeof v === "boolean" || (typeof v === "string" && !v.trim())) return NaN;
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

/** Count rows where a numeric column meets a threshold. */
function detectEventCount(sample: QueryResult, col: string, threshold: number): number {
  let count = 0;
  for (let r = 0; r < sample.rows.length; r++) {
    if (numAt(sample, r, col) >= threshold) count += 1;
  }
  return count;
}

/** Keep discover scores in a comparable 0–99 band after boosts. */
function clampScore(score: number): number {
  return Math.max(0, Math.min(99, Math.round(score)));
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
  
  // Detect clusters of significant quakes
  const significant = detectEventCount(sample, "magnitude", 5);
  
  if (maxMag >= 7) {
    return {
      hook: `M${maxMag.toFixed(1)} major earthquake${place ? ` — ${place}` : ""}`,
      blurb: "Monitor for aftershocks and tsunami alerts",
      score: 98,
      preferKind: "geoPoints",
      category: "Earth",
    };
  }
  
  if (maxMag >= 5 && significant > 1) {
    return {
      hook: `${significant} significant quakes (M5+)${place ? ` — strongest near ${place}` : ""}`,
      blurb: "Several strong events in the past day",
      score: 95,
      preferKind: "geoPoints",
      category: "Earth",
    };
  }
  
  if (maxMag >= 5) {
    return {
      hook: `M${maxMag.toFixed(1)} quake${place ? ` — ${place}` : ""}`,
      blurb: "Map it and see the distribution",
      score: 92,
      preferKind: "geoPoints",
      category: "Earth",
    };
  }
  
  return {
    hook: `${n} quakes today · max M${maxMag.toFixed(1)}`,
    blurb: "View global distribution on the globe",
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
  let comments = 0;
  for (let r = 0; r < sample.rows.length; r++) {
    const p = numAt(sample, r, "points");
    const c = numAt(sample, r, "num_comments");
    if (p > best) {
      best = p;
      title = strAt(sample, r, "title");
      comments = c;
    }
  }
  const short = title.length > 48 ? `${title.slice(0, 46)}…` : title;
  
  // Detect viral stories
  let hook = "";
  let blurb = "";
  let score = 70 + Math.min(25, best / 20);
  
  if (best >= 300 && comments >= 100) {
    hook = `${best} pts · ${comments} comments: ${short}`;
    blurb = "Viral story — hot discussion";
    score = 95;
  } else if (best >= 150) {
    hook = `${best} pts · ${short}`;
    blurb = `${comments} comments · discussion awaiting`;
    score = 85;
  } else if (short) {
    hook = `${best} pts · ${short}`;
    blurb = "Scores vs engagement";
  } else {
    hook = `${n} stories on the front page`;
    blurb = "Hacker News activity feed";
    score = 70;
  }
  
  return {
    hook,
    blurb,
    score,
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
        // The chart compares every gauge — headline the leader, not a single-site story
        hook: short ? `Highest flow: ${short} · ${Math.round(peak).toLocaleString()} cfs` : `${n} river gauge readings`,
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
  const verb = chg >= 0 ? "surges" : "drops";
  if (!sym) {
    return {
      hook: `${n} crypto markets`,
      blurb: "Compare crypto performance side by side",
      score: 72,
      preferKind: "isoScatter",
      category: "Markets",
    };
  }

  if (bestAbs >= 20) {
    return {
      hook: `${sym} ${verb} ${sign}${bestAbs.toFixed(1)}% today`,
      blurb: "Significant volatility across crypto markets",
      score: clampScore(90 + Math.min(8, bestAbs / 5)),
      preferKind: "isoScatter",
      category: "Markets",
    };
  }

  if (bestAbs >= 10) {
    return {
      hook: `${sym} ${sign}${chg.toFixed(1)}% today`,
      blurb: "Notable price movement in crypto markets",
      score: clampScore(82 + Math.min(8, bestAbs / 3)),
      preferKind: "isoScatter",
      category: "Markets",
    };
  }

  return {
    hook: `${sym} ${sign}${chg.toFixed(1)}% today`,
    blurb: "Compare crypto performance side by side",
    score: clampScore(75 + Math.min(15, bestAbs)),
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
  let extremeCount = 0;

  for (let r = 0; r < sample.rows.length; r++) {
    const sev = strAt(sample, r, "severity").toLowerCase();
    if (sev.includes("extreme")) {
      extremeCount += 1;
      severe += 1;
    } else if (sev.includes("severe") || sev.includes("dangerous")) {
      severe += 1;
    }
  }

  if (extremeCount > 0) {
    return {
      hook: `${extremeCount} extreme weather alert${extremeCount > 1 ? "s" : ""} active`,
      blurb: "Life-threatening conditions possible",
      score: 98,
      preferKind: "bar",
      category: "Weather",
    };
  }
  if (severe > 3) {
    return {
      hook: `${severe} severe US weather alerts`,
      blurb: `${n} total alerts — monitor conditions`,
      score: 92,
      preferKind: "bar",
      category: "Weather",
    };
  }
  if (severe > 0) {
    return {
      hook: `${severe} severe weather alert${severe > 1 ? "s" : ""}`,
      blurb: `${n} total alerts — review conditions`,
      score: 85,
      preferKind: "bar",
      category: "Weather",
    };
  }
  return {
    hook: n > 0 ? `${n} NWS alerts active` : "No active NWS alerts",
    blurb: n > 0 ? "Weather watches, warnings, advisories" : "Quiet period across the US",
    score: n > 0 ? 70 + Math.min(15, n / 5) : 60,
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

  if (hottest > 35 && city) {
    return {
      hook: `${city} blazing at ${hottest.toFixed(1)}°C`,
      blurb: "Extreme heat across the city snapshot",
      score: 92,
      preferKind: "geoBubbles",
      category: "Weather",
    };
  }
  if (hottest > 30 && city) {
    return {
      hook: `${city} hottest now at ${hottest.toFixed(1)}°C`,
      blurb:
        wettest > 0.2
          ? `${wetCity} seeing rain while ${city} bakes`
          : "Temperature extremes across major cities",
      score: 85,
      preferKind: "geoBubbles",
      category: "Weather",
    };
  }
  if (city) {
    return {
      hook: `${city} hottest now at ${hottest.toFixed(1)}°C`,
      blurb:
        wettest > 0.2 && wetCity
          ? `${wetCity} sees rain · compare global temps`
          : "World temperature snapshot",
      score: 78,
      preferKind: "geoBubbles",
      category: "Weather",
    };
  }
  return {
    hook: "World weather snapshot",
    blurb: "Temperature and precipitation across 12 cities",
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
  
  // Also check for dangerous levels
  let dangerous = 0;
  let unhealthy = 0;
  
  for (let r = 0; r < sample.rows.length; r++) {
    const pm = numAt(sample, r, "pm2_5");
    if (pm > worst) {
      worst = pm;
      city = strAt(sample, r, "city");
    }
    if (pm >= 55) dangerous += 1;
    if (pm >= 35 && pm < 55) unhealthy += 1;
  }
  
  if (city && Number.isFinite(worst)) {
    let hook = "";
    let blurb = "";
    let score = 80 + Math.min(15, worst / 10);
    
    if (worst >= 150) {
      hook = `${city} hazardous air quality · PM2.5 ${worst.toFixed(0)}`;
      blurb = "Avoid outdoor activity — health alert";
      score = 96;
    } else if (worst >= 55) {
      hook = `${city} unhealthy air · PM2.5 ${worst.toFixed(0)} µg/m³`;
      blurb = `${dangerous} cities in danger zone · limit exposure`;
      score = 90;
    } else if (worst >= 35) {
      hook = `${city} elevated pollution · PM2.5 ${worst.toFixed(0)} µg/m³`;
      blurb = `${unhealthy + dangerous} cities above safe levels`;
      score = 82;
    } else {
      hook = `${city} PM2.5 ${worst.toFixed(0)} µg/m³`;
      blurb = "Compare cities on air quality";
      score = 76;
    }
    
    return {
      hook,
      blurb,
      score,
      preferKind: "geoBubbles",
      category: "Air",
    };
  }
  
  return {
    hook: "City air quality snapshot",
    blurb: "PM2.5 levels across major cities",
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
  
  // Perfect record or near-perfect = higher score
  if (finished >= 5 && rate === 100) {
    return {
      hook: `SpaceX · perfect ${finished}/${finished} success rate`,
      blurb: "Flawless streak continues",
      score: 95,
      preferKind: "bar",
      category: "Space",
    };
  }
  
  // Very high success rate
  if (finished >= 10 && rate >= 95) {
    return {
      hook: `SpaceX · ${rate}% success across ${finished} flights`,
      blurb: "Industry-leading reliability",
      score: 88,
      preferKind: "bar",
      category: "Space",
    };
  }
  
  // Normal reporting
  if (finished > 0) {
    return {
      hook: `SpaceX · ${rate}% success across ${finished} flights`,
      blurb: "Cadence and success rate over time",
      score: 81,
      preferKind: "bar",
      category: "Space",
    };
  }
  
  return {
    hook: `${n} SpaceX flights on the books`,
    blurb: "Historical launch data and upcoming missions",
    score: 70,
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
  
  // Compare to historical data for context
  let hook = "";
  let blurb = "";
  let score = 87;
  
  if (full && Number.isFinite(avg)) {
    // Get all years to find if this is a record
    const allYears = [...byYear.entries()]
      .filter(([, v]) => v.length === 12)
      .map(([yr, vals]) => ({
        yr,
        avg: vals.reduce((s, v) => s + v, 0) / vals.length,
      }))
      .sort((a, b) => a.avg - b.avg);
    
    const isRecord = full[0] === allYears[allYears.length - 1].yr;
    const top3 = allYears.slice(-3).some((yr) => yr.yr === full[0]);
    
    hook = `${full[0]} was ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}°C vs 20th century`;
    
    if (isRecord) {
      hook = `${full[0]} was hottest on record · ${avg.toFixed(2)}°C above normal`;
      blurb = "Continuing the warming trend since 1880";
      score = 96;
    } else if (top3) {
      hook = `${full[0]} among warmest years · ${avg.toFixed(2)}°C above normal`;
      blurb = "Still in top 3 warmest years recorded";
      score = 92;
    } else {
      blurb = "Global temperature trend since 1880";
    }
  } else {
    hook = "Global temperature since 1880";
    blurb = "Monthly temperature anomaly record";
    score = 75;
  }
  
  return {
    hook,
    blurb,
    score,
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
  let green = 0;
  let worst = "";
  let worstScore = -Infinity;
  let worstType = "";
  
  for (let r = 0; r < sample.rows.length; r++) {
    const lvl = strAt(sample, r, "alert_level");
    const sc = numAt(sample, r, "alert_score");
    const title = strAt(sample, r, "title");
    const eventType = strAt(sample, r, "event_type");
    
    if (lvl === "Red") {
      red += 1;
      if (!worst && sc > worstScore) {
        worstScore = sc;
        worst = title;
        worstType = eventType;
      }
    } else if (lvl === "Orange") {
      orange += 1;
      if (red === 0 && sc > worstScore) {
        worstScore = sc;
        worst = title;
        worstType = eventType;
      }
    } else {
      green += 1;
    }
  }
  
  let hook = "";
  let blurb = "";
  let score = 78;
  
  if (red > 0) {
    hook = `${red} RED disaster alert${red > 1 ? "s" : ""} — immediate action required`;
    blurb = worst && worstType ? `${worstType}: ${worst}` : "Major disasters underway";
    score = 98;
  } else if (orange > 2) {
    hook = `${orange} orange disaster alerts worldwide`;
    blurb = worst && worstType ? `Significant: ${worst}` : "Multiple developing disasters";
    score = 90;
  } else if (orange > 0) {
    hook = `${orange} orange disaster alert${orange > 1 ? "s" : ""}`;
    blurb = worst && worstType ? `${worstType}: ${worst}` : "Moderate impact events";
    score = 85;
  } else if (n > 0) {
    hook = `${n} disasters being tracked`;
    blurb = green > 0 ? `${green} green alerts — minimal impact` : "Global disaster monitoring";
    score = 75;
  } else {
    hook = "No active major disasters";
    blurb = "Quiet worldwide";
    score = 60;
  }
  
  return {
    hook,
    blurb,
    score,
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
  
  // Also track if there are any truly close flybys
  const closeApproaches: Array<{ name: string; distance: number; size: number }> = [];
  
  for (let r = 0; r < sample.rows.length; r++) {
    const d = numAt(sample, r, "distance_ld");
    if (d < closest) {
      closest = d;
      name = strAt(sample, r, "designation") || strAt(sample, r, "name");
    }
    // Track close approaches (< 0.5 LD)
    if (d < 0.5 && d > 0) {
      closeApproaches.push({
        name: strAt(sample, r, "designation") || strAt(sample, r, "name"),
        distance: d,
        size: numAt(sample, r, "diameter_m"),
      });
    }
  }
  
  if (closeApproaches.length > 0) {
    // Sort by distance
    closeApproaches.sort((a, b) => a.distance - b.distance);
    const closestClose = closeApproaches[0]!;
    const size = Math.round(closestClose.size);
    
    if (closestClose.distance < 0.2) {
      const hook = `${closestClose.name} passes at ${closestClose.distance.toFixed(2)} LD · ${size}m wide`;
      return {
        hook,
        blurb: "Potentially hazardous close approach in the next 60 days",
        score: 97,
        preferKind: "bubble",
        category: "Space",
      };
    }
    
    return {
      hook: `${closestClose.name} flyby · ${closestClose.distance.toFixed(2)} LD from Earth`,
      blurb: `${n} close approaches tracked · ${size}m diameter asteroid`,
      score: 92,
      preferKind: "bubble",
      category: "Space",
    };
  }
  
  if (Number.isFinite(closest) && closest < 1) {
    return {
      hook: `${name} passes within ${closest.toFixed(1)}× the Moon's distance`,
      blurb: `${n} asteroid approaches in the next 60 days`,
      score: 94,
      preferKind: "bubble",
      category: "Space",
    };
  }
  
  if (Number.isFinite(closest)) {
    return {
      hook: `${name} flies by at ${closest.toFixed(1)}× lunar distance`,
      blurb: `${n} close approaches tracked in the next 60 days`,
      score: 84,
      preferKind: "bubble",
      category: "Space",
    };
  }
  
  return {
    hook: "Asteroids passing Earth soon",
    blurb: `${n} close approaches in the next 60 days`,
    score: 70,
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

function hook_usafacts_states(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  // Richest state in the newest vintage, plus how many states saw unemployment rise vs the prior one
  let latest = -Infinity;
  for (let r = 0; r < sample.rows.length; r++) {
    const y = numAt(sample, r, "yr");
    if (Number.isFinite(y) && y > latest) latest = y;
  }
  let prior = -Infinity;
  for (let r = 0; r < sample.rows.length; r++) {
    const y = numAt(sample, r, "yr");
    if (y < latest && y > prior) prior = y;
  }
  const unempPrior = new Map<string, number>();
  let topIncome = -Infinity;
  let topState = "";
  for (let r = 0; r < sample.rows.length; r++) {
    const y = numAt(sample, r, "yr");
    if (y === prior) unempPrior.set(strAt(sample, r, "state_abbr"), numAt(sample, r, "unemployment_rate"));
    if (y !== latest) continue;
    const inc = numAt(sample, r, "median_household_income");
    if (inc > topIncome) {
      topIncome = inc;
      topState = strAt(sample, r, "state_name");
    }
  }
  let rose = 0;
  let compared = 0;
  for (let r = 0; r < sample.rows.length; r++) {
    if (numAt(sample, r, "yr") !== latest) continue;
    const before = unempPrior.get(strAt(sample, r, "state_abbr"));
    const now = numAt(sample, r, "unemployment_rate");
    if (before == null || !Number.isFinite(before) || !Number.isFinite(now)) continue;
    compared++;
    if (now > before) rose++;
  }
  if (topState && Number.isFinite(topIncome)) {
    const movers = compared ? ` Unemployment rose in ${rose} of ${compared} states vs ${prior}.` : "";
    return {
      hook: `${topState} earns the most · $${Math.round(topIncome).toLocaleString("en-US")} median income (${latest})`,
      blurb: `${chart.subtitle || chart.title}.${movers}`,
      score: 84,
      preferKind: "choropleth",
      category: "Economy",
    };
  }
  return {
    hook: "Income, poverty, and jobs in every state",
    blurb: chart.subtitle || chart.title,
    score: 74,
    preferKind: "choropleth",
    category: "Economy",
  };
}

function hook_usafacts_nation(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  let latest = "";
  let unemp = NaN;
  let infl = NaN;
  for (let r = 0; r < sample.rows.length; r++) {
    const m = strAt(sample, r, "month");
    const u = numAt(sample, r, "unemployment_rate");
    if (m > latest && Number.isFinite(u)) {
      latest = m;
      unemp = u;
      infl = numAt(sample, r, "inflation_yoy_pct");
    }
  }
  if (latest && Number.isFinite(unemp)) {
    const when = new Date(`${latest.slice(0, 7)}-15T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    const inflText = Number.isFinite(infl) ? ` · inflation ${infl.toFixed(1)}%` : "";
    return {
      hook: `US unemployment ${unemp.toFixed(1)}%${inflText} (${when})`,
      blurb: chart.subtitle || chart.title,
      score: Number.isFinite(infl) && infl >= 3 ? 85 : 80,
      preferKind: "line",
      category: "Economy",
    };
  }
  return {
    hook: "The US economy since 1990",
    blurb: chart.subtitle || chart.title,
    score: 74,
    preferKind: "line",
    category: "Economy",
  };
}

function hook_wiki(
  n: number,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  const titleCounts = new Map<string, number>();
  for (let r = 0; r < Math.min(50, sample.rows.length); r++) {
    const title = strAt(sample, r, "title");
    if (title && title.length > 0 && title.length < 100) {
      titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    }
  }
  const [hotTopic, hotCount] = [...titleCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];

  if (hotTopic && hotCount >= 5) {
    return {
      hook: `${hotTopic} · ${hotCount} edits in sample`,
      blurb: chart.subtitle || "Watch the live edit stream",
      score: 86,
      preferKind: "bar",
      category: "Culture",
    };
  }
  return {
    hook: `${n.toLocaleString()} recent Wikipedia edits`,
    blurb: chart.subtitle || "Watch the live edit stream",
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
  "usafacts_states": hook_usafacts_states,
  "usafacts_nation": hook_usafacts_nation,
  "wiki": hook_wiki,
};

export function discoverHookFor(
  kind: DiscoverKind,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  const n = sample.rows.length;
  const fn = DISCOVER_HOOKS[kind] ?? hookDefault;
  const result = fn(n, sample, chart);
  return {
    ...result,
    score: clampScore(applySeasonalBoost(kind, result.score)),
  };
}

/**
 * Light seasonal / time-of-day multipliers for discover ranking.
 * Kept small so severity-based scores still dominate.
 */
function applySeasonalBoost(kind: DiscoverKind, baseScore: number): number {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const hour = now.getHours();
  const dayOfWeek = now.getDay(); // 0 (Sun) - 6 (Sat)

  let boost = 1.0;

  switch (kind) {
    case "aurora":
    case "spaceweather":
      // Aurora season: autumn/winter (Sep–Mar)
      boost *= month >= 8 || month <= 2 ? 1.15 : 0.95;
      break;
    case "eonet":
    case "firms":
      // Fire season: Jun–Oct (Northern hemisphere)
      if (month >= 5 && month <= 9) boost *= 1.1;
      break;
    case "buoys":
      if (month >= 9 || month <= 3) boost *= 1.08;
      break;
    case "meteo":
    case "nws":
    case "aq":
      if (month >= 5 && month <= 8 && hour >= 12 && hour <= 18) {
        boost *= 1.08; // summer afternoon
      } else if ((month >= 11 || month <= 1) && hour >= 6 && hour <= 9) {
        boost *= 1.08; // winter morning
      }
      break;
  }

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    if (kind === "steam" || kind === "pageviews" || kind === "hn") boost *= 1.05;
  } else if (
    (kind === "crypto" || kind === "fx" || kind === "bitcoin" || kind === "hn") &&
    hour >= 9 &&
    hour <= 17
  ) {
    boost *= 1.05;
  }

  boost = Math.max(0.9, Math.min(1.2, boost));
  return baseScore * boost;
}
