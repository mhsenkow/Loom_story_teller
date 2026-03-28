// =================================================================
// Loom — Poll-Based Data Sources
// =================================================================
// Four public data feeds, each polled on a background interval:
//   1. USGS Earthquake Hazards   (GeoJSON, ~60s)
//   2. Open-Meteo Weather        (JSON, on-demand + 5min refresh)
//   3. NWS Alerts                (GeoJSON, ~120s)
//   4. World Bank Indicators     (JSON, on-demand load)
//
// All share a common SourceInstance (running/cancel/event count)
// and insert into per-source DuckDB tables.
// =================================================================

use crate::db::{duckdb_value_to_json, ColumnInfo, LoomDb, QueryResult};
use duckdb::params;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

const MAX_ROWS: usize = 50_000;

// ---- Shared instance per source ----

pub struct SourceInstance {
    pub running: Arc<AtomicBool>,
    pub total_events: Arc<AtomicU64>,
    pub started_at: Arc<TokioMutex<Option<i64>>>,
    pub cancel_token: Arc<TokioMutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    eps_state: Arc<TokioMutex<(u64, std::time::Instant)>>,
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
            .map(|s| {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64;
                (now - s).max(0) as f64
            })
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
                c.query_row(
                    &format!("SELECT COUNT(*) FROM {}", table),
                    params![],
                    |r| r.get::<_, i64>(0),
                )
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
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        *self.started_at.lock().await = Some(now);
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

pub struct SourcesState {
    pub usgs: SourceInstance,
    pub meteo: SourceInstance,
    pub nws: SourceInstance,
    pub world_bank: SourceInstance,
}

impl SourcesState {
    pub fn new() -> Self {
        Self {
            usgs: SourceInstance::new(),
            meteo: SourceInstance::new(),
            nws: SourceInstance::new(),
            world_bank: SourceInstance::new(),
        }
    }

    pub fn get(&self, kind: &str) -> Option<&SourceInstance> {
        match kind {
            "usgs" => Some(&self.usgs),
            "meteo" => Some(&self.meteo),
            "nws" => Some(&self.nws),
            "world_bank" => Some(&self.world_bank),
            _ => None,
        }
    }
}

fn table_for_kind(kind: &str) -> &'static str {
    match kind {
        "usgs" => "usgs_quakes",
        "meteo" => "meteo_weather",
        "nws" => "nws_alerts",
        "world_bank" => "world_bank",
        _ => "unknown",
    }
}

// ---- Table creation ----

pub fn ensure_tables(db: &LoomDb) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS usgs_quakes (
            id VARCHAR,
            magnitude DOUBLE,
            place VARCHAR,
            ts TIMESTAMP,
            latitude DOUBLE,
            longitude DOUBLE,
            depth DOUBLE,
            mag_type VARCHAR,
            status VARCHAR,
            tsunami BOOLEAN,
            sig INTEGER,
            net VARCHAR,
            updated_at TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS meteo_weather (
            ts TIMESTAMP,
            city VARCHAR,
            latitude DOUBLE,
            longitude DOUBLE,
            temperature DOUBLE,
            humidity DOUBLE,
            wind_speed DOUBLE,
            precipitation DOUBLE,
            weather_code INTEGER,
            pressure DOUBLE,
            cloud_cover DOUBLE
        );
        CREATE TABLE IF NOT EXISTS nws_alerts (
            id VARCHAR,
            event VARCHAR,
            headline VARCHAR,
            severity VARCHAR,
            certainty VARCHAR,
            urgency VARCHAR,
            area_desc VARCHAR,
            sender_name VARCHAR,
            effective TIMESTAMP,
            expires TIMESTAMP,
            status VARCHAR,
            category VARCHAR
        );
        CREATE TABLE IF NOT EXISTS world_bank (
            country_code VARCHAR,
            country_name VARCHAR,
            indicator_id VARCHAR,
            indicator_name VARCHAR,
            yr INTEGER,
            value DOUBLE
        );",
    )
    .map_err(|e| e.to_string())
}

// ---- Generic helpers ----

fn trim_table(db: &LoomDb, table: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM {}", table),
            params![],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count > MAX_ROWS as i64 {
        let excess = count - MAX_ROWS as i64;
        conn.execute_batch(&format!(
            "DELETE FROM {} WHERE rowid IN (SELECT rowid FROM {} LIMIT {})",
            table, table, excess
        ))
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Loom-Data-Storyteller/1.0 (local analytics tool; contact: github.com/mhsenkow/Loom_story_teller)")
        .build()
        .map_err(|e| e.to_string())
}

// ================================================================
// 1. USGS Earthquakes
// ================================================================

const USGS_URL: &str = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson";
const USGS_POLL_SECS: u64 = 60;

fn usgs_insert(db: &LoomDb, body: &serde_json::Value) -> Result<u32, String> {
    let features = body
        .get("features")
        .and_then(|f| f.as_array())
        .ok_or("No features in USGS response")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut count = 0u32;
    for feat in features {
        let props = match feat.get("properties") {
            Some(p) => p,
            None => continue,
        };
        let geom = feat.get("geometry").and_then(|g| g.get("coordinates"));
        let id = props
            .get("ids")
            .or_else(|| feat.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let mag = props.get("mag").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let place = props
            .get("place")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let ts = props.get("time").and_then(|v| v.as_i64()).unwrap_or(0) / 1000;
        let lon = geom
            .and_then(|c| c.get(0))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let lat = geom
            .and_then(|c| c.get(1))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let depth = geom
            .and_then(|c| c.get(2))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let mag_type = props
            .get("magType")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let status = props
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let tsunami = props.get("tsunami").and_then(|v| v.as_i64()).unwrap_or(0) == 1;
        let sig = props.get("sig").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        let net = props
            .get("net")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let updated = props.get("updated").and_then(|v| v.as_i64()).unwrap_or(0) / 1000;

        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM usgs_quakes WHERE id = ?",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if exists {
            continue;
        }
        let _ = conn.execute(
            "INSERT INTO usgs_quakes VALUES (?, ?, ?, to_timestamp(?), ?, ?, ?, ?, ?, ?, ?, ?, to_timestamp(?))",
            params![id, mag, place, ts, lat, lon, depth, mag_type, status, tsunami, sig, net, updated],
        );
        count += 1;
    }
    Ok(count)
}

// ================================================================
// 2. Open-Meteo Weather (5 cities)
// ================================================================

const METEO_POLL_SECS: u64 = 300;

struct CityDef {
    name: &'static str,
    lat: f64,
    lon: f64,
}

const CITIES: &[CityDef] = &[
    CityDef { name: "New York", lat: 40.71, lon: -74.01 },
    CityDef { name: "London", lat: 51.51, lon: -0.13 },
    CityDef { name: "Tokyo", lat: 35.68, lon: 139.69 },
    CityDef { name: "Sydney", lat: -33.87, lon: 151.21 },
    CityDef { name: "São Paulo", lat: -23.55, lon: -46.63 },
];

async fn meteo_fetch_city(
    client: &reqwest::Client,
    city: &CityDef,
) -> Result<Vec<(String, f64, f64, f64, f64, f64, f64, i64, f64, f64)>, String> {
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code,pressure_msl,cloud_cover&past_days=2&forecast_days=1&timezone=auto",
        city.lat, city.lon
    );
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Open-Meteo returned {}", res.status()));
    }
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let hourly = body.get("hourly").ok_or("No hourly data")?;
    let times = hourly
        .get("time")
        .and_then(|v| v.as_array())
        .ok_or("No time array")?;
    let temp = hourly.get("temperature_2m").and_then(|v| v.as_array());
    let hum = hourly.get("relative_humidity_2m").and_then(|v| v.as_array());
    let wind = hourly.get("wind_speed_10m").and_then(|v| v.as_array());
    let precip = hourly.get("precipitation").and_then(|v| v.as_array());
    let wcode = hourly.get("weather_code").and_then(|v| v.as_array());
    let press = hourly.get("pressure_msl").and_then(|v| v.as_array());
    let cloud = hourly.get("cloud_cover").and_then(|v| v.as_array());

    let mut rows = Vec::new();
    for (i, t) in times.iter().enumerate() {
        let ts = t.as_str().unwrap_or("").to_string();
        rows.push((
            ts,
            city.lat,
            city.lon,
            temp.and_then(|a| a.get(i)).and_then(|v| v.as_f64()).unwrap_or(f64::NAN),
            hum.and_then(|a| a.get(i)).and_then(|v| v.as_f64()).unwrap_or(f64::NAN),
            wind.and_then(|a| a.get(i)).and_then(|v| v.as_f64()).unwrap_or(f64::NAN),
            precip.and_then(|a| a.get(i)).and_then(|v| v.as_f64()).unwrap_or(0.0),
            wcode.and_then(|a| a.get(i)).and_then(|v| v.as_i64()).unwrap_or(0),
            press.and_then(|a| a.get(i)).and_then(|v| v.as_f64()).unwrap_or(f64::NAN),
            cloud.and_then(|a| a.get(i)).and_then(|v| v.as_f64()).unwrap_or(f64::NAN),
        ));
    }
    Ok(rows)
}

fn meteo_insert(db: &LoomDb, city_name: &str, rows: &[(String, f64, f64, f64, f64, f64, f64, i64, f64, f64)]) -> Result<u32, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut count = 0u32;
    for r in rows {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM meteo_weather WHERE ts = ? AND city = ?",
                params![r.0, city_name],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if exists {
            continue;
        }
        let _ = conn.execute(
            "INSERT INTO meteo_weather VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![r.0, city_name, r.1, r.2, r.3, r.4, r.5, r.6, r.7, r.8, r.9],
        );
        count += 1;
    }
    Ok(count)
}

// ================================================================
// 3. NWS Alerts
// ================================================================

const NWS_URL: &str = "https://api.weather.gov/alerts/active?status=actual&limit=50";
const NWS_POLL_SECS: u64 = 120;

fn nws_insert(db: &LoomDb, body: &serde_json::Value) -> Result<u32, String> {
    let features = body
        .get("features")
        .and_then(|f| f.as_array())
        .ok_or("No features in NWS response")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut count = 0u32;
    for feat in features {
        let props = match feat.get("properties") {
            Some(p) => p,
            None => continue,
        };
        let id = props
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            continue;
        }
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM nws_alerts WHERE id = ?",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if exists {
            continue;
        }
        let s = |key: &str| -> String {
            props
                .get(key)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        let _ = conn.execute(
            "INSERT INTO nws_alerts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                id,
                s("event"),
                s("headline"),
                s("severity"),
                s("certainty"),
                s("urgency"),
                s("areaDesc"),
                s("senderName"),
                s("effective"),
                s("expires"),
                s("status"),
                s("category")
            ],
        );
        count += 1;
    }
    Ok(count)
}

// ================================================================
// 4. World Bank Indicators
// ================================================================

const WB_INDICATORS: &[(&str, &str)] = &[
    ("NY.GDP.MKTP.CD", "GDP (current US$)"),
    ("SP.POP.TOTL", "Population"),
    ("SP.DYN.LE00.IN", "Life expectancy at birth"),
    ("EN.ATM.CO2E.PC", "CO2 emissions (metric tons per capita)"),
];

async fn wb_fetch_indicator(
    client: &reqwest::Client,
    indicator: &str,
) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://api.worldbank.org/v2/country/all/indicator/{}?format=json&per_page=1000&date=2015:2023",
        indicator
    );
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("World Bank returned {}", res.status()));
    }
    res.json().await.map_err(|e| e.to_string())
}

fn wb_insert(db: &LoomDb, body: &serde_json::Value, indicator_label: &str) -> Result<u32, String> {
    let data = body
        .as_array()
        .and_then(|a| a.get(1))
        .and_then(|v| v.as_array())
        .ok_or("Unexpected World Bank format")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut count = 0u32;
    for entry in data {
        let value = match entry.get("value").and_then(|v| v.as_f64()) {
            Some(v) => v,
            None => continue,
        };
        let country_code = entry
            .get("countryiso3code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let country_name = entry
            .get("country")
            .and_then(|c| c.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let indicator_id = entry
            .get("indicator")
            .and_then(|c| c.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let year = entry
            .get("date")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);
        if country_code.is_empty() || year == 0 {
            continue;
        }
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM world_bank WHERE country_code = ? AND indicator_id = ? AND yr = ?",
                params![country_code, indicator_id, year],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if exists {
            continue;
        }
        let _ = conn.execute(
            "INSERT INTO world_bank VALUES (?, ?, ?, ?, ?, ?)",
            params![country_code, country_name, indicator_id, indicator_label, year, value],
        );
        count += 1;
    }
    Ok(count)
}

// ================================================================
// Start / Stop / Query (generic, dispatched by kind)
// ================================================================

pub async fn source_start(
    kind: &str,
    db: Arc<LoomDb>,
    state: Arc<SourcesState>,
) -> Result<(), String> {
    let inst = state.get(kind).ok_or("Unknown source kind")?;
    if inst.running.load(Ordering::Relaxed) {
        return Err(format!("{} already running", kind));
    }
    ensure_tables(&db)?;
    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    *inst.cancel_token.lock().await = Some(cancel_tx);
    inst.mark_started().await;

    let db_c = db.clone();
    let inst_c = Arc::new((
        inst.running.clone(),
        inst.total_events.clone(),
    ));

    match kind {
        "usgs" => {
            tokio::spawn(async move {
                let client = match build_client() { Ok(c) => c, Err(_) => { inst_c.0.store(false, Ordering::Relaxed); return; } };
                loop {
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(USGS_POLL_SECS)) => {
                            if let Ok(res) = client.get(USGS_URL).send().await {
                                if let Ok(body) = res.json::<serde_json::Value>().await {
                                    if let Ok(n) = usgs_insert(&db_c, &body) {
                                        inst_c.1.fetch_add(n as u64, Ordering::Relaxed);
                                        let _ = trim_table(&db_c, "usgs_quakes");
                                    }
                                }
                            }
                        }
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
            // Immediate first fetch
            let db2 = db.clone();
            let total2 = inst.total_events.clone();
            tokio::spawn(async move {
                if let Ok(client) = build_client() {
                    if let Ok(res) = client.get(USGS_URL).send().await {
                        if let Ok(body) = res.json::<serde_json::Value>().await {
                            if let Ok(n) = usgs_insert(&db2, &body) {
                                total2.fetch_add(n as u64, Ordering::Relaxed);
                            }
                        }
                    }
                }
            });
        }
        "meteo" => {
            tokio::spawn(async move {
                let client = match build_client() { Ok(c) => c, Err(_) => { inst_c.0.store(false, Ordering::Relaxed); return; } };
                // Initial fetch
                for city in CITIES {
                    if let Ok(rows) = meteo_fetch_city(&client, city).await {
                        if let Ok(n) = meteo_insert(&db_c, city.name, &rows) {
                            inst_c.1.fetch_add(n as u64, Ordering::Relaxed);
                        }
                    }
                }
                loop {
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(METEO_POLL_SECS)) => {
                            for city in CITIES {
                                if let Ok(rows) = meteo_fetch_city(&client, city).await {
                                    if let Ok(n) = meteo_insert(&db_c, city.name, &rows) {
                                        inst_c.1.fetch_add(n as u64, Ordering::Relaxed);
                                    }
                                }
                            }
                            let _ = trim_table(&db_c, "meteo_weather");
                        }
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        "nws" => {
            tokio::spawn(async move {
                let client = match build_client() { Ok(c) => c, Err(_) => { inst_c.0.store(false, Ordering::Relaxed); return; } };
                // Initial fetch
                if let Ok(res) = client.get(NWS_URL).send().await {
                    if let Ok(body) = res.json::<serde_json::Value>().await {
                        if let Ok(n) = nws_insert(&db_c, &body) {
                            inst_c.1.fetch_add(n as u64, Ordering::Relaxed);
                        }
                    }
                }
                loop {
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(NWS_POLL_SECS)) => {
                            if let Ok(res) = client.get(NWS_URL).send().await {
                                if let Ok(body) = res.json::<serde_json::Value>().await {
                                    if let Ok(n) = nws_insert(&db_c, &body) {
                                        inst_c.1.fetch_add(n as u64, Ordering::Relaxed);
                                        let _ = trim_table(&db_c, "nws_alerts");
                                    }
                                }
                            }
                        }
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        "world_bank" => {
            tokio::spawn(async move {
                let client = match build_client() { Ok(c) => c, Err(_) => { inst_c.0.store(false, Ordering::Relaxed); return; } };
                for (indicator, label) in WB_INDICATORS {
                    if let Ok(body) = wb_fetch_indicator(&client, indicator).await {
                        if let Ok(n) = wb_insert(&db_c, &body, label) {
                            inst_c.1.fetch_add(n as u64, Ordering::Relaxed);
                        }
                    }
                }
                let _ = trim_table(&db_c, "world_bank");
                // World Bank is a one-shot load; keep "running" for status, stop on cancel
                loop {
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(3600)) => {}
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        _ => return Err("Unknown source".to_string()),
    }
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
    let table = table_for_kind(kind);
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
    let meta_sql = format!(
        "SELECT column_name, column_type FROM (DESCRIBE ({}))",
        full_sql
    );
    let mut meta_stmt = conn.prepare(&meta_sql).map_err(|e| e.to_string())?;
    let meta_rows = meta_stmt
        .query_map(params![], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
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
    let mut out = Vec::new();
    for r in rows.flatten() {
        out.push(r);
    }
    let total = out.len() as u64;
    Ok(QueryResult {
        columns,
        types,
        rows: out,
        total_rows: total,
    })
}

pub fn source_stats(db: &LoomDb, kind: &str) -> Result<Vec<ColumnInfo>, String> {
    let table = table_for_kind(kind);
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM {}", table),
            params![],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if count == 0 {
        return Ok(vec![]);
    }
    conn.execute_batch(&format!(
        "CREATE OR REPLACE TEMP VIEW loom_stats AS SELECT * FROM {}",
        table
    ))
    .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("DESCRIBE loom_stats")
        .map_err(|e| e.to_string())?;
    let schema_rows = stmt
        .query_map(params![], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in schema_rows.flatten() {
        let (col_name, data_type) = row;
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
    let table = table_for_kind(kind);
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(&format!("DELETE FROM {}", table))
        .map_err(|e| e.to_string())
}
