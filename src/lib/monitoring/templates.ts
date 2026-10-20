// =================================================================
// Loom — Starter monitors
// =================================================================
// Each starter names the decision it supports, so a new user sees that
// a monitor is "watch X so I can do Y", not "a line that turns red".
// Scorecards group several metrics: one reading (temperature) is rarely
// enough to call something degraded.
// =================================================================

import type { Monitor } from "./types";

export type MonitorDraft = Omit<Monitor, "id" | "createdAt" | "nextRunAt">;

const notify = { inApp: true, system: true, cooldownMinutes: 60 } as const;

export const MONITOR_TEMPLATES: { id: string; title: string; blurb: string; draft: MonitorDraft }[] = [
  {
    id: "quake-m6",
    title: "Big earthquake",
    blurb: "Any M6+ quake in the last hour.",
    draft: {
      name: "M6+ earthquake in the last hour",
      decision: "Check on people and partners in the affected region; watch for tsunami notices.",
      metric: { source: "usgs", agg: "max", column: "magnitude", timeColumn: "ts", lookbackMinutes: 60, unit: "M" },
      rule: { kind: "threshold", above: 6 },
      confirmChecks: 1,
      severity: "critical",
      schedule: { kind: "interval", minutes: 5 },
      notify: { ...notify, cooldownMinutes: 180 },
      expected: [],
      enabled: true,
    },
  },
  {
    id: "city-heat",
    title: "City heat health",
    blurb: "Scorecard: temperature, humidity and air quality for one city.",
    draft: {
      name: "New York temperature unusual for this hour",
      decision: "Send the heat advisory to field crews and move outdoor work earlier.",
      rationale: "Temperature alone isn't enough. Pair it with humidity and AQI in the same scorecard.",
      metric: { source: "meteo", agg: "latest", column: "temperature", timeColumn: "ts", filters: [{ column: "city", op: "=", value: "New York" }], unit: "°C" },
      rule: { kind: "anomaly", sensitivity: 3.5, window: 30, seasonal: "hour" },
      confirmChecks: 2,
      severity: "warning",
      schedule: { kind: "interval", minutes: 30 },
      notify,
      expected: [],
      scorecard: "City heat health",
      enabled: true,
    },
  },
  {
    id: "city-aqi",
    title: "Air quality limit",
    blurb: "European AQI above \"poor\" for a city (part of City heat health).",
    draft: {
      name: "New York air quality poor",
      decision: "Close windows on the HVAC schedule and tell sensitive staff to limit time outdoors.",
      metric: { source: "aq", agg: "latest", column: "european_aqi", timeColumn: "ts", filters: [{ column: "city", op: "=", value: "New York" }], unit: "AQI" },
      rule: { kind: "threshold", above: 60 },
      confirmChecks: 2,
      severity: "warning",
      schedule: { kind: "interval", minutes: 60 },
      notify,
      expected: [],
      scorecard: "City heat health",
      enabled: true,
    },
  },
  {
    id: "geomag-storm",
    title: "Geomagnetic storm",
    blurb: "Planetary Kp at storm level (5+). Also a good night for aurora.",
    draft: {
      name: "Kp at storm level",
      decision: "Expect GPS / HF radio degradation; post the aurora alert.",
      metric: { source: "spaceweather", agg: "latest", column: "kp", timeColumn: "ts", unit: "Kp" },
      rule: { kind: "threshold", above: 4.99 },
      confirmChecks: 1,
      severity: "info",
      schedule: { kind: "interval", minutes: 30 },
      notify,
      expected: [],
      enabled: true,
    },
  },
  {
    id: "grid-carbon",
    title: "Dirty grid hour",
    blurb: "UK grid carbon intensity outside its normal band.",
    draft: {
      name: "UK grid carbon unusual",
      decision: "Delay flexible loads such as batch jobs or EV charging until intensity drops.",
      metric: { source: "ukcarbon", agg: "latest", column: "actual", timeColumn: "ts", unit: "gCO₂/kWh" },
      rule: { kind: "anomaly", sensitivity: 3.5, window: 48, seasonal: "hour" },
      confirmChecks: 2,
      severity: "info",
      schedule: { kind: "interval", minutes: 30 },
      notify,
      expected: [],
      enabled: true,
    },
  },
  {
    id: "btc-drop",
    title: "Crypto swing",
    blurb: "Bitcoin moves 5% between checks.",
    draft: {
      name: "Bitcoin price swing",
      decision: "Review the treasury exposure note. No automatic trades.",
      metric: { source: "crypto", agg: "latest", column: "price_usd", filters: [{ column: "symbol", op: "=", value: "btc" }], unit: "USD" },
      rule: { kind: "change", pct: 5, direction: "either", versus: "previous" },
      confirmChecks: 1,
      severity: "info",
      schedule: { kind: "interval", minutes: 15 },
      notify,
      expected: [],
      enabled: true,
    },
  },
  {
    id: "feed-stale",
    title: "Feed went quiet",
    blurb: "No new river gauge readings in 3 hours: is the sensor or the feed down?",
    draft: {
      name: "River gauges stopped reporting",
      decision: "Treat flood readings as unknown, not safe; check the USGS status page.",
      metric: { source: "nwis", agg: "count", timeColumn: "ts" },
      rule: { kind: "stale", maxAgeMinutes: 180 },
      confirmChecks: 2,
      severity: "warning",
      schedule: { kind: "interval", minutes: 30 },
      notify,
      expected: [],
      enabled: true,
    },
  },
  {
    id: "nws-severe",
    title: "Severe weather alerts",
    blurb: "Count of Extreme/Severe NWS alerts; daily 7am digest.",
    draft: {
      name: "Severe NWS alerts this morning",
      decision: "Decide by 8am whether to activate the weather plan for affected sites.",
      metric: { source: "nws", agg: "count", filters: [{ column: "severity", op: "=", value: "Extreme" }] },
      rule: { kind: "threshold", above: 0 },
      confirmChecks: 1,
      severity: "warning",
      schedule: { kind: "daily", hour: 7, minute: 0 },
      notify,
      expected: [],
      enabled: true,
    },
  },
];
