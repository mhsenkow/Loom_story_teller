// =================================================================
// Loom — Poll-Based Data Sources
// =================================================================
// Public data feeds polled on background intervals into DuckDB tables.
//
// `SOURCE_SPECS` mirrors `src/lib/sourceRegistry.ts` (kind, table,
// column names + order + types, ORDER BY, poll cadence). A unit test
// parses the TS registry and fails if the two drift apart.
//
// Each kind has a pure parser (`*_rows`: upstream JSON → rows) and a
// fetch step in `poll_once`. One generic loop in `source_start` polls,
// writes (replace / upsert / append per the spec), and reports counts.
// =================================================================

use crate::db::{duckdb_value_to_json, ColumnInfo, LoomDb, QueryResult};
use duckdb::types::{ToSql, ToSqlOutput, Value as DbValue};
use duckdb::{params, params_from_iter, Connection};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

/// Row cap for append / upsert tables (oldest rows are trimmed).
const MAX_ROWS: usize = 50_000;
/// Aircraft kept per poll (OpenSky or ADSB.lol).
const MAX_AIRCRAFT: usize = 1500;
/// Newest NWS alerts kept per poll.
const NWS_MAX_ALERTS: usize = 150;
/// Pageviews rows kept after filtering.
const PAGEVIEWS_TOP: usize = 100;
/// Retry delay for load-once sources whose first load failed.
const LOAD_ONCE_RETRY_SECS: u64 = 60;
/// After OpenSky / CoinGecko fail, skip them for this long and use the fallback.
const PRIMARY_BACKOFF_SECS: i64 = 600;

// ================================================================
// Registry (mirror of src/lib/sourceRegistry.ts)
// ================================================================

/// How each poll's rows land in the table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteMode {
    /// Snapshot: replace the table contents each poll.
    Replace,
    /// Replace rows with the same key, insert new ones (keeps history).
    Upsert(&'static [&'static str]),
    /// Append every row (trails / tracks).
    Append,
}

pub struct SourceSpec {
    pub kind: &'static str,
    pub table: &'static str,
    pub columns: &'static [(&'static str, &'static str)],
    /// ORDER BY clause for snapshots (no "ORDER BY" keyword).
    pub order_by: &'static str,
    /// Poll interval; 0 = load once.
    pub poll_secs: u64,
    pub mode: WriteMode,
}

const V: &str = "VARCHAR";
const D: &str = "DOUBLE";
const I: &str = "INTEGER";
const BI: &str = "BIGINT";
const B: &str = "BOOLEAN";
const TS: &str = "TIMESTAMP";
const DT: &str = "DATE";

pub const SOURCE_SPECS: &[SourceSpec] = &[
    SourceSpec {
        kind: "usgs",
        table: "usgs_quakes",
        columns: &[
            ("id", V), ("magnitude", D), ("place", V), ("ts", TS), ("latitude", D), ("longitude", D),
            ("depth", D), ("mag_type", V), ("status", V), ("tsunami", B), ("sig", I), ("net", V),
        ],
        order_by: "ts DESC",
        poll_secs: 60,
        mode: WriteMode::Upsert(&["id"]),
    },
    SourceSpec {
        kind: "eonet",
        table: "natural_events",
        columns: &[
            ("id", V), ("title", V), ("category", V), ("source", V), ("ts", TS), ("latitude", D),
            ("longitude", D), ("magnitude", D), ("magnitude_unit", V), ("status", V),
        ],
        order_by: "ts DESC",
        poll_secs: 600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "nws",
        table: "nws_alerts",
        columns: &[
            ("id", V), ("event", V), ("headline", V), ("severity", V), ("certainty", V), ("urgency", V),
            ("area_desc", V), ("sender_name", V), ("effective", TS), ("expires", TS), ("status", V),
            ("category", V),
        ],
        order_by: "effective DESC",
        poll_secs: 120,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "meteo",
        table: "meteo_weather",
        columns: &[
            ("ts", TS), ("city", V), ("latitude", D), ("longitude", D), ("temperature", D), ("humidity", D),
            ("wind_speed", D), ("precipitation", D), ("weather_code", I), ("pressure", D), ("cloud_cover", D),
        ],
        order_by: "ts DESC",
        poll_secs: 300,
        mode: WriteMode::Upsert(&["ts", "city"]),
    },
    SourceSpec {
        kind: "aq",
        table: "air_quality",
        columns: &[
            ("ts", TS), ("city", V), ("latitude", D), ("longitude", D), ("pm2_5", D), ("pm10", D),
            ("ozone", D), ("nitrogen_dioxide", D), ("european_aqi", D),
        ],
        order_by: "pm2_5 DESC",
        poll_secs: 300,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "ukcarbon",
        table: "uk_carbon",
        columns: &[("ts", TS), ("forecast", I), ("actual", I), ("intensity_index", V)],
        order_by: "ts DESC",
        poll_secs: 1800,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "climate",
        table: "global_temperature",
        columns: &[("ts", DT), ("year", I), ("month", I), ("anomaly_c", D)],
        order_by: "ts ASC",
        poll_secs: 0,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "opensky",
        table: "opensky_aircraft",
        columns: &[
            ("icao24", V), ("callsign", V), ("origin_country", V), ("longitude", D), ("latitude", D),
            ("baro_altitude", D), ("velocity", D), ("true_track", D), ("on_ground", B), ("ts", TS),
        ],
        order_by: "baro_altitude DESC",
        poll_secs: 30,
        // Append snapshots (do not wipe) so trail ribbons can stitch paths.
        mode: WriteMode::Append,
    },
    SourceSpec {
        kind: "citibike",
        table: "citibike_stations",
        columns: &[
            ("station_id", V), ("name", V), ("latitude", D), ("longitude", D), ("capacity", I),
            ("bikes_available", I), ("ebikes_available", I), ("docks_available", I), ("pct_full", D),
            ("is_renting", B), ("ts", TS),
        ],
        order_by: "bikes_available DESC",
        poll_secs: 60,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "nyc311",
        table: "nyc_311",
        columns: &[
            ("unique_key", V), ("created_date", TS), ("complaint_type", V), ("descriptor", V),
            ("borough", V), ("city", V), ("latitude", D), ("longitude", D), ("status", V), ("agency", V),
        ],
        order_by: "created_date DESC",
        poll_secs: 300,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "iss",
        table: "iss_track",
        columns: &[
            ("ts", TS), ("latitude", D), ("longitude", D), ("altitude_km", D), ("velocity_kmh", D),
            ("visibility", V),
        ],
        order_by: "ts DESC",
        poll_secs: 15,
        mode: WriteMode::Append,
    },
    SourceSpec {
        kind: "launches",
        table: "space_launches",
        columns: &[
            ("id", V), ("name", V), ("net", TS), ("status", V), ("pad", V), ("location", V),
            ("agency", V), ("rocket", V), ("orbital", B),
        ],
        order_by: "net ASC",
        poll_secs: 1800,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "spacex",
        table: "spacex_launches",
        columns: &[
            ("id", V), ("name", V), ("date_utc", TS), ("success", B), ("upcoming", B), ("rocket", V),
            ("flight_number", I), ("details", V),
        ],
        order_by: "date_utc DESC",
        poll_secs: 3600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "spaceweather",
        table: "space_weather",
        columns: &[("ts", TS), ("kp", D), ("a_running", I), ("station_count", I), ("storm_level", V)],
        order_by: "ts DESC",
        poll_secs: 900,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "hn",
        table: "hn_stories",
        columns: &[
            ("id", V), ("title", V), ("author", V), ("points", I), ("num_comments", I), ("url", V),
            ("created_at", TS),
        ],
        order_by: "points DESC",
        poll_secs: 120,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "pageviews",
        table: "wiki_top_articles",
        columns: &[("rank", I), ("article", V), ("views", BI), ("day", DT)],
        order_by: "rank ASC",
        poll_secs: 3600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "crypto",
        table: "crypto_markets",
        columns: &[
            ("id", V), ("symbol", V), ("name", V), ("price_usd", D), ("market_cap", D),
            ("volume_24h", D), ("change_24h_pct", D), ("rank", I),
        ],
        order_by: "rank ASC",
        poll_secs: 60,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "fx",
        table: "fx_rates",
        columns: &[("as_of", DT), ("base", V), ("quote", V), ("rate", D), ("change_pct", D)],
        order_by: "as_of DESC, quote",
        poll_secs: 3600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "fema",
        table: "fema_disasters",
        columns: &[
            ("id", V), ("disaster_number", I), ("state", V), ("declaration_type", V),
            ("declaration_title", V), ("incident_type", V), ("declaration_date", TS),
            ("incident_begin", TS), ("fy_declared", I),
        ],
        order_by: "declaration_date DESC",
        poll_secs: 600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "covid",
        table: "covid_countries",
        columns: &[
            ("country", V), ("cases", BI), ("today_cases", BI), ("deaths", BI), ("today_deaths", BI),
            ("recovered", BI), ("active", BI), ("cases_per_million", D), ("deaths_per_million", D),
            ("population", BI), ("continent", V),
        ],
        order_by: "cases DESC",
        poll_secs: 1800,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "countries",
        table: "world_countries",
        columns: &[
            ("name", V), ("cca3", V), ("region", V), ("subregion", V), ("population", BI), ("area", D),
            ("density", D), ("capital", V), ("independent", B),
        ],
        order_by: "population DESC",
        poll_secs: 0,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "world_bank",
        table: "world_bank",
        columns: &[
            ("country_code", V), ("country_name", V), ("yr", I), ("gdp_usd", D), ("gdp_per_capita", D),
            ("population", BI), ("life_expectancy", D), ("co2_per_capita", D),
        ],
        order_by: "yr DESC, country_code",
        poll_secs: 0,
        mode: WriteMode::Replace,
    },
];

pub fn spec_for_kind(kind: &str) -> Option<&'static SourceSpec> {
    SOURCE_SPECS.iter().find(|s| s.kind == kind)
}

pub fn table_for_kind(kind: &str) -> Option<&'static str> {
    spec_for_kind(kind).map(|s| s.table)
}

/// `SELECT * FROM <table> ORDER BY <registry orderBy>` for snapshots.
pub fn snapshot_sql(kind: &str) -> Option<String> {
    spec_for_kind(kind).map(|s| format!("SELECT * FROM {} ORDER BY {}", s.table, s.order_by))
}

// ================================================================
// Shared instance per source
// ================================================================

pub struct SourceInstance {
    pub running: Arc<AtomicBool>,
    pub total_events: Arc<AtomicU64>,
    pub started_at: Arc<TokioMutex<Option<i64>>>,
    pub cancel_token: Arc<TokioMutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    eps_state: Arc<TokioMutex<(u64, std::time::Instant)>>,
}

impl Default for SourceInstance {
    fn default() -> Self {
        Self::new()
    }
}

impl SourceInstance {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            total_events: Arc::new(AtomicU64::new(0)),
            started_at: Arc::new(TokioMutex::new(None)),
            cancel_token: Arc::new(TokioMutex::new(None)),
            eps_state: Arc::new(TokioMutex::new((0, std::time::Instant::now()))),
        }
    }

    pub async fn status(&self, table: &str, db: &LoomDb) -> SourceStatus {
        let running = self.running.load(Ordering::Relaxed);
        let total = self.total_events.load(Ordering::Relaxed);
        let started = *self.started_at.lock().await;
        let uptime = started
            .map(|s| (now_secs() - s).max(0) as f64)
            .unwrap_or(0.0);
        let mut last = self.eps_state.lock().await;
        let elapsed = last.1.elapsed().as_secs_f64().max(0.001);
        let delta = total.saturating_sub(last.0);
        let eps = delta as f64 / elapsed;
        *last = (total, std::time::Instant::now());
        let buffer_rows = db
            .conn
            .lock()
            .ok()
            .and_then(|c| {
                c.query_row(&format!("SELECT COUNT(*) FROM {}", table), params![], |r| {
                    r.get::<_, i64>(0)
                })
                .ok()
            })
            .unwrap_or(0) as u64;
        SourceStatus {
            running,
            total_events: total,
            events_per_sec: (eps * 10.0).round() / 10.0,
            buffer_rows,
            started_at: started,
            uptime_secs: uptime,
        }
    }

    async fn mark_started(&self) {
        self.running.store(true, Ordering::Relaxed);
        self.total_events.store(0, Ordering::Relaxed);
        *self.started_at.lock().await = Some(now_secs());
    }

    async fn mark_stopped(&self) {
        self.running.store(false, Ordering::Relaxed);
        *self.started_at.lock().await = None;
    }
}

#[derive(Debug, Serialize)]
pub struct SourceStatus {
    pub running: bool,
    pub total_events: u64,
    pub events_per_sec: f64,
    pub buffer_rows: u64,
    pub started_at: Option<i64>,
    pub uptime_secs: f64,
}

/// One `SourceInstance` per kind in `SOURCE_SPECS`.
pub struct SourcesState {
    instances: HashMap<&'static str, SourceInstance>,
}

impl Default for SourcesState {
    fn default() -> Self {
        Self::new()
    }
}

impl SourcesState {
    pub fn new() -> Self {
        Self {
            instances: SOURCE_SPECS
                .iter()
                .map(|s| (s.kind, SourceInstance::new()))
                .collect(),
        }
    }

    pub fn get(&self, kind: &str) -> Option<&SourceInstance> {
        self.instances.get(kind)
    }
}

// ================================================================
// Table creation / migration
// ================================================================

fn create_table_sql(spec: &SourceSpec) -> String {
    let cols: Vec<String> = spec
        .columns
        .iter()
        .map(|(name, ty)| format!("{} {}", name, ty))
        .collect();
    format!("CREATE TABLE IF NOT EXISTS {} ({})", spec.table, cols.join(", "))
}

fn existing_columns(conn: &Connection, table: &str) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT column_name, data_type FROM information_schema.columns \
             WHERE table_schema = 'main' AND table_name = ? ORDER BY ordinal_position",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![table], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

fn schema_matches(existing: &[(String, String)], spec: &SourceSpec) -> bool {
    existing.len() == spec.columns.len()
        && existing
            .iter()
            .zip(spec.columns)
            .all(|((name, ty), (want_name, want_ty))| {
                name == want_name && ty.eq_ignore_ascii_case(want_ty)
            })
}

/// Create every source table; a table whose columns no longer match the
/// registry (e.g. the old long-format `world_bank`) is dropped and recreated.
pub fn ensure_tables(db: &LoomDb) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    for spec in SOURCE_SPECS {
        let existing = existing_columns(&conn, spec.table)?;
        if !existing.is_empty() && !schema_matches(&existing, spec) {
            conn.execute_batch(&format!("DROP TABLE IF EXISTS {}", spec.table))
                .map_err(|e| e.to_string())?;
        }
        conn.execute_batch(&create_table_sql(spec))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ================================================================
// Cells, rows, and writes
// ================================================================

/// One value bound into a typed column (`TRY_CAST(? AS <type>)`, so a value
/// that will not cast lands as NULL instead of aborting the batch).
/// Timestamps / dates travel as normalized text.
#[derive(Debug, Clone, PartialEq)]
pub enum Cell {
    Null,
    Str(String),
    F64(f64),
    I64(i64),
    Bool(bool),
}

impl ToSql for Cell {
    fn to_sql(&self) -> duckdb::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::Owned(match self {
            Cell::Null => DbValue::Null,
            Cell::Str(s) => DbValue::Text(s.clone()),
            Cell::F64(f) if f.is_finite() => DbValue::Double(*f),
            Cell::F64(_) => DbValue::Null,
            Cell::I64(i) => DbValue::BigInt(*i),
            Cell::Bool(b) => DbValue::Boolean(*b),
        }))
    }
}

impl Cell {
    fn str(s: impl Into<String>) -> Cell {
        Cell::Str(s.into())
    }
    fn opt_f64(v: Option<f64>) -> Cell {
        v.map(Cell::F64).unwrap_or(Cell::Null)
    }
    fn opt_i64(v: Option<i64>) -> Cell {
        v.map(Cell::I64).unwrap_or(Cell::Null)
    }
}

pub type Row = Vec<Cell>;

// ---- JSON → Cell helpers ----

fn as_f64_loose(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn as_i64_loose(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f.round() as i64)),
        Value::String(s) => {
            let t = s.trim();
            t.parse::<i64>()
                .ok()
                .or_else(|| t.parse::<f64>().ok().map(|f| f.round() as i64))
        }
        _ => None,
    }
}

/// String (numbers are stringified); missing / null / "" → NULL.
fn js(v: Option<&Value>) -> Cell {
    match v {
        Some(Value::String(s)) if !s.is_empty() => Cell::Str(s.clone()),
        Some(Value::Number(n)) => Cell::Str(n.to_string()),
        _ => Cell::Null,
    }
}

fn jf(v: Option<&Value>) -> Cell {
    Cell::opt_f64(v.and_then(as_f64_loose))
}

fn ji(v: Option<&Value>) -> Cell {
    Cell::opt_i64(v.and_then(as_i64_loose))
}

fn jb(v: Option<&Value>) -> Cell {
    match v {
        Some(Value::Bool(b)) => Cell::Bool(*b),
        Some(Value::Number(n)) => Cell::Bool(n.as_f64().unwrap_or(0.0) != 0.0),
        _ => Cell::Null,
    }
}

/// ISO-8601 text → UTC "YYYY-MM-DD HH:MM:SS" (naive input kept as-is).
fn jts(v: Option<&Value>) -> Cell {
    v.and_then(Value::as_str)
        .and_then(parse_iso_utc)
        .map(Cell::Str)
        .unwrap_or(Cell::Null)
}

fn epoch_secs_cell(secs: i64) -> Cell {
    Cell::Str(fmt_ts(secs))
}

fn trimmed(v: Option<&Value>) -> Cell {
    match v.and_then(Value::as_str).map(str::trim) {
        Some(s) if !s.is_empty() => Cell::str(s),
        _ => Cell::Null,
    }
}

fn str_of<'a>(v: &'a Value, ptr: &str) -> Option<&'a str> {
    v.pointer(ptr).and_then(Value::as_str).filter(|s| !s.is_empty())
}

// ---- Writes ----

fn insert_sql(spec: &SourceSpec) -> String {
    let vals: Vec<String> = spec
        .columns
        .iter()
        .map(|(_, ty)| format!("TRY_CAST(? AS {})", ty))
        .collect();
    format!("INSERT INTO {} VALUES ({})", spec.table, vals.join(", "))
}

fn key_where(spec: &SourceSpec, keys: &[&str]) -> (String, Vec<usize>) {
    let mut idx = Vec::new();
    let mut parts = Vec::new();
    for k in keys {
        if let Some(i) = spec.columns.iter().position(|(name, _)| name == k) {
            idx.push(i);
            parts.push(format!("{} = CAST(? AS {})", k, spec.columns[i].1));
        }
    }
    (parts.join(" AND "), idx)
}

fn in_tx<T>(conn: &Connection, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    conn.execute_batch("BEGIN TRANSACTION").map_err(|e| e.to_string())?;
    match f(conn) {
        Ok(v) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(v)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

/// Write one poll's rows per the spec's mode. Returns rows written (replace /
/// append) or newly-seen keys (upsert). Uncastable cells become NULL.
pub fn write_rows(db: &LoomDb, spec: &SourceSpec, rows: &[Row]) -> Result<u64, String> {
    if let Some(bad) = rows.iter().find(|r| r.len() != spec.columns.len()) {
        return Err(format!(
            "{}: row has {} cells, table has {} columns",
            spec.table,
            bad.len(),
            spec.columns.len()
        ));
    }
    if rows.is_empty() && spec.mode == WriteMode::Replace {
        // Keep the previous snapshot rather than blanking the table on a hiccup.
        return Err(format!("{}: upstream returned no rows", spec.kind));
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    in_tx(&conn, |conn| {
        let mut insert = conn.prepare(&insert_sql(spec)).map_err(|e| e.to_string())?;
        let mut n = 0u64;
        match spec.mode {
            WriteMode::Replace | WriteMode::Append => {
                if spec.mode == WriteMode::Replace {
                    conn.execute_batch(&format!("DELETE FROM {}", spec.table))
                        .map_err(|e| e.to_string())?;
                }
                for r in rows {
                    match insert.execute(params_from_iter(r.iter())) {
                        Ok(_) => n += 1,
                        Err(e) => eprintln!("[loom] {} insert skipped: {}", spec.table, e),
                    }
                }
            }
            WriteMode::Upsert(keys) => {
                let (cond, idx) = key_where(spec, keys);
                let mut exists = conn
                    .prepare(&format!("SELECT COUNT(*) FROM {} WHERE {}", spec.table, cond))
                    .map_err(|e| e.to_string())?;
                let mut delete = conn
                    .prepare(&format!("DELETE FROM {} WHERE {}", spec.table, cond))
                    .map_err(|e| e.to_string())?;
                for r in rows {
                    let key: Vec<&Cell> = idx.iter().map(|&i| &r[i]).collect();
                    let found: i64 = exists
                        .query_row(params_from_iter(key.iter()), |row| row.get(0))
                        .unwrap_or(0);
                    if found > 0 {
                        let _ = delete.execute(params_from_iter(key.iter()));
                    }
                    match insert.execute(params_from_iter(r.iter())) {
                        Ok(_) if found == 0 => n += 1,
                        Ok(_) => {}
                        Err(e) => eprintln!("[loom] {} upsert skipped: {}", spec.table, e),
                    }
                }
            }
        }
        Ok(n)
    })
}

fn trim_table(db: &LoomDb, table: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {}", table), params![], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if count > MAX_ROWS as i64 {
        let excess = count - MAX_ROWS as i64;
        conn.execute_batch(&format!(
            "DELETE FROM {0} WHERE rowid IN (SELECT rowid FROM {0} ORDER BY rowid LIMIT {1})",
            table, excess
        ))
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn table_is_empty(db: &LoomDb, table: &str) -> bool {
    db.conn
        .lock()
        .ok()
        .and_then(|c| {
            c.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get::<_, i64>(0))
                .ok()
        })
        .map(|n| n == 0)
        .unwrap_or(true)
}

// ================================================================
// Dates (no chrono dependency)
// ================================================================

/// Days since 1970-01-01 for a proleptic Gregorian date.
pub(crate) fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// (year, month, day) for days since 1970-01-01.
pub(crate) fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn today_days() -> i64 {
    now_secs().div_euclid(86_400)
}

/// "YYYY-MM-DD" for days since epoch.
pub(crate) fn fmt_date(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// "YYYY-MM-DD HH:MM:SS" (UTC) for unix seconds.
pub(crate) fn fmt_ts(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    format!(
        "{} {:02}:{:02}:{:02}",
        fmt_date(days),
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn num(s: &str, range: std::ops::Range<usize>) -> Option<i64> {
    let part = s.get(range)?;
    if part.bytes().all(|b| b.is_ascii_digit()) {
        part.parse().ok()
    } else {
        None
    }
}

/// Parse ISO-8601 ("2026-10-02", "2026-10-02T16:43", "…:00Z",
/// "…:00.000-04:00", "… 12:00:00") into "YYYY-MM-DD HH:MM:SS". An offset or
/// Z converts to UTC; text without one is kept as wall-clock time.
pub(crate) fn parse_iso_utc(s: &str) -> Option<String> {
    let s = s.trim();
    let y = num(s, 0..4)?;
    let m = num(s, 5..7)? as u32;
    let d = num(s, 8..10)? as u32;
    if s.get(4..5)? != "-" || s.get(7..8)? != "-" || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let days = days_from_civil(y, m, d);
    if s.len() == 10 {
        return Some(fmt_ts(days * 86_400));
    }
    let sep = s.as_bytes()[10];
    if sep != b'T' && sep != b' ' {
        return None;
    }
    let hh = num(s, 11..13)?;
    if s.get(13..14)? != ":" {
        return None;
    }
    let mm = num(s, 14..16)?;
    let mut rest = &s[16..];
    let mut ss = 0;
    if let Some(r) = rest.strip_prefix(':') {
        ss = num(r, 0..2)?;
        rest = &r[2..];
    }
    if let Some(r) = rest.strip_prefix('.') {
        rest = r.trim_start_matches(|c: char| c.is_ascii_digit());
    }
    let offset = match rest {
        "" => 0,
        "Z" | "z" => 0,
        tz => {
            let sign = match tz.as_bytes()[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let digits: String = tz[1..].chars().filter(|c| *c != ':').collect();
            let oh = num(&digits, 0..2)?;
            let om = if digits.len() >= 4 { num(&digits, 2..4)? } else { 0 };
            sign * (oh * 3600 + om * 60)
        }
    };
    Some(fmt_ts(days * 86_400 + hh * 3600 + mm * 60 + ss - offset))
}

// ================================================================
// HTTP
// ================================================================

fn build_client() -> Result<reqwest::Client, String> {
    // NWS and Wikimedia require a descriptive User-Agent.
    reqwest::Client::builder()
        .user_agent("Loom-Data-Storyteller/1.0 (local analytics tool; contact: github.com/mhsenkow/Loom_story_teller)")
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

async fn get_json(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("{}: {}", url, e))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("{}: HTTP {}", url, status));
    }
    res.json::<Value>().await.map_err(|e| format!("{}: {}", url, e))
}

// ================================================================
// Parsers (pure: upstream JSON → rows in registry column order)
// ================================================================

// ---- USGS ----

const USGS_URL: &str = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

pub(crate) fn usgs_rows(body: &Value) -> Result<Vec<Row>, String> {
    let features = body
        .get("features")
        .and_then(Value::as_array)
        .ok_or("USGS: no features")?;
    Ok(features
        .iter()
        .filter_map(|feat| {
            let p = feat.get("properties")?;
            let id = feat.get("id").and_then(Value::as_str).filter(|s| !s.is_empty())?;
            let c = feat.pointer("/geometry/coordinates");
            let coord = |i: usize| jf(c.and_then(|c| c.get(i)));
            let time = p.get("time").and_then(as_i64_loose);
            Some(vec![
                Cell::str(id),
                jf(p.get("mag")),
                js(p.get("place")),
                time.map(|ms| epoch_secs_cell(ms.div_euclid(1000))).unwrap_or(Cell::Null),
                coord(1),
                coord(0),
                coord(2),
                js(p.get("magType")),
                js(p.get("status")),
                Cell::Bool(p.get("tsunami").and_then(as_i64_loose) == Some(1)),
                ji(p.get("sig")),
                js(p.get("net")),
            ])
        })
        .collect())
}

// ---- NASA EONET ----

const EONET_URL: &str = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=300";

fn point_of(coords: &Value) -> Option<(f64, f64)> {
    let lon = coords.get(0).and_then(as_f64_loose)?;
    let lat = coords.get(1).and_then(as_f64_loose)?;
    Some((lat, lon))
}

/// Vertex average of a ring (closing vertex excluded) → (lat, lon).
fn ring_centroid(ring: &[Value]) -> Option<(f64, f64)> {
    let mut pts: Vec<(f64, f64)> = ring.iter().filter_map(point_of).collect();
    if pts.len() > 1 && pts.first() == pts.last() {
        pts.pop();
    }
    if pts.is_empty() {
        return None;
    }
    let n = pts.len() as f64;
    let lat = pts.iter().map(|p| p.0).sum::<f64>() / n;
    let lon = pts.iter().map(|p| p.1).sum::<f64>() / n;
    Some((lat, lon))
}

fn geometry_lat_lon(g: &Value) -> Option<(f64, f64)> {
    let coords = g.get("coordinates")?;
    match g.get("type").and_then(Value::as_str)? {
        "Point" => point_of(coords),
        "Polygon" => ring_centroid(coords.get(0)?.as_array()?),
        "MultiPolygon" => ring_centroid(coords.get(0)?.get(0)?.as_array()?),
        _ => None,
    }
}

pub(crate) fn eonet_rows(body: &Value) -> Result<Vec<Row>, String> {
    let events = body
        .get("events")
        .and_then(Value::as_array)
        .ok_or("EONET: no events")?;
    Ok(events
        .iter()
        .filter_map(|ev| {
            let id = ev.get("id").and_then(Value::as_str)?;
            // Latest geometry (ISO dates sort lexically).
            let g = ev.get("geometry")?.as_array()?.iter().max_by(|a, b| {
                let da = a.get("date").and_then(Value::as_str).unwrap_or("");
                let db = b.get("date").and_then(Value::as_str).unwrap_or("");
                da.cmp(db)
            })?;
            let (lat, lon) = geometry_lat_lon(g)?;
            let closed = ev.get("closed").map(|c| !c.is_null()).unwrap_or(false);
            Some(vec![
                Cell::str(id),
                js(ev.get("title")),
                js(ev.pointer("/categories/0/title")),
                js(ev.pointer("/sources/0/id")),
                jts(g.get("date")),
                Cell::F64(lat),
                Cell::F64(lon),
                jf(g.get("magnitudeValue")),
                js(g.get("magnitudeUnit")),
                Cell::str(if closed { "closed" } else { "open" }),
            ])
        })
        .collect())
}

// ---- NWS ----

const NWS_URL: &str = "https://api.weather.gov/alerts/active?status=actual";

pub(crate) fn nws_rows(body: &Value, max: usize) -> Result<Vec<Row>, String> {
    let features = body
        .get("features")
        .and_then(Value::as_array)
        .ok_or("NWS: no features")?;
    let mut props: Vec<(Option<String>, &Value)> = features
        .iter()
        .filter_map(|f| f.get("properties"))
        .filter(|p| str_of(p, "/id").is_some())
        .map(|p| {
            let sent = p
                .get("sent")
                .or_else(|| p.get("effective"))
                .and_then(Value::as_str)
                .and_then(parse_iso_utc);
            (sent, p)
        })
        .collect();
    // Newest first (None sorts last).
    props.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(props
        .into_iter()
        .take(max)
        .map(|(_, p)| {
            vec![
                js(p.get("id")),
                js(p.get("event")),
                js(p.get("headline")),
                js(p.get("severity")),
                js(p.get("certainty")),
                js(p.get("urgency")),
                js(p.get("areaDesc")),
                js(p.get("senderName")),
                jts(p.get("effective")),
                jts(p.get("expires")),
                js(p.get("status")),
                js(p.get("category")),
            ]
        })
        .collect())
}

// ---- Open-Meteo weather + air quality (12 cities, one request each) ----

pub(crate) struct CityDef {
    pub name: &'static str,
    pub lat: f64,
    pub lon: f64,
}

pub(crate) const CITIES: &[CityDef] = &[
    CityDef { name: "New York", lat: 40.71, lon: -74.01 },
    CityDef { name: "London", lat: 51.51, lon: -0.13 },
    CityDef { name: "Tokyo", lat: 35.68, lon: 139.69 },
    CityDef { name: "Sydney", lat: -33.87, lon: 151.21 },
    CityDef { name: "São Paulo", lat: -23.55, lon: -46.63 },
    CityDef { name: "Mumbai", lat: 19.08, lon: 72.88 },
    CityDef { name: "Lagos", lat: 6.52, lon: 3.38 },
    CityDef { name: "Cairo", lat: 30.04, lon: 31.24 },
    CityDef { name: "Mexico City", lat: 19.43, lon: -99.13 },
    CityDef { name: "Los Angeles", lat: 34.05, lon: -118.24 },
    CityDef { name: "Moscow", lat: 55.76, lon: 37.62 },
    CityDef { name: "Beijing", lat: 39.90, lon: 116.41 },
];

fn city_coord_params() -> String {
    let lats: Vec<String> = CITIES.iter().map(|c| c.lat.to_string()).collect();
    let lons: Vec<String> = CITIES.iter().map(|c| c.lon.to_string()).collect();
    format!("latitude={}&longitude={}", lats.join(","), lons.join(","))
}

/// `timezone=GMT` so every city's hourly `ts` is true UTC on one shared axis.
fn meteo_url() -> String {
    format!(
        "https://api.open-meteo.com/v1/forecast?{}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code,pressure_msl,cloud_cover&past_days=2&forecast_days=1&timezone=GMT",
        city_coord_params()
    )
}

fn aq_url() -> String {
    format!(
        "https://air-quality-api.open-meteo.com/v1/air-quality?{}&current=pm2_5,pm10,ozone,nitrogen_dioxide,european_aqi",
        city_coord_params()
    )
}

fn at(a: Option<&Vec<Value>>, i: usize) -> Option<&Value> {
    a.and_then(|a| a.get(i))
}

/// Multi-location Open-Meteo responses are an array in request order; a
/// single location is a bare object.
fn per_location(body: &Value) -> Vec<&Value> {
    match body {
        Value::Array(a) => a.iter().collect(),
        Value::Object(_) => vec![body],
        _ => vec![],
    }
}

pub(crate) fn meteo_rows(body: &Value, cities: &[CityDef]) -> Result<Vec<Row>, String> {
    let locs = per_location(body);
    if locs.is_empty() {
        return Err("Open-Meteo: unexpected response".into());
    }
    let mut rows = Vec::new();
    for (loc, city) in locs.into_iter().zip(cities) {
        let Some(hourly) = loc.get("hourly") else { continue };
        let Some(times) = hourly.get("time").and_then(Value::as_array) else { continue };
        let series = |k: &str| hourly.get(k).and_then(Value::as_array);
        let (temp, hum, wind, precip, code, press, cloud) = (
            series("temperature_2m"),
            series("relative_humidity_2m"),
            series("wind_speed_10m"),
            series("precipitation"),
            series("weather_code"),
            series("pressure_msl"),
            series("cloud_cover"),
        );
        for (i, t) in times.iter().enumerate() {
            let ts = jts(Some(t));
            if ts == Cell::Null {
                continue;
            }
            rows.push(vec![
                ts,
                Cell::str(city.name),
                Cell::F64(city.lat),
                Cell::F64(city.lon),
                jf(at(temp, i)),
                jf(at(hum, i)),
                jf(at(wind, i)),
                jf(at(precip, i)),
                ji(at(code, i)),
                jf(at(press, i)),
                jf(at(cloud, i)),
            ]);
        }
    }
    Ok(rows)
}

pub(crate) fn aq_rows(body: &Value, cities: &[CityDef]) -> Result<Vec<Row>, String> {
    let locs = per_location(body);
    if locs.is_empty() {
        return Err("Open-Meteo AQ: unexpected response".into());
    }
    Ok(locs
        .into_iter()
        .zip(cities)
        .filter_map(|(loc, city)| {
            let cur = loc.get("current")?;
            Some(vec![
                jts(cur.get("time")),
                Cell::str(city.name),
                Cell::F64(city.lat),
                Cell::F64(city.lon),
                jf(cur.get("pm2_5")),
                jf(cur.get("pm10")),
                jf(cur.get("ozone")),
                jf(cur.get("nitrogen_dioxide")),
                jf(cur.get("european_aqi")),
            ])
        })
        .collect())
}

// ---- UK carbon intensity ----

pub(crate) fn ukcarbon_rows(bodies: &[Value]) -> Result<Vec<Row>, String> {
    let mut by_ts: BTreeMap<String, Row> = BTreeMap::new();
    for body in bodies {
        let Some(data) = body.get("data").and_then(Value::as_array) else { continue };
        for entry in data {
            let Cell::Str(ts) = jts(entry.get("from")) else { continue };
            let actual = ji(entry.pointer("/intensity/actual"));
            // Prefer a half-hour that already has an actual reading.
            if actual == Cell::Null && by_ts.contains_key(&ts) {
                continue;
            }
            by_ts.insert(
                ts.clone(),
                vec![
                    Cell::Str(ts),
                    ji(entry.pointer("/intensity/forecast")),
                    actual,
                    js(entry.pointer("/intensity/index")),
                ],
            );
        }
    }
    if by_ts.is_empty() {
        return Err("UK carbon: no data".into());
    }
    Ok(by_ts.into_values().collect())
}

// ---- NOAA global temperature ----

fn climate_url(year: i64) -> String {
    format!(
        "https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series/globe/land_ocean/1/0/1880-{}/data.json",
        year
    )
}

pub(crate) fn climate_rows(body: &Value) -> Result<Vec<Row>, String> {
    let data = body
        .get("data")
        .and_then(Value::as_object)
        .ok_or("NOAA: no data object")?;
    let mut out: Vec<(String, Row)> = data
        .iter()
        .filter_map(|(k, v)| {
            let year = num(k, 0..4)?;
            let month = num(k, 4..6)?;
            if k.len() != 6 || !(1..=12).contains(&month) {
                return None;
            }
            let anomaly = v
                .get("departure")
                .or_else(|| v.get("anomaly"))
                .and_then(as_f64_loose)
                .or_else(|| as_f64_loose(v))?;
            let ts = format!("{:04}-{:02}-01", year, month);
            Some((
                ts.clone(),
                vec![Cell::Str(ts), Cell::I64(year), Cell::I64(month), Cell::F64(anomaly)],
            ))
        })
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out.into_iter().map(|(_, r)| r).collect())
}

// ---- Aircraft: OpenSky, falling back to ADSB.lol ----

// Contiguous US bounding box — keeps payload manageable without auth.
const OPENSKY_URL: &str =
    "https://opensky-network.org/api/states/all?lamin=24.5&lomin=-125.0&lamax=49.5&lomax=-66.5";

/// ~250 nm circles covering the busiest US airspace.
const ADSB_POINTS: &[(f64, f64)] = &[
    (40.7, -74.0),  // New York
    (41.9, -87.6),  // Chicago
    (33.7, -84.4),  // Atlanta
    (32.9, -97.0),  // Dallas
    (34.0, -118.2), // Los Angeles
];

const ADSB_SPACING_MS: u64 = 1200;

const FEET_TO_M: f64 = 0.3048;
const KNOTS_TO_MS: f64 = 0.514_444;

pub(crate) fn opensky_rows(body: &Value) -> Result<Vec<Row>, String> {
    let states = body
        .get("states")
        .and_then(Value::as_array)
        .ok_or("OpenSky: no states")?;
    let time = body.get("time").and_then(as_i64_loose).unwrap_or_else(now_secs);
    Ok(states
        .iter()
        .filter_map(|st| {
            let a = st.as_array().filter(|a| a.len() >= 11)?;
            let lon = a[5].as_f64()?;
            let lat = a[6].as_f64()?;
            Some(vec![
                js(a.first()),
                trimmed(a.get(1)),
                js(a.get(2)),
                Cell::F64(lon),
                Cell::F64(lat),
                jf(a.get(7)),
                jf(a.get(9)),
                jf(a.get(10)),
                Cell::Bool(a[8].as_bool().unwrap_or(false)),
                epoch_secs_cell(time),
            ])
        })
        .take(MAX_AIRCRAFT)
        .collect())
}

/// ADSB.lol `/v2/point` responses → opensky_aircraft rows (deduped by hex;
/// feet → m, knots → m/s, "ground" → on_ground).
pub(crate) fn adsb_rows(bodies: &[Value]) -> Vec<Row> {
    let mut seen = HashSet::new();
    let mut rows = Vec::new();
    for body in bodies {
        let now = body
            .get("now")
            .and_then(as_i64_loose)
            .map(|ms| ms.div_euclid(1000))
            .unwrap_or_else(now_secs);
        let Some(list) = body.get("ac").and_then(Value::as_array) else { continue };
        for ac in list {
            let Some(hex) = ac.get("hex").and_then(Value::as_str) else { continue };
            let (Some(lat), Some(lon)) = (
                ac.get("lat").and_then(as_f64_loose),
                ac.get("lon").and_then(as_f64_loose),
            ) else {
                continue;
            };
            if !seen.insert(hex.to_string()) {
                continue;
            }
            let (alt, on_ground) = match ac.get("alt_baro") {
                Some(Value::String(s)) if s == "ground" => (Cell::F64(0.0), true),
                Some(v) => (Cell::opt_f64(as_f64_loose(v).map(|ft| ft * FEET_TO_M)), false),
                None => (Cell::Null, false),
            };
            rows.push(vec![
                Cell::str(hex),
                trimmed(ac.get("flight")),
                Cell::Null,
                Cell::F64(lon),
                Cell::F64(lat),
                alt,
                Cell::opt_f64(ac.get("gs").and_then(as_f64_loose).map(|kt| kt * KNOTS_TO_MS)),
                jf(ac.get("track")),
                Cell::Bool(on_ground),
                epoch_secs_cell(now),
            ]);
            if rows.len() >= MAX_AIRCRAFT {
                return rows;
            }
        }
    }
    rows
}

// ---- Citi Bike (GBFS) ----

const GBFS_INFO_URL: &str = "https://gbfs.citibikenyc.com/gbfs/en/station_information.json";
const GBFS_STATUS_URL: &str = "https://gbfs.citibikenyc.com/gbfs/en/station_status.json";

#[derive(Debug, Clone)]
pub(crate) struct CitiStation {
    name: Cell,
    lat: Cell,
    lon: Cell,
    capacity: Option<i64>,
}

pub(crate) fn citibike_info(body: &Value) -> Result<HashMap<String, CitiStation>, String> {
    let stations = body
        .pointer("/data/stations")
        .and_then(Value::as_array)
        .ok_or("GBFS: no station_information")?;
    Ok(stations
        .iter()
        .filter_map(|s| {
            let id = s.get("station_id").and_then(Value::as_str)?;
            Some((
                id.to_string(),
                CitiStation {
                    name: js(s.get("name")),
                    lat: jf(s.get("lat")),
                    lon: jf(s.get("lon")),
                    capacity: s.get("capacity").and_then(as_i64_loose),
                },
            ))
        })
        .collect())
}

pub(crate) fn citibike_rows(status: &Value, info: &HashMap<String, CitiStation>) -> Result<Vec<Row>, String> {
    let stations = status
        .pointer("/data/stations")
        .and_then(Value::as_array)
        .ok_or("GBFS: no station_status")?;
    let ts = status
        .get("last_updated")
        .and_then(as_i64_loose)
        .unwrap_or_else(now_secs);
    Ok(stations
        .iter()
        .filter_map(|s| {
            let id = s.get("station_id").and_then(Value::as_str)?;
            let st = info.get(id)?;
            // Decommissioned / not-yet-installed docks are noise on a map.
            if s.get("is_installed").and_then(as_i64_loose) == Some(0) {
                return None;
            }
            let bikes = s.get("num_bikes_available").and_then(as_i64_loose);
            let pct_full = match (bikes, st.capacity) {
                (Some(b), Some(c)) if c > 0 => Cell::F64((b as f64 / c as f64 * 1000.0).round() / 10.0),
                _ => Cell::Null,
            };
            Some(vec![
                Cell::str(id),
                st.name.clone(),
                st.lat.clone(),
                st.lon.clone(),
                Cell::opt_i64(st.capacity),
                Cell::opt_i64(bikes),
                ji(s.get("num_ebikes_available")),
                ji(s.get("num_docks_available")),
                pct_full,
                Cell::Bool(s.get("is_renting").and_then(as_i64_loose).unwrap_or(0) == 1),
                epoch_secs_cell(ts),
            ])
        })
        .collect())
}

// ---- NYC 311 ----

const NYC311_URL: &str =
    "https://data.cityofnewyork.us/resource/erm2-nwe9.json?$limit=400&$order=created_date%20DESC";

pub(crate) fn nyc311_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body.as_array().ok_or("NYC 311: expected array")?;
    Ok(list
        .iter()
        .map(|r| {
            vec![
                js(r.get("unique_key")),
                jts(r.get("created_date")),
                js(r.get("complaint_type")),
                js(r.get("descriptor")),
                js(r.get("borough")),
                js(r.get("city")),
                jf(r.get("latitude")),
                jf(r.get("longitude")),
                js(r.get("status")),
                js(r.get("agency")),
            ]
        })
        .collect())
}

// ---- ISS ----

const ISS_URL: &str = "https://api.wheretheiss.at/v1/satellites/25544";

/// One position object or an array of them (the `/positions` seed).
pub(crate) fn iss_rows(body: &Value) -> Result<Vec<Row>, String> {
    let items: Vec<&Value> = match body {
        Value::Array(a) => a.iter().collect(),
        Value::Object(_) => vec![body],
        _ => return Err("ISS: unexpected response".into()),
    };
    Ok(items
        .into_iter()
        .filter_map(|p| {
            let lat = p.get("latitude").and_then(as_f64_loose)?;
            let lon = p.get("longitude").and_then(as_f64_loose)?;
            let ts = p.get("timestamp").and_then(as_i64_loose)?;
            Some(vec![
                epoch_secs_cell(ts),
                Cell::F64(lat),
                Cell::F64(lon),
                jf(p.get("altitude")),
                jf(p.get("velocity")),
                js(p.get("visibility")),
            ])
        })
        .collect())
}

// ---- Launch Library 2 (upcoming launches + SpaceX history) ----

const LAUNCHES_URL: &str = "https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=40&mode=list";
// Full (non-list) mode: carries rocket.configuration and mission.description.
const SPACEX_URL: &str = "https://ll.thespacedevs.com/2.2.0/launch/previous/?lsp__name=SpaceX&limit=100";

fn id_string(v: Option<&Value>) -> Cell {
    match v {
        Some(Value::String(s)) => Cell::str(s.as_str()),
        Some(Value::Number(n)) => Cell::Str(n.to_string()),
        _ => Cell::Null,
    }
}

/// Rocket from `rocket.configuration` (full mode) or the "Rocket | Mission" name (list mode).
fn ll2_rocket(r: &Value) -> Cell {
    str_of(r, "/rocket/configuration/full_name")
        .or_else(|| str_of(r, "/rocket/configuration/name"))
        .or_else(|| {
            r.get("name")
                .and_then(Value::as_str)
                .and_then(|n| n.split(" | ").next())
                .map(str::trim)
                .filter(|s| !s.is_empty())
        })
        .map(Cell::str)
        .unwrap_or(Cell::Null)
}

pub(crate) fn launches_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body
        .get("results")
        .and_then(Value::as_array)
        .ok_or("LL2: no results")?;
    Ok(list
        .iter()
        .map(|r| {
            // List mode flattens pad / location / provider / orbit to strings.
            let pad = str_of(r, "/pad").or_else(|| str_of(r, "/pad/name"));
            let location = str_of(r, "/location").or_else(|| str_of(r, "/pad/location/name"));
            let agency = str_of(r, "/lsp_name").or_else(|| str_of(r, "/launch_service_provider/name"));
            let status = str_of(r, "/status/name").or_else(|| str_of(r, "/status/abbrev"));
            let orbit = str_of(r, "/orbit")
                .or_else(|| str_of(r, "/mission/orbit/name"))
                .or_else(|| str_of(r, "/mission_type"))
                .or_else(|| str_of(r, "/mission/type"));
            let orbital = !orbit.map(|o| o.to_lowercase().contains("suborbital")).unwrap_or(false);
            vec![
                id_string(r.get("id")),
                js(r.get("name")),
                jts(r.get("net")),
                status.map(Cell::str).unwrap_or(Cell::Null),
                pad.map(Cell::str).unwrap_or(Cell::Null),
                location.map(Cell::str).unwrap_or(Cell::Null),
                agency.map(Cell::str).unwrap_or(Cell::Null),
                ll2_rocket(r),
                Cell::Bool(orbital),
            ]
        })
        .collect())
}

pub(crate) fn spacex_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body
        .get("results")
        .and_then(Value::as_array)
        .ok_or("LL2: no results")?;
    Ok(list
        .iter()
        .map(|r| {
            let details = str_of(r, "/mission/description")
                .map(|d| Cell::Str(d.chars().take(280).collect()))
                .unwrap_or(Cell::Null);
            vec![
                id_string(r.get("id")),
                js(r.get("name")),
                jts(r.get("net")),
                Cell::Bool(str_of(r, "/status/abbrev") == Some("Success")),
                Cell::Bool(false),
                ll2_rocket(r),
                // Nth SpaceX launch attempt — LL2's closest thing to a flight number.
                ji(r.get("flight_number").or_else(|| r.get("agency_launch_attempt_count"))),
                details,
            ]
        })
        .collect())
}

// ---- NOAA SWPC planetary K-index ----

const KP_URL: &str = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";

/// NOAA G-scale from Kp: G0 < 5, G1 5, G2 6, G3 7, G4 8, G5 ≥ 9.
pub(crate) fn storm_level(kp: f64) -> &'static str {
    if kp < 5.0 {
        "G0"
    } else if kp < 6.0 {
        "G1"
    } else if kp < 7.0 {
        "G2"
    } else if kp < 8.0 {
        "G3"
    } else if kp < 9.0 {
        "G4"
    } else {
        "G5"
    }
}

/// Accepts the current array-of-objects shape and the older
/// array-of-arrays shape (first row = header).
pub(crate) fn kp_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body.as_array().ok_or("SWPC: expected array")?;
    let header: Option<Vec<String>> = list.first().and_then(Value::as_array).map(|h| {
        h.iter()
            .map(|v| v.as_str().unwrap_or("").to_string())
            .collect()
    });
    let field = |row: &Value, key: &str| -> Option<Value> {
        match &header {
            Some(h) => {
                let i = h.iter().position(|k| k == key)?;
                row.get(i).cloned()
            }
            None => row.get(key).cloned(),
        }
    };
    let skip = usize::from(header.is_some());
    Ok(list
        .iter()
        .skip(skip)
        .filter_map(|row| {
            let ts = jts(field(row, "time_tag").as_ref());
            let kp = field(row, "Kp").as_ref().and_then(as_f64_loose)?;
            if ts == Cell::Null {
                return None;
            }
            Some(vec![
                ts,
                Cell::F64(kp),
                ji(field(row, "a_running").as_ref()),
                ji(field(row, "station_count").as_ref()),
                Cell::str(storm_level(kp)),
            ])
        })
        .collect())
}

// ---- Hacker News ----

const HN_URL: &str = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50";

pub(crate) fn hn_rows(body: &Value) -> Result<Vec<Row>, String> {
    let hits = body.get("hits").and_then(Value::as_array).ok_or("HN: no hits")?;
    Ok(hits
        .iter()
        .map(|h| {
            vec![
                js(h.get("objectID")),
                js(h.get("title").filter(|v| !v.is_null()).or_else(|| h.get("story_title"))),
                js(h.get("author")),
                ji(h.get("points")),
                ji(h.get("num_comments")),
                js(h.get("url")),
                jts(h.get("created_at")),
            ]
        })
        .collect())
}

// ---- Wikipedia most-read ----

fn pageviews_url(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!(
        "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/{:04}/{:02}/{:02}",
        y, m, d
    )
}

const PAGEVIEWS_SKIP_PREFIXES: &[&str] = &["Special:", "File:", "Wikipedia:", "Portal:", "Talk:"];

pub(crate) fn pageviews_rows(body: &Value) -> Result<Vec<Row>, String> {
    let item = body.pointer("/items/0").ok_or("Pageviews: no items")?;
    let day = match (
        item.get("year").and_then(as_i64_loose),
        item.get("month").and_then(as_i64_loose),
        item.get("day").and_then(as_i64_loose),
    ) {
        (Some(y), Some(m), Some(d)) => Cell::Str(format!("{:04}-{:02}-{:02}", y, m, d)),
        _ => Cell::Null,
    };
    let articles = item
        .get("articles")
        .and_then(Value::as_array)
        .ok_or("Pageviews: no articles")?;
    Ok(articles
        .iter()
        .filter_map(|a| {
            let title = a.get("article").and_then(Value::as_str)?;
            let skip = title == "Main_Page"
                || title == "-"
                || PAGEVIEWS_SKIP_PREFIXES.iter().any(|p| title.starts_with(p));
            (!skip).then_some((title, a.get("views").and_then(as_i64_loose)))
        })
        .take(PAGEVIEWS_TOP)
        .enumerate()
        .map(|(i, (title, views))| {
            vec![
                Cell::I64(i as i64 + 1),
                Cell::Str(title.replace('_', " ")),
                Cell::opt_i64(views),
                day.clone(),
            ]
        })
        .collect())
}

// ---- Crypto: CoinGecko, falling back to CoinPaprika ----

const COINGECKO_URL: &str = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false";
const COINPAPRIKA_URL: &str = "https://api.coinpaprika.com/v1/tickers?limit=50";

pub(crate) fn coingecko_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body.as_array().ok_or("CoinGecko: expected array")?;
    Ok(list
        .iter()
        .map(|c| {
            vec![
                js(c.get("id")),
                c.get("symbol")
                    .and_then(Value::as_str)
                    .map(|s| Cell::Str(s.to_uppercase()))
                    .unwrap_or(Cell::Null),
                js(c.get("name")),
                jf(c.get("current_price")),
                jf(c.get("market_cap")),
                jf(c.get("total_volume")),
                jf(c.get("price_change_percentage_24h")),
                ji(c.get("market_cap_rank")),
            ]
        })
        .collect())
}

pub(crate) fn coinpaprika_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body.as_array().ok_or("CoinPaprika: expected array")?;
    Ok(list
        .iter()
        .take(50)
        .map(|c| {
            let usd = c.pointer("/quotes/USD");
            let q = |k: &str| jf(usd.and_then(|u| u.get(k)));
            vec![
                js(c.get("id")),
                c.get("symbol")
                    .and_then(Value::as_str)
                    .map(|s| Cell::Str(s.to_uppercase()))
                    .unwrap_or(Cell::Null),
                js(c.get("name")),
                q("price"),
                q("market_cap"),
                q("volume_24h"),
                q("percent_change_24h"),
                ji(c.get("rank")),
            ]
        })
        .collect())
}

// ---- FX (Frankfurter / ECB), 90-day series ----

fn fx_url(today: i64) -> String {
    format!("https://api.frankfurter.app/{}..", fmt_date(today - 90))
}

/// `{base, rates: {date: {quote: rate}}}` → one row per (as_of, quote) with
/// change_pct vs the previous available day for that quote.
pub(crate) fn fx_rows(body: &Value) -> Result<Vec<Row>, String> {
    let base = body.get("base").and_then(Value::as_str).unwrap_or("EUR");
    let rates = body
        .get("rates")
        .and_then(Value::as_object)
        .ok_or("Frankfurter: no rates")?;
    let mut dates: Vec<&String> = rates.keys().collect();
    dates.sort();
    let mut prev: HashMap<&str, f64> = HashMap::new();
    let mut rows = Vec::new();
    for date in dates {
        let Some(day) = rates.get(date).and_then(Value::as_object) else { continue };
        let mut quotes: Vec<(&String, &Value)> = day.iter().collect();
        quotes.sort_by(|a, b| a.0.cmp(b.0));
        for (quote, v) in quotes {
            let Some(rate) = as_f64_loose(v) else { continue };
            let change = prev
                .get(quote.as_str())
                .filter(|p| **p != 0.0)
                .map(|p| (rate / p - 1.0) * 100.0);
            prev.insert(quote.as_str(), rate);
            rows.push(vec![
                Cell::str(date.as_str()),
                Cell::str(base),
                Cell::str(quote.as_str()),
                Cell::F64(rate),
                Cell::opt_f64(change),
            ]);
        }
    }
    Ok(rows)
}

// ---- FEMA ----

const FEMA_URL: &str = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=200&$orderby=declarationDate%20desc";

pub(crate) fn fema_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body
        .get("DisasterDeclarationsSummaries")
        .and_then(Value::as_array)
        .ok_or("FEMA: no rows")?;
    Ok(list
        .iter()
        .take(200)
        .map(|r| {
            vec![
                id_string(r.get("id").or_else(|| r.get("disasterNumber"))),
                ji(r.get("disasterNumber")),
                js(r.get("state")),
                js(r.get("declarationType")),
                js(r.get("declarationTitle")),
                js(r.get("incidentType")),
                jts(r.get("declarationDate")),
                jts(r.get("incidentBeginDate")),
                ji(r.get("fyDeclared")),
            ]
        })
        .collect())
}

// ---- COVID ----

const COVID_URL: &str = "https://disease.sh/v3/covid-19/countries";

pub(crate) fn covid_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body.as_array().ok_or("COVID: expected array")?;
    Ok(list
        .iter()
        .filter(|r| str_of(r, "/country").is_some())
        .map(|r| {
            vec![
                js(r.get("country")),
                ji(r.get("cases")),
                ji(r.get("todayCases")),
                ji(r.get("deaths")),
                ji(r.get("todayDeaths")),
                ji(r.get("recovered")),
                ji(r.get("active")),
                jf(r.get("casesPerOneMillion")),
                jf(r.get("deathsPerOneMillion")),
                ji(r.get("population")),
                js(r.get("continent")),
            ]
        })
        .collect())
}

// ---- World countries (mledoze/countries + World Bank population) ----

const COUNTRIES_URL: &str = "https://raw.githubusercontent.com/mledoze/countries/master/countries.json";
const WB_POP_LATEST_URL: &str =
    "https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=400&mrnev=1";

/// World Bank `[meta, [entries…]]` → iso3 → value.
pub(crate) fn wb_values_by_iso3(body: &Value) -> HashMap<String, f64> {
    body.get(1)
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|e| {
                    let code = e.get("countryiso3code").and_then(Value::as_str)?;
                    let v = e.get("value").and_then(as_f64_loose)?;
                    (!code.is_empty()).then(|| (code.to_string(), v))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// mledoze codes that differ from World Bank ISO3 codes.
fn wb_code_for(cca3: &str) -> &str {
    match cca3 {
        "UNK" => "XKX", // Kosovo
        other => other,
    }
}

pub(crate) fn countries_rows(body: &Value, population: &HashMap<String, f64>) -> Result<Vec<Row>, String> {
    let list = body.as_array().ok_or("countries: expected array")?;
    Ok(list
        .iter()
        .filter_map(|c| {
            let name = str_of(c, "/name/common")?;
            let cca3 = c.get("cca3").and_then(Value::as_str).unwrap_or("");
            let pop = population.get(wb_code_for(cca3)).map(|p| p.round() as i64);
            let area = c.get("area").and_then(as_f64_loose);
            let density = match (pop, area) {
                (Some(p), Some(a)) if a > 0.0 => Some(p as f64 / a),
                _ => None,
            };
            Some(vec![
                Cell::str(name),
                js(c.get("cca3")),
                js(c.get("region")),
                js(c.get("subregion")),
                Cell::opt_i64(pop),
                Cell::opt_f64(area),
                Cell::opt_f64(density),
                js(c.pointer("/capital/0")),
                jb(c.get("independent")),
            ])
        })
        .collect())
}

// ---- World Bank (wide: one row per country-year) ----

const WB_COUNTRIES_URL: &str = "https://api.worldbank.org/v2/country?format=json&per_page=400";

/// Indicator ids in wide-column order: gdp_usd, gdp_per_capita, population,
/// life_expectancy, co2_per_capita.
const WB_INDICATORS: [&str; 5] = [
    "NY.GDP.MKTP.CD",
    "NY.GDP.PCAP.CD",
    "SP.POP.TOTL",
    "SP.DYN.LE00.IN",
    "EN.GHG.CO2.PC.CE.AR5",
];
const WB_POPULATION_IDX: usize = 2;

fn wb_indicator_url(id: &str) -> String {
    format!(
        "https://api.worldbank.org/v2/country/all/indicator/{}?format=json&per_page=20000&date=2000:2023",
        id
    )
}

/// `/v2/country` list → iso3 → name, skipping aggregates (region.id == "NA").
pub(crate) fn wb_country_names(body: &Value) -> Result<HashMap<String, String>, String> {
    let list = body
        .get(1)
        .and_then(Value::as_array)
        .ok_or("World Bank: unexpected country list")?;
    Ok(list
        .iter()
        .filter(|c| str_of(c, "/region/id") != Some("NA"))
        .filter_map(|c| {
            let id = str_of(c, "/id")?;
            let name = str_of(c, "/name")?.trim();
            Some((id.to_string(), name.to_string()))
        })
        .collect())
}

/// Pivot indicator series (`(column index, response)`) into wide rows for real countries.
pub(crate) fn wb_wide_rows(countries: &HashMap<String, String>, series: &[(usize, Value)]) -> Vec<Row> {
    let mut grid: BTreeMap<(String, i64), [Option<f64>; 5]> = BTreeMap::new();
    for (col, body) in series {
        let Some(list) = body.get(1).and_then(Value::as_array) else { continue };
        for e in list {
            let Some(code) = e.get("countryiso3code").and_then(Value::as_str) else { continue };
            if !countries.contains_key(code) {
                continue;
            }
            let (Some(yr), Some(v)) = (
                e.get("date").and_then(as_i64_loose),
                e.get("value").and_then(as_f64_loose),
            ) else {
                continue;
            };
            grid.entry((code.to_string(), yr)).or_default()[*col] = Some(v);
        }
    }
    grid.into_iter()
        .map(|((code, yr), vals)| {
            let name = countries.get(&code).cloned().map(Cell::Str).unwrap_or(Cell::Null);
            let mut row = vec![Cell::Str(code), name, Cell::I64(yr)];
            for (i, v) in vals.iter().enumerate() {
                row.push(if i == WB_POPULATION_IDX {
                    Cell::opt_i64(v.map(|p| p.round() as i64))
                } else {
                    Cell::opt_f64(*v)
                });
            }
            row
        })
        .collect()
}

// ================================================================
// Fetch + poll
// ================================================================

/// Per-run state carried between polls.
struct PollCtx {
    client: reqwest::Client,
    citibike_info: Option<HashMap<String, CitiStation>>,
    iss_seeded: bool,
    opensky_retry_at: i64,
    coingecko_retry_at: i64,
    adsb_next: usize,
}

async fn fetch_aircraft(ctx: &mut PollCtx) -> Result<Vec<Row>, String> {
    let now = now_secs();
    if now >= ctx.opensky_retry_at {
        match get_json(&ctx.client, OPENSKY_URL).await.and_then(|b| opensky_rows(&b)) {
            Ok(rows) if !rows.is_empty() => return Ok(rows),
            Ok(_) => {}
            Err(e) => {
                eprintln!("[loom] opensky: {} — using ADSB.lol", e);
                ctx.opensky_retry_at = now + PRIMARY_BACKOFF_SECS;
            }
        }
    }
    // ADSB.lol allows only a few calls per short window: start at a rotating
    // point so coverage evens out across polls, and stop at the first error.
    let mut bodies = Vec::new();
    let start = ctx.adsb_next;
    ctx.adsb_next = (start + 1) % ADSB_POINTS.len();
    for i in 0..ADSB_POINTS.len() {
        let (lat, lon) = ADSB_POINTS[(start + i) % ADSB_POINTS.len()];
        if i > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(ADSB_SPACING_MS)).await;
        }
        let url = format!("https://api.adsb.lol/v2/point/{}/{}/250", lat, lon);
        match get_json(&ctx.client, &url).await {
            Ok(b) => bodies.push(b),
            Err(e) => {
                eprintln!("[loom] adsb.lol: {}", e);
                break;
            }
        }
    }
    if bodies.is_empty() {
        return Err("aircraft: OpenSky and ADSB.lol both failed".into());
    }
    Ok(adsb_rows(&bodies))
}

async fn fetch_crypto(ctx: &mut PollCtx) -> Result<Vec<Row>, String> {
    let now = now_secs();
    if now >= ctx.coingecko_retry_at {
        match get_json(&ctx.client, COINGECKO_URL).await.and_then(|b| coingecko_rows(&b)) {
            Ok(rows) if !rows.is_empty() => return Ok(rows),
            Ok(_) => {}
            Err(e) => {
                eprintln!("[loom] coingecko: {} — using CoinPaprika", e);
                ctx.coingecko_retry_at = now + PRIMARY_BACKOFF_SECS;
            }
        }
    }
    coinpaprika_rows(&get_json(&ctx.client, COINPAPRIKA_URL).await?)
}

async fn fetch_world_bank(client: &reqwest::Client) -> Result<Vec<Row>, String> {
    let countries = wb_country_names(&get_json(client, WB_COUNTRIES_URL).await?)?;
    let mut series = Vec::new();
    for (i, id) in WB_INDICATORS.iter().enumerate() {
        match get_json(client, &wb_indicator_url(id)).await {
            Ok(b) => series.push((i, b)),
            Err(e) => eprintln!("[loom] world bank {}: {}", id, e),
        }
    }
    if series.is_empty() {
        return Err("World Bank: every indicator request failed".into());
    }
    Ok(wb_wide_rows(&countries, &series))
}

async fn fetch_rows(spec: &SourceSpec, ctx: &mut PollCtx, db: &LoomDb) -> Result<Vec<Row>, String> {
    let c = ctx.client.clone();
    let today = today_days();
    match spec.kind {
        "usgs" => usgs_rows(&get_json(&c, USGS_URL).await?),
        "eonet" => eonet_rows(&get_json(&c, EONET_URL).await?),
        "nws" => nws_rows(&get_json(&c, NWS_URL).await?, NWS_MAX_ALERTS),
        "meteo" => meteo_rows(&get_json(&c, &meteo_url()).await?, CITIES),
        "aq" => aq_rows(&get_json(&c, &aq_url()).await?, CITIES),
        "ukcarbon" => {
            let base = "https://api.carbonintensity.org.uk/intensity/date";
            let mut bodies = vec![get_json(&c, &format!("{}/{}", base, fmt_date(today - 1))).await?];
            match get_json(&c, base).await {
                Ok(b) => bodies.push(b),
                Err(e) => eprintln!("[loom] ukcarbon today: {}", e),
            }
            ukcarbon_rows(&bodies)
        }
        "climate" => {
            let (year, _, _) = civil_from_days(today);
            climate_rows(&get_json(&c, &climate_url(year)).await?)
        }
        "opensky" => fetch_aircraft(ctx).await,
        "citibike" => {
            if ctx.citibike_info.is_none() {
                ctx.citibike_info = Some(citibike_info(&get_json(&c, GBFS_INFO_URL).await?)?);
            }
            let status = get_json(&c, GBFS_STATUS_URL).await?;
            citibike_rows(&status, ctx.citibike_info.as_ref().ok_or("GBFS: no station info")?)
        }
        "nyc311" => nyc311_rows(&get_json(&c, NYC311_URL).await?),
        "iss" => {
            let mut rows = Vec::new();
            if !ctx.iss_seeded {
                ctx.iss_seeded = true;
                // Seed one orbit (~10 samples) so trail ribbons work immediately.
                // wheretheiss.at allows ≤10 timestamps per request.
                if table_is_empty(db, spec.table) {
                    let now = now_secs();
                    let stamps: Vec<String> = (1..10).rev().map(|i| (now - i * 600).to_string()).collect();
                    let url = format!("{}/positions?timestamps={}", ISS_URL, stamps.join(","));
                    match get_json(&c, &url).await.and_then(|b| iss_rows(&b)) {
                        Ok(seed) => rows.extend(seed),
                        Err(e) => eprintln!("[loom] iss seed: {}", e),
                    }
                }
            }
            rows.extend(iss_rows(&get_json(&c, ISS_URL).await?)?);
            Ok(rows)
        }
        "launches" => launches_rows(&get_json(&c, LAUNCHES_URL).await?),
        "spacex" => spacex_rows(&get_json(&c, SPACEX_URL).await?),
        "spaceweather" => kp_rows(&get_json(&c, KP_URL).await?),
        "hn" => hn_rows(&get_json(&c, HN_URL).await?),
        "pageviews" => {
            // Yesterday (UTC) is published a few hours after midnight; fall back one more day.
            let body = match get_json(&c, &pageviews_url(today - 1)).await {
                Ok(b) => b,
                Err(_) => get_json(&c, &pageviews_url(today - 2)).await?,
            };
            pageviews_rows(&body)
        }
        "crypto" => fetch_crypto(ctx).await,
        "fx" => fx_rows(&get_json(&c, &fx_url(today)).await?),
        "fema" => fema_rows(&get_json(&c, FEMA_URL).await?),
        "covid" => covid_rows(&get_json(&c, COVID_URL).await?),
        "countries" => {
            let body = get_json(&c, COUNTRIES_URL).await?;
            let pop = match get_json(&c, WB_POP_LATEST_URL).await {
                Ok(b) => wb_values_by_iso3(&b),
                Err(e) => {
                    eprintln!("[loom] countries population: {}", e);
                    HashMap::new()
                }
            };
            countries_rows(&body, &pop)
        }
        "world_bank" => fetch_world_bank(&c).await,
        other => Err(format!("Unknown source kind {}", other)),
    }
}

// ================================================================
// Start / Stop / Query (generic, dispatched by kind)
// ================================================================

pub async fn source_start(kind: &str, db: Arc<LoomDb>, state: Arc<SourcesState>) -> Result<(), String> {
    let spec = spec_for_kind(kind).ok_or("Unknown source kind")?;
    let inst = state.get(kind).ok_or("Unknown source kind")?;
    if inst.running.load(Ordering::Relaxed) {
        return Err(format!("{} already running", kind));
    }
    ensure_tables(&db)?;
    let client = build_client()?;
    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    *inst.cancel_token.lock().await = Some(cancel_tx);
    inst.mark_started().await;

    let running = inst.running.clone();
    let total = inst.total_events.clone();
    tokio::spawn(async move {
        let mut ctx = PollCtx {
            client,
            citibike_info: None,
            iss_seeded: false,
            opensky_retry_at: 0,
            coingecko_retry_at: 0,
            adsb_next: 0,
        };
        loop {
            let result = match fetch_rows(spec, &mut ctx, &db).await {
                Ok(rows) => write_rows(&db, spec, &rows),
                Err(e) => Err(e),
            };
            let ok = match result {
                Ok(n) => {
                    if spec.mode == WriteMode::Replace {
                        total.store(n, Ordering::Relaxed);
                    } else {
                        total.fetch_add(n, Ordering::Relaxed);
                        let _ = trim_table(&db, spec.table);
                    }
                    true
                }
                Err(e) => {
                    eprintln!("[loom] source {}: {}", spec.kind, e);
                    false
                }
            };
            let wait = match (spec.poll_secs, ok) {
                (0, true) => None, // loaded once; idle until stopped
                (0, false) => Some(LOAD_ONCE_RETRY_SECS),
                (secs, _) => Some(secs),
            };
            match wait {
                Some(secs) => {
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(secs)) => {}
                    }
                }
                None => {
                    let _ = (&mut cancel_rx).await;
                    break;
                }
            }
        }
        running.store(false, Ordering::Relaxed);
    });
    Ok(())
}

pub async fn source_stop(kind: &str, state: Arc<SourcesState>) -> Result<(), String> {
    let inst = state.get(kind).ok_or("Unknown source kind")?;
    if let Some(tx) = inst.cancel_token.lock().await.take() {
        let _ = tx.send(());
    }
    inst.mark_stopped().await;
    Ok(())
}

pub fn source_query(db: &LoomDb, kind: &str, sql: &str, limit: u32) -> Result<QueryResult, String> {
    let table = table_for_kind(kind).ok_or("Unknown source kind")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(&format!(
        "CREATE OR REPLACE TEMP VIEW loom_active AS SELECT * FROM {}",
        table
    ))
    .map_err(|e| e.to_string())?;

    let full_sql = if sql.trim().is_empty() {
        format!("SELECT * FROM {} LIMIT {}", table, limit)
    } else {
        format!("{} LIMIT {}", sql.trim().trim_end_matches(';'), limit)
    };
    let meta_sql = format!("SELECT column_name, column_type FROM (DESCRIBE ({}))", full_sql);
    let mut meta_stmt = conn.prepare(&meta_sql).map_err(|e| e.to_string())?;
    let meta_rows = meta_stmt
        .query_map(params![], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut columns = Vec::new();
    let mut types = Vec::new();
    for mr in meta_rows.flatten() {
        columns.push(mr.0);
        types.push(mr.1);
    }
    let col_count = columns.len();
    let mut stmt = conn.prepare(&full_sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![], |row| {
            let mut v = Vec::new();
            for i in 0..col_count {
                let val: duckdb::types::Value = row.get(i)?;
                v.push(duckdb_value_to_json(val));
            }
            Ok(v)
        })
        .map_err(|e| e.to_string())?;
    let out: Vec<Vec<Value>> = rows.flatten().collect();
    let total = out.len() as u64;
    Ok(QueryResult {
        columns,
        types,
        rows: out,
        total_rows: total,
    })
}

pub fn source_stats(db: &LoomDb, kind: &str) -> Result<Vec<ColumnInfo>, String> {
    let table = table_for_kind(kind).ok_or("Unknown source kind")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {}", table), params![], |r| r.get(0))
        .unwrap_or(0);
    if count == 0 {
        return Ok(vec![]);
    }
    conn.execute_batch(&format!(
        "CREATE OR REPLACE TEMP VIEW loom_stats AS SELECT * FROM {}",
        table
    ))
    .map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("DESCRIBE loom_stats").map_err(|e| e.to_string())?;
    let schema_rows = stmt
        .query_map(params![], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for (col_name, data_type) in schema_rows.flatten() {
        let col_q = format!("\"{}\"", col_name.replace('"', "\"\""));
        let sql = format!(
            "SELECT COUNT(*) - COUNT({0}), APPROX_COUNT_DISTINCT({0}), TRY_CAST(MIN({0}) AS VARCHAR), TRY_CAST(MAX({0}) AS VARCHAR) FROM loom_stats",
            col_q
        );
        if let Ok(mut s) = conn.prepare(&sql) {
            if let Ok(info) = s.query_row(params![], |sr| {
                Ok(ColumnInfo {
                    name: col_name.clone(),
                    data_type: data_type.clone(),
                    null_count: sr.get::<_, i64>(0).unwrap_or(0) as u64,
                    distinct_count: sr.get::<_, i64>(1).unwrap_or(0) as u64,
                    min_value: sr.get::<_, Option<String>>(2).unwrap_or(None),
                    max_value: sr.get::<_, Option<String>>(3).unwrap_or(None),
                })
            }) {
                out.push(info);
            }
        }
    }
    Ok(out)
}

pub fn source_clear(db: &LoomDb, kind: &str) -> Result<(), String> {
    let table = table_for_kind(kind).ok_or("Unknown source kind")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(&format!("DELETE FROM {}", table))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "sources_tests.rs"]
mod tests;
