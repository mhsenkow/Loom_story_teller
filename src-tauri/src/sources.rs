// =================================================================
// Loom — Poll-Based Data Sources
// =================================================================
// Public data feeds polled on background intervals into DuckDB tables:
//   USGS, Open-Meteo, NWS, World Bank, ISS, HN, Crypto,
//   Air Quality (Open-Meteo), FX (Frankfurter), FEMA, OpenSky.
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
    pub iss: SourceInstance,
    pub hn: SourceInstance,
    pub crypto: SourceInstance,
    pub aq: SourceInstance,
    pub fx: SourceInstance,
    pub fema: SourceInstance,
    pub opensky: SourceInstance,
    pub countries: SourceInstance,
    pub spacex: SourceInstance,
    pub nyc311: SourceInstance,
    pub covid: SourceInstance,
    pub launches: SourceInstance,
}

impl SourcesState {
    pub fn new() -> Self {
        Self {
            usgs: SourceInstance::new(),
            meteo: SourceInstance::new(),
            nws: SourceInstance::new(),
            world_bank: SourceInstance::new(),
            iss: SourceInstance::new(),
            hn: SourceInstance::new(),
            crypto: SourceInstance::new(),
            aq: SourceInstance::new(),
            fx: SourceInstance::new(),
            fema: SourceInstance::new(),
            opensky: SourceInstance::new(),
            countries: SourceInstance::new(),
            spacex: SourceInstance::new(),
            nyc311: SourceInstance::new(),
            covid: SourceInstance::new(),
            launches: SourceInstance::new(),
        }
    }

    pub fn get(&self, kind: &str) -> Option<&SourceInstance> {
        match kind {
            "usgs" => Some(&self.usgs),
            "meteo" => Some(&self.meteo),
            "nws" => Some(&self.nws),
            "world_bank" => Some(&self.world_bank),
            "iss" => Some(&self.iss),
            "hn" => Some(&self.hn),
            "crypto" => Some(&self.crypto),
            "aq" => Some(&self.aq),
            "fx" => Some(&self.fx),
            "fema" => Some(&self.fema),
            "opensky" => Some(&self.opensky),
            "countries" => Some(&self.countries),
            "spacex" => Some(&self.spacex),
            "nyc311" => Some(&self.nyc311),
            "covid" => Some(&self.covid),
            "launches" => Some(&self.launches),
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
        "iss" => "iss_track",
        "hn" => "hn_stories",
        "crypto" => "crypto_markets",
        "aq" => "air_quality",
        "fx" => "fx_rates",
        "fema" => "fema_disasters",
        "opensky" => "opensky_aircraft",
        "countries" => "world_countries",
        "spacex" => "spacex_launches",
        "nyc311" => "nyc_311",
        "covid" => "covid_countries",
        "launches" => "space_launches",
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
        );
        CREATE TABLE IF NOT EXISTS iss_track (
            ts TIMESTAMP,
            latitude DOUBLE,
            longitude DOUBLE,
            altitude_km DOUBLE,
            velocity_kmh DOUBLE,
            visibility VARCHAR
        );
        CREATE TABLE IF NOT EXISTS hn_stories (
            id VARCHAR,
            title VARCHAR,
            author VARCHAR,
            points INTEGER,
            num_comments INTEGER,
            url VARCHAR,
            created_at TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS crypto_markets (
            id VARCHAR,
            symbol VARCHAR,
            name VARCHAR,
            price_usd DOUBLE,
            market_cap DOUBLE,
            volume_24h DOUBLE,
            change_24h_pct DOUBLE,
            rank INTEGER
        );
        CREATE TABLE IF NOT EXISTS air_quality (
            ts TIMESTAMP,
            city VARCHAR,
            latitude DOUBLE,
            longitude DOUBLE,
            pm2_5 DOUBLE,
            pm10 DOUBLE,
            ozone DOUBLE,
            nitrogen_dioxide DOUBLE,
            european_aqi DOUBLE
        );
        CREATE TABLE IF NOT EXISTS fx_rates (
            as_of DATE,
            base VARCHAR,
            quote VARCHAR,
            rate DOUBLE,
            change_pct DOUBLE
        );
        CREATE TABLE IF NOT EXISTS fema_disasters (
            id VARCHAR,
            disaster_number INTEGER,
            state VARCHAR,
            declaration_type VARCHAR,
            declaration_title VARCHAR,
            incident_type VARCHAR,
            declaration_date TIMESTAMP,
            incident_begin TIMESTAMP,
            fy_declared INTEGER
        );
        CREATE TABLE IF NOT EXISTS opensky_aircraft (
            icao24 VARCHAR,
            callsign VARCHAR,
            origin_country VARCHAR,
            longitude DOUBLE,
            latitude DOUBLE,
            baro_altitude DOUBLE,
            velocity DOUBLE,
            true_track DOUBLE,
            on_ground BOOLEAN,
            ts TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS world_countries (
            name VARCHAR,
            cca3 VARCHAR,
            region VARCHAR,
            subregion VARCHAR,
            population BIGINT,
            area DOUBLE,
            density DOUBLE,
            capital VARCHAR,
            independent BOOLEAN
        );
        CREATE TABLE IF NOT EXISTS spacex_launches (
            id VARCHAR,
            name VARCHAR,
            date_utc TIMESTAMP,
            success BOOLEAN,
            upcoming BOOLEAN,
            rocket VARCHAR,
            flight_number INTEGER,
            details VARCHAR
        );
        CREATE TABLE IF NOT EXISTS nyc_311 (
            unique_key VARCHAR,
            created_date TIMESTAMP,
            complaint_type VARCHAR,
            descriptor VARCHAR,
            borough VARCHAR,
            city VARCHAR,
            latitude DOUBLE,
            longitude DOUBLE,
            status VARCHAR,
            agency VARCHAR
        );
        CREATE TABLE IF NOT EXISTS covid_countries (
            country VARCHAR,
            cases BIGINT,
            today_cases BIGINT,
            deaths BIGINT,
            today_deaths BIGINT,
            recovered BIGINT,
            active BIGINT,
            cases_per_million DOUBLE,
            deaths_per_million DOUBLE,
            population BIGINT,
            continent VARCHAR
        );
        CREATE TABLE IF NOT EXISTS space_launches (
            id VARCHAR,
            name VARCHAR,
            net TIMESTAMP,
            status VARCHAR,
            pad VARCHAR,
            location VARCHAR,
            agency VARCHAR,
            rocket VARCHAR,
            orbital BOOLEAN
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
        "iss" => {
            const ISS_URL: &str = "https://api.wheretheiss.at/v1/satellites/25544";
            tokio::spawn(async move {
                let client = match build_client() {
                    Ok(c) => c,
                    Err(_) => {
                        inst_c.0.store(false, Ordering::Relaxed);
                        return;
                    }
                };
                // Seed one orbit (~10 samples) so trail ribbons work immediately.
                // wheretheiss.at allows ≤10 timestamps per request.
                {
                    let mut empty = true;
                    if let Ok(c) = db_c.conn.lock() {
                        empty = c
                            .query_row("SELECT COUNT(*) FROM iss_track", [], |r| r.get::<_, i64>(0))
                            .map(|n| n == 0)
                            .unwrap_or(true);
                    }
                    if empty {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0);
                        let stamps: Vec<String> = (0..10)
                            .rev()
                            .map(|i| (now - i * 600).to_string())
                            .collect();
                        let url = format!(
                            "https://api.wheretheiss.at/v1/satellites/25544/positions?timestamps={}",
                            stamps.join(",")
                        );
                        if let Ok(res) = client.get(&url).send().await {
                            if let Ok(body) = res.json::<serde_json::Value>().await {
                                if let Ok(n) = iss_insert_many(&db_c, &body) {
                                    inst_c.1.fetch_add(n as u64, Ordering::Relaxed);
                                }
                            }
                        }
                    }
                }
                loop {
                    if let Ok(res) = client.get(ISS_URL).send().await {
                        if let Ok(body) = res.json::<serde_json::Value>().await {
                            if let Ok(n) = iss_insert(&db_c, &body) {
                                inst_c.1.fetch_add(n as u64, Ordering::Relaxed);
                                let _ = trim_table(&db_c, "iss_track");
                            }
                        }
                    }
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(15)) => {}
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        "hn" => {
            const HN_URL: &str =
                "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50";
            tokio::spawn(async move {
                let client = match build_client() {
                    Ok(c) => c,
                    Err(_) => {
                        inst_c.0.store(false, Ordering::Relaxed);
                        return;
                    }
                };
                loop {
                    if let Ok(res) = client.get(HN_URL).send().await {
                        if let Ok(body) = res.json::<serde_json::Value>().await {
                            if let Ok(c) = db_c.conn.lock() {
                                let _ = c.execute_batch("DELETE FROM hn_stories");
                            }
                            if let Ok(n) = hn_insert(&db_c, &body) {
                                inst_c.1.store(n as u64, Ordering::Relaxed);
                            }
                        }
                    }
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(120)) => {}
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        "crypto" => {
            const CG_URL: &str = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false";
            tokio::spawn(async move {
                let client = match build_client() {
                    Ok(c) => c,
                    Err(_) => {
                        inst_c.0.store(false, Ordering::Relaxed);
                        return;
                    }
                };
                loop {
                    if let Ok(res) = client.get(CG_URL).send().await {
                        if let Ok(body) = res.json::<serde_json::Value>().await {
                            if let Ok(c) = db_c.conn.lock() {
                                let _ = c.execute_batch("DELETE FROM crypto_markets");
                            }
                            if let Ok(n) = crypto_insert(&db_c, &body) {
                                inst_c.1.store(n as u64, Ordering::Relaxed);
                            }
                        }
                    }
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(60)) => {}
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        "aq" => {
            tokio::spawn(async move {
                let client = match build_client() {
                    Ok(c) => c,
                    Err(_) => {
                        inst_c.0.store(false, Ordering::Relaxed);
                        return;
                    }
                };
                loop {
                    if let Ok(c) = db_c.conn.lock() {
                        let _ = c.execute_batch("DELETE FROM air_quality");
                    }
                    let mut total = 0u32;
                    for city in CITIES {
                        let url = format!(
                            "https://air-quality-api.open-meteo.com/v1/air-quality?latitude={}&longitude={}&current=pm2_5,pm10,ozone,nitrogen_dioxide,european_aqi",
                            city.lat, city.lon
                        );
                        if let Ok(res) = client.get(&url).send().await {
                            if let Ok(body) = res.json::<serde_json::Value>().await {
                                if let Ok(n) = aq_insert_city(&db_c, city.name, city.lat, city.lon, &body) {
                                    total += n;
                                }
                            }
                        }
                    }
                    inst_c.1.store(total as u64, Ordering::Relaxed);
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(300)) => {}
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        "fx" => {
            const FX_URL: &str = "https://api.frankfurter.app/latest";
            tokio::spawn(async move {
                let client = match build_client() {
                    Ok(c) => c,
                    Err(_) => {
                        inst_c.0.store(false, Ordering::Relaxed);
                        return;
                    }
                };
                loop {
                    if let Ok(res) = client.get(FX_URL).send().await {
                        if let Ok(body) = res.json::<serde_json::Value>().await {
                            if let Ok(c) = db_c.conn.lock() {
                                let _ = c.execute_batch("DELETE FROM fx_rates");
                            }
                            if let Ok(n) = fx_insert(&db_c, &body) {
                                inst_c.1.store(n as u64, Ordering::Relaxed);
                            }
                        }
                    }
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(3600)) => {}
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        "fema" => {
            const FEMA_URL: &str = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=200&$orderby=declarationDate%20desc";
            tokio::spawn(async move {
                let client = match build_client() {
                    Ok(c) => c,
                    Err(_) => {
                        inst_c.0.store(false, Ordering::Relaxed);
                        return;
                    }
                };
                loop {
                    if let Ok(res) = client.get(FEMA_URL).send().await {
                        if let Ok(body) = res.json::<serde_json::Value>().await {
                            if let Ok(c) = db_c.conn.lock() {
                                let _ = c.execute_batch("DELETE FROM fema_disasters");
                            }
                            if let Ok(n) = fema_insert(&db_c, &body) {
                                inst_c.1.store(n as u64, Ordering::Relaxed);
                            }
                        }
                    }
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(600)) => {}
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        "opensky" => {
            // Contiguous US bounding box — keeps payload manageable without auth.
            const OS_URL: &str = "https://opensky-network.org/api/states/all?lamin=24.5&lomin=-125.0&lamax=49.5&lomax=-66.5";
            tokio::spawn(async move {
                let client = match build_client() {
                    Ok(c) => c,
                    Err(_) => {
                        inst_c.0.store(false, Ordering::Relaxed);
                        return;
                    }
                };
                loop {
                    if let Ok(res) = client.get(OS_URL).send().await {
                        if let Ok(body) = res.json::<serde_json::Value>().await {
                            // Append snapshots (do not wipe) so trail ribbons can stitch paths.
                            if let Ok(n) = opensky_insert(&db_c, &body) {
                                inst_c.1.fetch_add(n as u64, Ordering::Relaxed);
                                let _ = trim_table(&db_c, "opensky_aircraft");
                            }
                        }
                    }
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {}
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        "countries" => {
            const URL: &str = "https://restcountries.com/v3.1/all?fields=name,cca3,region,subregion,population,area,capital,independent";
            tokio::spawn(async move {
                let client = match build_client() {
                    Ok(c) => c,
                    Err(_) => {
                        inst_c.0.store(false, Ordering::Relaxed);
                        return;
                    }
                };
                if let Ok(res) = client.get(URL).send().await {
                    if let Ok(body) = res.json::<serde_json::Value>().await {
                        if let Ok(c) = db_c.conn.lock() {
                            let _ = c.execute_batch("DELETE FROM world_countries");
                        }
                        if let Ok(n) = countries_insert(&db_c, &body) {
                            inst_c.1.store(n as u64, Ordering::Relaxed);
                        }
                    }
                }
                // One-shot snapshot (countries rarely need a poll loop)
                loop {
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(86_400)) => {}
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        "spacex" => {
            const URL: &str = "https://api.spacexdata.com/v5/launches/past";
            tokio::spawn(async move {
                let client = match build_client() {
                    Ok(c) => c,
                    Err(_) => {
                        inst_c.0.store(false, Ordering::Relaxed);
                        return;
                    }
                };
                loop {
                    if let Ok(res) = client.get(URL).send().await {
                        if let Ok(body) = res.json::<serde_json::Value>().await {
                            if let Ok(c) = db_c.conn.lock() {
                                let _ = c.execute_batch("DELETE FROM spacex_launches");
                            }
                            if let Ok(n) = spacex_insert(&db_c, &body) {
                                inst_c.1.store(n as u64, Ordering::Relaxed);
                            }
                        }
                    }
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(3600)) => {}
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        "nyc311" => {
            const URL: &str = "https://data.cityofnewyork.us/resource/erm2-nwe9.json?$limit=400&$order=created_date%20DESC";
            tokio::spawn(async move {
                let client = match build_client() {
                    Ok(c) => c,
                    Err(_) => {
                        inst_c.0.store(false, Ordering::Relaxed);
                        return;
                    }
                };
                loop {
                    if let Ok(res) = client.get(URL).send().await {
                        if let Ok(body) = res.json::<serde_json::Value>().await {
                            if let Ok(c) = db_c.conn.lock() {
                                let _ = c.execute_batch("DELETE FROM nyc_311");
                            }
                            if let Ok(n) = nyc311_insert(&db_c, &body) {
                                inst_c.1.store(n as u64, Ordering::Relaxed);
                            }
                        }
                    }
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(300)) => {}
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        "covid" => {
            const URL: &str = "https://disease.sh/v3/covid-19/countries";
            tokio::spawn(async move {
                let client = match build_client() {
                    Ok(c) => c,
                    Err(_) => {
                        inst_c.0.store(false, Ordering::Relaxed);
                        return;
                    }
                };
                loop {
                    if let Ok(res) = client.get(URL).send().await {
                        if let Ok(body) = res.json::<serde_json::Value>().await {
                            if let Ok(c) = db_c.conn.lock() {
                                let _ = c.execute_batch("DELETE FROM covid_countries");
                            }
                            if let Ok(n) = covid_insert(&db_c, &body) {
                                inst_c.1.store(n as u64, Ordering::Relaxed);
                            }
                        }
                    }
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(1800)) => {}
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        "launches" => {
            const URL: &str = "https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=40&mode=list";
            tokio::spawn(async move {
                let client = match build_client() {
                    Ok(c) => c,
                    Err(_) => {
                        inst_c.0.store(false, Ordering::Relaxed);
                        return;
                    }
                };
                loop {
                    if let Ok(res) = client.get(URL).send().await {
                        if let Ok(body) = res.json::<serde_json::Value>().await {
                            if let Ok(c) = db_c.conn.lock() {
                                let _ = c.execute_batch("DELETE FROM space_launches");
                            }
                            if let Ok(n) = launches_insert(&db_c, &body) {
                                inst_c.1.store(n as u64, Ordering::Relaxed);
                            }
                        }
                    }
                    tokio::select! {
                        _ = &mut cancel_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(1800)) => {}
                    }
                }
                inst_c.0.store(false, Ordering::Relaxed);
            });
        }
        _ => return Err("Unknown source".to_string()),
    }
    Ok(())
}

fn iss_insert(db: &LoomDb, body: &serde_json::Value) -> Result<u32, String> {
    let lat = body.get("latitude").and_then(|v| v.as_f64()).ok_or("no lat")?;
    let lon = body.get("longitude").and_then(|v| v.as_f64()).ok_or("no lon")?;
    let alt = body.get("altitude").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let vel = body.get("velocity").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let vis = body
        .get("visibility")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let ts = body.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO iss_track VALUES (to_timestamp(?), ?, ?, ?, ?, ?)",
        params![ts, lat, lon, alt, vel, vis],
    )
    .map_err(|e| e.to_string())?;
    Ok(1)
}

fn iss_insert_many(db: &LoomDb, body: &serde_json::Value) -> Result<u32, String> {
    let arr = body
        .as_array()
        .ok_or_else(|| "ISS trail: expected array".to_string())?;
    let mut n = 0u32;
    for item in arr {
        if iss_insert(db, item).is_ok() {
            n += 1;
        }
    }
    Ok(n)
}

fn hn_insert(db: &LoomDb, body: &serde_json::Value) -> Result<u32, String> {
    let hits = body
        .get("hits")
        .and_then(|v| v.as_array())
        .ok_or("no hits")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut n = 0u32;
    for hit in hits {
        let id = hit
            .get("objectID")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let title = hit
            .get("title")
            .or_else(|| hit.get("story_title"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let author = hit
            .get("author")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let points = hit.get("points").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        let comments = hit
            .get("num_comments")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;
        let url = hit
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let created = hit
            .get("created_at")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let _ = conn.execute(
            "INSERT INTO hn_stories VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![id, title, author, points, comments, url, created],
        );
        n += 1;
    }
    Ok(n)
}

fn crypto_insert(db: &LoomDb, body: &serde_json::Value) -> Result<u32, String> {
    let list = body.as_array().ok_or("no coins")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut n = 0u32;
    for coin in list {
        let id = coin
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let symbol = coin
            .get("symbol")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        let name = coin
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let price = coin
            .get("current_price")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let mcap = coin
            .get("market_cap")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let vol = coin
            .get("total_volume")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let chg = coin
            .get("price_change_percentage_24h")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let rank = coin
            .get("market_cap_rank")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;
        let _ = conn.execute(
            "INSERT INTO crypto_markets VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![id, symbol, name, price, mcap, vol, chg, rank],
        );
        n += 1;
    }
    Ok(n)
}

fn aq_insert_city(
    db: &LoomDb,
    city: &str,
    lat: f64,
    lon: f64,
    body: &serde_json::Value,
) -> Result<u32, String> {
    let cur = body.get("current").ok_or("no current")?;
    let pm25 = cur.get("pm2_5").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let pm10 = cur.get("pm10").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let o3 = cur.get("ozone").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let no2 = cur
        .get("nitrogen_dioxide")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let aqi = cur
        .get("european_aqi")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let ts = cur
        .get("time")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO air_quality VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![ts, city, lat, lon, pm25, pm10, o3, no2, aqi],
    )
    .map_err(|e| e.to_string())?;
    Ok(1)
}

fn fx_insert(db: &LoomDb, body: &serde_json::Value) -> Result<u32, String> {
    let base = body
        .get("base")
        .and_then(|v| v.as_str())
        .unwrap_or("EUR")
        .to_string();
    let as_of = body
        .get("date")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let rates = body
        .get("rates")
        .and_then(|v| v.as_object())
        .ok_or("no rates")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut n = 0u32;
    for (quote, val) in rates {
        let rate = val.as_f64().unwrap_or(0.0);
        let _ = conn.execute(
            "INSERT INTO fx_rates VALUES (?, ?, ?, ?, ?)",
            params![as_of, base, quote, rate, 0.0_f64],
        );
        n += 1;
    }
    Ok(n)
}

fn fema_insert(db: &LoomDb, body: &serde_json::Value) -> Result<u32, String> {
    let list = body
        .get("DisasterDeclarationsSummaries")
        .and_then(|v| v.as_array())
        .ok_or("no fema rows")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut n = 0u32;
    for row in list.iter().take(200) {
        let id = row
            .get("id")
            .or_else(|| row.get("disasterNumber"))
            .map(|v| match v {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_default();
        let disaster_number = row
            .get("disasterNumber")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;
        let state = row
            .get("state")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let declaration_type = row
            .get("declarationType")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let declaration_title = row
            .get("declarationTitle")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let incident_type = row
            .get("incidentType")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let declaration_date = row
            .get("declarationDate")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let incident_begin = row
            .get("incidentBeginDate")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let fy = row
            .get("fyDeclared")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;
        let _ = conn.execute(
            "INSERT INTO fema_disasters VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                id,
                disaster_number,
                state,
                declaration_type,
                declaration_title,
                incident_type,
                declaration_date,
                incident_begin,
                fy
            ],
        );
        n += 1;
    }
    Ok(n)
}

fn opensky_insert(db: &LoomDb, body: &serde_json::Value) -> Result<u32, String> {
    let states = body
        .get("states")
        .and_then(|v| v.as_array())
        .ok_or("no states")?;
    let time = body.get("time").and_then(|v| v.as_i64()).unwrap_or(0);
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut n = 0u32;
    for st in states.iter().take(800) {
        let arr = match st.as_array() {
            Some(a) if a.len() >= 9 => a,
            _ => continue,
        };
        let lon = arr.get(5).and_then(|v| v.as_f64());
        let lat = arr.get(6).and_then(|v| v.as_f64());
        let (Some(lon), Some(lat)) = (lon, lat) else {
            continue;
        };
        let icao = arr
            .get(0)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let callsign = arr
            .get(1)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let country = arr
            .get(2)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let alt = arr.get(7).and_then(|v| v.as_f64()).unwrap_or(0.0);
        let vel = arr.get(9).and_then(|v| v.as_f64()).unwrap_or(0.0);
        let track = arr.get(10).and_then(|v| v.as_f64()).unwrap_or(0.0);
        let on_ground = arr.get(8).and_then(|v| v.as_bool()).unwrap_or(false);
        let _ = conn.execute(
            "INSERT INTO opensky_aircraft VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, to_timestamp(?))",
            params![icao, callsign, country, lon, lat, alt, vel, track, on_ground, time],
        );
        n += 1;
    }
    Ok(n)
}

fn countries_insert(db: &LoomDb, body: &serde_json::Value) -> Result<u32, String> {
    let list = body.as_array().ok_or("no countries")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut n = 0u32;
    for row in list {
        let name = row
            .get("name")
            .and_then(|v| v.get("common"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        let cca3 = row
            .get("cca3")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let region = row
            .get("region")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let subregion = row
            .get("subregion")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let population = row.get("population").and_then(|v| v.as_i64()).unwrap_or(0);
        let area = row.get("area").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let density = if area > 0.0 {
            population as f64 / area
        } else {
            0.0
        };
        let capital = row
            .get("capital")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let independent = row
            .get("independent")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let _ = conn.execute(
            "INSERT INTO world_countries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                name,
                cca3,
                region,
                subregion,
                population,
                area,
                density,
                capital,
                independent
            ],
        );
        n += 1;
    }
    Ok(n)
}

fn spacex_insert(db: &LoomDb, body: &serde_json::Value) -> Result<u32, String> {
    let list = body.as_array().ok_or("no launches")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut n = 0u32;
    // Keep the most recent ~120 launches (API returns chronological; take last).
    let start = list.len().saturating_sub(120);
    for row in &list[start..] {
        let id = row
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let name = row
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let date_utc = row
            .get("date_utc")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let success = row.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
        let upcoming = row.get("upcoming").and_then(|v| v.as_bool()).unwrap_or(false);
        let rocket = row
            .get("rocket")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let flight_number = row
            .get("flight_number")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;
        let details = row
            .get("details")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .chars()
            .take(280)
            .collect::<String>();
        let _ = conn.execute(
            "INSERT INTO spacex_launches VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![id, name, date_utc, success, upcoming, rocket, flight_number, details],
        );
        n += 1;
    }
    Ok(n)
}

fn nyc311_insert(db: &LoomDb, body: &serde_json::Value) -> Result<u32, String> {
    let list = body.as_array().ok_or("no 311")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut n = 0u32;
    for row in list {
        let unique_key = row
            .get("unique_key")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let created = row
            .get("created_date")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let complaint = row
            .get("complaint_type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let descriptor = row
            .get("descriptor")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let borough = row
            .get("borough")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let city = row
            .get("city")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let lat = row
            .get("latitude")
            .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_f64()))
            .unwrap_or(0.0);
        let lon = row
            .get("longitude")
            .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_f64()))
            .unwrap_or(0.0);
        let status = row
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let agency = row
            .get("agency")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let _ = conn.execute(
            "INSERT INTO nyc_311 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                unique_key,
                created,
                complaint,
                descriptor,
                borough,
                city,
                lat,
                lon,
                status,
                agency
            ],
        );
        n += 1;
    }
    Ok(n)
}

fn covid_insert(db: &LoomDb, body: &serde_json::Value) -> Result<u32, String> {
    let list = body.as_array().ok_or("no covid")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut n = 0u32;
    for row in list {
        let country = row
            .get("country")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if country.is_empty() {
            continue;
        }
        let cases = row.get("cases").and_then(|v| v.as_i64()).unwrap_or(0);
        let today_cases = row.get("todayCases").and_then(|v| v.as_i64()).unwrap_or(0);
        let deaths = row.get("deaths").and_then(|v| v.as_i64()).unwrap_or(0);
        let today_deaths = row.get("todayDeaths").and_then(|v| v.as_i64()).unwrap_or(0);
        let recovered = row.get("recovered").and_then(|v| v.as_i64()).unwrap_or(0);
        let active = row.get("active").and_then(|v| v.as_i64()).unwrap_or(0);
        let cpm = row
            .get("casesPerOneMillion")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let dpm = row
            .get("deathsPerOneMillion")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let population = row.get("population").and_then(|v| v.as_i64()).unwrap_or(0);
        let continent = row
            .get("continent")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let _ = conn.execute(
            "INSERT INTO covid_countries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                country,
                cases,
                today_cases,
                deaths,
                today_deaths,
                recovered,
                active,
                cpm,
                dpm,
                population,
                continent
            ],
        );
        n += 1;
    }
    Ok(n)
}

fn launches_insert(db: &LoomDb, body: &serde_json::Value) -> Result<u32, String> {
    let list = body
        .get("results")
        .and_then(|v| v.as_array())
        .ok_or("no launches")?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut n = 0u32;
    for row in list {
        let id = row
            .get("id")
            .map(|v| match v {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_default();
        let name = row
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let net = row
            .get("net")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let status = row
            .get("status")
            .and_then(|v| v.get("name").or_else(|| v.get("abbrev")))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let pad = row
            .get("pad")
            .and_then(|v| v.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let location = row
            .get("pad")
            .and_then(|v| v.get("location"))
            .and_then(|v| v.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let agency = row
            .get("launch_service_provider")
            .and_then(|v| v.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let rocket = row
            .get("rocket")
            .and_then(|v| v.get("configuration"))
            .and_then(|v| v.get("full_name").or_else(|| v.get("name")))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let orbital = row
            .get("mission")
            .and_then(|v| v.get("type"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_lowercase().contains("orbit"))
            .unwrap_or(false);
        let _ = conn.execute(
            "INSERT INTO space_launches VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![id, name, net, status, pad, location, agency, rocket, orbital],
        );
        n += 1;
    }
    Ok(n)
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
