// =================================================================
// Loom — Dive data loading (rows for the in-memory dive engine)
// =================================================================
// Desktop: pull a large sample through DuckDB (files: reservoir
// sample; streams: newest rows). Web: live streams use the whole JS
// buffer; demo files their full mock data; uploaded CSVs fall back to
// the in-store sample. Always reports how much of the data it holds.
// =================================================================

import { isTauri, queryFile, sourceQuery, sourceSnapshot, streamQuery, streamSnapshot, type SourceKind } from "./tauri";
import type { QueryResult } from "./store";
import type { DiveData } from "./dive";

export const DIVE_DESKTOP_ROWS = 30_000;
export const DIVE_WEB_STREAM_ROWS = 8_000;

/** Poll-source table names in DuckDB (desktop). */
export const SOURCE_TABLES: Record<string, string> = {
  usgs: "usgs_quakes",
  meteo: "meteo_weather",
  nws: "nws_alerts",
  world_bank: "world_bank",
  iss: "iss_track",
  hn: "hn_stories",
  crypto: "crypto_markets",
  aq: "air_quality",
  fx: "fx_rates",
  fema: "fema_disasters",
  opensky: "opensky_aircraft",
  countries: "world_countries",
  spacex: "spacex_launches",
  nyc311: "nyc_311",
  covid: "covid_countries",
  launches: "space_launches",
};

export interface DiveDataset {
  data: DiveData;
  /** Rows in the full dataset when known (≥ rows held). */
  totalRows: number;
  /** True when only part of the dataset is loaded. */
  sampled: boolean;
  /** Stream / poll source that keeps growing — worth auto-refreshing. */
  live: boolean;
  /** SQL table name the query maps to (for the SQL preview). */
  table: string;
}

function fromQuery(r: QueryResult): DiveData {
  return { columns: r.columns, rows: r.rows, types: r.types };
}

export function isLiveDivePath(path: string | null | undefined): boolean {
  return !!path && path.startsWith("stream://");
}

/** Load as many rows as is reasonable for `path`; `fallback` is the current in-store sample. */
export async function loadDiveDataset(path: string, fallback: QueryResult | null): Promise<DiveDataset> {
  const desktop = isTauri();
  if (path === "stream://wiki") {
    if (desktop) {
      const r = await streamQuery("SELECT * FROM wiki_stream ORDER BY ts DESC", DIVE_DESKTOP_ROWS);
      return { data: fromQuery(r), totalRows: Math.max(r.total_rows, r.rows.length), sampled: r.rows.length >= DIVE_DESKTOP_ROWS, live: true, table: "wiki_stream" };
    }
    const snap = await streamSnapshot(DIVE_WEB_STREAM_ROWS);
    return { data: fromQuery(snap.sample), totalRows: snap.sample.total_rows, sampled: snap.sample.rows.length < snap.sample.total_rows, live: true, table: "wiki_stream" };
  }
  if (path.startsWith("stream://")) {
    const kind = path.slice("stream://".length) as SourceKind;
    const table = SOURCE_TABLES[kind] ?? kind;
    if (desktop) {
      const r = await sourceQuery(kind, `SELECT * FROM ${table}`, DIVE_DESKTOP_ROWS);
      return { data: fromQuery(r), totalRows: Math.max(r.total_rows, r.rows.length), sampled: r.rows.length >= DIVE_DESKTOP_ROWS, live: true, table };
    }
    const snap = await sourceSnapshot(kind, DIVE_WEB_STREAM_ROWS);
    return { data: fromQuery(snap.sample), totalRows: snap.sample.total_rows, sampled: snap.sample.rows.length < snap.sample.total_rows, live: true, table };
  }
  if (desktop) {
    let r: QueryResult;
    try {
      // Reservoir sample keeps big files representative instead of "first N rows".
      r = await queryFile(path, `SELECT * FROM loom_active USING SAMPLE ${DIVE_DESKTOP_ROWS} ROWS`, DIVE_DESKTOP_ROWS);
    } catch {
      r = await queryFile(path, "SELECT * FROM loom_active", DIVE_DESKTOP_ROWS);
    }
    const total = Math.max(fallback?.total_rows ?? 0, r.rows.length);
    return { data: fromQuery(r), totalRows: total, sampled: r.rows.length < total, live: false, table: "loom_active" };
  }
  if (path.startsWith("mock://")) {
    // Demo files: the browser mock serves the full generated table.
    const r = await queryFile(path, "", 100_000);
    return { data: fromQuery(r), totalRows: r.rows.length, sampled: false, live: false, table: "loom_active" };
  }
  if (!fallback) throw new Error("Open a file first");
  return {
    data: fromQuery(fallback),
    totalRows: Math.max(fallback.total_rows, fallback.rows.length),
    sampled: fallback.rows.length < fallback.total_rows,
    live: false,
    table: "loom_active",
  };
}
