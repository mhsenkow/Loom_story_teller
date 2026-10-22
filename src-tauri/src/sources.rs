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

use crate::db::{ColumnInfo, LoomDb, QueryResult};
use duckdb::types::{ToSql, ToSqlOutput, Value as DbValue};
use duckdb::{appender_params_from_iter, params, params_from_iter, Connection};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

/// Row cap for append / upsert tables (oldest rows are trimmed).
const MAX_ROWS: usize = 50_000;
/// Aircraft kept per poll (OpenSky / ADSB.lol / adsb.fi) — matches Worker cap.
const MAX_AIRCRAFT: usize = 2000;
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
            ("id", V),
            ("magnitude", D),
            ("place", V),
            ("ts", TS),
            ("latitude", D),
            ("longitude", D),
            ("depth", D),
            ("mag_type", V),
            ("status", V),
            ("tsunami", B),
            ("sig", I),
            ("net", V),
        ],
        order_by: "ts DESC",
        poll_secs: 60,
        mode: WriteMode::Upsert(&["id"]),
    },
    SourceSpec {
        kind: "eonet",
        table: "natural_events",
        columns: &[
            ("id", V),
            ("title", V),
            ("category", V),
            ("source", V),
            ("ts", TS),
            ("latitude", D),
            ("longitude", D),
            ("magnitude", D),
            ("magnitude_unit", V),
            ("status", V),
        ],
        order_by: "ts DESC",
        poll_secs: 600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "gdacs",
        table: "disaster_alerts",
        columns: &[
            ("id", V),
            ("event_type", V),
            ("title", V),
            ("alert_level", V),
            ("alert_score", D),
            ("country", V),
            ("latitude", D),
            ("longitude", D),
            ("start_ts", TS),
            ("end_ts", TS),
            ("severity", D),
            ("severity_unit", V),
        ],
        order_by: "start_ts DESC",
        poll_secs: 900,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "nws",
        table: "nws_alerts",
        columns: &[
            ("id", V),
            ("event", V),
            ("headline", V),
            ("severity", V),
            ("certainty", V),
            ("urgency", V),
            ("area_desc", V),
            ("sender_name", V),
            ("effective", TS),
            ("expires", TS),
            ("status", V),
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
            ("ts", TS),
            ("city", V),
            ("latitude", D),
            ("longitude", D),
            ("temperature", D),
            ("humidity", D),
            ("wind_speed", D),
            ("precipitation", D),
            ("weather_code", I),
            ("pressure", D),
            ("cloud_cover", D),
        ],
        order_by: "ts DESC",
        poll_secs: 300,
        mode: WriteMode::Upsert(&["ts", "city"]),
    },
    SourceSpec {
        kind: "aq",
        table: "air_quality",
        columns: &[
            ("ts", TS),
            ("city", V),
            ("latitude", D),
            ("longitude", D),
            ("pm2_5", D),
            ("pm10", D),
            ("ozone", D),
            ("nitrogen_dioxide", D),
            ("european_aqi", D),
        ],
        order_by: "pm2_5 DESC",
        poll_secs: 300,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "ukcarbon",
        table: "uk_carbon",
        columns: &[
            ("ts", TS),
            ("forecast", I),
            ("actual", I),
            ("intensity_index", V),
        ],
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
        kind: "buoys",
        table: "ocean_buoys",
        columns: &[
            ("station", V),
            ("latitude", D),
            ("longitude", D),
            ("ts", TS),
            ("wind_dir", D),
            ("wind_speed_ms", D),
            ("gust_ms", D),
            ("wave_height_m", D),
            ("wave_period_s", D),
            ("pressure_hpa", D),
            ("air_temp_c", D),
            ("water_temp_c", D),
        ],
        order_by: "wave_height_m DESC",
        poll_secs: 1800,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "firms",
        table: "firms_fires",
        columns: &[
            ("id", V),
            ("latitude", D),
            ("longitude", D),
            ("bright_ti4", D),
            ("bright_ti5", D),
            ("frp", D),
            ("confidence", V),
            ("satellite", V),
            ("acq_ts", TS),
            ("daynight", V),
        ],
        order_by: "frp DESC",
        poll_secs: 600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "nwis",
        table: "nwis_gauges",
        columns: &[
            ("site_id", V),
            ("site_name", V),
            ("ts", TS),
            ("latitude", D),
            ("longitude", D),
            ("discharge_cfs", D),
            ("gage_height_ft", D),
        ],
        order_by: "ts DESC",
        poll_secs: 300,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "opensky",
        table: "opensky_aircraft",
        columns: &[
            ("icao24", V),
            ("callsign", V),
            ("origin_country", V),
            ("longitude", D),
            ("latitude", D),
            ("baro_altitude", D),
            ("velocity", D),
            ("true_track", D),
            ("on_ground", B),
            ("ts", TS),
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
            ("station_id", V),
            ("name", V),
            ("latitude", D),
            ("longitude", D),
            ("capacity", I),
            ("bikes_available", I),
            ("ebikes_available", I),
            ("docks_available", I),
            ("pct_full", D),
            ("is_renting", B),
            ("ts", TS),
        ],
        order_by: "bikes_available DESC",
        poll_secs: 60,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "mbta",
        table: "mbta_vehicles",
        columns: &[
            ("id", V),
            ("label", V),
            ("route", V),
            ("route_type", V),
            ("latitude", D),
            ("longitude", D),
            ("bearing", D),
            ("speed_mph", D),
            ("status", V),
            ("occupancy", V),
            ("ts", TS),
        ],
        order_by: "route, label",
        poll_secs: 30,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "nyc311",
        table: "nyc_311",
        columns: &[
            ("unique_key", V),
            ("created_date", TS),
            ("complaint_type", V),
            ("descriptor", V),
            ("borough", V),
            ("city", V),
            ("latitude", D),
            ("longitude", D),
            ("status", V),
            ("agency", V),
        ],
        order_by: "created_date DESC",
        poll_secs: 300,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "iss",
        table: "iss_track",
        columns: &[
            ("ts", TS),
            ("latitude", D),
            ("longitude", D),
            ("altitude_km", D),
            ("velocity_kmh", D),
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
            ("id", V),
            ("name", V),
            ("net", TS),
            ("status", V),
            ("pad", V),
            ("location", V),
            ("agency", V),
            ("rocket", V),
            ("orbital", B),
        ],
        order_by: "net ASC",
        poll_secs: 1800,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "spacex",
        table: "spacex_launches",
        columns: &[
            ("id", V),
            ("name", V),
            ("date_utc", TS),
            ("success", B),
            ("upcoming", B),
            ("rocket", V),
            ("flight_number", I),
            ("details", V),
        ],
        order_by: "date_utc DESC",
        poll_secs: 3600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "spaceweather",
        table: "space_weather",
        columns: &[
            ("ts", TS),
            ("kp", D),
            ("a_running", I),
            ("station_count", I),
            ("storm_level", V),
        ],
        order_by: "ts DESC",
        poll_secs: 900,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "aurora",
        table: "aurora_forecast",
        columns: &[
            ("longitude", D),
            ("latitude", D),
            ("probability", I),
            ("ts", TS),
        ],
        order_by: "probability DESC",
        poll_secs: 900,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "asteroids",
        table: "asteroid_approaches",
        columns: &[
            ("designation", V),
            ("name", V),
            ("approach_ts", TS),
            ("distance_ld", D),
            ("distance_km", D),
            ("velocity_kms", D),
            ("abs_magnitude", D),
            ("diameter_m", D),
        ],
        order_by: "approach_ts ASC",
        poll_secs: 21_600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "starlink",
        table: "starlink_sats",
        columns: &[
            ("norad_cat_id", I),
            ("object_name", V),
            ("object_id", V),
            ("epoch", TS),
            ("inclination", D),
            ("eccentricity", D),
            ("mean_motion", D),
            ("raan", D),
            ("arg_perigee", D),
            ("mean_anomaly", D),
            ("bstar", D),
        ],
        order_by: "mean_motion DESC",
        poll_secs: 7200,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "hn",
        table: "hn_stories",
        columns: &[
            ("id", V),
            ("title", V),
            ("author", V),
            ("points", I),
            ("num_comments", I),
            ("url", V),
            ("created_at", TS),
        ],
        order_by: "points DESC",
        poll_secs: 120,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "lobsters",
        table: "lobsters_stories",
        columns: &[
            ("id", V),
            ("title", V),
            ("author", V),
            ("score", I),
            ("comment_count", I),
            ("url", V),
            ("tags", V),
            ("created_at", TS),
        ],
        order_by: "score DESC",
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
        kind: "steam",
        table: "steam_games",
        columns: &[
            ("appid", V),
            ("name", V),
            ("developer", V),
            ("peak_players", I),
            ("positive", I),
            ("negative", I),
            ("positive_pct", D),
            ("owners_min", BI),
            ("price_usd", D),
            ("discount_pct", D),
        ],
        order_by: "peak_players DESC",
        poll_secs: 21_600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "crypto",
        table: "crypto_markets",
        columns: &[
            ("id", V),
            ("symbol", V),
            ("name", V),
            ("price_usd", D),
            ("market_cap", D),
            ("volume_24h", D),
            ("change_24h_pct", D),
            ("rank", I),
        ],
        order_by: "rank ASC",
        poll_secs: 60,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "bitcoin",
        table: "bitcoin_blocks",
        columns: &[
            ("height", I),
            ("ts", TS),
            ("tx_count", I),
            ("size_mb", D),
            ("median_fee_sat_vb", D),
            ("total_fees_btc", D),
            ("reward_btc", D),
            ("pool", V),
        ],
        order_by: "height DESC",
        poll_secs: 120,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "fx",
        table: "fx_rates",
        columns: &[
            ("as_of", DT),
            ("base", V),
            ("quote", V),
            ("rate", D),
            ("change_pct", D),
        ],
        order_by: "as_of DESC, quote",
        poll_secs: 3600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "debt",
        table: "us_debt",
        columns: &[
            ("record_date", DT),
            ("total_debt", D),
            ("held_by_public", D),
            ("intragovernmental", D),
        ],
        order_by: "record_date ASC",
        poll_secs: 0,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "usafacts_states",
        table: "usafacts_states",
        columns: &[
            ("state_fips", V),
            ("state_abbr", V),
            ("state_name", V),
            ("yr", I),
            ("population", BI),
            ("median_household_income", D),
            ("poverty_rate", D),
            ("median_age", D),
            ("unemployment_rate", D),
            ("bachelors_or_higher_pct", D),
        ],
        order_by: "yr DESC, state_abbr",
        poll_secs: 0,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "usafacts_nation",
        table: "usafacts_nation",
        columns: &[
            ("month", DT),
            ("yr", I),
            ("unemployment_rate", D),
            ("inflation_yoy_pct", D),
            ("payrolls_k", D),
            ("fed_funds_rate", D),
            ("housing_starts_k", D),
            ("gas_price_usd", D),
        ],
        order_by: "month ASC",
        poll_secs: 21_600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "fema",
        table: "fema_disasters",
        columns: &[
            ("id", V),
            ("disaster_number", I),
            ("state", V),
            ("declaration_type", V),
            ("declaration_title", V),
            ("incident_type", V),
            ("declaration_date", TS),
            ("incident_begin", TS),
            ("fy_declared", I),
        ],
        order_by: "declaration_date DESC",
        poll_secs: 600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "covid",
        table: "covid_countries",
        columns: &[
            ("country", V),
            ("cases", BI),
            ("today_cases", BI),
            ("deaths", BI),
            ("today_deaths", BI),
            ("recovered", BI),
            ("active", BI),
            ("cases_per_million", D),
            ("deaths_per_million", D),
            ("population", BI),
            ("continent", V),
        ],
        order_by: "cases DESC",
        poll_secs: 1800,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "countries",
        table: "world_countries",
        columns: &[
            ("name", V),
            ("cca3", V),
            ("region", V),
            ("subregion", V),
            ("population", BI),
            ("area", D),
            ("density", D),
            ("capital", V),
            ("independent", B),
        ],
        order_by: "population DESC",
        poll_secs: 0,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "world_bank",
        table: "world_bank",
        columns: &[
            ("country_code", V),
            ("country_name", V),
            ("yr", I),
            ("gdp_usd", D),
            ("gdp_per_capita", D),
            ("population", BI),
            ("life_expectancy", D),
            ("co2_per_capita", D),
        ],
        order_by: "yr DESC, country_code",
        poll_secs: 0,
        mode: WriteMode::Replace,
    },
    // ---- 2026-10 keyless batch (parsers in sources_extra.rs) ----
    SourceSpec {
        kind: "fireballs",
        table: "fireballs",
        columns: &[
            ("ts", TS),
            ("latitude", D),
            ("longitude", D),
            ("altitude_km", D),
            ("velocity_kms", D),
            ("energy_e10j", D),
            ("impact_kt", D),
        ],
        order_by: "ts DESC",
        poll_secs: 21_600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "satellites",
        table: "visual_satellites",
        columns: &[
            ("norad_id", I),
            ("name", V),
            ("object_type", V),
            ("launch_year", I),
            ("inclination", D),
            ("period_min", D),
            ("apogee_km", D),
            ("perigee_km", D),
            ("eccentricity", D),
            ("epoch", TS),
        ],
        order_by: "apogee_km DESC",
        poll_secs: 7200,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "internet_outages",
        table: "internet_outages",
        columns: &[
            ("ts", TS),
            ("country_code", V),
            ("country", V),
            ("datasource", V),
            ("level", V),
            ("value", D),
            ("history_value", D),
            ("drop_pct", D),
        ],
        order_by: "ts DESC",
        poll_secs: 900,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "faa_delays",
        table: "faa_airport_status",
        columns: &[
            ("airport", V),
            ("status_type", V),
            ("reason", V),
            ("min_delay_min", D),
            ("max_delay_min", D),
            ("avg_delay_min", D),
            ("trend", V),
            ("updated", TS),
        ],
        order_by: "max_delay_min DESC",
        poll_secs: 300,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "lobbying",
        table: "lobbying_filings",
        columns: &[
            ("filing_id", V),
            ("registrant", V),
            ("client", V),
            ("client_state", V),
            ("filing_type", V),
            ("filing_year", I),
            ("filing_period", V),
            ("amount_usd", D),
            ("amount_kind", V),
            ("issue_codes", V),
            ("n_issues", I),
            ("posted", TS),
        ],
        order_by: "posted DESC",
        poll_secs: 3600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "fda_recalls",
        table: "fda_recalls",
        columns: &[
            ("recall_number", V),
            ("product_type", V),
            ("classification", V),
            ("status", V),
            ("firm", V),
            ("state", V),
            ("country", V),
            ("reason", V),
            ("product", V),
            ("quantity", V),
            ("voluntary", V),
            ("report_date", DT),
            ("initiated", DT),
        ],
        order_by: "report_date DESC",
        poll_secs: 21_600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "vehicle_recalls",
        table: "vehicle_recalls",
        columns: &[
            ("nhtsa_id", V),
            ("report_date", DT),
            ("manufacturer", V),
            ("subject", V),
            ("component", V),
            ("recall_type", V),
            ("potentially_affected", BI),
            ("park_outside", B),
            ("do_not_drive", B),
        ],
        order_by: "report_date DESC",
        poll_secs: 21_600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "arxiv",
        table: "arxiv_papers",
        columns: &[
            ("id", V),
            ("title", V),
            ("primary_category", V),
            ("field", V),
            ("n_categories", I),
            ("n_authors", I),
            ("published", TS),
            ("updated", TS),
        ],
        order_by: "published DESC",
        poll_secs: 3600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "github_events",
        table: "github_events",
        columns: &[
            ("id", V),
            ("event_type", V),
            ("repo", V),
            ("is_org", B),
            ("ts", TS),
        ],
        order_by: "ts DESC",
        poll_secs: 600,
        mode: WriteMode::Upsert(&["id"]),
    },
    SourceSpec {
        kind: "books",
        table: "trending_books",
        columns: &[
            ("site", V),
            ("rank", I),
            ("title", V),
            ("author", V),
            ("first_year", I),
            ("editions", I),
            ("downloads", BI),
            ("language", V),
        ],
        order_by: "site, rank",
        poll_secs: 21_600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "nyc_inspections",
        table: "nyc_restaurant_inspections",
        columns: &[
            ("camis", V),
            ("restaurant", V),
            ("borough", V),
            ("cuisine", V),
            ("inspection_date", TS),
            ("grade", V),
            ("score", I),
            ("critical", V),
            ("violation_code", V),
            ("violation", V),
            ("latitude", D),
            ("longitude", D),
        ],
        order_by: "inspection_date DESC",
        poll_secs: 3600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "chicago_crime",
        table: "chicago_crime",
        columns: &[
            ("id", V),
            ("ts", TS),
            ("block", V),
            ("primary_type", V),
            ("description", V),
            ("location_description", V),
            ("arrest", B),
            ("domestic", B),
            ("district", V),
            ("community_area", V),
            ("latitude", D),
            ("longitude", D),
        ],
        order_by: "ts DESC",
        poll_secs: 3600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "nyc_parking",
        table: "nyc_parking_tickets",
        columns: &[
            ("summons_number", V),
            ("issue_date", DT),
            ("violation_time", V),
            ("violation", V),
            ("fine_amount", D),
            ("penalty_amount", D),
            ("amount_due", D),
            ("county", V),
            ("plate_state", V),
            ("issuing_agency", V),
            ("precinct", V),
        ],
        order_by: "issue_date DESC",
        poll_secs: 3600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "powerball",
        table: "powerball_draws",
        columns: &[
            ("draw_date", DT),
            ("yr", I),
            ("n1", I),
            ("n2", I),
            ("n3", I),
            ("n4", I),
            ("n5", I),
            ("powerball", I),
            ("multiplier", I),
        ],
        order_by: "draw_date DESC",
        poll_secs: 21_600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "fed_spending",
        table: "federal_agencies",
        columns: &[
            ("agency", V),
            ("abbreviation", V),
            ("toptier_code", V),
            ("fiscal_year", I),
            ("budget_authority", D),
            ("obligated", D),
            ("outlays", D),
            ("pct_of_total", D),
        ],
        order_by: "budget_authority DESC",
        poll_secs: 21_600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "bikeshare",
        table: "bikeshare_stations",
        columns: &[
            ("system", V),
            ("station_id", V),
            ("name", V),
            ("latitude", D),
            ("longitude", D),
            ("capacity", I),
            ("bikes_available", I),
            ("ebikes_available", I),
            ("docks_available", I),
            ("pct_full", D),
            ("is_renting", B),
            ("ts", TS),
        ],
        order_by: "bikes_available DESC",
        poll_secs: 120,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "bluesky",
        table: "bluesky_activity",
        columns: &[
            ("id", V),
            ("ts", TS),
            ("dimension", V),
            ("key", V),
            ("posts", I),
            ("window_secs", D),
            ("posts_per_min", D),
        ],
        order_by: "ts DESC, posts DESC",
        poll_secs: 60,
        mode: WriteMode::Upsert(&["id"]),
    },
    SourceSpec {
        kind: "bgp",
        table: "bgp_updates",
        columns: &[
            ("id", V),
            ("ts", TS),
            ("dimension", V),
            ("key", V),
            ("announcements", I),
            ("withdrawals", I),
            ("window_secs", D),
        ],
        order_by: "ts DESC, announcements DESC",
        poll_secs: 60,
        mode: WriteMode::Upsert(&["id"]),
    },
    SourceSpec {
        kind: "nobel",
        table: "nobel_laureates",
        columns: &[
            ("laureate_id", V),
            ("name", V),
            ("gender", V),
            ("birth_year", I),
            ("birth_country", V),
            ("award_year", I),
            ("category", V),
            ("portion", V),
            ("motivation", V),
        ],
        order_by: "award_year DESC, category, name",
        poll_secs: 21_600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "trivia",
        table: "trivia_questions",
        columns: &[
            ("category", V),
            ("difficulty", V),
            ("question_type", V),
            ("question", V),
            ("correct_answer", V),
            ("incorrect_count", I),
        ],
        order_by: "category, difficulty",
        poll_secs: 21_600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "pokemon",
        table: "pokemon",
        columns: &[
            ("id", I),
            ("name", V),
            ("type1", V),
            ("type2", V),
            ("height_m", D),
            ("weight_kg", D),
            ("hp", I),
            ("attack", I),
            ("defense", I),
            ("sp_attack", I),
            ("sp_defense", I),
            ("speed", I),
            ("total", I),
        ],
        order_by: "id",
        poll_secs: 86_400,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "met",
        table: "met_highlights",
        columns: &[
            ("object_id", I),
            ("title", V),
            ("artist", V),
            ("department", V),
            ("culture", V),
            ("object_date", V),
            ("object_begin_year", I),
            ("medium", V),
            ("is_public_domain", B),
            ("is_highlight", B),
        ],
        order_by: "department, title",
        poll_secs: 86_400,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "openfood",
        table: "open_food_facts",
        columns: &[
            ("code", V),
            ("product_name", V),
            ("brands", V),
            ("nutriscore", V),
            ("countries", V),
            ("category", V),
            ("energy_kcal_100g", D),
            ("fat_100g", D),
            ("sugars_100g", D),
            ("proteins_100g", D),
        ],
        order_by: "nutriscore, product_name",
        poll_secs: 21_600,
        mode: WriteMode::Replace,
    },
    SourceSpec {
        kind: "radio",
        table: "radio_stations",
        columns: &[
            ("station_uuid", V),
            ("name", V),
            ("country", V),
            ("country_code", V),
            ("language", V),
            ("codec", V),
            ("bitrate", I),
            ("votes", I),
            ("click_count", I),
            ("homepage", V),
        ],
        order_by: "votes DESC",
        poll_secs: 86_400,
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

/// History feeds stored oldest → newest (mirrors `keepNewest` in sourceRegistry.ts).
/// A limited snapshot of these keeps the most recent rows, still in ascending order —
/// otherwise a 400-row Discover probe of US debt or global temperature stops in 1913.
pub const KEEP_NEWEST_KINDS: &[&str] = &["climate", "debt", "usafacts_nation"];

/// Snapshot SQL honoring `limit` for keep-newest history feeds.
pub fn snapshot_sql_limited(kind: &str, limit: u32) -> Option<String> {
    let s = spec_for_kind(kind)?;
    if KEEP_NEWEST_KINDS.contains(&s.kind) && s.order_by.ends_with(" ASC") {
        let desc = format!("{} DESC", s.order_by.trim_end_matches(" ASC"));
        return Some(format!(
            "SELECT * FROM (SELECT * FROM {} ORDER BY {} LIMIT {}) ORDER BY {}",
            s.table, desc, limit, s.order_by
        ));
    }
    snapshot_sql(kind)
}

// ================================================================
// Shared instance per source
// ================================================================

type PollWorker = Option<(u64, tokio::task::JoinHandle<()>)>;

pub struct SourceInstance {
    pub running: Arc<AtomicBool>,
    pub total_events: Arc<AtomicU64>,
    pub started_at: Arc<TokioMutex<Option<i64>>>,
    cancel_token: Arc<TokioMutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    eps_state: Arc<TokioMutex<(u64, std::time::Instant)>>,
    poll_generation: Arc<std::sync::atomic::AtomicU64>,
    poll_worker: Arc<TokioMutex<PollWorker>>,
    last_ok_at: Arc<TokioMutex<Option<i64>>>,
    last_error: Arc<TokioMutex<Option<String>>>,
    consecutive_failures: Arc<std::sync::atomic::AtomicU32>,
    next_poll_at: Arc<TokioMutex<Option<i64>>>,
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
            poll_generation: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            poll_worker: Arc::new(TokioMutex::new(None)),
            last_ok_at: Arc::new(TokioMutex::new(None)),
            last_error: Arc::new(TokioMutex::new(None)),
            consecutive_failures: Arc::new(std::sync::atomic::AtomicU32::new(0)),
            next_poll_at: Arc::new(TokioMutex::new(None)),
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
            last_ok_at: *self.last_ok_at.lock().await,
            last_error: self.last_error.lock().await.clone(),
            consecutive_failures: self.consecutive_failures.load(Ordering::Relaxed),
            next_poll_at: *self.next_poll_at.lock().await,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_ok_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    pub consecutive_failures: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_poll_at: Option<i64>,
}

/// One `SourceInstance` per kind in `SOURCE_SPECS`.
pub struct SourcesState {
    client: reqwest::Client,
    instances: HashMap<&'static str, SourceInstance>,
}

impl Default for SourcesState {
    fn default() -> Self {
        Self::new()
    }
}

impl SourcesState {
    pub fn new() -> Self {
        let client = build_client().expect("source HTTP client");
        Self::new_with_client(client)
    }

    pub fn new_with_client(client: reqwest::Client) -> Self {
        Self {
            client,
            instances: SOURCE_SPECS
                .iter()
                .map(|s| (s.kind, SourceInstance::new()))
                .collect(),
        }
    }

    pub fn get(&self, kind: &str) -> Option<&SourceInstance> {
        self.instances.get(kind)
    }

    pub fn client(&self) -> reqwest::Client {
        self.client.clone()
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
    format!(
        "CREATE TABLE IF NOT EXISTS {} ({})",
        spec.table,
        cols.join(", ")
    )
}

fn existing_columns(conn: &Connection, table: &str) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT column_name, data_type FROM information_schema.columns \
             WHERE table_schema = 'main' AND table_name = ? ORDER BY ordinal_position",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![table], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
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

/// Create every source table at app startup. In-memory DuckDB resets on quit,
/// so drift repair only matters within a session (see DOCS.md — poll sources).
pub fn ensure_tables(db: &LoomDb) -> Result<(), String> {
    let conn = db.lock_connection();
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
    v.pointer(ptr)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

// ---- Writes ----

fn insert_sql_table(table: &str, spec: &SourceSpec) -> String {
    let vals: Vec<String> = spec
        .columns
        .iter()
        .map(|(_, ty)| format!("TRY_CAST(? AS {})", ty))
        .collect();
    format!("INSERT INTO {} VALUES ({})", table, vals.join(", "))
}

fn sql_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn staging_table_sql(staging: &str, spec: &SourceSpec) -> String {
    let cols: Vec<String> = spec
        .columns
        .iter()
        .map(|(name, _)| format!("{} VARCHAR", sql_ident(name)))
        .collect();
    format!("CREATE TABLE {} ({})", sql_ident(staging), cols.join(", "))
}

fn cast_insert_from_staging_sql(table: &str, spec: &SourceSpec, staging: &str) -> String {
    let vals: Vec<String> = spec
        .columns
        .iter()
        .map(|(name, ty)| format!("TRY_CAST({} AS {})", sql_ident(name), ty))
        .collect();
    format!(
        "INSERT INTO {} SELECT {} FROM {}",
        table,
        vals.join(", "),
        sql_ident(staging)
    )
}

fn upsert_key_join(keys: &[&str], left: &str, right: &str) -> String {
    keys.iter()
        .map(|k| format!("{left}.\"{k}\" = {right}.\"{k}\""))
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn in_tx<T>(
    conn: &Connection,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    conn.execute_batch("BEGIN TRANSACTION")
        .map_err(|e| e.to_string())?;
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

fn cell_to_staging_text(cell: &Cell) -> Option<String> {
    match cell {
        Cell::Null => None,
        Cell::Str(s) => Some(s.clone()),
        Cell::F64(f) if f.is_finite() => Some(f.to_string()),
        Cell::F64(_) => None,
        Cell::I64(i) => Some(i.to_string()),
        Cell::Bool(b) => Some(b.to_string()),
    }
}

fn append_rows_to_staging(conn: &Connection, staging: &str, rows: &[Row]) -> Result<(), String> {
    let mut appender = conn.appender(staging).map_err(|e| e.to_string())?;
    for row in rows {
        appender
            .append_row(appender_params_from_iter(
                row.iter().map(cell_to_staging_text),
            ))
            .map_err(|e| e.to_string())?;
    }
    appender.flush().map_err(|e| e.to_string())
}

fn write_replace_or_append_rows(
    conn: &Connection,
    spec: &SourceSpec,
    rows: &[Row],
) -> Result<u64, String> {
    let staging = format!("loom_stage_{}", spec.table);
    conn.execute_batch(&format!("DROP TABLE IF EXISTS {}", sql_ident(&staging)))
        .map_err(|e| e.to_string())?;
    conn.execute_batch(&staging_table_sql(&staging, spec))
        .map_err(|e| e.to_string())?;
    append_rows_to_staging(conn, &staging, rows)?;
    if spec.mode == WriteMode::Replace {
        conn.execute_batch(&format!("DELETE FROM {}", spec.table))
            .map_err(|e| e.to_string())?;
    }
    conn.execute_batch(&cast_insert_from_staging_sql(spec.table, spec, &staging))
        .map_err(|e| e.to_string())?;
    conn.execute_batch(&format!("DROP TABLE {}", sql_ident(&staging)))
        .map_err(|e| e.to_string())?;
    Ok(rows.len() as u64)
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
    db.with_cloned_conn(|conn| {
        in_tx(conn, |conn| {
            let n = match spec.mode {
                WriteMode::Replace | WriteMode::Append => {
                    write_replace_or_append_rows(conn, spec, rows)?
                }
                WriteMode::Upsert(keys) => {
                    let staging = format!("loom_upsert_{}", spec.table);
                    conn.execute_batch(&format!("DROP TABLE IF EXISTS \"{staging}\""))
                        .map_err(|e| e.to_string())?;
                    conn.execute_batch(&format!(
                        "CREATE TEMP TABLE \"{staging}\" AS SELECT * FROM {} WHERE 1=0",
                        spec.table,
                        staging = staging
                    ))
                    .map_err(|e| e.to_string())?;
                    let mut staging_insert = conn
                        .prepare(&insert_sql_table(&staging, spec))
                        .map_err(|e| e.to_string())?;
                    for r in rows {
                        staging_insert
                            .execute(params_from_iter(r.iter()))
                            .map_err(|e| e.to_string())?;
                    }
                    let join = upsert_key_join(keys, "t", "s");
                    let new_keys: i64 = conn
                        .query_row(
                            &format!(
                                "SELECT COUNT(*) FROM \"{staging}\" s \
                             WHERE NOT EXISTS (SELECT 1 FROM {} t WHERE {join})",
                                spec.table,
                                staging = staging,
                                join = join
                            ),
                            params![],
                            |row| row.get(0),
                        )
                        .unwrap_or(0);
                    conn.execute_batch(&format!(
                        "DELETE FROM {} WHERE rowid IN (\
                       SELECT t.rowid FROM {} t INNER JOIN \"{staging}\" s ON {join2}\
                     )",
                        spec.table,
                        spec.table,
                        staging = staging,
                        join2 = upsert_key_join(keys, "t", "s")
                    ))
                    .map_err(|e| e.to_string())?;
                    conn.execute_batch(&format!(
                        "INSERT INTO {} SELECT * FROM \"{staging}\"",
                        spec.table,
                        staging = staging
                    ))
                    .map_err(|e| e.to_string())?;
                    new_keys as u64
                }
            };
            Ok(n)
        })
    })
}

fn trim_table(db: &LoomDb, table: &str) -> Result<(), String> {
    let conn = db.lock_connection();
    let count: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {}", table), params![], |r| {
            r.get(0)
        })
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
            c.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| {
                r.get::<_, i64>(0)
            })
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

/// UK BST: last Sunday of March 01:00 UTC → last Sunday of October 01:00 UTC (+3600).
fn uk_bst_offset_secs_at(utc_secs: i64) -> i64 {
    let (y, _, _) = civil_from_days(utc_secs.div_euclid(86_400));
    let march1 = days_from_civil(y, 3, 1);
    let oct1 = days_from_civil(y, 10, 1);
    let last_sunday = |month1: i64, dim: i64| {
        let last = month1 + dim - 1;
        let wd = (last + 4).rem_euclid(7);
        last - wd
    };
    let start = last_sunday(march1, 31) * 86_400 + 3600; // 01:00 UTC
    let end = last_sunday(oct1, 31) * 86_400 + 3600;
    if utc_secs >= start && utc_secs < end {
        3600
    } else {
        0
    }
}

/// Calendar day `ago` days before today in Europe/London.
fn london_days_ago(ago: i64) -> i64 {
    let now = now_secs();
    let off = uk_bst_offset_secs_at(now);
    (now + off).div_euclid(86_400) - ago
}

/// Prefer day-2 before 14:00 UTC for Wikimedia top pageviews.
fn pageviews_try_offsets() -> [i64; 3] {
    let hour = (now_secs().rem_euclid(86_400)) / 3600;
    if hour < 14 {
        [2, 1, 3]
    } else {
        [1, 2, 3]
    }
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
    parse_iso_with_default_offset(s, 0)
}

/// Like `parse_iso_utc`, but zone-less timestamps use `default_offset_secs`
/// (east of UTC — e.g. America/New_York is −14400 or −18000).
pub(crate) fn parse_iso_with_default_offset(s: &str, default_offset_secs: i64) -> Option<String> {
    let s = s.trim();
    let y = num(s, 0..4)?;
    let m = num(s, 5..7)? as u32;
    let d = num(s, 8..10)? as u32;
    if s.get(4..5)? != "-"
        || s.get(7..8)? != "-"
        || !(1..=12).contains(&m)
        || !(1..=31).contains(&d)
    {
        return None;
    }
    let days = days_from_civil(y, m, d);
    if s.len() == 10 {
        return Some(fmt_ts(days * 86_400 - default_offset_secs));
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
        "" => default_offset_secs,
        "Z" | "z" => 0,
        tz => {
            let sign = match tz.as_bytes().first().copied()? {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let digits: String = tz[1..].chars().filter(|c| *c != ':').collect();
            let oh = num(&digits, 0..2)?;
            let om = if digits.len() >= 4 {
                num(&digits, 2..4)?
            } else {
                0
            };
            sign * (oh * 3600 + om * 60)
        }
    };
    Some(fmt_ts(days * 86_400 + hh * 3600 + mm * 60 + ss - offset))
}

/// US Eastern offset (seconds east of UTC) for a civil local date — second
/// Sunday of March → first Sunday of November is EDT (−4h), else EST (−5h).
fn us_eastern_offset_secs(y: i64, m: u32, d: u32) -> i64 {
    let march = days_from_civil(y, 3, 1);
    let nov = days_from_civil(y, 11, 1);
    // Unix epoch day 0 is Thursday; (days + 4) % 7 == 0 → Sunday.
    let sunday = |month1_days: i64| {
        let wd = (month1_days + 4).rem_euclid(7);
        let first_sun = if wd == 0 { 0 } else { 7 - wd };
        month1_days + first_sun
    };
    let dst_start = sunday(march) + 7; // 2nd Sunday March
    let dst_end = sunday(nov); // 1st Sunday November
    let day = days_from_civil(y, m, d);
    if day >= dst_start && day < dst_end {
        -4 * 3600
    } else {
        -5 * 3600
    }
}

fn jts_nyc(v: Option<&Value>) -> Cell {
    match v.and_then(|x| x.as_str()) {
        Some(s) => {
            let y = num(s, 0..4).unwrap_or(1970);
            let m = num(s, 5..7).unwrap_or(1) as u32;
            let d = num(s, 8..10).unwrap_or(1) as u32;
            let off = us_eastern_offset_secs(y, m, d);
            parse_iso_with_default_offset(s, off)
                .map(Cell::Str)
                .unwrap_or(Cell::Null)
        }
        None => Cell::Null,
    }
}

// ================================================================
// HTTP
// ================================================================

fn build_client() -> Result<reqwest::Client, String> {
    Ok(crate::http_client::build_loom_http()?.client().clone())
}

const MAX_UPSTREAM_BODY: usize = 20 * 1024 * 1024;

async fn response_bytes_limited(res: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    if let Some(len) = res.content_length() {
        if len as usize > max {
            return Err(format!("response too large ({} bytes)", len));
        }
    }
    let bytes = res.bytes().await.map_err(|e| format!("read body: {}", e))?;
    if bytes.len() > max {
        return Err(format!("response too large ({} bytes)", bytes.len()));
    }
    Ok(bytes.to_vec())
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
    let bytes = response_bytes_limited(res, MAX_UPSTREAM_BODY).await?;
    serde_json::from_slice(&bytes).map_err(|e| format!("{}: {}", url, e))
}

async fn get_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("{}: {}", url, e))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("{}: HTTP {}", url, status));
    }
    let bytes = response_bytes_limited(res, MAX_UPSTREAM_BODY).await?;
    String::from_utf8(bytes).map_err(|e| format!("{}: invalid utf-8: {}", url, e))
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
            let id = feat
                .get("id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())?;
            let c = feat.pointer("/geometry/coordinates");
            let coord = |i: usize| jf(c.and_then(|c| c.get(i)));
            let time = p.get("time").and_then(as_i64_loose);
            Some(vec![
                Cell::str(id),
                jf(p.get("mag")),
                js(p.get("place")),
                time.map(|ms| epoch_secs_cell(ms.div_euclid(1000)))
                    .unwrap_or(Cell::Null),
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
    CityDef {
        name: "New York",
        lat: 40.71,
        lon: -74.01,
    },
    CityDef {
        name: "London",
        lat: 51.51,
        lon: -0.13,
    },
    CityDef {
        name: "Tokyo",
        lat: 35.68,
        lon: 139.69,
    },
    CityDef {
        name: "Sydney",
        lat: -33.87,
        lon: 151.21,
    },
    CityDef {
        name: "São Paulo",
        lat: -23.55,
        lon: -46.63,
    },
    CityDef {
        name: "Mumbai",
        lat: 19.08,
        lon: 72.88,
    },
    CityDef {
        name: "Lagos",
        lat: 6.52,
        lon: 3.38,
    },
    CityDef {
        name: "Cairo",
        lat: 30.04,
        lon: 31.24,
    },
    CityDef {
        name: "Mexico City",
        lat: 19.43,
        lon: -99.13,
    },
    CityDef {
        name: "Los Angeles",
        lat: 34.05,
        lon: -118.24,
    },
    CityDef {
        name: "Moscow",
        lat: 55.76,
        lon: 37.62,
    },
    CityDef {
        name: "Beijing",
        lat: 39.90,
        lon: 116.41,
    },
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
        "https://air-quality-api.open-meteo.com/v1/air-quality?{}&current=pm2_5,pm10,ozone,nitrogen_dioxide,european_aqi&timezone=GMT",
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
        let Some(hourly) = loc.get("hourly") else {
            continue;
        };
        let Some(times) = hourly.get("time").and_then(Value::as_array) else {
            continue;
        };
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
        let Some(data) = body.get("data").and_then(Value::as_array) else {
            continue;
        };
        for entry in data {
            let Cell::Str(ts) = jts(entry.get("from")) else {
                continue;
            };
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
                vec![
                    Cell::Str(ts),
                    Cell::I64(year),
                    Cell::I64(month),
                    Cell::F64(anomaly),
                ],
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
    (32.9, -97.0),  // Dallas
    (39.7, -104.9), // Denver
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
    let time = body
        .get("time")
        .and_then(as_i64_loose)
        .unwrap_or_else(now_secs);
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
                // Prefer last_contact (4) then time_position (3) over poll time.
                epoch_secs_cell(
                    a.get(4)
                        .and_then(as_i64_loose)
                        .or_else(|| a.get(3).and_then(as_i64_loose))
                        .unwrap_or(time),
                ),
            ])
        })
        .take(MAX_AIRCRAFT)
        .collect())
}

fn normalize_adsb_body(mut body: Value) -> Value {
    if body.get("ac").is_none() {
        if let Some(aircraft) = body.get("aircraft").cloned() {
            if let Some(obj) = body.as_object_mut() {
                obj.insert("ac".to_string(), aircraft);
            }
        }
    }
    body
}

fn push_adsb_aircraft(ac: &Value, now_secs: i64, seen: &mut HashSet<String>, rows: &mut Vec<Row>) {
    let Some(hex) = ac.get("hex").and_then(Value::as_str) else {
        return;
    };
    let (Some(lat), Some(lon)) = (
        ac.get("lat").and_then(as_f64_loose),
        ac.get("lon").and_then(as_f64_loose),
    ) else {
        return;
    };
    if !seen.insert(hex.to_ascii_lowercase()) {
        return;
    }
    let (alt, on_ground) = match ac.get("alt_baro") {
        Some(Value::String(s)) if s == "ground" => (Cell::F64(0.0), true),
        Some(v) => (
            Cell::opt_f64(as_f64_loose(v).map(|ft| ft * FEET_TO_M)),
            false,
        ),
        None => (Cell::Null, false),
    };
    let seen_secs = ac.get("seen").and_then(as_f64_loose).unwrap_or(0.0);
    let contact = (now_secs as f64 - seen_secs).round() as i64;
    rows.push(vec![
        Cell::str(hex),
        trimmed(ac.get("flight")),
        Cell::Null,
        Cell::F64(lon),
        Cell::F64(lat),
        alt,
        Cell::opt_f64(
            ac.get("gs")
                .and_then(as_f64_loose)
                .map(|kt| kt * KNOTS_TO_MS),
        ),
        jf(ac.get("track")),
        Cell::Bool(on_ground),
        epoch_secs_cell(contact.max(0)),
    ]);
}

/// ADSB `/v2/point` responses → opensky_aircraft rows (round-robin across points;
/// deduped by hex; feet → m, knots → m/s).
pub(crate) fn adsb_rows(bodies: &[Value]) -> Vec<Row> {
    let mut lists: Vec<(i64, Vec<Value>)> = Vec::new();
    for body in bodies {
        let b = normalize_adsb_body(body.clone());
        let now = b
            .get("now")
            .and_then(as_i64_loose)
            .map(|ms| ms.div_euclid(1000))
            .unwrap_or_else(now_secs);
        if let Some(list) = b.get("ac").and_then(Value::as_array) {
            lists.push((now, list.clone()));
        }
    }
    let mut seen = HashSet::new();
    let mut rows = Vec::new();
    let longest = lists.iter().map(|(_, l)| l.len()).max().unwrap_or(0);
    for i in 0..longest {
        for (now, list) in &lists {
            if i < list.len() {
                push_adsb_aircraft(&list[i], *now, &mut seen, &mut rows);
                if rows.len() >= MAX_AIRCRAFT {
                    return rows;
                }
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

pub(crate) fn citibike_rows(
    status: &Value,
    info: &HashMap<String, CitiStation>,
) -> Result<Vec<Row>, String> {
    let stations = status
        .pointer("/data/stations")
        .and_then(Value::as_array)
        .ok_or("GBFS: no station_status")?;
    // Parity contract (LOOM-435) — keep in lockstep with `joinCitibike` in
    // workers/sourceTransforms.ts; shared fixtures: gbfs_parity_*.json.
    let feed_updated = status
        .get("last_updated")
        .and_then(as_i64_loose)
        .filter(|t| *t > 1_000_000_000);
    Ok(stations
        .iter()
        .filter_map(|s| {
            let id = s.get("station_id").and_then(Value::as_str)?;
            let st = info.get(id)?;
            // Decommissioned / not-yet-installed docks are noise on a map.
            if gbfs_flag(s.get("is_installed")) == Some(false) {
                return None;
            }
            // A station without coordinates can't be mapped — dropped like the Worker.
            if matches!(st.lat, Cell::Null) || matches!(st.lon, Cell::Null) {
                return None;
            }
            let bikes = s.get("num_bikes_available").and_then(as_i64_loose);
            let ebikes = s
                .get("num_ebikes_available")
                .and_then(as_i64_loose)
                .or_else(|| {
                    let ebike_types: Vec<&Value> = s
                        .get("vehicle_types_available")
                        .and_then(Value::as_array)
                        .map(|a| {
                            a.iter()
                                .filter(|v| {
                                    is_ebike_vehicle_type(
                                        v.get("vehicle_type_id")
                                            .and_then(Value::as_str)
                                            .unwrap_or(""),
                                    )
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    if ebike_types.is_empty() {
                        None
                    } else {
                        Some(
                            ebike_types
                                .iter()
                                .map(|v| v.get("count").and_then(as_i64_loose).unwrap_or(0))
                                .sum(),
                        )
                    }
                });
            let pct_full = match (bikes, st.capacity) {
                (Some(b), Some(c)) if c > 0 => {
                    Cell::F64(((b as f64 / c as f64 * 1000.0).round() / 10.0).min(100.0))
                }
                _ => Cell::Null,
            };
            let reported = s
                .get("last_reported")
                .and_then(as_i64_loose)
                .filter(|t| *t > 1_000_000_000)
                .or(feed_updated);
            Some(vec![
                Cell::str(id),
                st.name.clone(),
                st.lat.clone(),
                st.lon.clone(),
                Cell::opt_i64(st.capacity),
                Cell::opt_i64(bikes),
                Cell::opt_i64(ebikes),
                ji(s.get("num_docks_available")),
                pct_full,
                Cell::Bool(gbfs_flag(s.get("is_renting")) == Some(true)),
                reported.map(epoch_secs_cell).unwrap_or(Cell::Null),
            ])
        })
        .collect())
}

/// GBFS booleans arrive as 0/1 or true/false; anything else is unknown.
fn gbfs_flag(v: Option<&Value>) -> Option<bool> {
    match v? {
        Value::Bool(b) => Some(*b),
        Value::Number(n) => n.as_f64().map(|f| f != 0.0),
        Value::String(s) => match s.trim() {
            "1" | "true" => Some(true),
            "0" | "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

/// Mirrors `isEbikeVehicleType` in workers/sourceTransforms.ts.
pub(crate) fn is_ebike_vehicle_type(id: &str) -> bool {
    let l = id.to_ascii_lowercase();
    l == "e" || l.contains("ebike") || l.contains("e-bike") || l.contains("electric")
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
                jts_nyc(r.get("created_date")),
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
const SPACEX_URL: &str =
    "https://ll.thespacedevs.com/2.2.0/launch/previous/?lsp__name=SpaceX&limit=100";

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
            let agency =
                str_of(r, "/lsp_name").or_else(|| str_of(r, "/launch_service_provider/name"));
            let status = str_of(r, "/status/name").or_else(|| str_of(r, "/status/abbrev"));
            let orbit = str_of(r, "/orbit")
                .or_else(|| str_of(r, "/mission/orbit/name"))
                .or_else(|| str_of(r, "/mission_type"))
                .or_else(|| str_of(r, "/mission/type"));
            let orbital = orbit
                .map(|o| !o.to_lowercase().contains("suborbital"))
                .unwrap_or(false);
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
                ji(r.get("flight_number")
                    .or_else(|| r.get("agency_launch_attempt_count"))),
                details,
            ]
        })
        .collect())
}

// ---- NOAA SWPC planetary K-index ----

const KP_URL: &str = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";

/// NOAA G-scale from Kp: G0 < 5, G1 5, G2 6, G3 7, G4 8, G5 ≥ 9.
/// Kp comes in thirds and rounds first (4.67 = "5-" counts as Kp 5), matching
/// sourceParsers.ts stormLevel; tests/fixtures/sources/storm_levels.json pins both.
pub(crate) fn storm_level(kp: f64) -> &'static str {
    const LEVELS: [&str; 4] = ["G1", "G2", "G3", "G4"];
    let k = kp.round() as i64;
    if k >= 9 {
        "G5"
    } else if k >= 5 {
        LEVELS[(k - 5) as usize]
    } else {
        "G0"
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
    let hits = body
        .get("hits")
        .and_then(Value::as_array)
        .ok_or("HN: no hits")?;
    Ok(hits
        .iter()
        .map(|h| {
            vec![
                js(h.get("objectID")),
                js(h.get("title")
                    .filter(|v| !v.is_null())
                    .or_else(|| h.get("story_title"))),
                js(h.get("author")),
                ji(h.get("points")),
                ji(h.get("num_comments")),
                js(h.get("url")),
                jts(h.get("created_at")),
            ]
        })
        .collect())
}

// ---- Lobsters hottest ----

const LOBSTERS_URL: &str = "https://lobste.rs/hottest.json";

pub(crate) fn lobsters_rows(body: &Value) -> Result<Vec<Row>, String> {
    let hits = body.as_array().ok_or("Lobsters: expected array")?;
    Ok(hits
        .iter()
        .map(|h| {
            let author = h
                .get("submitter_user")
                .and_then(|u| {
                    if let Some(s) = u.as_str() {
                        Some(s.to_string())
                    } else {
                        u.get("username")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    }
                })
                .unwrap_or_default();
            let tags = h
                .get("tags")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .unwrap_or_default();
            vec![
                js(h.get("short_id")),
                js(h.get("title")),
                Cell::Str(author),
                ji(h.get("score")),
                ji(h.get("comment_count")),
                js(h.get("url")),
                Cell::Str(tags),
                jts(h.get("created_at")),
            ]
        })
        .collect())
}

// ---- NASA FIRMS VIIRS CSV ----

const FIRMS_URL: &str = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv";

pub(crate) fn firms_rows(text: &str) -> Result<Vec<Row>, String> {
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    let header = lines.next().ok_or("FIRMS: empty CSV")?;
    let names: Vec<&str> = header.split(',').map(str::trim).collect();
    let at = |n: &str| names.iter().position(|h| h.eq_ignore_ascii_case(n));
    let lat_i = at("latitude").ok_or("FIRMS: no latitude")?;
    let lon_i = at("longitude").ok_or("FIRMS: no longitude")?;
    let b4 = at("bright_ti4");
    let b5 = at("bright_ti5");
    let frp = at("frp");
    let conf = at("confidence");
    let sat = at("satellite");
    let date_i = at("acq_date");
    let time_i = at("acq_time");
    let dn = at("daynight");
    let num = |parts: &[&str], i: Option<usize>| {
        i.and_then(|i| parts.get(i))
            .and_then(|v| v.parse::<f64>().ok())
    };
    let rows: Vec<Row> = lines
        .filter_map(|line| {
            let parts: Vec<&str> = line.split(',').collect();
            let lat = num(&parts, Some(lat_i))?;
            let lon = num(&parts, Some(lon_i))?;
            let date = date_i.and_then(|i| parts.get(i)).copied().unwrap_or("");
            let time_raw = time_i
                .and_then(|i| parts.get(i))
                .map(|t| format!("{:0>4}", t.trim()))
                .unwrap_or_default();
            let acq_ts = if date.len() == 10 && time_raw.len() == 4 {
                let raw = format!("{}T{}:{}:00Z", date, &time_raw[..2], &time_raw[2..]);
                parse_iso_utc(&raw).map(Cell::Str).unwrap_or(Cell::Null)
            } else {
                Cell::Null
            };
            let id = format!("{:.4}_{:.4}_{}_{}", lat, lon, date, time_raw);
            let s_at = |i: Option<usize>| {
                i.and_then(|i| parts.get(i))
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(Cell::str)
                    .unwrap_or(Cell::Null)
            };
            Some(vec![
                Cell::Str(id),
                Cell::F64(lat),
                Cell::F64(lon),
                Cell::opt_f64(num(&parts, b4)),
                Cell::opt_f64(num(&parts, b5)),
                Cell::opt_f64(num(&parts, frp)),
                s_at(conf),
                s_at(sat),
                acq_ts,
                s_at(dn),
            ])
        })
        .collect();
    if rows.is_empty() {
        return Err("FIRMS: no hotspots".into());
    }
    Ok(rows)
}

// ---- USGS NWIS river gauges ----

fn nwis_url() -> String {
    let sites = "01646500,05420500,06934500,07374000,09380000,11427100,14211720,05587455";
    format!(
        "https://waterservices.usgs.gov/nwis/iv/?format=json&sites={}&parameterCd=00060,00065&period=P2D",
        sites
    )
}

pub(crate) fn nwis_rows(body: &Value) -> Result<Vec<Row>, String> {
    use std::collections::BTreeMap;
    struct Acc {
        site_name: String,
        lat: Option<f64>,
        lon: Option<f64>,
        by_ts: BTreeMap<String, (Option<f64>, Option<f64>)>,
    }
    let series = body
        .pointer("/value/timeSeries")
        .and_then(Value::as_array)
        .ok_or("NWIS: no timeSeries")?;
    let mut sites: HashMap<String, Acc> = HashMap::new();
    for s in series {
        let info = s.get("sourceInfo").unwrap_or(&Value::Null);
        let site_id = info
            .pointer("/siteCode/0/value")
            .and_then(Value::as_str)
            .or_else(|| info.get("siteCode").and_then(Value::as_str))
            .unwrap_or("")
            .to_string();
        if site_id.is_empty() {
            continue;
        }
        let site_name = info
            .get("siteName")
            .and_then(Value::as_str)
            .unwrap_or(&site_id)
            .to_string();
        let lat = info
            .pointer("/geoLocation/geogLocation/latitude")
            .and_then(Value::as_f64);
        let lon = info
            .pointer("/geoLocation/geogLocation/longitude")
            .and_then(Value::as_f64);
        let var_code = s
            .pointer("/variable/variableCode/0/value")
            .and_then(Value::as_str)
            .unwrap_or("");
        let values = s
            .pointer("/values/0/value")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let acc = sites.entry(site_id).or_insert_with(|| Acc {
            site_name: site_name.clone(),
            lat,
            lon,
            by_ts: BTreeMap::new(),
        });
        for v in values {
            let ts = v
                .get("dateTime")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if ts.is_empty() {
                continue;
            }
            // USGS publishes missing readings as -999999 (LOOM-498) — never a measurement.
            let n = v
                .get("value")
                .and_then(|x| {
                    x.as_str()
                        .map(str::trim)
                        .and_then(|s| s.parse::<f64>().ok())
                        .or_else(|| x.as_f64())
                })
                .filter(|n| n.is_finite() && *n > -999_998.0);
            let cell = acc.by_ts.entry(ts).or_insert((None, None));
            if var_code == "00060" {
                cell.0 = n;
            } else if var_code == "00065" {
                cell.1 = n;
            }
        }
    }
    let mut rows = Vec::new();
    for (site_id, acc) in sites {
        for (ts, (q, h)) in acc.by_ts {
            if q.is_none() && h.is_none() {
                continue;
            }
            // Unparseable timestamps are dropped (matches the Worker transform).
            let Some(ts_norm) = parse_iso_utc(&ts).map(Cell::Str) else {
                continue;
            };
            rows.push(vec![
                Cell::Str(site_id.clone()),
                Cell::Str(acc.site_name.clone()),
                ts_norm,
                Cell::opt_f64(acc.lat),
                Cell::opt_f64(acc.lon),
                Cell::opt_f64(q),
                Cell::opt_f64(h),
            ]);
        }
    }
    if rows.is_empty() {
        return Err("NWIS: no gauge readings".into());
    }
    rows.sort_by(|a, b| match (&a[2], &b[2]) {
        (Cell::Str(x), Cell::Str(y)) => y.cmp(x),
        _ => std::cmp::Ordering::Equal,
    });
    Ok(rows)
}

// ---- CelesTrak Starlink ----

const STARLINK_URL: &str = "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json";
const STARLINK_CAP: usize = 2500;

/// Match Worker `/\bDEB\b/i` — whole token "DEB", not substring.
pub(crate) fn is_starlink_debris_name(name: &str) -> bool {
    name.split(|c: char| !c.is_ascii_alphanumeric())
        .any(|w| w.eq_ignore_ascii_case("DEB"))
}

pub(crate) fn starlink_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body.as_array().ok_or("Starlink: expected array")?;
    let mut rows = Vec::new();
    for item in list {
        if rows.len() >= STARLINK_CAP {
            break;
        }
        let id = item.get("NORAD_CAT_ID").and_then(as_i64_loose);
        let Some(id) = id else { continue };
        let name = item
            .get("OBJECT_NAME")
            .and_then(Value::as_str)
            .unwrap_or("");
        if is_starlink_debris_name(name) {
            continue;
        }
        rows.push(vec![
            Cell::I64(id),
            js(item.get("OBJECT_NAME")),
            js(item.get("OBJECT_ID")),
            jts(item.get("EPOCH")),
            jf(item.get("INCLINATION")),
            jf(item.get("ECCENTRICITY")),
            jf(item.get("MEAN_MOTION")),
            jf(item.get("RA_OF_ASC_NODE")),
            jf(item.get("ARG_OF_PERICENTER")),
            jf(item.get("MEAN_ANOMALY")),
            jf(item.get("BSTAR")),
        ]);
    }
    if rows.is_empty() {
        return Err("Starlink: no satellites".into());
    }
    Ok(rows)
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
    // Same host + /v1 path as the Worker (LOOM-436); the legacy .app host only redirects here.
    format!("https://api.frankfurter.dev/v1/{}..", fmt_date(today - 90))
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
        let Some(day) = rates.get(date).and_then(Value::as_object) else {
            continue;
        };
        let mut quotes: Vec<(&String, &Value)> = day.iter().collect();
        quotes.sort_by(|a, b| a.0.cmp(b.0));
        for (quote, v) in quotes {
            let Some(rate) = as_f64_loose(v) else {
                continue;
            };
            let change = prev
                .get(quote.as_str())
                .filter(|p| **p != 0.0)
                // Same 4-decimal rounding as the web parser (`parseFx`).
                .map(|p| ((rate - p) / p * 100.0 * 10_000.0).round() / 10_000.0);
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

const COUNTRIES_URL: &str =
    "https://raw.githubusercontent.com/mledoze/countries/master/countries.json";
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

pub(crate) fn countries_rows(
    body: &Value,
    population: &HashMap<String, f64>,
) -> Result<Vec<Row>, String> {
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

fn wb_year_range() -> String {
    let (year, _, _) = civil_from_days(today_days());
    format!("2000:{}", (year - 1).max(2000))
}

fn wb_indicator_url(id: &str) -> String {
    format!(
        "https://api.worldbank.org/v2/country/all/indicator/{}?format=json&per_page=20000&date={}",
        id,
        wb_year_range()
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
pub(crate) fn wb_wide_rows(
    countries: &HashMap<String, String>,
    series: &[(usize, Value)],
) -> Vec<Row> {
    let mut grid: BTreeMap<(String, i64), [Option<f64>; 5]> = BTreeMap::new();
    for (col, body) in series {
        let Some(list) = body.get(1).and_then(Value::as_array) else {
            continue;
        };
        for e in list {
            let Some(code) = e.get("countryiso3code").and_then(Value::as_str) else {
                continue;
            };
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
            let name = countries
                .get(&code)
                .cloned()
                .map(Cell::Str)
                .unwrap_or(Cell::Null);
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

// ---- GDACS disaster alerts ----

const GDACS_URL: &str = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;WF;DR&alertlevel=Green;Orange;Red";

pub(crate) fn gdacs_event_type(code: &str) -> &str {
    match code {
        "EQ" => "Earthquake",
        "TC" => "Tropical cyclone",
        "FL" => "Flood",
        "VO" => "Volcano",
        "WF" => "Wildfire",
        "DR" => "Drought",
        other => other,
    }
}

/// Point geometry, else the feature bbox centre, else the geometry centroid.
fn gdacs_lat_lon(feat: &Value) -> Option<(f64, f64)> {
    let g = feat.get("geometry");
    if let Some(g) = g.filter(|g| g.get("type").and_then(Value::as_str) == Some("Point")) {
        if let Some(p) = g.get("coordinates").and_then(point_of) {
            return Some(p);
        }
    }
    if let Some(b) = feat
        .get("bbox")
        .and_then(Value::as_array)
        .filter(|b| b.len() >= 4)
    {
        let n: Vec<f64> = b.iter().take(4).filter_map(as_f64_loose).collect();
        if n.len() == 4 {
            return Some(((n[1] + n[3]) / 2.0, (n[0] + n[2]) / 2.0));
        }
    }
    g.and_then(geometry_lat_lon)
}

/// One row per event (`eventtype` + `eventid`); when an event appears more
/// than once (several episodes), the latest (`todate`, then `episodeid`) wins.
pub(crate) fn gdacs_rows(body: &Value) -> Result<Vec<Row>, String> {
    let features = body
        .get("features")
        .and_then(Value::as_array)
        .ok_or("GDACS: no features")?;
    let mut order: Vec<String> = Vec::new();
    let mut best: HashMap<String, ((Option<String>, i64), Row)> = HashMap::new();
    for feat in features {
        let Some(p) = feat.get("properties") else {
            continue;
        };
        let Some(code) = str_of(p, "/eventtype") else {
            continue;
        };
        let Cell::Str(eid) = id_string(p.get("eventid")) else {
            continue;
        };
        let id = format!("{}{}", code, eid);
        let (lat, lon) = match gdacs_lat_lon(feat) {
            Some((lat, lon)) => (Cell::F64(lat), Cell::F64(lon)),
            None => (Cell::Null, Cell::Null),
        };
        let title = str_of(p, "/name")
            .or_else(|| str_of(p, "/description"))
            .map(Cell::str)
            .unwrap_or(Cell::Null);
        let rank = (
            p.get("todate")
                .and_then(Value::as_str)
                .and_then(parse_iso_utc),
            p.get("episodeid").and_then(as_i64_loose).unwrap_or(0),
        );
        let row = vec![
            Cell::str(id.as_str()),
            Cell::str(gdacs_event_type(code)),
            title,
            js(p.get("alertlevel")),
            jf(p.get("alertscore")),
            js(p.get("country")),
            lat,
            lon,
            jts(p.get("fromdate")),
            jts(p.get("todate")),
            jf(p.pointer("/severitydata/severity")),
            js(p.pointer("/severitydata/severityunit")),
        ];
        match best.get(&id) {
            Some((r, _)) if *r > rank => {}
            Some(_) => {
                best.insert(id, (rank, row));
            }
            None => {
                order.push(id.clone());
                best.insert(id, (rank, row));
            }
        }
    }
    Ok(order
        .into_iter()
        .filter_map(|id| best.remove(&id).map(|(_, row)| row))
        .collect())
}

// ---- NOAA NDBC buoys (latest observation per station, fixed-width text) ----

const BUOYS_URL: &str = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt";

const BUOYS_DEFAULT_HEADER: &[&str] = &[
    "STN", "LAT", "LON", "YYYY", "MM", "DD", "hh", "mm", "WDIR", "WSPD", "GST", "WVHT", "DPD",
    "APD", "MWD", "PRES", "PTDY", "ATMP", "WTMP", "DEWP", "VIS", "TIDE",
];

/// `latest_obs.txt` → one row per station. Columns are located by the first
/// `#` header line (falls back to the documented layout); "MM" → NULL.
pub(crate) fn buoys_rows(text: &str) -> Result<Vec<Row>, String> {
    let header: Vec<String> = text
        .lines()
        .find(|l| l.starts_with('#'))
        .map(|l| {
            l.trim_start_matches('#')
                .split_whitespace()
                .map(str::to_string)
                .collect()
        })
        .filter(|h: &Vec<String>| h.iter().any(|c| c == "WVHT"))
        .unwrap_or_else(|| BUOYS_DEFAULT_HEADER.iter().map(|s| s.to_string()).collect());
    let col = |name: &str| header.iter().position(|h| h == name);
    let (stn, lat, lon) = (col("STN"), col("LAT"), col("LON"));
    let date_cols = [col("YYYY"), col("MM"), col("DD"), col("hh"), col("mm")];
    let fields = ["WDIR", "WSPD", "GST", "WVHT", "DPD", "PRES", "ATMP", "WTMP"].map(col);
    let rows: Vec<Row> = text
        .lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            let get =
                |i: Option<usize>| i.and_then(|i| parts.get(i)).copied().filter(|v| *v != "MM");
            let num = |i: Option<usize>| get(i).and_then(|v| v.parse::<f64>().ok());
            let station = get(stn)?;
            let (la, lo) = (num(lat)?, num(lon)?);
            let d: Vec<i64> = date_cols
                .iter()
                .filter_map(|&i| get(i)?.parse().ok())
                .collect();
            let ts = if d.len() == 5 {
                Cell::Str(format!(
                    "{:04}-{:02}-{:02} {:02}:{:02}:00",
                    d[0], d[1], d[2], d[3], d[4]
                ))
            } else {
                Cell::Null
            };
            let mut row = vec![Cell::str(station), Cell::F64(la), Cell::F64(lo), ts];
            row.extend(fields.iter().map(|&i| Cell::opt_f64(num(i))));
            Some(row)
        })
        .collect();
    if rows.is_empty() {
        return Err("NDBC: no observations".into());
    }
    Ok(rows)
}

// ---- MBTA vehicles (JSON:API) ----

const MBTA_URL: &str = "https://api-v3.mbta.com/vehicles?include=route&page[limit]=1000";

const MS_TO_MPH: f64 = 3600.0 / 1609.344;

fn mbta_route_type(t: i64) -> Option<&'static str> {
    Some(match t {
        0 => "Light rail",
        1 => "Subway",
        2 => "Commuter rail",
        3 => "Bus",
        4 => "Ferry",
        _ => return None,
    })
}

/// "IN_TRANSIT_TO" → "In transit to"; empty / missing → NULL.
pub(crate) fn humanize_enum(v: Option<&Value>) -> Cell {
    let Some(s) = v.and_then(Value::as_str).filter(|s| !s.is_empty()) else {
        return Cell::Null;
    };
    let lower = s.replace('_', " ").to_lowercase();
    let mut chars = lower.chars();
    match chars.next() {
        Some(c) => Cell::Str(c.to_uppercase().chain(chars).collect()),
        None => Cell::Null,
    }
}

pub(crate) fn mbta_rows(body: &Value) -> Result<Vec<Row>, String> {
    let data = body
        .get("data")
        .and_then(Value::as_array)
        .ok_or("MBTA: no data")?;
    let routes: HashMap<&str, (Cell, Cell)> = body
        .get("included")
        .and_then(Value::as_array)
        .map(|inc| {
            inc.iter()
                .filter(|r| r.get("type").and_then(Value::as_str) == Some("route"))
                .filter_map(|r| {
                    let id = r.get("id").and_then(Value::as_str)?;
                    let name = str_of(r, "/attributes/short_name")
                        .or_else(|| str_of(r, "/attributes/long_name"))
                        .unwrap_or(id);
                    let ty = r
                        .pointer("/attributes/type")
                        .and_then(as_i64_loose)
                        .and_then(mbta_route_type)
                        .map(Cell::str)
                        .unwrap_or(Cell::Null);
                    Some((id, (Cell::str(name), ty)))
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(data
        .iter()
        .filter_map(|v| {
            let id = v.get("id").and_then(Value::as_str)?;
            let a = v.get("attributes")?;
            let route_id = str_of(v, "/relationships/route/data/id");
            let (route, route_type) = match route_id {
                Some(rid) => routes
                    .get(rid)
                    .cloned()
                    .unwrap_or_else(|| (Cell::str(rid), Cell::Null)),
                None => (Cell::Null, Cell::Null),
            };
            Some(vec![
                Cell::str(id),
                js(a.get("label")),
                route,
                route_type,
                jf(a.get("latitude")),
                jf(a.get("longitude")),
                jf(a.get("bearing")),
                Cell::opt_f64(
                    a.get("speed")
                        .and_then(as_f64_loose)
                        .map(|ms| ms * MS_TO_MPH),
                ),
                humanize_enum(a.get("current_status")),
                humanize_enum(a.get("occupancy_status")),
                jts(a.get("updated_at")),
            ])
        })
        .collect())
}

// ---- NOAA SWPC OVATION aurora ----

const AURORA_URL: &str = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
/// Cells below this probability (%) are dropped.
const AURORA_MIN_PROB: i64 = 3;

/// 1° `[lon 0–359, lat, prob]` grid → 2° cells (max probability; cell keyed by
/// its even south-west corner), prob < 3 dropped, longitude → −180…180.
pub(crate) fn aurora_rows(body: &Value) -> Result<Vec<Row>, String> {
    let coords = body
        .get("coordinates")
        .and_then(Value::as_array)
        .ok_or("OVATION: no coordinates")?;
    let ts = jts(body.get("Forecast Time"));
    let mut cells: BTreeMap<(i64, i64), i64> = BTreeMap::new();
    for c in coords {
        let (Some(lon), Some(lat), Some(p)) = (
            c.get(0).and_then(as_f64_loose),
            c.get(1).and_then(as_f64_loose),
            c.get(2).and_then(as_f64_loose),
        ) else {
            continue;
        };
        let key = (
            (lon.floor() as i64).div_euclid(2) * 2,
            (lat.floor() as i64).div_euclid(2) * 2,
        );
        let p = p.round() as i64;
        let e = cells.entry(key).or_insert(p);
        *e = (*e).max(p);
    }
    Ok(cells
        .into_iter()
        .filter(|(_, p)| *p >= AURORA_MIN_PROB)
        .map(|((lon, lat), p)| {
            let lon = if lon > 180 { lon - 360 } else { lon };
            vec![
                Cell::F64(lon as f64),
                Cell::F64(lat as f64),
                Cell::I64(p),
                ts.clone(),
            ]
        })
        .collect())
}

// ---- NASA JPL close approaches ----

const ASTEROIDS_URL: &str =
    "https://ssd-api.jpl.nasa.gov/cad.api?date-min=now&date-max=%2B60&dist-max=0.05&fullname=true";
const AU_TO_LD: f64 = 389.17;
const AU_TO_KM: f64 = 149_597_870.7;
/// Assumed geometric albedo for the H → diameter estimate.
const ASTEROID_ALBEDO: f64 = 0.14;

/// "2026-Oct-05 13:42" (UTC) → "2026-10-05 13:42:00".
pub(crate) fn parse_cad_date(s: &str) -> Option<String> {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let s = s.trim();
    let y = num(s, 0..4)?;
    let m = MONTHS.iter().position(|m| Some(*m) == s.get(5..8))? + 1;
    let d = num(s, 9..11)?;
    if s.get(4..5)? != "-" || s.get(8..9)? != "-" {
        return None;
    }
    let (hh, mm) = match s.get(11..) {
        Some(t) if !t.trim().is_empty() => {
            let t = t.trim();
            (num(t, 0..2)?, num(t, 3..5)?)
        }
        _ => (0, 0),
    };
    Some(format!("{:04}-{:02}-{:02} {:02}:{:02}:00", y, m, d, hh, mm))
}

/// Estimated diameter (m) from absolute magnitude H at albedo 0.14.
pub(crate) fn asteroid_diameter_m(h: f64) -> f64 {
    1329.0 / ASTEROID_ALBEDO.sqrt() * 10f64.powf(-h / 5.0) * 1000.0
}

pub(crate) fn asteroids_rows(body: &Value) -> Result<Vec<Row>, String> {
    let fields: Vec<&str> = body
        .get("fields")
        .and_then(Value::as_array)
        .ok_or("CAD: no fields")?
        .iter()
        .map(|f| f.as_str().unwrap_or(""))
        .collect();
    // No close approaches in the window → the API omits `data`.
    let Some(data) = body.get("data").and_then(Value::as_array) else {
        return Ok(vec![]);
    };
    let idx = |k: &str| fields.iter().position(|f| *f == k);
    let (des, full, cd, dist, v_rel, h) = (
        idx("des"),
        idx("fullname"),
        idx("cd"),
        idx("dist"),
        idx("v_rel"),
        idx("h"),
    );
    Ok(data
        .iter()
        .filter_map(|r| {
            let at = |i: Option<usize>| i.and_then(|i| r.get(i));
            let au = at(dist).and_then(as_f64_loose);
            let hmag = at(h).and_then(as_f64_loose);
            Some(vec![
                js(Some(at(des)?)),
                trimmed(at(full)),
                at(cd)
                    .and_then(Value::as_str)
                    .and_then(parse_cad_date)
                    .map(Cell::Str)
                    .unwrap_or(Cell::Null),
                Cell::opt_f64(au.map(|a| a * AU_TO_LD)),
                Cell::opt_f64(au.map(|a| a * AU_TO_KM)),
                jf(at(v_rel)),
                Cell::opt_f64(hmag),
                Cell::opt_f64(hmag.map(asteroid_diameter_m)),
            ])
        })
        .collect())
}

// ---- SteamSpy top 100 (two weeks) ----

const STEAM_URL: &str = "https://steamspy.com/api.php?request=top100in2weeks";

/// "50,000,000 .. 100,000,000" → 50000000.
pub(crate) fn owners_lower_bound(s: &str) -> Option<i64> {
    let lo: String = s
        .split("..")
        .next()?
        .chars()
        .filter(char::is_ascii_digit)
        .collect();
    lo.parse().ok()
}

pub(crate) fn steam_rows(body: &Value) -> Result<Vec<Row>, String> {
    let games = body.as_object().ok_or("SteamSpy: expected object")?;
    Ok(games
        .iter()
        .map(|(key, g)| {
            let pos = g.get("positive").and_then(as_i64_loose);
            let neg = g.get("negative").and_then(as_i64_loose);
            let pct = match (pos, neg) {
                (Some(p), Some(n)) if p + n > 0 => Some(p as f64 / (p + n) as f64 * 100.0),
                _ => None,
            };
            let appid = match id_string(g.get("appid")) {
                Cell::Null => Cell::str(key.as_str()),
                c => c,
            };
            vec![
                appid,
                js(g.get("name")),
                js(g.get("developer")),
                ji(g.get("ccu")),
                Cell::opt_i64(pos),
                Cell::opt_i64(neg),
                Cell::opt_f64(pct),
                Cell::opt_i64(
                    g.get("owners")
                        .and_then(Value::as_str)
                        .and_then(owners_lower_bound),
                ),
                Cell::opt_f64(g.get("price").and_then(as_f64_loose).map(|c| c / 100.0)),
                // average_2weeks is 0 for every top-100 game; the discount varies
                Cell::opt_f64(g.get("discount").and_then(as_f64_loose)),
            ]
        })
        .collect())
}

// ---- Bitcoin blocks (mempool.space) ----

const MEMPOOL_BLOCKS_URL: &str = "https://mempool.space/api/v1/blocks";
/// Extra pages of 15 blocks fetched after the tip page (~60 blocks total).
const MEMPOOL_EXTRA_PAGES: usize = 3;
const SATS_PER_BTC: f64 = 1e8;

/// Block pages (`/api/v1/blocks[/{height}]`) → one row per height (deduped).
pub(crate) fn bitcoin_rows(pages: &[Value]) -> Result<Vec<Row>, String> {
    let mut seen = HashSet::new();
    let mut rows = Vec::new();
    for page in pages {
        let Some(list) = page.as_array() else {
            continue;
        };
        for b in list {
            let Some(height) = b.get("height").and_then(as_i64_loose) else {
                continue;
            };
            if !seen.insert(height) {
                continue;
            }
            let ex = |k: &str| {
                b.get("extras")
                    .and_then(|e| e.get(k))
                    .and_then(as_f64_loose)
            };
            rows.push(vec![
                Cell::I64(height),
                b.get("timestamp")
                    .and_then(as_i64_loose)
                    .map(epoch_secs_cell)
                    .unwrap_or(Cell::Null),
                ji(b.get("tx_count")),
                Cell::opt_f64(b.get("size").and_then(as_f64_loose).map(|s| s / 1e6)),
                Cell::opt_f64(ex("medianFee")),
                Cell::opt_f64(ex("totalFees").map(|s| s / SATS_PER_BTC)),
                Cell::opt_f64(ex("reward").map(|s| s / SATS_PER_BTC)),
                js(b.pointer("/extras/pool/name")),
            ]);
        }
    }
    if rows.is_empty() {
        return Err("mempool.space: no blocks".into());
    }
    Ok(rows)
}

/// Lowest height on a page (the next page starts one below it).
pub(crate) fn min_block_height(page: &Value) -> Option<i64> {
    page.as_array()?
        .iter()
        .filter_map(|b| b.get("height").and_then(as_i64_loose))
        .min()
}

// ---- US Treasury debt to the penny ----

const DEBT_URL: &str = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=10000";

/// Amounts arrive as strings ("null" when missing → NULL).
pub(crate) fn debt_rows(body: &Value) -> Result<Vec<Row>, String> {
    let data = body
        .get("data")
        .and_then(Value::as_array)
        .ok_or("Treasury: no data")?;
    Ok(data
        .iter()
        .filter(|r| str_of(r, "/record_date").is_some())
        .map(|r| {
            vec![
                js(r.get("record_date")),
                jf(r.get("tot_pub_debt_out_amt")),
                jf(r.get("debt_held_public_amt")),
                jf(r.get("intragov_hold_amt")),
            ]
        })
        .collect())
}

// ================================================================
// Fetch + poll
// ================================================================

// ---- 2026-10 keyless batch: upstream URLs (parsers in sources_extra.rs) ----

#[path = "sources_extra.rs"]
mod extra;
use extra::*;

const FIREBALLS_URL: &str = "https://ssd-api.jpl.nasa.gov/fireball.api";
const SATELLITES_URL: &str = "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json";
const IODA_ALERTS_URL: &str = "https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts";
const FAA_STATUS_URL: &str = "https://nasstatus.faa.gov/api/airport-status-information";
/// lda.senate.gov now redirects here.
/// Anonymous pages cap at 25 rows — the newest `LDA_PAGES` pages.
const LDA_FILINGS_URL: &str = "https://lda.gov/api/v1/filings/?ordering=-dt_posted&page_size=25";
const LDA_PAGES: usize = 4;
const FDA_CATEGORIES: [&str; 3] = ["food", "drug", "device"];
fn fda_url(category: &str) -> String {
    format!(
        "https://api.fda.gov/{}/enforcement.json?limit=100&sort=report_date:desc",
        category
    )
}
const NHTSA_RECALLS_URL: &str =
    "https://data.transportation.gov/resource/6axg-epim.json?$limit=400&$order=report_received_date%20DESC";
/// One query per field (mirrors ARXIV_QUERIES); arXiv asks for ~1 request at a time.
const ARXIV_QUERIES: [&str; 5] = [
    "cat:cs.AI",
    "cat:cs.LG",
    "cat:astro-ph*",
    "cat:q-bio*",
    "cat:econ*",
];
const ARXIV_PER_QUERY: usize = 60;
fn arxiv_url(q: &str) -> String {
    format!(
        "https://export.arxiv.org/api/query?search_query={}&sortBy=submittedDate&sortOrder=descending&max_results={}",
        q.replace(':', "%3A").replace('*', "%2A"),
        ARXIV_PER_QUERY
    )
}
const GITHUB_EVENTS_URL: &str = "https://api.github.com/events?per_page=100";
const OPEN_LIBRARY_TRENDING_URL: &str = "https://openlibrary.org/trending/daily.json?limit=50";
const GUTENDEX_POPULAR_URL: &str = "https://gutendex.com/books/?sort=popular";
const NYC_INSPECTIONS_URL: &str = "https://data.cityofnewyork.us/resource/43nn-pn8j.json?$limit=1000&$order=inspection_date%20DESC&$where=inspection_date%3E%272001-01-01%27";
const CHICAGO_CRIME_URL: &str =
    "https://data.cityofchicago.org/resource/ijzp-q8t2.json?$limit=1000&$order=date%20DESC";
/// `$select` leaves the plate column out entirely.
/// issue_date is text upstream with typos like "2097-12-11" — capped at tomorrow.
fn nyc_parking_url(today: i64) -> String {
    format!(
        "https://data.cityofnewyork.us/resource/nc67-uf89.json?$limit=1000&$order=issue_date%20DESC&$select=summons_number,issue_date,violation_time,violation,fine_amount,penalty_amount,amount_due,county,state,issuing_agency,precinct&$where=issue_date%20between%20%272000-01-01%27%20and%20%27{}%27",
        fmt_date(today + 1)
    )
}
const POWERBALL_URL: &str =
    "https://data.ny.gov/resource/d6yy-54nr.json?$limit=5000&$order=draw_date%20DESC";
const USASPENDING_AGENCIES_URL: &str =
    "https://api.usaspending.gov/api/v2/references/toptier_agencies/";
/// Mirrors BIKESHARE_SYSTEMS in workers/catalog-proxy.ts.
const BIKESHARE_SYSTEMS: [(&str, &str); 3] = [
    ("Divvy (Chicago)", "https://gbfs.divvybikes.com/gbfs/en/"),
    (
        "Capital Bikeshare (DC)",
        "https://gbfs.capitalbikeshare.com/gbfs/en/",
    ),
    ("Bay Wheels (SF)", "https://gbfs.lyftbikes.com/gbfs/en/"),
];
/// WebSocket-sampled / fan-out feeds (bluesky, bgp, pokemon, met) come from the Worker.
const LOOM_WORKER_ORIGIN: &str = "https://loom.ibm.io";
const NOBEL_LAUREATES_URL: &str = "https://api.nobelprize.org/2.1/laureates?limit=1500&format=json";
const RADIO_TOPVOTE_URL: &str = "https://de1.api.radio-browser.info/json/stations/topvote/500";
const TRIVIA_PAGE_URL: &str = "https://opentdb.com/api.php?amount=50";
fn openfood_page_url(page: u32) -> String {
    format!(
        "https://world.openfoodfacts.org/cgi/search.pl?action=process&json=true&page_size=100&page={}&sort_by=unique_scans_n&fields=code,product_name,product_name_en,brands,nutriscore_grade,countries_tags,categories_tags,nutriments",
        page
    )
}

async fn fetch_bikeshare(ctx: &mut PollCtx) -> Result<Vec<Row>, String> {
    let mut rows = Vec::new();
    let mut errors = Vec::new();
    for (system, base) in BIKESHARE_SYSTEMS {
        if !ctx.bikeshare_info.contains_key(system) {
            match get_json(&ctx.client, &format!("{}station_information.json", base))
                .await
                .and_then(|b| citibike_info(&b))
            {
                Ok(info) => {
                    ctx.bikeshare_info.insert(system.to_string(), info);
                }
                Err(e) => {
                    errors.push(e);
                    continue;
                }
            }
        }
        let status = match get_json(&ctx.client, &format!("{}station_status.json", base)).await {
            Ok(s) => s,
            Err(e) => {
                errors.push(e);
                continue;
            }
        };
        if let Some(info) = ctx.bikeshare_info.get(system) {
            rows.extend(bikeshare_rows(system, &status, info)?);
        }
    }
    if rows.is_empty() && !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(rows)
}

async fn fetch_arxiv(client: &reqwest::Client) -> Result<Vec<Row>, String> {
    let mut feeds = Vec::new();
    let mut last_err = None;
    for (i, q) in ARXIV_QUERIES.iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        }
        match get_text(client, &arxiv_url(q)).await {
            Ok(t) => feeds.push(t),
            Err(e) => last_err = Some(e),
        }
    }
    if feeds.is_empty() {
        return Err(last_err.unwrap_or_else(|| "arXiv: no feeds".into()));
    }
    arxiv_rows(&feeds)
}

async fn fetch_books(client: &reqwest::Client) -> Result<Vec<Row>, String> {
    let ol = get_json(client, OPEN_LIBRARY_TRENDING_URL).await;
    let gut = get_json(client, GUTENDEX_POPULAR_URL).await;
    if let (Err(a), Err(b)) = (&ol, &gut) {
        return Err(format!("{}; {}", a, b));
    }
    books_rows(ol.as_ref().ok(), gut.as_ref().ok())
}

async fn fetch_fda(client: &reqwest::Client) -> Result<Vec<Row>, String> {
    let mut bodies = Vec::new();
    let mut last_err = None;
    for c in FDA_CATEGORIES {
        match get_json(client, &fda_url(c)).await {
            Ok(b) => bodies.push(b),
            Err(e) => last_err = Some(e),
        }
    }
    if bodies.is_empty() {
        return Err(last_err.unwrap_or_else(|| "openFDA: no feeds".into()));
    }
    fda_rows(&bodies)
}

async fn fetch_trivia(client: &reqwest::Client) -> Result<Vec<Row>, String> {
    let mut bodies = Vec::new();
    let mut last_err = None;
    for i in 0..10 {
        if i > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        match get_json(client, TRIVIA_PAGE_URL).await {
            Ok(b) => bodies.push(b),
            Err(e) => last_err = Some(e),
        }
    }
    if bodies.is_empty() {
        return Err(last_err.unwrap_or_else(|| "Open Trivia DB: no pages".into()));
    }
    trivia_rows(&bodies)
}

async fn fetch_openfood(client: &reqwest::Client) -> Result<Vec<Row>, String> {
    let mut bodies = Vec::new();
    let mut last_err = None;
    for page in 1u32..=10 {
        match get_json(client, &openfood_page_url(page)).await {
            Ok(b) => bodies.push(b),
            Err(e) => last_err = Some(e),
        }
    }
    if bodies.is_empty() {
        return Err(last_err.unwrap_or_else(|| "Open Food Facts: no pages".into()));
    }
    openfood_rows(&bodies)
}

/// Per-run state carried between polls.
struct PollCtx {
    client: reqwest::Client,
    bikeshare_info: HashMap<String, HashMap<String, CitiStation>>,
    citibike_info: Option<HashMap<String, CitiStation>>,
    iss_seeded: bool,
    opensky_retry_at: i64,
    coingecko_retry_at: i64,
    adsb_next: usize,
}

async fn fetch_adsb_points(
    client: &reqwest::Client,
    provider: &str,
    url_for: impl Fn(f64, f64) -> String,
    start: usize,
) -> Vec<Value> {
    let mut bodies = Vec::new();
    for i in 0..ADSB_POINTS.len() {
        let (lat, lon) = ADSB_POINTS[(start + i) % ADSB_POINTS.len()];
        if i > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(ADSB_SPACING_MS)).await;
        }
        let url = url_for(lat, lon);
        match get_json(client, &url).await {
            Ok(b) => bodies.push(b),
            Err(e) => {
                log::warn!(target: "loom", "{provider}: {e}");
                break;
            }
        }
    }
    bodies
}

async fn fetch_aircraft(ctx: &mut PollCtx) -> Result<Vec<Row>, String> {
    let now = now_secs();
    if now >= ctx.opensky_retry_at {
        match get_json(&ctx.client, OPENSKY_URL)
            .await
            .and_then(|b| opensky_rows(&b))
        {
            Ok(rows) if !rows.is_empty() => return Ok(rows),
            Ok(_) => {}
            Err(e) => {
                log::warn!(target: "loom", "opensky: {e} — using ADS-B fallbacks");
                ctx.opensky_retry_at = now + PRIMARY_BACKOFF_SECS;
            }
        }
    }
    let start = ctx.adsb_next;
    ctx.adsb_next = (start + 1) % ADSB_POINTS.len();
    let lol = fetch_adsb_points(
        &ctx.client,
        "adsb.lol",
        |lat, lon| format!("https://api.adsb.lol/v2/point/{lat}/{lon}/250"),
        start,
    )
    .await;
    if !lol.is_empty() {
        return Ok(adsb_rows(&lol));
    }
    let fi = fetch_adsb_points(
        &ctx.client,
        "adsb.fi",
        |lat, lon| format!("https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/250"),
        start,
    )
    .await;
    if fi.is_empty() {
        return Err("aircraft: OpenSky and ADS-B fallbacks failed".into());
    }
    Ok(adsb_rows(&fi))
}

async fn fetch_crypto(ctx: &mut PollCtx) -> Result<Vec<Row>, String> {
    let now = now_secs();
    if now >= ctx.coingecko_retry_at {
        match get_json(&ctx.client, COINGECKO_URL)
            .await
            .and_then(|b| coingecko_rows(&b))
        {
            Ok(rows) if !rows.is_empty() => return Ok(rows),
            Ok(_) => {}
            Err(e) => {
                log::warn!(target: "loom", "coingecko: {e} — using CoinPaprika");
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
            Err(e) => log::warn!(target: "loom", "world bank {id}: {e}"),
        }
    }
    if series.is_empty() {
        return Err("World Bank: every indicator request failed".into());
    }
    Ok(wb_wide_rows(&countries, &series))
}

// ---- USAFacts Data gateway (https://usafacts.org/mcp/) ----
// Keyless JSON-RPC proxy over federal sources. Same calls, columns and math as
// workers/sourceTransforms.ts (usafactsPayload / acsStatesWide / fredNationMonthly).

const USAFACTS_GATEWAY: &str = "https://data.mcp.usafacts.org/mcp";

pub(crate) fn usafacts_tool_call(source_id: &str, tool_name: &str, args: Value) -> String {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "call_source_tool",
            "arguments": { "source_id": source_id, "tool_name": tool_name, "arguments": args },
        },
    })
    .to_string()
}

/// Gateway reply (SSE `data:` lines or plain JSON-RPC) → the tool payload.
pub(crate) fn usafacts_payload(text: &str) -> Result<Value, String> {
    let raw = text
        .lines()
        .filter_map(|l| l.strip_prefix("data:"))
        .map(str::trim)
        .next_back()
        .unwrap_or_else(|| text.trim());
    let msg: Value =
        serde_json::from_str(raw).map_err(|_| "USAFacts: unreadable reply".to_string())?;
    if let Some(err) = msg.get("error") {
        let m = err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("gateway error");
        return Err(format!("USAFacts: {}", m));
    }
    let result = msg.get("result").cloned().unwrap_or(Value::Null);
    let payload = match result.get("structuredContent") {
        Some(v) if !v.is_null() => Some(v.clone()),
        _ => result
            .pointer("/content/0/text")
            .and_then(Value::as_str)
            .and_then(|t| serde_json::from_str::<Value>(t).ok()),
    };
    let is_error = result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let p = payload.clone().unwrap_or(Value::Null);
    let error_shape = p.get("kind").map(Value::is_string).unwrap_or(false)
        && p.get("message").map(Value::is_string).unwrap_or(false)
        && p.get("results").is_none()
        && p.get("observations").is_none();
    if is_error || error_shape {
        let kind = p.get("kind").and_then(Value::as_str).unwrap_or("error");
        let m: String = p
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("tool failed")
            .chars()
            .take(200)
            .collect();
        return Err(format!("USAFacts {}: {}", kind, m));
    }
    payload.ok_or_else(|| "USAFacts: empty payload".to_string())
}

/// 2-digit state FIPS → USPS code (50 states + DC + PR). Mirrors STATE_FIPS_ABBR.
pub(crate) const STATE_FIPS_ABBR: &[(&str, &str)] = &[
    ("01", "AL"),
    ("02", "AK"),
    ("04", "AZ"),
    ("05", "AR"),
    ("06", "CA"),
    ("08", "CO"),
    ("09", "CT"),
    ("10", "DE"),
    ("11", "DC"),
    ("12", "FL"),
    ("13", "GA"),
    ("15", "HI"),
    ("16", "ID"),
    ("17", "IL"),
    ("18", "IN"),
    ("19", "IA"),
    ("20", "KS"),
    ("21", "KY"),
    ("22", "LA"),
    ("23", "ME"),
    ("24", "MD"),
    ("25", "MA"),
    ("26", "MI"),
    ("27", "MN"),
    ("28", "MS"),
    ("29", "MO"),
    ("30", "MT"),
    ("31", "NE"),
    ("32", "NV"),
    ("33", "NH"),
    ("34", "NJ"),
    ("35", "NM"),
    ("36", "NY"),
    ("37", "NC"),
    ("38", "ND"),
    ("39", "OH"),
    ("40", "OK"),
    ("41", "OR"),
    ("42", "PA"),
    ("44", "RI"),
    ("45", "SC"),
    ("46", "SD"),
    ("47", "TN"),
    ("48", "TX"),
    ("49", "UT"),
    ("50", "VT"),
    ("51", "VA"),
    ("53", "WA"),
    ("54", "WV"),
    ("55", "WI"),
    ("56", "WY"),
    ("72", "PR"),
];

/// Detailed-table ACS variables (stable across vintages). Mirrors ACS_STATE_VARS.
pub(crate) const ACS_STATE_VARS: &[&str] = &[
    "NAME",
    "B01003_001E",
    "B19013_001E",
    "B01002_001E",
    "B17001_001E",
    "B17001_002E",
    "B15003_001E",
    "B15003_022E",
    "B15003_023E",
    "B15003_024E",
    "B15003_025E",
    "B23025_003E",
    "B23025_005E",
];

const ACS_FIRST_YEAR: i64 = 2012;

/// ACS 1-year vintages: 2012 → last calendar year, no 2020 release.
pub(crate) fn acs_state_years(today: i64) -> Vec<i64> {
    let (y, _, _) = civil_from_days(today);
    (ACS_FIRST_YEAR..y).filter(|&yr| yr != 2020).collect()
}

fn round_to(v: f64, k: f64) -> f64 {
    (v * k).round() / k
}

/// Census jam values (-666666666 …) and negatives are "no estimate".
fn acs_num(v: Option<&Value>) -> Option<f64> {
    v.and_then(as_f64_loose).filter(|n| *n >= 0.0)
}

fn pct_of(num: Option<f64>, den: Option<f64>) -> Option<f64> {
    match (num, den) {
        (Some(n), Some(d)) if d > 0.0 => Some(round_to(n / d * 100.0, 100.0)),
        _ => None,
    }
}

/// `{ results: [[header…], [row…]…] }` (or a bare grid) per year → wide rows, newest year first.
pub(crate) fn acs_states_rows(years: &[(i64, Value)]) -> Vec<Row> {
    let mut rows: Vec<Row> = Vec::new();
    for (year, table) in years {
        let grid = match table {
            Value::Array(a) => a.clone(),
            other => other
                .get("results")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        };
        let Some(header) = grid.first().and_then(Value::as_array) else {
            continue;
        };
        let header: Vec<&str> = header.iter().map(|h| h.as_str().unwrap_or("")).collect();
        let at = |n: &str| header.iter().position(|h| *h == n);
        let (Some(state_i), Some(_)) = (at("state"), at("B01003_001E")) else {
            continue;
        };
        for r in grid.iter().skip(1) {
            let Some(cells) = r.as_array() else { continue };
            let get = |v: &str| at(v).and_then(|i| cells.get(i));
            let fips = format!(
                "{:0>2}",
                cells.get(state_i).and_then(Value::as_str).unwrap_or("")
            );
            let Some(abbr) = STATE_FIPS_ABBR
                .iter()
                .find(|(f, _)| *f == fips)
                .map(|(_, a)| *a)
            else {
                continue;
            };
            let bach: Vec<Option<f64>> =
                ["B15003_022E", "B15003_023E", "B15003_024E", "B15003_025E"]
                    .iter()
                    .map(|v| acs_num(get(v)))
                    .collect();
            let bach_sum = if bach.iter().all(Option::is_some) {
                Some(bach.iter().flatten().sum::<f64>())
            } else {
                None
            };
            rows.push(vec![
                Cell::str(fips),
                Cell::str(abbr),
                js(get("NAME")),
                Cell::I64(*year),
                Cell::opt_i64(acs_num(get("B01003_001E")).map(|p| p.round() as i64)),
                Cell::opt_f64(acs_num(get("B19013_001E"))),
                Cell::opt_f64(pct_of(
                    acs_num(get("B17001_002E")),
                    acs_num(get("B17001_001E")),
                )),
                Cell::opt_f64(acs_num(get("B01002_001E"))),
                Cell::opt_f64(pct_of(
                    acs_num(get("B23025_005E")),
                    acs_num(get("B23025_003E")),
                )),
                Cell::opt_f64(pct_of(bach_sum, acs_num(get("B15003_001E")))),
            ]);
        }
    }
    let key = |r: &Row| -> (i64, String) {
        let y = match r[3] {
            Cell::I64(y) => y,
            _ => 0,
        };
        let a = match &r[1] {
            Cell::Str(a) => a.clone(),
            _ => String::new(),
        };
        (y, a)
    };
    rows.sort_by(|a, b| {
        let (ya, aa) = key(a);
        let (yb, ab) = key(b);
        yb.cmp(&ya).then(aa.cmp(&ab))
    });
    rows
}

/// (column, FRED id, units, frequency) — mirrors USAFACTS_NATION_SERIES.
pub(crate) const USAFACTS_NATION_SERIES: &[(&str, &str, Option<&str>, Option<&str>)] = &[
    ("unemployment_rate", "UNRATE", None, None),
    ("inflation_yoy_pct", "CPIAUCSL", Some("pc1"), None),
    ("payrolls_k", "PAYEMS", None, None),
    ("fed_funds_rate", "FEDFUNDS", None, None),
    ("housing_starts_k", "HOUST", None, None),
    ("gas_price_usd", "GASREGW", None, Some("m")),
];

const USAFACTS_NATION_START: &str = "1990-01-01";

fn nation_rows(by_month: BTreeMap<String, Vec<Option<f64>>>) -> Vec<Row> {
    let start = &USAFACTS_NATION_START[..7];
    by_month
        .into_iter()
        .filter(|(m, vals)| m.as_str() >= start && vals.iter().any(Option::is_some))
        .map(|(m, vals)| {
            let mut row = vec![
                Cell::str(format!("{}-01", m)),
                Cell::opt_i64(m.get(..4).and_then(|y| y.parse().ok())),
            ];
            for (i, v) in vals.into_iter().enumerate() {
                let k = match USAFACTS_NATION_SERIES[i].0 {
                    "inflation_yoy_pct" => Some(100.0),
                    "gas_price_usd" => Some(1000.0),
                    _ => None,
                };
                row.push(Cell::opt_f64(match k {
                    Some(k) => v.map(|x| round_to(x, k)),
                    None => v,
                }));
            }
            row
        })
        .collect()
}

fn month_of(date: &str) -> Option<String> {
    let b = date.as_bytes();
    (date.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && date[..4].bytes().all(|c| c.is_ascii_digit()))
    .then(|| date[..7].to_string())
}

/// FRED `observations` payload per series (registry order; None = failed) → monthly rows.
pub(crate) fn fred_nation_rows(payloads: &[Option<Value>]) -> Vec<Row> {
    let n = USAFACTS_NATION_SERIES.len();
    let mut by_month: BTreeMap<String, Vec<Option<f64>>> = BTreeMap::new();
    for (i, p) in payloads.iter().enumerate() {
        let Some(obs) = p
            .as_ref()
            .and_then(|p| p.get("observations"))
            .and_then(Value::as_array)
        else {
            continue;
        };
        for o in obs {
            let Some(m) = o.get("date").and_then(Value::as_str).and_then(month_of) else {
                continue;
            };
            let v = match o.get("value") {
                Some(Value::String(s)) if s == "." => None,
                other => other.and_then(as_f64_loose),
            };
            by_month.entry(m).or_insert_with(|| vec![None; n])[i] = v;
        }
    }
    nation_rows(by_month)
}

/// Keyless fallback: fredgraph.csv levels (CPI → YoY computed here) + monthly-averaged gas.
pub(crate) fn fredgraph_nation_rows(monthly_csv: &str, gas_csv: &str) -> Vec<Row> {
    let n = USAFACTS_NATION_SERIES.len();
    let mut by_month: BTreeMap<String, Vec<Option<f64>>> = BTreeMap::new();
    let mut cpi: BTreeMap<String, f64> = BTreeMap::new();
    for csv in [monthly_csv, gas_csv] {
        let mut lines = csv
            .trim_start_matches('\u{feff}')
            .lines()
            .filter(|l| !l.trim().is_empty());
        let Some(header) = lines.next() else { continue };
        let header: Vec<&str> = header.split(',').map(str::trim).collect();
        for line in lines {
            let cells: Vec<&str> = line.split(',').collect();
            let Some(m) = cells.first().and_then(|d| month_of(d)) else {
                continue;
            };
            for (c, h) in header.iter().enumerate().skip(1) {
                let v = cells
                    .get(c)
                    .and_then(|x| x.trim().parse::<f64>().ok())
                    .filter(|x| x.is_finite());
                if *h == "CPIAUCSL" {
                    if let Some(v) = v {
                        cpi.insert(m.clone(), v);
                    }
                    continue;
                }
                if let Some(i) = USAFACTS_NATION_SERIES.iter().position(|s| s.1 == *h) {
                    by_month.entry(m.clone()).or_insert_with(|| vec![None; n])[i] = v;
                }
            }
        }
    }
    let cpi_i = USAFACTS_NATION_SERIES
        .iter()
        .position(|s| s.1 == "CPIAUCSL")
        .unwrap_or(1);
    for (m, level) in &cpi {
        let prev_key = m
            .get(..4)
            .and_then(|y| y.parse::<i64>().ok())
            .map(|y| format!("{}{}", y - 1, &m[4..]));
        let yoy = prev_key
            .and_then(|k| cpi.get(&k))
            .map(|prev| (level / prev - 1.0) * 100.0);
        by_month.entry(m.clone()).or_insert_with(|| vec![None; n])[cpi_i] = yoy;
    }
    nation_rows(by_month)
}

async fn usafacts_call(
    client: &reqwest::Client,
    source_id: &str,
    tool: &str,
    args: Value,
) -> Result<Value, String> {
    let res = client
        .post(USAFACTS_GATEWAY)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .body(usafacts_tool_call(source_id, tool, args))
        .send()
        .await
        .map_err(|e| format!("USAFacts: {}", e))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("USAFacts: HTTP {}", status));
    }
    let bytes = response_bytes_limited(res, MAX_UPSTREAM_BODY).await?;
    usafacts_payload(&String::from_utf8_lossy(&bytes))
}

async fn fetch_usafacts_states(client: &reqwest::Client) -> Result<Vec<Row>, String> {
    use futures_util::stream::{self, StreamExt};
    let get = ACS_STATE_VARS.join(",");
    let calls: Vec<(i64, Value, reqwest::Client)> = acs_state_years(today_days())
        .into_iter()
        .map(|year| {
            let args =
                serde_json::json!({ "year": year.to_string(), "get": get, "for": "state:*" });
            (year, args, client.clone())
        })
        .collect();
    let results: Vec<(i64, Result<Value, String>)> = stream::iter(calls)
        .map(|(year, args, client)| async move {
            (
                year,
                usafacts_call(&client, "census_acs", "getAcs1", args).await,
            )
        })
        .buffer_unordered(4)
        .collect()
        .await;
    let mut ok = Vec::new();
    for (year, r) in results {
        match r {
            Ok(v) => ok.push((year, v)),
            Err(e) => log::info!(target: "loom", "usafacts_states {year}: {e}"),
        }
    }
    if ok.is_empty() {
        return Err("USAFacts: no ACS vintages returned".into());
    }
    Ok(acs_states_rows(&ok))
}

async fn fetch_usafacts_nation(client: &reqwest::Client) -> Result<Vec<Row>, String> {
    use futures_util::stream::{self, StreamExt};
    let calls: Vec<(String, Value, reqwest::Client)> = USAFACTS_NATION_SERIES
        .iter()
        .map(|(_, id, units, freq)| {
            let mut args =
                serde_json::json!({ "series_id": id, "observation_start": USAFACTS_NATION_START });
            if let Some(u) = units {
                args["units"] = Value::from(*u);
            }
            if let Some(f) = freq {
                args["frequency"] = Value::from(*f);
            }
            (id.to_string(), args, client.clone())
        })
        .collect();
    let payloads: Vec<Option<Value>> = stream::iter(calls)
        .map(|(id, args, client)| async move {
            match usafacts_call(&client, "fred", "getSeriesObservations", args).await {
                Ok(v) => Some(v),
                Err(e) => {
                    log::warn!(target: "loom", "usafacts_nation {id}: {e}");
                    None
                }
            }
        })
        .buffered(3)
        .collect()
        .await;
    if payloads.iter().all(Option::is_some) {
        return Ok(fred_nation_rows(&payloads));
    }
    let fallback = async {
        let monthly = get_text(client, "https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE,CPIAUCSL,PAYEMS,FEDFUNDS,HOUST").await?;
        let gas = get_text(
            client,
            &format!("https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASREGW&cosd={}&fq=Monthly&fam=avg", USAFACTS_NATION_START),
        )
        .await?;
        Ok::<_, String>(fredgraph_nation_rows(&monthly, &gas))
    };
    match fallback.await {
        Ok(rows) => Ok(rows),
        Err(e) if payloads.iter().any(Option::is_some) => {
            log::warn!(target: "loom", "usafacts_nation fredgraph fallback: {e}");
            Ok(fred_nation_rows(&payloads))
        }
        Err(e) => Err(e),
    }
}

async fn fetch_bitcoin(client: &reqwest::Client) -> Result<Vec<Row>, String> {
    let mut pages = vec![get_json(client, MEMPOOL_BLOCKS_URL).await?];
    for _ in 0..MEMPOOL_EXTRA_PAGES {
        let Some(next) = pages.last().and_then(min_block_height).map(|h| h - 1) else {
            break;
        };
        if next < 0 {
            break;
        }
        match get_json(client, &format!("{}/{}", MEMPOOL_BLOCKS_URL, next)).await {
            Ok(b) => pages.push(b),
            Err(e) => {
                log::warn!(target: "loom", "mempool.space page {next}: {e}");
                break;
            }
        }
    }
    bitcoin_rows(&pages)
}

async fn fetch_rows(spec: &SourceSpec, ctx: &mut PollCtx, db: &LoomDb) -> Result<Vec<Row>, String> {
    let c = ctx.client.clone();
    let today = today_days();
    match spec.kind {
        "usgs" => usgs_rows(&get_json(&c, USGS_URL).await?),
        "eonet" => eonet_rows(&get_json(&c, EONET_URL).await?),
        "gdacs" => gdacs_rows(&get_json(&c, GDACS_URL).await?),
        "nws" => nws_rows(&get_json(&c, NWS_URL).await?, NWS_MAX_ALERTS),
        "meteo" => meteo_rows(&get_json(&c, &meteo_url()).await?, CITIES),
        "aq" => aq_rows(&get_json(&c, &aq_url()).await?, CITIES),
        "ukcarbon" => {
            let base = "https://api.carbonintensity.org.uk/intensity/date";
            let mut bodies =
                vec![get_json(&c, &format!("{}/{}", base, fmt_date(london_days_ago(1)))).await?];
            match get_json(&c, base).await {
                Ok(b) => bodies.push(b),
                Err(e) => log::warn!(target: "loom", "ukcarbon today: {e}"),
            }
            ukcarbon_rows(&bodies)
        }
        "climate" => {
            let (year, _, _) = civil_from_days(today);
            match get_json(&c, &climate_url(year)).await {
                Ok(body) => climate_rows(&body),
                Err(_) => climate_rows(&get_json(&c, &climate_url(year - 1)).await?),
            }
        }
        "buoys" => buoys_rows(&get_text(&c, BUOYS_URL).await?),
        "opensky" => fetch_aircraft(ctx).await,
        "citibike" => {
            if ctx.citibike_info.is_none() {
                ctx.citibike_info = Some(citibike_info(&get_json(&c, GBFS_INFO_URL).await?)?);
            }
            let status = get_json(&c, GBFS_STATUS_URL).await?;
            citibike_rows(
                &status,
                ctx.citibike_info.as_ref().ok_or("GBFS: no station info")?,
            )
        }
        "mbta" => mbta_rows(&get_json(&c, MBTA_URL).await?),
        "nyc311" => nyc311_rows(&get_json(&c, NYC311_URL).await?),
        "iss" => {
            let mut rows = Vec::new();
            if !ctx.iss_seeded {
                ctx.iss_seeded = true;
                // Seed one orbit (~10 samples) so trail ribbons work immediately.
                // wheretheiss.at allows ≤10 timestamps per request.
                if table_is_empty(db, spec.table) {
                    let now = now_secs();
                    let stamps: Vec<String> =
                        (1..10).rev().map(|i| (now - i * 600).to_string()).collect();
                    let url = format!("{}/positions?timestamps={}", ISS_URL, stamps.join(","));
                    match get_json(&c, &url).await.and_then(|b| iss_rows(&b)) {
                        Ok(seed) => rows.extend(seed),
                        Err(e) => log::warn!(target: "loom", "iss seed: {e}"),
                    }
                }
            }
            rows.extend(iss_rows(&get_json(&c, ISS_URL).await?)?);
            Ok(rows)
        }
        "launches" => launches_rows(&get_json(&c, LAUNCHES_URL).await?),
        "spacex" => spacex_rows(&get_json(&c, SPACEX_URL).await?),
        "spaceweather" => kp_rows(&get_json(&c, KP_URL).await?),
        "aurora" => aurora_rows(&get_json(&c, AURORA_URL).await?),
        "asteroids" => asteroids_rows(&get_json(&c, ASTEROIDS_URL).await?),
        "firms" => firms_rows(&get_text(&c, FIRMS_URL).await?),
        "nwis" => nwis_rows(&get_json(&c, &nwis_url()).await?),
        "starlink" => {
            let text = get_text(&c, STARLINK_URL).await?;
            if text.trim_start().starts_with("GP data has not updated") {
                return Err("CelesTrak: GP not updated yet".into());
            }
            let body: Value =
                serde_json::from_str(&text).map_err(|e| format!("Starlink JSON: {}", e))?;
            starlink_rows(&body)
        }
        "hn" => hn_rows(&get_json(&c, HN_URL).await?),
        "lobsters" => lobsters_rows(&get_json(&c, LOBSTERS_URL).await?),
        "pageviews" => {
            // Top pageviews for day D usually land mid-day UTC on D+1.
            let mut body = None;
            let mut last_err = None;
            for ago in pageviews_try_offsets() {
                match get_json(&c, &pageviews_url(today - ago)).await {
                    Ok(b) => {
                        body = Some(b);
                        break;
                    }
                    Err(e) => last_err = Some(e),
                }
            }
            pageviews_rows(
                &body.ok_or_else(|| last_err.unwrap_or_else(|| "Pageviews unavailable".into()))?,
            )
        }
        "steam" => steam_rows(&get_json(&c, STEAM_URL).await?),
        "crypto" => fetch_crypto(ctx).await,
        "bitcoin" => fetch_bitcoin(&c).await,
        "fx" => fx_rows(&get_json(&c, &fx_url(today)).await?),
        "debt" => debt_rows(&get_json(&c, DEBT_URL).await?),
        "usafacts_states" => fetch_usafacts_states(&c).await,
        "usafacts_nation" => fetch_usafacts_nation(&c).await,
        "fema" => fema_rows(&get_json(&c, FEMA_URL).await?),
        "covid" => covid_rows(&get_json(&c, COVID_URL).await?),
        "countries" => {
            let body = get_json(&c, COUNTRIES_URL).await?;
            let pop = match get_json(&c, WB_POP_LATEST_URL).await {
                Ok(b) => wb_values_by_iso3(&b),
                Err(e) => {
                    log::warn!(target: "loom", "countries population: {e}");
                    HashMap::new()
                }
            };
            countries_rows(&body, &pop)
        }
        "world_bank" => fetch_world_bank(&c).await,
        "fireballs" => fireballs_rows(&get_json(&c, FIREBALLS_URL).await?),
        "satellites" => {
            let text = get_text(&c, SATELLITES_URL).await?;
            if text.trim_start().starts_with("GP data has not updated") {
                return Err("CelesTrak: GP not updated yet".into());
            }
            let body: Value =
                serde_json::from_str(&text).map_err(|e| format!("CelesTrak JSON: {}", e))?;
            satellites_rows(&body)
        }
        "internet_outages" => {
            let (from, until) = ioda_window(now_secs());
            let url = format!(
                "{}?from={}&until={}&entityType=country&limit={}",
                IODA_ALERTS_URL, from, until, IODA_MAX_ROWS
            );
            match get_json(&c, &url).await {
                Ok(body) => ioda_rows(&body),
                Err(e) => {
                    // IODA's chain ends at an emSign cross-signed root rustls may not build a
                    // path to — fall back to the Worker's copy (same columns).
                    log::warn!(target: "loom", "IODA direct: {e}; using Worker");
                    let url = format!("{}/api/source/internet_outages", LOOM_WORKER_ORIGIN);
                    columnar_rows(&get_json(&c, &url).await?, spec)
                }
            }
        }
        "faa_delays" => faa_rows(&get_text(&c, FAA_STATUS_URL).await?),
        "lobbying" => {
            let mut results = Vec::new();
            let mut last_err = None;
            for page in 1..=LDA_PAGES {
                // Paging needs a filter: filing_year of 30 days ago (mirrors the Worker).
                let (year, _, _) = civil_from_days(today - 30);
                let url = format!("{}&filing_year={}&page={}", LDA_FILINGS_URL, year, page);
                match get_json(&c, &url).await {
                    Ok(b) => results.extend(
                        b.get("results")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default(),
                    ),
                    Err(e) => {
                        last_err = Some(e);
                        break;
                    }
                }
            }
            if results.is_empty() {
                return Err(last_err.unwrap_or_else(|| "LDA: no filings".into()));
            }
            lobbying_rows(&serde_json::json!({ "results": results }))
        }
        "fda_recalls" => fetch_fda(&c).await,
        "vehicle_recalls" => vehicle_recalls_rows(&get_json(&c, NHTSA_RECALLS_URL).await?),
        "arxiv" => fetch_arxiv(&c).await,
        "github_events" => github_events_rows(&get_json(&c, GITHUB_EVENTS_URL).await?),
        "books" => fetch_books(&c).await,
        "nyc_inspections" => nyc_inspections_rows(&get_json(&c, NYC_INSPECTIONS_URL).await?),
        "chicago_crime" => chicago_crime_rows(&get_json(&c, CHICAGO_CRIME_URL).await?),
        "nyc_parking" => nyc_parking_rows(&get_json(&c, &nyc_parking_url(today)).await?),
        "powerball" => powerball_rows(&get_json(&c, POWERBALL_URL).await?),
        "fed_spending" => fed_spending_rows(&get_json(&c, USASPENDING_AGENCIES_URL).await?),
        "bikeshare" => fetch_bikeshare(ctx).await,
        "nobel" => nobel_rows(&get_json(&c, NOBEL_LAUREATES_URL).await?),
        "trivia" => fetch_trivia(&c).await,
        "openfood" => fetch_openfood(&c).await,
        "radio" => radio_rows(&get_json(&c, RADIO_TOPVOTE_URL).await?),
        "bluesky" | "bgp" | "pokemon" | "met" => {
            let url = format!("{}/api/source/{}", LOOM_WORKER_ORIGIN, spec.kind);
            columnar_rows(&get_json(&c, &url).await?, spec)
        }
        other => Err(format!("Unknown source kind {}", other)),
    }
}

// ================================================================
// Start / Stop / Query (generic, dispatched by kind)
// ================================================================

pub async fn source_start(
    kind: &str,
    db: Arc<LoomDb>,
    state: Arc<SourcesState>,
) -> Result<(), String> {
    let spec = spec_for_kind(kind).ok_or("Unknown source kind")?;
    let inst = state.get(kind).ok_or("Unknown source kind")?;
    if inst
        .running
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
        .is_err()
    {
        return Err(format!("{} already running", kind));
    }

    if let Some((_, handle)) = inst.poll_worker.lock().await.take() {
        handle.abort();
    }

    let client = state.client();
    let my_gen = inst.poll_generation.fetch_add(1, Ordering::AcqRel) + 1;
    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    *inst.cancel_token.lock().await = Some(cancel_tx);
    inst.mark_started().await;
    *inst.last_error.lock().await = None;
    inst.consecutive_failures.store(0, Ordering::Relaxed);

    let running = inst.running.clone();
    let total = inst.total_events.clone();
    let last_ok = inst.last_ok_at.clone();
    let last_error = inst.last_error.clone();
    let consecutive_failures = inst.consecutive_failures.clone();
    let next_poll_at = inst.next_poll_at.clone();
    let poll_generation = inst.poll_generation.clone();

    let handle = tokio::spawn(async move {
        let mut ctx = PollCtx {
            client,
            bikeshare_info: HashMap::new(),
            citibike_info: None,
            iss_seeded: false,
            opensky_retry_at: 0,
            coingecko_retry_at: 0,
            adsb_next: 0,
        };
        loop {
            if poll_generation.load(Ordering::Acquire) != my_gen {
                break;
            }
            let result = match fetch_rows(spec, &mut ctx, &db).await {
                Ok(rows) => {
                    if poll_generation.load(Ordering::Acquire) != my_gen {
                        break;
                    }
                    // DuckDB writes block; keep them off the async worker threads.
                    let db = Arc::clone(&db);
                    tokio::task::spawn_blocking(move || write_rows(&db, spec, &rows))
                        .await
                        .unwrap_or_else(|e| Err(format!("Write task: {}", e)))
                }
                Err(e) => Err(e),
            };
            let ok = match result {
                Ok(n) => {
                    if poll_generation.load(Ordering::Acquire) != my_gen {
                        break;
                    }
                    if spec.mode == WriteMode::Replace {
                        total.store(n, Ordering::Relaxed);
                    } else {
                        total.fetch_add(n, Ordering::Relaxed);
                        let db = Arc::clone(&db);
                        let _ =
                            tokio::task::spawn_blocking(move || trim_table(&db, spec.table)).await;
                    }
                    consecutive_failures.store(0, Ordering::Relaxed);
                    *last_ok.lock().await = Some(now_secs());
                    *last_error.lock().await = None;
                    true
                }
                Err(e) => {
                    log::warn!(target: "loom", "source {}: {}", spec.kind, e);
                    consecutive_failures.fetch_add(1, Ordering::Relaxed);
                    *last_error.lock().await = Some(e);
                    false
                }
            };
            let failures = consecutive_failures.load(Ordering::Relaxed);
            let wait = match (spec.poll_secs, ok) {
                (0, true) => None,
                (0, false) => Some(LOAD_ONCE_RETRY_SECS),
                (secs, true) => Some(secs),
                (secs, false) => {
                    let mult = 1u64 << failures.min(4);
                    Some((secs * mult).min(secs.saturating_mul(10)).max(secs))
                }
            };
            if let Some(secs) = wait {
                *next_poll_at.lock().await = Some(now_secs() + secs as i64);
                tokio::select! {
                    _ = &mut cancel_rx => break,
                    _ = tokio::time::sleep(std::time::Duration::from_secs(secs)) => {}
                }
            } else {
                *next_poll_at.lock().await = None;
                let _ = (&mut cancel_rx).await;
                break;
            }
        }
        if poll_generation.load(Ordering::Acquire) == my_gen {
            running.store(false, Ordering::Relaxed);
        }
    });
    *inst.poll_worker.lock().await = Some((my_gen, handle));
    Ok(())
}

pub async fn source_stop(kind: &str, state: Arc<SourcesState>) -> Result<(), String> {
    let inst = state.get(kind).ok_or("Unknown source kind")?;
    if let Some(tx) = inst.cancel_token.lock().await.take() {
        let _ = tx.send(());
    }
    if let Some((_, handle)) = inst.poll_worker.lock().await.take() {
        handle.abort();
    }
    inst.poll_generation.fetch_add(1, Ordering::AcqRel);
    inst.mark_stopped().await;
    *inst.next_poll_at.lock().await = None;
    Ok(())
}

pub fn source_query(db: &LoomDb, kind: &str, sql: &str, limit: u32) -> Result<QueryResult, String> {
    crate::sql_policy::validate_user_sql(sql)?;
    let table = table_for_kind(kind).ok_or("Unknown source kind")?;
    // Cloned connection: a slow user query must not hold the mutex pollers write through.
    db.with_cloned_conn(|conn| {
        conn.execute_batch(&format!(
            "CREATE OR REPLACE TEMP VIEW loom_active AS SELECT * FROM {}",
            table
        ))
        .map_err(|e| e.to_string())?;
        let default = format!("SELECT * FROM {} LIMIT {{limit}}", table);
        crate::query_engine::run_user_query(conn, sql, limit, &default)
    })
}

pub fn source_stats(db: &LoomDb, kind: &str) -> Result<Vec<ColumnInfo>, String> {
    let table = table_for_kind(kind).ok_or("Unknown source kind")?;
    db.with_cloned_conn(|conn| crate::query_engine::column_stats_for_table(conn, table))
}

pub fn source_clear(db: &LoomDb, kind: &str) -> Result<(), String> {
    let table = table_for_kind(kind).ok_or("Unknown source kind")?;
    db.with_cloned_conn(|conn| {
        conn.execute_batch(&format!("DELETE FROM {}", table))
            .map_err(|e| e.to_string())
    })
}

#[cfg(test)]
#[path = "sources_tests.rs"]
mod tests;
