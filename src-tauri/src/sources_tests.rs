// Unit + in-memory DuckDB tests for sources.rs. Fixtures under
// tests/fixtures/sources/ are trimmed real responses (captured with curl).

use super::*;
use std::sync::Mutex;

fn fixture(name: &str) -> Value {
    let path = format!(
        "{}/tests/fixtures/sources/{}",
        env!("CARGO_MANIFEST_DIR"),
        name
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {}", path, e));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {}", path, e))
}

fn test_db() -> LoomDb {
    let db = LoomDb {
        conn: Mutex::new(Connection::open_in_memory().unwrap()),
    };
    ensure_tables(&db).unwrap();
    db
}

fn spec(kind: &str) -> &'static SourceSpec {
    spec_for_kind(kind).unwrap()
}

/// Every cell of a query, cast to text (NULL → None).
fn query(db: &LoomDb, sql: &str) -> Vec<Vec<Option<String>>> {
    let conn = db.conn.lock().unwrap();
    let wrapped = format!("SELECT CAST(COLUMNS(*) AS VARCHAR) FROM ({})", sql);
    let mut stmt = conn.prepare(&wrapped).unwrap();
    let mut rows = stmt.query([]).unwrap();
    let mut out = Vec::new();
    while let Some(r) = rows.next().unwrap() {
        let n = r.as_ref().column_count();
        out.push(
            (0..n)
                .map(|i| r.get::<_, Option<String>>(i).unwrap())
                .collect(),
        );
    }
    out
}

fn one(db: &LoomDb, sql: &str) -> Option<String> {
    query(db, sql)
        .into_iter()
        .next()
        .and_then(|r| r.into_iter().next().flatten())
}

fn s(v: &str) -> Cell {
    Cell::str(v)
}

// ---------------------------------------------------------------
// Registry parity with src/lib/sourceRegistry.ts
// ---------------------------------------------------------------

struct RegEntry {
    kind: String,
    table: String,
    columns: Vec<String>,
    types: Vec<String>,
    order_by: String,
    poll_ms: u64,
}

fn line_value<'a>(chunk: &'a str, key: &str) -> &'a str {
    let line = chunk
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with(&format!("{}:", key)))
        .unwrap_or_else(|| panic!("registry entry missing {}:\n{}", key, chunk));
    line[key.len() + 1..].trim().trim_end_matches(',')
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches('"').to_string()
}

fn list(s: &str) -> Vec<String> {
    s.trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(unquote)
        .filter(|x| !x.is_empty())
        .collect()
}

fn registry() -> Vec<RegEntry> {
    let src = include_str!("../../src/lib/sourceRegistry.ts");
    let defs = &src[src.find("export const SOURCE_DEFS").expect("SOURCE_DEFS")..];
    defs.split("def({")
        .skip(1)
        .map(|chunk| RegEntry {
            kind: unquote(line_value(chunk, "kind")),
            table: unquote(line_value(chunk, "table")),
            columns: list(line_value(chunk, "columns")),
            types: list(line_value(chunk, "types")),
            order_by: unquote(line_value(chunk, "orderBy")),
            poll_ms: line_value(chunk, "pollMs")
                .replace('_', "")
                .parse()
                .unwrap(),
        })
        .collect()
}

#[test]
fn specs_match_typescript_registry() {
    let reg = registry();
    let reg_kinds: Vec<&str> = reg.iter().map(|r| r.kind.as_str()).collect();
    let rust_kinds: Vec<&str> = SOURCE_SPECS.iter().map(|s| s.kind).collect();
    assert_eq!(
        rust_kinds, reg_kinds,
        "kinds / order differ from sourceRegistry.ts"
    );
    for r in &reg {
        let sp = spec(&r.kind);
        assert_eq!(sp.table, r.table, "{} table", r.kind);
        let names: Vec<&str> = sp.columns.iter().map(|c| c.0).collect();
        let types: Vec<&str> = sp.columns.iter().map(|c| c.1).collect();
        assert_eq!(names, r.columns, "{} columns", r.kind);
        assert_eq!(types, r.types, "{} types", r.kind);
        assert_eq!(sp.order_by, r.order_by, "{} orderBy", r.kind);
        assert_eq!(sp.poll_secs * 1000, r.poll_ms, "{} pollMs", r.kind);
    }
}

#[test]
fn state_and_lookups_cover_every_kind() {
    let st = SourcesState::new();
    for sp in SOURCE_SPECS {
        assert!(st.get(sp.kind).is_some(), "{}", sp.kind);
        assert_eq!(table_for_kind(sp.kind), Some(sp.table));
        assert_eq!(
            snapshot_sql(sp.kind).unwrap(),
            format!("SELECT * FROM {} ORDER BY {}", sp.table, sp.order_by)
        );
    }
    assert!(st.get("nope").is_none());
    assert!(table_for_kind("nope").is_none());
    assert_eq!(
        snapshot_sql("fx").unwrap(),
        "SELECT * FROM fx_rates ORDER BY as_of DESC, quote"
    );
}

#[test]
fn ensure_tables_creates_registry_schema_and_snapshot_sql_runs() {
    let db = test_db();
    for sp in SOURCE_SPECS {
        let conn = db.conn.lock().unwrap();
        let cols = existing_columns(&conn, sp.table).unwrap();
        assert!(schema_matches(&cols, sp), "{}: {:?}", sp.table, cols);
        drop(conn);
        source_query(&db, sp.kind, &snapshot_sql(sp.kind).unwrap(), 10).unwrap();
    }
}

#[test]
fn keep_newest_snapshot_returns_latest_rows_ascending() {
    let db = test_db();
    {
        let conn = db.conn.lock().unwrap();
        for year in 1880..1890 {
            conn.execute_batch(&format!(
                "INSERT INTO global_temperature VALUES ('{year}-01-01', {year}, 1, 0.1)"
            ))
            .unwrap();
        }
    }
    let sql = snapshot_sql_limited("climate", 3).unwrap();
    let res = source_query(&db, "climate", &sql, 3).unwrap();
    let years: Vec<String> = res.rows.iter().map(|r| r[1].to_string()).collect();
    assert_eq!(years, vec!["1887", "1888", "1889"]);
    // Other feeds keep the plain registry ORDER BY
    assert_eq!(snapshot_sql_limited("usgs", 3), snapshot_sql("usgs"));
}

#[test]
fn ensure_tables_migrates_drifted_tables() {
    let db = LoomDb {
        conn: Mutex::new(Connection::open_in_memory().unwrap()),
    };
    {
        let conn = db.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE world_bank (country_code VARCHAR, country_name VARCHAR, indicator_id VARCHAR,
                indicator_name VARCHAR, yr INTEGER, value DOUBLE);
             INSERT INTO world_bank VALUES ('USA', 'United States', 'SP.POP.TOTL', 'Population', 2020, 1.0);
             CREATE TABLE usgs_quakes (id VARCHAR, magnitude DOUBLE, place VARCHAR, ts TIMESTAMP,
                latitude DOUBLE, longitude DOUBLE, depth DOUBLE, mag_type VARCHAR, status VARCHAR,
                tsunami BOOLEAN, sig INTEGER, net VARCHAR, updated_at TIMESTAMP);
             CREATE TABLE hn_stories (id VARCHAR, title VARCHAR, author VARCHAR, points INTEGER,
                num_comments INTEGER, url VARCHAR, created_at TIMESTAMP);
             INSERT INTO hn_stories VALUES ('1', 'kept', 'a', 1, 1, 'u', NULL);",
        )
        .unwrap();
    }
    ensure_tables(&db).unwrap();
    let conn = db.conn.lock().unwrap();
    for kind in ["world_bank", "usgs"] {
        let sp = spec(kind);
        assert!(
            schema_matches(&existing_columns(&conn, sp.table).unwrap(), sp),
            "{}",
            kind
        );
    }
    drop(conn);
    assert_eq!(
        one(&db, "SELECT COUNT(*) FROM world_bank").as_deref(),
        Some("0")
    );
    // Matching tables keep their rows.
    assert_eq!(
        one(&db, "SELECT title FROM hn_stories").as_deref(),
        Some("kept")
    );
}

// ---------------------------------------------------------------
// Dates
// ---------------------------------------------------------------

#[test]
fn civil_date_roundtrip() {
    assert_eq!(days_from_civil(1970, 1, 1), 0);
    assert_eq!(civil_from_days(0), (1970, 1, 1));
    assert_eq!(days_from_civil(2000, 3, 1), 11_017);
    assert_eq!(fmt_date(days_from_civil(2024, 2, 29) + 1), "2024-03-01");
    assert_eq!(fmt_date(days_from_civil(2026, 10, 2) - 90), "2026-07-04");
    assert_eq!(fmt_date(days_from_civil(2026, 1, 1) - 1), "2025-12-31");
    for d in (-800_000..800_000).step_by(997) {
        let (y, m, dd) = civil_from_days(d);
        assert_eq!(days_from_civil(y, m, dd), d);
    }
    assert_eq!(fmt_ts(1_790_974_028), "2026-10-02 20:47:08");
    assert_eq!(fmt_ts(-1), "1969-12-31 23:59:59");
}

#[test]
fn iso_parsing_normalizes_to_utc() {
    let p = |s: &str| parse_iso_utc(s);
    assert_eq!(
        p("2026-10-02T16:43:00-04:00").as_deref(),
        Some("2026-10-02 20:43:00")
    );
    assert_eq!(
        p("2026-10-02T22:30Z").as_deref(),
        Some("2026-10-02 22:30:00")
    );
    assert_eq!(
        p("2026-10-02T03:54:00Z").as_deref(),
        Some("2026-10-02 03:54:00")
    );
    assert_eq!(
        p("2026-09-20T00:00:00.000Z").as_deref(),
        Some("2026-09-20 00:00:00")
    );
    assert_eq!(
        p("2026-10-02T01:23:45.000").as_deref(),
        Some("2026-10-02 01:23:45")
    );
    assert_eq!(
        p("2026-09-30T00:00").as_deref(),
        Some("2026-09-30 00:00:00")
    );
    assert_eq!(
        p("2026-10-02T23:30:00+0530").as_deref(),
        Some("2026-10-02 18:00:00")
    );
    assert_eq!(
        p("2026-12-31T23:00:00-02:00").as_deref(),
        Some("2027-01-01 01:00:00")
    );
    assert_eq!(
        p("2026-09-25 09:00:00").as_deref(),
        Some("2026-09-25 09:00:00")
    );
    assert_eq!(p("2026-10-01").as_deref(), Some("2026-10-01 00:00:00"));
    assert_eq!(p(""), None);
    assert_eq!(p("not a date"), None);
    assert_eq!(p("2026-13-01"), None);
}

// ---------------------------------------------------------------
// Existing feeds
// ---------------------------------------------------------------

#[test]
fn usgs_parses_and_upserts() {
    let rows = usgs_rows(&fixture("usgs.json")).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0][0], s("hv75048562"));
    assert_eq!(rows[0][1], Cell::F64(1.83));
    assert_eq!(rows[0][3], s("2026-10-02 20:23:39"));
    assert_eq!(rows[0][4], Cell::F64(19.4148330688477));
    assert_eq!(rows[0][5], Cell::F64(-155.281997680664));

    let db = test_db();
    assert_eq!(write_rows(&db, spec("usgs"), &rows).unwrap(), 2);
    // Same quakes again (revised): replaced in place, not duplicated or recounted.
    let mut revised = rows.clone();
    revised[0][1] = Cell::F64(2.0);
    assert_eq!(write_rows(&db, spec("usgs"), &revised).unwrap(), 0);
    assert_eq!(
        one(&db, "SELECT COUNT(*) FROM usgs_quakes").as_deref(),
        Some("2")
    );
    assert_eq!(
        one(
            &db,
            "SELECT magnitude FROM usgs_quakes WHERE id = 'hv75048562'"
        )
        .as_deref(),
        Some("2.0")
    );
    assert_eq!(
        one(
            &db,
            "SELECT CAST(ts AS VARCHAR) FROM usgs_quakes WHERE id = 'hv75048562'"
        )
        .as_deref(),
        Some("2026-10-02 20:23:39")
    );
}

#[test]
fn nws_keeps_newest_with_utc_times() {
    let body = fixture("nws.json");
    let rows = nws_rows(&body, 150).unwrap();
    assert_eq!(rows.len(), 3);
    // Sent times: 20:43Z, 20:42Z, 20:41Z → already newest-first.
    assert_eq!(rows[0][8], s("2026-10-02 20:43:00"));
    assert_eq!(rows[1][8], s("2026-10-02 20:42:00"));
    assert_eq!(rows[0][1], s("Flood Advisory"));
    let capped = nws_rows(&body, 2).unwrap();
    assert_eq!(capped.len(), 2);

    let db = test_db();
    assert_eq!(write_rows(&db, spec("nws"), &rows).unwrap(), 3);
    assert_eq!(
        one(
            &db,
            "SELECT COUNT(*) FROM nws_alerts WHERE expires > effective"
        )
        .as_deref(),
        Some("3")
    );
}

#[test]
fn meteo_multi_city_parses_and_upserts() {
    let rows = meteo_rows(&fixture("meteo.json"), CITIES).unwrap();
    assert_eq!(rows.len(), 6); // 2 cities × 3 hours
    assert_eq!(rows[0][0], s("2026-09-30 00:00:00"));
    assert_eq!(rows[0][1], s("New York"));
    assert_eq!(rows[3][1], s("London"));
    assert!(matches!(rows[0][4], Cell::F64(_)));
    assert!(matches!(rows[0][8], Cell::I64(_)));

    let db = test_db();
    assert_eq!(write_rows(&db, spec("meteo"), &rows).unwrap(), 6);
    assert_eq!(write_rows(&db, spec("meteo"), &rows).unwrap(), 0);
    assert_eq!(
        one(&db, "SELECT COUNT(*) FROM meteo_weather").as_deref(),
        Some("6")
    );
    assert_eq!(CITIES.len(), 12);
    assert!(meteo_url().contains("latitude=40.71,51.51,35.68"));
}

#[test]
fn aq_multi_city_parses() {
    let rows = aq_rows(&fixture("aq.json"), CITIES).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0][1], s("New York"));
    assert_eq!(rows[0][4], Cell::F64(18.7));
    assert_eq!(rows[1][8], Cell::F64(40.0));
    let db = test_db();
    assert_eq!(write_rows(&db, spec("aq"), &rows).unwrap(), 2);
    assert_eq!(
        one(&db, "SELECT city FROM air_quality ORDER BY pm2_5 DESC").as_deref(),
        Some("New York")
    );
}

#[test]
fn fx_series_with_change_pct() {
    let rows = fx_rows(&fixture("fx.json")).unwrap();
    assert_eq!(rows.len(), 9); // 3 days × 3 quotes
                               // First day: no previous → NULL change.
    assert_eq!(rows[0][0], s("2026-07-03"));
    assert_eq!(rows[0][4], Cell::Null);
    // 2026-07-06 USD: 1.1415 vs 1.1448.
    let usd = rows
        .iter()
        .find(|r| r[0] == s("2026-07-06") && r[2] == s("USD"))
        .unwrap();
    match usd[4] {
        // change_pct is rounded to 4 decimals (parity with the web parser).
        Cell::F64(c) => assert!((c - (1.1415 / 1.1448 - 1.0) * 100.0).abs() < 5e-5),
        ref other => panic!("{:?}", other),
    }
    let db = test_db();
    assert_eq!(write_rows(&db, spec("fx"), &rows).unwrap(), 9);
    assert_eq!(
        one(
            &db,
            &format!(
                "{} LIMIT 1",
                snapshot_sql("fx")
                    .unwrap()
                    .replace("SELECT *", "SELECT CAST(as_of AS VARCHAR)")
            )
        )
        .as_deref(),
        Some("2026-07-07")
    );
    assert_eq!(
        fx_url(days_from_civil(2026, 10, 2)),
        "https://api.frankfurter.dev/v1/2026-07-04.."
    );
}

/// Shared with `src/lib/__tests__/upstreamParity.test.ts` (LOOM-436): the web
/// `parseFx` and desktop `fx_rows` must agree on the same Frankfurter body.
#[test]
fn fx_matches_shared_parity_fixture() {
    let rows = fx_rows(&fixture("fx.json")).unwrap();
    let expected = fixture("fx_parity_expected.json");
    let mut got: Vec<Value> = rows
        .iter()
        .map(|r| {
            Value::Array(
                r.iter()
                    .map(|c| match c {
                        Cell::Null => Value::Null,
                        Cell::Str(t) => Value::String(t.clone()),
                        Cell::F64(f) => serde_json::json!(f),
                        Cell::I64(i) => serde_json::json!(*i as f64),
                        Cell::Bool(b) => Value::Bool(*b),
                    })
                    .collect(),
            )
        })
        .collect();
    got.sort_by_key(|r| format!("{}|{}", r[0].as_str().unwrap(), r[2].as_str().unwrap()));
    fn norm(v: &Value) -> Value {
        match v {
            Value::Number(n) => serde_json::json!(n.as_f64().unwrap()),
            Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
            other => other.clone(),
        }
    }
    assert_eq!(norm(&Value::Array(got)), norm(&expected["rows"]));
}

#[test]
fn opensky_parses_states() {
    let rows = opensky_rows(&fixture("opensky.json")).unwrap();
    assert_eq!(rows.len(), 2); // third state has no position
    assert_eq!(rows[0][1], s("UAL123"));
    assert_eq!(rows[1][1], Cell::Null); // blank callsign
    assert_eq!(rows[1][5], Cell::Null);
    assert_eq!(rows[1][8], Cell::Bool(true));
    let db = test_db();
    assert_eq!(write_rows(&db, spec("opensky"), &rows).unwrap(), 2);
    assert_eq!(write_rows(&db, spec("opensky"), &rows).unwrap(), 2); // append
    assert_eq!(
        one(&db, "SELECT COUNT(*) FROM opensky_aircraft").as_deref(),
        Some("4")
    );
}

#[test]
fn adsb_fallback_converts_units_and_dedupes() {
    let body = fixture("adsb.json");
    let rows = adsb_rows(&[body.clone(), body]);
    assert_eq!(rows.len(), 3, "duplicates across points are dropped");
    assert_eq!(rows[0][0], s("a82cb1"));
    assert_eq!(rows[0][1], s("COL626"));
    match (&rows[0][5], &rows[0][6]) {
        (Cell::F64(alt), Cell::F64(v)) => {
            assert!((alt - 38000.0 * 0.3048).abs() < 1e-6);
            assert!((v - 349.5 * 0.514444).abs() < 1e-6);
        }
        other => panic!("{:?}", other),
    }
    let ground = &rows[2];
    assert_eq!(ground[5], Cell::F64(0.0));
    assert_eq!(ground[8], Cell::Bool(true));
    assert_eq!(rows[0][9], s(&fmt_ts(1_790_974_071)));
    let db = test_db();
    assert_eq!(write_rows(&db, spec("opensky"), &rows).unwrap(), 3);
}

#[test]
fn crypto_primary_and_fallback() {
    let cg = coingecko_rows(&fixture("coingecko.json")).unwrap();
    let cp = coinpaprika_rows(&fixture("coinpaprika.json")).unwrap();
    assert_eq!(cg.len(), 2);
    assert_eq!(cp.len(), 2);
    assert_eq!(cg[0][1], s("BTC"));
    assert_eq!(cp[0][1], s("BTC"));
    assert_eq!(cp[0][0], s("btc-bitcoin"));
    assert_eq!(cp[0][7], Cell::I64(1));
    assert_eq!(cp[0][6], Cell::F64(-0.25));
    let db = test_db();
    assert_eq!(write_rows(&db, spec("crypto"), &cp).unwrap(), 2);
    assert!(coingecko_rows(&serde_json::json!({"status": {"error_code": 429}})).is_err());
}

#[test]
fn spacex_from_launch_library() {
    let rows = spacex_rows(&fixture("ll2_spacex.json")).unwrap();
    assert_eq!(rows.len(), 2);
    let r = &rows[0];
    assert_eq!(r[1], s("Falcon Heavy | NROL-97"));
    assert_eq!(r[2], s("2026-10-02 03:54:00"));
    assert_eq!(r[3], Cell::Bool(true));
    assert_eq!(r[4], Cell::Bool(false));
    assert_eq!(r[5], s("Falcon Heavy"));
    assert_eq!(r[6], Cell::I64(735));
    assert_eq!(
        r[7],
        s("Classified payload for the US National Reconnaissance Office.")
    );
    // Missing pieces → NULL, rocket from the name.
    let bare = spacex_rows(&serde_json::json!({"results": [{"id": "x", "name": "Falcon 9 Block 5 | Starlink", "net": "2026-01-01T00:00:00Z", "status": {"abbrev": "Failure"}}]})).unwrap();
    assert_eq!(bare[0][3], Cell::Bool(false));
    assert_eq!(bare[0][5], s("Falcon 9 Block 5"));
    assert_eq!(bare[0][6], Cell::Null);
    assert_eq!(bare[0][7], Cell::Null);
    let db = test_db();
    assert_eq!(write_rows(&db, spec("spacex"), &rows).unwrap(), 2);
}

#[test]
fn upcoming_launches_list_mode() {
    let rows = launches_rows(&fixture("ll2_upcoming_list.json")).unwrap();
    assert_eq!(rows.len(), 2);
    let r = &rows[0];
    assert_eq!(r[4], s("Launch Complex 39A"));
    assert_eq!(r[5], s("Kennedy Space Center, FL, USA"));
    assert_eq!(r[6], s("SpaceX"));
    assert_eq!(r[7], s("Falcon Heavy"));
    assert_eq!(r[8], Cell::Bool(true));
    let sub = launches_rows(&serde_json::json!({"results": [{"id": 1, "name": "New Shepard | NS-40", "orbit": "Suborbital"}]})).unwrap();
    assert_eq!(sub[0][0], s("1"));
    assert_eq!(sub[0][8], Cell::Bool(false));
    let db = test_db();
    assert_eq!(write_rows(&db, spec("launches"), &rows).unwrap(), 2);
}

#[test]
fn countries_join_world_bank_population() {
    let pop = wb_values_by_iso3(&fixture("wb_pop_latest.json"));
    assert!(pop.contains_key("USA"));
    let rows = countries_rows(&fixture("countries.json"), &pop).unwrap();
    assert_eq!(rows.len(), 4);
    let by = |cca3: &str| rows.iter().find(|r| r[1] == s(cca3)).unwrap().clone();
    let aruba = by("ABW");
    assert_eq!(aruba[0], s("Aruba"));
    assert_eq!(aruba[4], Cell::I64(108_785));
    assert_eq!(aruba[5], Cell::F64(180.0));
    match aruba[6] {
        Cell::F64(d) => assert!((d - 108_785.0 / 180.0).abs() < 1e-9),
        ref o => panic!("{:?}", o),
    }
    assert_eq!(aruba[7], s("Oranjestad"));
    assert_eq!(aruba[8], Cell::Bool(false));
    // Kosovo: mledoze UNK ↔ World Bank XKX; independent: null → NULL.
    let kosovo = by("UNK");
    assert!(matches!(kosovo[4], Cell::I64(_)));
    assert_eq!(kosovo[8], Cell::Null);
    // Antarctica: no population, no capital.
    let ata = by("ATA");
    assert_eq!(ata[4], Cell::Null);
    assert_eq!(ata[6], Cell::Null);
    assert_eq!(ata[7], Cell::Null);
    let db = test_db();
    assert_eq!(write_rows(&db, spec("countries"), &rows).unwrap(), 4);
    assert_eq!(
        one(
            &db,
            &format!(
                "{} LIMIT 1",
                snapshot_sql("countries")
                    .unwrap()
                    .replace("SELECT *", "SELECT name")
            )
        )
        .as_deref(),
        Some("United States")
    );
}

#[test]
fn world_bank_pivots_wide_and_drops_aggregates() {
    let countries = wb_country_names(&fixture("wb_countries.json")).unwrap();
    assert!(countries.contains_key("USA"));
    assert!(countries.contains_key("XKX"));
    assert!(
        !countries.contains_key("WLD"),
        "aggregates (region NA) are dropped"
    );
    assert!(!countries.contains_key("AFE"));

    let pop = serde_json::json!([{"page": 1}, [
        {"countryiso3code": "USA", "date": "2023", "value": 334914895.0},
        {"countryiso3code": "AFE", "date": "2023", "value": 750000000.0},
        {"countryiso3code": "ABW", "date": "2023", "value": null}
    ]]);
    let series = vec![(2usize, pop), (4usize, fixture("wb_indicator_co2.json"))];
    let rows = wb_wide_rows(&countries, &series);
    assert!(rows.iter().all(|r| r[0] != s("AFE")));
    let usa23 = rows
        .iter()
        .find(|r| r[0] == s("USA") && r[2] == Cell::I64(2023))
        .unwrap();
    assert_eq!(usa23[1], s("United States"));
    assert_eq!(usa23[3], Cell::Null); // gdp not fetched in this test
    assert_eq!(usa23[5], Cell::I64(334_914_895));
    assert!(matches!(usa23[7], Cell::F64(v) if v > 5.0));
    let usa22 = rows
        .iter()
        .find(|r| r[0] == s("USA") && r[2] == Cell::I64(2022))
        .unwrap();
    assert_eq!(usa22[5], Cell::Null);

    let db = test_db();
    let n = write_rows(&db, spec("world_bank"), &rows).unwrap();
    assert_eq!(n as usize, rows.len());
    assert_eq!(
        one(
            &db,
            "SELECT COUNT(DISTINCT country_code || yr) = COUNT(*) FROM world_bank"
        )
        .as_deref(),
        Some("true")
    );
    assert!(wb_indicator_url("EN.GHG.CO2.PC.CE.AR5").contains("date=2000:"));
}

#[test]
fn hn_fema_covid_nyc311_iss_parse() {
    let hn = hn_rows(&serde_json::json!({"hits": [{"objectID": "1", "title": null, "story_title": "T", "author": "a", "points": 10, "num_comments": 2, "url": "u", "created_at": "2026-10-02T18:00:00Z"}]})).unwrap();
    assert_eq!(hn[0][1], s("T"));
    assert_eq!(hn[0][6], s("2026-10-02 18:00:00"));

    let fema = fema_rows(&serde_json::json!({"DisasterDeclarationsSummaries": [{"id": "abc", "disasterNumber": 4890, "state": "TX", "declarationType": "DR", "declarationTitle": "STORMS", "incidentType": "Flood", "declarationDate": "2026-09-20T00:00:00.000Z", "incidentBeginDate": "2026-09-01T00:00:00.000Z", "fyDeclared": 2026}]})).unwrap();
    assert_eq!(fema[0][1], Cell::I64(4890));
    assert_eq!(fema[0][6], s("2026-09-20 00:00:00"));

    let covid = covid_rows(&serde_json::json!([{"country": "USA", "cases": 111820082, "todayCases": 0, "deaths": 1219487, "todayDeaths": 0, "recovered": 109814428, "active": 786167, "casesPerOneMillion": 333985, "deathsPerOneMillion": 3642, "population": 334805269, "continent": "North America"}, {"cases": 1}])).unwrap();
    assert_eq!(covid.len(), 1);

    let nyc = nyc311_rows(&serde_json::json!([{"unique_key": "65000001", "created_date": "2026-10-02T01:23:45.000", "complaint_type": "Noise", "descriptor": "Loud Music", "borough": "BROOKLYN", "city": "BROOKLYN", "latitude": "40.6782", "longitude": "-73.9442", "status": "Open", "agency": "NYPD"}])).unwrap();
    assert_eq!(nyc[0][6], Cell::F64(40.6782));
    // Zone-less Socrata times are America/New_York → UTC (EDT in October).
    assert_eq!(nyc[0][1], s("2026-10-02 05:23:45"));

    let iss = iss_rows(&serde_json::json!([{"latitude": 1.0, "longitude": 2.0, "altitude": 420.1, "velocity": 27600.0, "visibility": "daylight", "timestamp": 1790974000}, {"latitude": 3.0, "longitude": 4.0, "timestamp": 1790974600}])).unwrap();
    assert_eq!(iss.len(), 2);
    assert_eq!(
        iss_rows(&serde_json::json!({"latitude": 1.0, "longitude": 2.0, "timestamp": 1}))
            .unwrap()
            .len(),
        1
    );

    let db = test_db();
    assert_eq!(write_rows(&db, spec("hn"), &hn).unwrap(), 1);
    assert_eq!(write_rows(&db, spec("fema"), &fema).unwrap(), 1);
    assert_eq!(write_rows(&db, spec("covid"), &covid).unwrap(), 1);
    assert_eq!(write_rows(&db, spec("nyc311"), &nyc).unwrap(), 1);
    assert_eq!(write_rows(&db, spec("iss"), &iss).unwrap(), 2);
}

// ---------------------------------------------------------------
// New sources
// ---------------------------------------------------------------

#[test]
fn eonet_latest_geometry_points_and_polygons() {
    let rows = eonet_rows(&fixture("eonet.json")).unwrap();
    assert_eq!(rows.len(), 3);
    let typhoon = &rows[0];
    assert_eq!(typhoon[0], s("EONET_24962"));
    assert_eq!(typhoon[2], s("Severe Storms"));
    assert_eq!(typhoon[3], s("JTWC"));
    // Latest of 9 track points.
    assert_eq!(typhoon[4], s("2026-10-02 12:00:00"));
    assert_eq!(typhoon[5], Cell::F64(17.7));
    assert_eq!(typhoon[6], Cell::F64(144.6));
    assert_eq!(typhoon[7], Cell::F64(70.0));
    assert_eq!(typhoon[8], s("kts"));
    assert_eq!(typhoon[9], s("open"));
    // Polygon → centroid of the first ring (closing vertex ignored).
    let fire = rows.iter().find(|r| r[0] == s("EONET_POLY")).unwrap();
    assert_eq!(fire[5], Cell::F64(38.5));
    assert_eq!(fire[6], Cell::F64(-119.5));
    assert_eq!(fire[2], s("Wildfires"));

    let db = test_db();
    assert_eq!(write_rows(&db, spec("eonet"), &rows).unwrap(), 3);
    // Replace: a second poll swaps the snapshot.
    assert_eq!(write_rows(&db, spec("eonet"), &rows[..1]).unwrap(), 1);
    assert_eq!(
        one(&db, "SELECT COUNT(*) FROM natural_events").as_deref(),
        Some("1")
    );
}

/// Shared with `src/lib/__tests__/citibikeParity.test.ts` (LOOM-435): the Worker
/// and desktop paths must emit identical typed rows for the same GBFS payloads.
#[test]
fn citibike_matches_shared_parity_fixture() {
    let info = citibike_info(&fixture("gbfs_parity_info.json")).unwrap();
    let rows = citibike_rows(&fixture("gbfs_parity_status.json"), &info).unwrap();
    let expected = fixture("gbfs_parity_expected.json");

    let columns: Vec<&str> = expected["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap())
        .collect();
    let spec_cols: Vec<&str> = spec("citibike").columns.iter().map(|c| c.0).collect();
    assert_eq!(
        columns, spec_cols,
        "fixture columns drifted from the Rust table schema"
    );

    let got: Vec<Value> = rows
        .iter()
        .map(|r| {
            Value::Array(
                r.iter()
                    .map(|c| match c {
                        Cell::Null => Value::Null,
                        Cell::Str(t) => {
                            // fmt_ts "YYYY-MM-DD HH:MM:SS" → ISO-8601 UTC like the Worker.
                            if t.len() == 19 && t.as_bytes()[10] == b' ' {
                                Value::String(format!("{}.000Z", t.replacen(' ', "T", 1)))
                            } else {
                                Value::String(t.clone())
                            }
                        }
                        Cell::F64(f) => serde_json::json!(f),
                        Cell::I64(i) => serde_json::json!(i),
                        Cell::Bool(b) => Value::Bool(*b),
                    })
                    .collect(),
            )
        })
        .collect();
    // JSON `75` and `75.0` are the same typed value (JS has one number type).
    fn norm(v: &Value) -> Value {
        match v {
            Value::Number(n) => serde_json::json!(n.as_f64().unwrap()),
            Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
            other => other.clone(),
        }
    }
    assert_eq!(norm(&Value::Array(got)), norm(&expected["rows"]));
}

#[test]
fn citibike_joins_info_and_status() {
    let info = citibike_info(&fixture("gbfs_info.json")).unwrap();
    assert_eq!(info.len(), 3);
    let rows = citibike_rows(&fixture("gbfs_status.json"), &info).unwrap();
    // Not-installed dock and the station missing from info are skipped.
    assert_eq!(rows.len(), 2);
    let vesey = rows
        .iter()
        .find(|r| r[1] == s("Vesey St & Church St"))
        .unwrap();
    assert_eq!(vesey[4], Cell::I64(78));
    assert_eq!(vesey[5], Cell::I64(60));
    assert_eq!(vesey[6], Cell::I64(12));
    assert_eq!(vesey[7], Cell::I64(18));
    assert_eq!(vesey[8], Cell::F64(76.9)); // 60 / 78 → 76.9 %
    assert_eq!(vesey[9], Cell::Bool(true));
    assert_eq!(vesey[10], s(&fmt_ts(1_790_973_950))); // station last_reported wins over feed last_updated

    let db = test_db();
    assert_eq!(write_rows(&db, spec("citibike"), &rows).unwrap(), 2);
    assert_eq!(
        one(
            &db,
            &format!(
                "{} LIMIT 1",
                snapshot_sql("citibike")
                    .unwrap()
                    .replace("SELECT *", "SELECT bikes_available")
            )
        )
        .as_deref(),
        Some("60")
    );
}

#[test]
fn space_weather_kp_and_storm_levels() {
    assert_eq!(storm_level(4.67), "G1");
    assert_eq!(storm_level(5.0), "G1");
    assert_eq!(storm_level(6.33), "G2");
    assert_eq!(storm_level(7.0), "G3");
    assert_eq!(storm_level(8.67), "G5");
    assert_eq!(storm_level(9.0), "G5");
    // Shared with upstreamParity.test.ts so desktop and web G-levels can't drift.
    let cases = fixture("storm_levels.json");
    for case in cases.as_array().unwrap() {
        let kp = case[0].as_f64().unwrap();
        assert_eq!(storm_level(kp), case[1].as_str().unwrap(), "Kp {kp}");
    }

    let rows = kp_rows(&fixture("kp.json")).unwrap();
    assert_eq!(rows.len(), 4);
    assert_eq!(
        rows[0],
        vec![
            s("2026-09-25 00:00:00"),
            Cell::F64(3.67),
            Cell::I64(22),
            Cell::I64(8),
            s("G0")
        ]
    );
    assert_eq!(rows[3][4], s("G3"));

    // Older SWPC shape: array of string arrays with a header row.
    let legacy = serde_json::json!([
        ["time_tag", "Kp", "a_running", "station_count"],
        ["2024-05-10 21:00:00.000", "9.00", "400", "8"]
    ]);
    let rows2 = kp_rows(&legacy).unwrap();
    assert_eq!(
        rows2,
        vec![vec![
            s("2024-05-10 21:00:00"),
            Cell::F64(9.0),
            Cell::I64(400),
            Cell::I64(8),
            s("G5")
        ]]
    );

    let db = test_db();
    assert_eq!(write_rows(&db, spec("spaceweather"), &rows).unwrap(), 4);
}

#[test]
fn uk_carbon_merges_yesterday_and_today() {
    let rows = ukcarbon_rows(&[fixture("ukc_yesterday.json"), fixture("ukc_today.json")]).unwrap();
    assert_eq!(rows.len(), 4);
    assert_eq!(
        rows[0],
        vec![
            s("2026-09-30 23:00:00"),
            Cell::I64(161),
            Cell::I64(181),
            s("high")
        ]
    );
    let last = rows.last().unwrap();
    assert_eq!(last[0], s("2026-10-02 22:30:00"));
    assert_eq!(last[2], Cell::Null);
    // An overlapping half-hour keeps the reading that has an actual.
    let dup = serde_json::json!({"data": [{"from": "2026-09-30T23:00Z", "intensity": {"forecast": 1, "actual": null, "index": "low"}}]});
    let merged = ukcarbon_rows(&[fixture("ukc_yesterday.json"), dup]).unwrap();
    assert_eq!(merged[0][2], Cell::I64(181));

    let db = test_db();
    assert_eq!(write_rows(&db, spec("ukcarbon"), &rows).unwrap(), 4);
}

#[test]
fn pageviews_filters_and_reranks() {
    let rows = pageviews_rows(&fixture("pageviews.json")).unwrap();
    // 12 articles − Main_Page, Special:Search, Wikipedia:Featured_pictures.
    assert_eq!(rows.len(), 9);
    assert_eq!(
        rows[0],
        vec![
            Cell::I64(1),
            s("Christa Pike"),
            Cell::I64(4_309_025),
            s("2026-10-01")
        ]
    );
    assert_eq!(rows[1][1], s("USS Theodore Roosevelt (CVN-71)"));
    assert_eq!(rows[8][0], Cell::I64(9));

    let many: Vec<Value> = (0..130)
        .map(|i| serde_json::json!({"article": format!("A_{}", i), "views": 1000 - i, "rank": i + 1}))
        .chain([
            serde_json::json!({"article": "-", "views": 5000}),
            serde_json::json!({"article": "File:X.jpg", "views": 5000}),
            serde_json::json!({"article": "Talk:Y", "views": 5000}),
            serde_json::json!({"article": "Portal:Z", "views": 5000}),
        ])
        .collect();
    let body = serde_json::json!({"items": [{"year": "2026", "month": "10", "day": "01", "articles": many}]});
    let top = pageviews_rows(&body).unwrap();
    assert_eq!(top.len(), 100);
    assert!(top
        .iter()
        .all(|r| matches!(&r[1], Cell::Str(a) if a.starts_with("A "))));

    let db = test_db();
    assert_eq!(write_rows(&db, spec("pageviews"), &rows).unwrap(), 9);
    assert_eq!(
        one(
            &db,
            "SELECT CAST(day AS VARCHAR) FROM wiki_top_articles LIMIT 1"
        )
        .as_deref(),
        Some("2026-10-01")
    );
    assert_eq!(
        pageviews_url(days_from_civil(2026, 10, 1)),
        "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/2026/10/01"
    );
}

#[test]
fn climate_monthly_anomalies() {
    let rows = climate_rows(&fixture("climate.json")).unwrap();
    assert_eq!(rows.len(), 5);
    assert_eq!(
        rows[0],
        vec![
            s("1880-01-01"),
            Cell::I64(1880),
            Cell::I64(1),
            Cell::F64(-0.4)
        ]
    );
    let last = rows.last().unwrap();
    assert_eq!(last[1], Cell::I64(2026));
    assert_eq!(last[2], Cell::I64(8));
    assert_eq!(last[3], Cell::F64(1.32));
    // Older shape: bare values, sometimes strings.
    let alt = climate_rows(
        &serde_json::json!({"data": {"202001": "1.05", "202002": {"anomaly": 1.2}, "junk": 1}}),
    )
    .unwrap();
    assert_eq!(alt.len(), 2);
    assert_eq!(alt[0][3], Cell::F64(1.05));

    let db = test_db();
    assert_eq!(write_rows(&db, spec("climate"), &rows).unwrap(), 5);
    assert_eq!(
        one(
            &db,
            "SELECT CAST(ts AS VARCHAR) FROM global_temperature ORDER BY ts ASC LIMIT 1"
        )
        .as_deref(),
        Some("1880-01-01")
    );
    assert!(climate_url(2026).ends_with("/1880-2026/data.json"));
}

// ---------------------------------------------------------------
// Feeds added with the GDACS … debt batch
// ---------------------------------------------------------------

fn fixture_text(name: &str) -> String {
    let path = format!(
        "{}/tests/fixtures/sources/{}",
        env!("CARGO_MANIFEST_DIR"),
        name
    );
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {}", path, e))
}

fn approx(c: &Cell, want: f64) {
    match c {
        Cell::F64(v) => assert!(
            (v - want).abs() < 1e-6 * want.abs().max(1.0),
            "{} != {}",
            v,
            want
        ),
        other => panic!("expected {}, got {:?}", want, other),
    }
}

#[test]
fn gdacs_events_typed_and_deduped() {
    let rows = gdacs_rows(&fixture("gdacs.json")).unwrap();
    assert_eq!(rows.len(), 5);
    let tc = &rows[0];
    assert_eq!(tc[0], s("TC1001321"));
    assert_eq!(tc[1], s("Tropical cyclone"));
    assert_eq!(tc[2], s("Tropical Cyclone NOLO-26"));
    assert_eq!(tc[3], s("Green"));
    assert_eq!(tc[4], Cell::F64(1.0));
    assert_eq!(tc[5], s("United States"));
    assert_eq!(
        (tc[6].clone(), tc[7].clone()),
        (Cell::F64(23.3), Cell::F64(-167.8))
    );
    assert_eq!(tc[8], s("2026-09-13 21:00:00"));
    assert_eq!(tc[9], s("2026-10-02 21:00:00"));
    assert_eq!(tc[10], Cell::F64(249.9984));
    assert_eq!(tc[11], s("km/h"));
    let types: Vec<Cell> = rows.iter().map(|r| r[1].clone()).collect();
    assert_eq!(
        types,
        vec![
            s("Tropical cyclone"),
            s("Earthquake"),
            s("Drought"),
            s("Flood"),
            s("Wildfire")
        ]
    );
    let dr = rows.iter().find(|r| r[0] == s("DR1018332")).unwrap();
    assert_eq!(dr[3], s("Orange"));
    assert_eq!(dr[11], s("km2"));
    // Empty severity unit → NULL.
    assert_eq!(
        rows.iter().find(|r| r[0] == s("FL1103888")).unwrap()[11],
        Cell::Null
    );
    assert_eq!(gdacs_event_type("VO"), "Volcano");

    // Same event twice: the later episode wins, first-seen order kept;
    // no name → description; no Point → bbox centre.
    let dup = serde_json::json!({"features": [
        {"geometry": {"type": "Point", "coordinates": [10.0, 20.0]},
         "properties": {"eventtype": "VO", "eventid": 7, "episodeid": 1, "name": "Old", "alertlevel": "Green", "todate": "2026-10-01T00:00:00"}},
        {"bbox": [0.0, 0.0, 4.0, 2.0], "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [4, 0], [4, 2], [0, 0]]]},
         "properties": {"eventtype": "FL", "eventid": 8, "description": "Flood somewhere", "todate": "2026-10-01T00:00:00"}},
        {"geometry": {"type": "Point", "coordinates": [11.0, 21.0]},
         "properties": {"eventtype": "VO", "eventid": 7, "episodeid": 2, "name": "New", "alertlevel": "Red", "todate": "2026-10-02T00:00:00"}},
        {"geometry": {"type": "Point", "coordinates": [12.0, 22.0]},
         "properties": {"eventtype": "VO", "eventid": 7, "episodeid": 0, "name": "Stale", "todate": "2026-09-01T00:00:00"}}
    ]});
    let d = gdacs_rows(&dup).unwrap();
    assert_eq!(d.len(), 2);
    assert_eq!(d[0][0], s("VO7"));
    assert_eq!(d[0][2], s("New"));
    assert_eq!(d[0][3], s("Red"));
    assert_eq!(d[0][6], Cell::F64(21.0));
    assert_eq!(d[1][2], s("Flood somewhere"));
    assert_eq!(
        (d[1][6].clone(), d[1][7].clone()),
        (Cell::F64(1.0), Cell::F64(2.0))
    );

    let db = test_db();
    assert_eq!(write_rows(&db, spec("gdacs"), &rows).unwrap(), 5);
    assert_eq!(
        one(
            &db,
            "SELECT id FROM disaster_alerts ORDER BY start_ts DESC LIMIT 1"
        )
        .as_deref(),
        Some("EQ1569163")
    );
}

#[test]
fn buoys_fixed_width_with_missing_values() {
    let rows = buoys_rows(&fixture_text("buoys.txt")).unwrap();
    assert_eq!(rows.len(), 4);
    assert_eq!(
        rows[0],
        vec![
            s("22101"),
            Cell::F64(37.24),
            Cell::F64(126.02),
            s("2026-10-02 23:00:00"),
            Cell::F64(100.0),
            Cell::F64(4.0),
            Cell::Null,
            Cell::F64(0.0),
            Cell::F64(0.0),
            Cell::Null,
            Cell::F64(18.0),
            Cell::F64(23.4),
        ]
    );
    let monterey = rows.iter().find(|r| r[0] == s("46042")).unwrap();
    assert_eq!(monterey[2], Cell::F64(-122.408));
    assert_eq!(monterey[6], Cell::F64(5.0));
    assert_eq!(monterey[8], Cell::F64(10.0));
    assert_eq!(monterey[9], Cell::F64(1011.6));
    assert_eq!(rows[1][4], Cell::Null); // WDIR "MM"
    let buzz = rows.iter().find(|r| r[0] == s("BUZM3")).unwrap();
    assert_eq!(buzz[3], s("2026-10-03 00:00:00"));
    assert_eq!(buzz[7], Cell::Null);
    assert!(buoys_rows("#STN LAT LON\n#text deg deg\n").is_err());

    let db = test_db();
    assert_eq!(write_rows(&db, spec("buoys"), &rows).unwrap(), 4);
    assert_eq!(
        one(
            &db,
            "SELECT station FROM ocean_buoys ORDER BY wave_height_m DESC NULLS LAST LIMIT 1"
        )
        .as_deref(),
        Some("46042")
    );
}

#[test]
fn mbta_vehicles_join_routes_and_humanize() {
    let rows = mbta_rows(&fixture("mbta.json")).unwrap();
    assert_eq!(rows.len(), 7);
    let bus = &rows[0];
    assert_eq!(bus[0], s("y3243"));
    assert_eq!(bus[1], s("3243"));
    assert_eq!(bus[2], s("57"));
    assert_eq!(bus[3], s("Bus"));
    assert_eq!(bus[6], Cell::F64(90.0));
    assert_eq!(bus[7], Cell::Null); // speed null stays null
    assert_eq!(bus[8], s("Stopped at"));
    assert_eq!(bus[9], s("Many seats available"));
    assert_eq!(bus[10], s("2026-10-03 00:25:24")); // -04:00 → UTC
    let by = |id: &str| rows.iter().find(|r| r[0] == s(id)).unwrap().clone();
    // No short_name → long_name.
    assert_eq!(by("1854")[2], s("Framingham/Worcester Line"));
    assert_eq!(by("1854")[3], s("Commuter rail"));
    assert_eq!(by("1854")[8], s("In transit to"));
    assert_eq!(by("1854")[9], Cell::Null);
    assert_eq!(by("R-548BFAD1")[2], s("Red Line"));
    assert_eq!(by("R-548BFAD1")[3], s("Subway"));
    let green = by("G-10077");
    assert_eq!(green[2], s("B"));
    assert_eq!(green[3], s("Light rail"));
    approx(&green[7], 4.2 * 3600.0 / 1609.344);
    let ferry = by("JOHN KEITH");
    assert_eq!(ferry[1], Cell::Null);
    assert_eq!(ferry[2], s("Quincy Ferry"));
    assert_eq!(ferry[3], s("Ferry"));
    assert_eq!(
        humanize_enum(Some(&serde_json::json!("INCOMING_AT"))),
        s("Incoming at")
    );
    assert_eq!(humanize_enum(Some(&serde_json::json!("FULL"))), s("Full"));
    // Route missing from `included` → its id, unknown type.
    let orphan = mbta_rows(
        &serde_json::json!({"data": [{"id": "v1", "attributes": {"label": "1"},
        "relationships": {"route": {"data": {"id": "Mattapan", "type": "route"}}}}]}),
    )
    .unwrap();
    assert_eq!(orphan[0][2], s("Mattapan"));
    assert_eq!(orphan[0][3], Cell::Null);

    let db = test_db();
    assert_eq!(write_rows(&db, spec("mbta"), &rows).unwrap(), 7);
    assert_eq!(
        one(
            &db,
            "SELECT COUNT(*) FROM mbta_vehicles WHERE speed_mph IS NOT NULL"
        )
        .as_deref(),
        Some("2")
    );
}

#[test]
fn aurora_downsamples_to_two_degree_cells() {
    let rows = aurora_rows(&fixture("aurora.json")).unwrap();
    let ts = s("2026-10-03 01:50:00");
    let cell =
        |lon: f64, lat: f64, p: i64| vec![Cell::F64(lon), Cell::F64(lat), Cell::I64(p), ts.clone()];
    assert_eq!(
        rows,
        vec![
            cell(0.0, 64.0, 9),
            cell(0.0, 66.0, 11),
            cell(2.0, 64.0, 8),
            cell(2.0, 66.0, 11),
            cell(-2.0, 64.0, 9),
            cell(-2.0, 66.0, 11)
        ]
    );
    // Max of the four 1° points; cells under 3 % dropped; 180 stays 180, 182 → −178.
    let body = serde_json::json!({"Forecast Time": "2026-10-03T01:50:00Z", "coordinates": [
        [10, -70, 1], [11, -70, 4], [10, -69, 2], [11, -69, 0],
        [20, 50, 2], [21, 51, 2],
        [180, 0, 5], [182, 0, 6]
    ]});
    let r = aurora_rows(&body).unwrap();
    assert_eq!(r.len(), 3);
    assert_eq!(r[0][..3], [Cell::F64(10.0), Cell::F64(-70.0), Cell::I64(4)]);
    assert_eq!(r[1][0], Cell::F64(180.0));
    assert_eq!(r[2][0], Cell::F64(-178.0));

    let db = test_db();
    assert_eq!(write_rows(&db, spec("aurora"), &rows).unwrap(), 6);
    assert_eq!(
        one(&db, "SELECT MIN(longitude) FROM aurora_forecast").as_deref(),
        Some("-2.0")
    );
}

#[test]
fn asteroid_close_approaches() {
    let rows = asteroids_rows(&fixture("asteroids.json")).unwrap();
    assert_eq!(rows.len(), 3);
    let r = &rows[0];
    assert_eq!(r[0], s("2026 RP39"));
    assert_eq!(r[1], s("(2026 RP39)"));
    assert_eq!(r[2], s("2026-10-03 12:01:00"));
    approx(&r[3], 0.0156288744154242 * 389.17);
    approx(&r[4], 0.0156288744154242 * 149_597_870.7);
    approx(&r[5], 6.13940599510947);
    assert_eq!(r[6], Cell::F64(26.254));
    approx(
        &r[7],
        1329.0 / 0.14f64.sqrt() * 10f64.powf(-26.254 / 5.0) * 1000.0,
    );
    match r[7] {
        Cell::F64(d) => assert!(d > 15.0 && d < 25.0, "{}", d),
        ref o => panic!("{:?}", o),
    }
    assert_eq!(
        parse_cad_date("2026-Dec-31 23:59").as_deref(),
        Some("2026-12-31 23:59:00")
    );
    assert_eq!(parse_cad_date("2026-Foo-01 00:00"), None);
    // Empty window: no `data` key.
    assert!(
        asteroids_rows(&serde_json::json!({"fields": ["des"], "count": 0}))
            .unwrap()
            .is_empty()
    );

    let db = test_db();
    assert_eq!(write_rows(&db, spec("asteroids"), &rows).unwrap(), 3);
    assert_eq!(
        one(
            &db,
            "SELECT designation FROM asteroid_approaches ORDER BY approach_ts ASC LIMIT 1"
        )
        .as_deref(),
        Some("2026 RP39")
    );
}

#[test]
fn steam_top_games() {
    let rows = steam_rows(&fixture("steam.json")).unwrap();
    assert_eq!(rows.len(), 3);
    let cs = rows.iter().find(|r| r[0] == s("730")).unwrap();
    assert_eq!(cs[1], s("Counter-Strike: Global Offensive"));
    assert_eq!(cs[2], s("Valve"));
    assert_eq!(cs[3], Cell::I64(1_013_936));
    assert_eq!(cs[4], Cell::I64(7_642_084));
    assert_eq!(cs[5], Cell::I64(1_173_003));
    approx(&cs[6], 7_642_084.0 / (7_642_084.0 + 1_173_003.0) * 100.0);
    assert_eq!(cs[7], Cell::I64(100_000_000));
    assert_eq!(cs[8], Cell::F64(0.0));
    assert_eq!(cs[9], Cell::F64(0.0));
    let paid = steam_rows(&serde_json::json!({"9": {"appid": 9, "name": "G", "developer": "", "positive": 0, "negative": 0,
        "owners": "50,000,000 .. 100,000,000", "price": "1999", "average_2weeks": 90, "discount": "40", "ccu": 5}})).unwrap();
    assert_eq!(paid[0][2], Cell::Null);
    assert_eq!(paid[0][6], Cell::Null); // no reviews
    assert_eq!(paid[0][7], Cell::I64(50_000_000));
    assert_eq!(paid[0][8], Cell::F64(19.99));
    assert_eq!(paid[0][9], Cell::F64(40.0));
    assert_eq!(owners_lower_bound("0 .. 20,000"), Some(0));

    let db = test_db();
    assert_eq!(write_rows(&db, spec("steam"), &rows).unwrap(), 3);
    assert_eq!(
        one(
            &db,
            "SELECT name FROM steam_games ORDER BY peak_players DESC LIMIT 1"
        )
        .as_deref(),
        Some("Counter-Strike: Global Offensive")
    );
}

#[test]
fn bitcoin_blocks_from_pages() {
    let page = fixture("mempool_blocks.json");
    assert_eq!(min_block_height(&page), Some(969_649));
    // Overlapping pages are deduped by height.
    let rows = bitcoin_rows(&[page.clone(), page]).unwrap();
    assert_eq!(rows.len(), 2);
    let b = &rows[0];
    assert_eq!(b[0], Cell::I64(969_650));
    assert_eq!(b[1], s(&fmt_ts(1_790_986_810)));
    assert_eq!(b[2], Cell::I64(6643));
    approx(&b[3], 1.513504);
    approx(&b[4], 0.38669064748201437);
    approx(&b[5], 0.00541722);
    approx(&b[6], 3.13041722);
    assert_eq!(b[7], s("Foundry USA"));
    assert_eq!(rows[1][7], s("ViaBTC"));
    assert!(bitcoin_rows(&[serde_json::json!([])]).is_err());

    let db = test_db();
    assert_eq!(write_rows(&db, spec("bitcoin"), &rows).unwrap(), 2);
    assert_eq!(
        one(&db, "SELECT MAX(height) FROM bitcoin_blocks").as_deref(),
        Some("969650")
    );
}

#[test]
fn treasury_debt_to_the_penny() {
    let rows = debt_rows(&fixture("debt.json")).unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0][0], s("2026-10-01"));
    assert_eq!(rows[0][1], Cell::F64(40_260_641_972_390.03));
    assert_eq!(rows[0][2], Cell::F64(32_433_790_394_253.86));
    assert_eq!(rows[0][3], Cell::F64(7_826_851_578_136.17));
    // 1993: only the total is published ("null" strings).
    assert_eq!(rows[2][0], s("1993-04-01"));
    assert_eq!(rows[2][2], Cell::Null);
    assert_eq!(rows[2][3], Cell::Null);

    let db = test_db();
    assert_eq!(write_rows(&db, spec("debt"), &rows).unwrap(), 3);
    assert_eq!(
        one(
            &db,
            "SELECT CAST(record_date AS VARCHAR) FROM us_debt ORDER BY record_date ASC LIMIT 1"
        )
        .as_deref(),
        Some("1993-04-01")
    );
}

// ---------------------------------------------------------------
// Write semantics
// ---------------------------------------------------------------

#[test]
fn replace_with_no_rows_keeps_previous_snapshot() {
    let db = test_db();
    let rows = kp_rows(&fixture("kp.json")).unwrap();
    write_rows(&db, spec("spaceweather"), &rows).unwrap();
    assert!(write_rows(&db, spec("spaceweather"), &[]).is_err());
    assert_eq!(
        one(&db, "SELECT COUNT(*) FROM space_weather").as_deref(),
        Some("4")
    );
}

#[test]
fn wrong_width_rows_are_rejected() {
    let db = test_db();
    let err = write_rows(&db, spec("spaceweather"), &[vec![Cell::Null]]).unwrap_err();
    assert!(err.contains("space_weather"));
}

#[test]
fn uncastable_cells_become_null() {
    let db = test_db();
    let rows = vec![
        vec![
            s("2026-01-01 00:00:00"),
            Cell::F64(1.0),
            Cell::I64(1),
            Cell::I64(8),
            s("G0"),
        ],
        vec![
            s("not a time"),
            Cell::F64(2.0),
            Cell::I64(1),
            Cell::I64(8),
            s("G0"),
        ],
    ];
    assert_eq!(write_rows(&db, spec("spaceweather"), &rows).unwrap(), 2);
    assert_eq!(
        one(&db, "SELECT COUNT(*) FROM space_weather WHERE ts IS NULL").as_deref(),
        Some("1")
    );
}

#[test]
fn query_json_formats_temporal_and_wide_ints() {
    let db = test_db();
    let rows = vec![vec![
        s("2026-01-01 12:34:56"),
        Cell::F64(1.0),
        Cell::I64(1),
        Cell::I64(8),
        s("G0"),
    ]];
    write_rows(&db, spec("spaceweather"), &rows).unwrap();
    let climate = climate_rows(&fixture("climate.json")).unwrap();
    write_rows(&db, spec("climate"), &climate).unwrap();
    let a = source_query(&db, "spaceweather", "", 5).unwrap();
    assert_eq!(a.rows[0][0], serde_json::json!("2026-01-01T12:34:56.000Z"));
    let b = source_query(
        &db,
        "climate",
        "SELECT * FROM global_temperature ORDER BY ts",
        5,
    )
    .unwrap();
    assert_eq!(b.rows[0][0], serde_json::json!("1880-01-01"));
    let c = source_query(
        &db,
        "spaceweather",
        "SELECT SUM(station_count::BIGINT) AS s, 1.5::DECIMAL(4,1) AS d FROM space_weather",
        5,
    )
    .unwrap();
    assert_eq!(c.rows[0][0], serde_json::json!(8));
    assert_eq!(c.rows[0][1], serde_json::json!(1.5));
}

#[test]
fn starlink_debris_word_boundary_matches_worker() {
    assert!(is_starlink_debris_name("STARLINK-1008 DEB 1"));
    assert!(!is_starlink_debris_name("DEBRIS OBJECT"));
    assert!(!is_starlink_debris_name("ADELE-1"));
}

#[test]
fn nwis_timestamps_normalize_to_utc_wall_clock() {
    let body = serde_json::json!({
        "value": { "timeSeries": [{
            "sourceInfo": {
                "siteCode": [{"value": "01646500"}],
                "siteName": "Test",
                "geoLocation": { "geogLocation": { "latitude": 1.0, "longitude": 2.0 } }
            },
            "variable": { "variableCode": [{"value": "00060"}] },
            "values": [{ "value": [{
                "dateTime": "2024-06-01T12:00:00-04:00",
                "value": "100"
            }] }]
        }] }
    });
    let rows = nwis_rows(&body).unwrap();
    assert_eq!(rows.len(), 1);
    match &rows[0][2] {
        Cell::Str(ts) => assert!(ts.contains("16:00:00"), "expected UTC shift, got {ts}"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn nwis_sentinel_is_null_and_bad_timestamps_dropped() {
    let body = serde_json::json!({
        "value": { "timeSeries": [{
            "sourceInfo": {
                "siteCode": [{"value": "01646500"}],
                "siteName": "Test",
                "geoLocation": { "geogLocation": { "latitude": 1.0, "longitude": 2.0 } }
            },
            "variable": { "variableCode": [{"value": "00060"}] },
            "values": [{ "value": [
                { "dateTime": "2024-06-01T12:00:00Z", "value": "-999999" },
                { "dateTime": "2024-06-01T12:15:00Z", "value": "42" },
                { "dateTime": "not a time", "value": "7" }
            ] }]
        }] }
    });
    let rows = nwis_rows(&body).unwrap();
    assert_eq!(rows.len(), 1, "sentinel-only and bad-ts rows are dropped");
    match &rows[0][5] {
        Cell::F64(q) => assert_eq!(*q, 42.0),
        other => panic!("{other:?}"),
    }
}

#[test]
fn firms_acq_ts_uses_parse_iso_utc() {
    let csv = "latitude,longitude,bright_ti4,bright_ti5,frp,confidence,satellite,acq_date,acq_time,daynight\n\
40.1,-120.2,300,310,12,n,VIIRS,2024-07-04,1530,D\n";
    let rows = firms_rows(csv).unwrap();
    match &rows[0][8] {
        Cell::Str(ts) => assert_eq!(ts, "2024-07-04 15:30:00"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn source_query_wraps_trailing_limit() {
    let db = test_db();
    write_rows(
        &db,
        spec("spaceweather"),
        &kp_rows(&fixture("kp.json")).unwrap(),
    )
    .unwrap();
    let r = source_query(
        &db,
        "spaceweather",
        "SELECT * FROM space_weather ORDER BY ts LIMIT 2 OFFSET 1",
        500,
    )
    .unwrap();
    assert_eq!(r.rows.len(), 2);
}

/// Live network smoke test of every kind's real fetch → parse → write path.
/// Run with: cargo test --lib live_fetch_every_source -- --ignored --nocapture
/// (set LOOM_LIVE_KINDS=gdacs,buoys,… to limit it to some kinds).
#[tokio::test]
#[ignore]
async fn live_fetch_every_source() {
    let only: Option<Vec<String>> = std::env::var("LOOM_LIVE_KINDS")
        .ok()
        .map(|v| v.split(',').map(|k| k.trim().to_string()).collect());
    let db = test_db();
    let mut ctx = PollCtx {
        client: build_client().unwrap(),
        bikeshare_info: HashMap::new(),
        citibike_info: None,
        iss_seeded: false,
        opensky_retry_at: 0,
        coingecko_retry_at: 0,
        adsb_next: 0,
    };
    let mut failed = Vec::new();
    for sp in SOURCE_SPECS {
        if only
            .as_ref()
            .is_some_and(|o| !o.iter().any(|k| k == sp.kind))
        {
            continue;
        }
        let t = std::time::Instant::now();
        match fetch_rows(sp, &mut ctx, &db).await {
            Ok(rows) => match write_rows(&db, sp, &rows) {
                Ok(n) => {
                    let sample =
                        source_query(&db, sp.kind, &snapshot_sql(sp.kind).unwrap(), 1).unwrap();
                    eprintln!(
                        "LIVE {:<13} parsed {:>5} wrote {:>5} ({:.1}s) first: {:?}",
                        sp.kind,
                        rows.len(),
                        n,
                        t.elapsed().as_secs_f64(),
                        sample.rows.first()
                    );
                }
                Err(e) => {
                    eprintln!("LIVE {:<13} WRITE FAILED {}", sp.kind, e);
                    failed.push(sp.kind);
                }
            },
            Err(e) => {
                eprintln!("LIVE {:<13} FETCH FAILED {}", sp.kind, e);
                failed.push(sp.kind);
            }
        }
    }
    assert!(failed.is_empty(), "failed: {:?}", failed);
}

// ---------------------------------------------------------------
// USAFacts Data gateway (usafacts_states / usafacts_nation / usafacts_state_jobs)
// ---------------------------------------------------------------

fn usafacts_fixture(name: &str) -> Value {
    usafacts_payload(&fixture_text(name)).unwrap()
}

fn usafacts_err(text: &str) -> UsafactsError {
    usafacts_payload(text).unwrap_err()
}

/// One gateway reply whose tool payload (as `content[0].text`) is `payload`.
fn usafacts_tool_reply(payload: Value, is_error: bool) -> String {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": { "isError": is_error, "content": [{ "type": "text", "text": payload.to_string() }] },
    })
    .to_string()
}

#[test]
fn usafacts_gateway_envelopes() {
    let body: Value = serde_json::from_str(&usafacts_tool_call(
        "fred",
        "getSeriesObservations",
        serde_json::json!({"series_id": "UNRATE"}),
    ))
    .unwrap();
    assert_eq!(body["params"]["name"], "call_source_tool");
    assert_eq!(body["params"]["arguments"]["source_id"], "fred");
    assert_eq!(
        body["params"]["arguments"]["arguments"]["series_id"],
        "UNRATE"
    );

    let acs = usafacts_fixture("usafacts_acs1_2024.sse");
    assert_eq!(acs["results"][0][0], "NAME");
    let plain = r#"{"jsonrpc":"2.0","id":1,"result":{"structuredContent":{"observations":[]}}}"#;
    assert!(usafacts_payload(plain).unwrap()["observations"].is_array());
    // BLS replies carry `Results` (and a non-string `message`) — a success shape.
    let bls = usafacts_fixture("usafacts_bls_state_ur.sse");
    assert_eq!(bls["Results"]["series"].as_array().unwrap().len(), 3);
    let bls_like = serde_json::json!({ "kind": "x", "message": "y", "Results": { "series": [] } });
    assert!(usafacts_payload(&usafacts_tool_reply(bls_like, false)).is_ok());

    let err = usafacts_err(&fixture_text("usafacts_error.sse"));
    assert!(err.message.contains("upstream_rejected"), "{err}");
    assert!(
        usafacts_err(r#"{"jsonrpc":"2.0","error":{"message":"boom"}}"#)
            .message
            .contains("boom")
    );
    assert!(usafacts_payload("<html>").is_err());
}

#[test]
fn usafacts_errors_are_classified() {
    // ACS vintage not released yet: 404, gateway says not retryable → "not found", not a failure.
    let err = usafacts_err(&fixture_text("usafacts_error.sse"));
    assert_eq!(err.kind, "upstream_rejected");
    assert_eq!(err.upstream_status, Some(404));
    assert!(!err.retryable);
    assert!(err.not_found());
    assert!(err
        .message
        .starts_with("USAFacts upstream_rejected: HTTP 404"));
    let as_string: String = err.into();
    assert!(as_string.starts_with("USAFacts upstream_rejected:"));

    // No `retryable` advice → decided by upstream_status.
    let overloaded = usafacts_err(&usafacts_tool_reply(
        serde_json::json!({ "kind": "upstream_error", "message": "HTTP 503", "upstream_status": 503 }),
        true,
    ));
    assert!(overloaded.retryable);
    assert!(!overloaded.not_found());
    assert_eq!(overloaded.message, "USAFacts upstream_error: HTTP 503");
    let rate_limited = usafacts_err(&usafacts_tool_reply(
        serde_json::json!({ "kind": "upstream_error", "message": "slow down", "upstream_status": "429" }),
        true,
    ));
    assert!(rate_limited.retryable);
    // The gateway's own advice wins over the status.
    let told_no = usafacts_err(&usafacts_tool_reply(
        serde_json::json!({ "kind": "upstream_error", "message": "x", "upstream_status": 503, "retryable": false }),
        true,
    ));
    assert!(!told_no.retryable);
    // Error shape without isError (kind + message strings, no results) is still an error.
    let shape = usafacts_err(&usafacts_tool_reply(
        serde_json::json!({ "kind": "bad_args", "message": "nope", "upstream_status": 400 }),
        false,
    ));
    assert_eq!(shape.kind, "bad_args");
    assert!(!shape.retryable);

    // JSON-RPC errors: -32603 / -32000…-32099 are the server's (transient); -326xx are ours.
    let internal = usafacts_err(r#"{"jsonrpc":"2.0","error":{"code":-32603,"message":"boom"}}"#);
    assert!(internal.retryable);
    assert_eq!(internal.kind, "jsonrpc");
    assert_eq!(internal.message, "USAFacts: boom");
    assert!(
        usafacts_err(r#"{"jsonrpc":"2.0","error":{"code":-32001,"message":"busy"}}"#).retryable
    );
    assert!(
        !usafacts_err(r#"{"jsonrpc":"2.0","error":{"code":-32602,"message":"bad"}}"#).retryable
    );
    assert!(!usafacts_err(r#"{"jsonrpc":"2.0","error":{"message":"boom"}}"#).retryable);

    // An HTML page from an edge is unreadable and worth a retry; an empty result is not.
    let html = usafacts_err("<html>502 Bad Gateway</html>");
    assert_eq!(html.kind, "unreadable");
    assert!(html.retryable);
    assert_eq!(html.message, "USAFacts: unreadable reply");
    let empty = usafacts_err(r#"{"jsonrpc":"2.0","id":1,"result":{}}"#);
    assert_eq!(empty.kind, "empty");
    assert!(!empty.retryable);
    assert_eq!(empty.message, "USAFacts: empty payload");

    for (status, retry) in [
        (400, false),
        (404, false),
        (408, true),
        (425, true),
        (429, true),
        (500, true),
        (503, true),
    ] {
        assert_eq!(usafacts_retryable_status(status), retry, "{status}");
    }
}

#[test]
fn usafacts_acceptance_checks_and_panel_completeness() {
    assert!(has_acs_rows(&usafacts_fixture("usafacts_acs1_2024.sse")));
    assert!(!has_acs_rows(&serde_json::json!({ "results": [["NAME"]] })));
    assert!(has_acs_rows(&serde_json::json!([["NAME"], ["Alabama"]])));
    assert!(has_observations(&usafacts_fixture(
        "usafacts_fred_cpi_annual.sse"
    )));
    assert!(!has_observations(
        &serde_json::json!({ "observations": [] })
    ));
    assert!(has_bls_series(&usafacts_fixture(
        "usafacts_bls_state_ur.sse"
    )));
    assert!(!has_bls_series(&serde_json::json!({
        "status": "REQUEST_NOT_PROCESSED",
        "Results": { "series": [{ "seriesID": "LASST010000000000003", "data": [] }] },
    })));

    // 14 vintages asked (2012–2025, no 2020).
    assert_eq!(acs_panel(14, 14, 0), AcsPanel::Complete);
    assert_eq!(
        acs_panel(14, 13, 0),
        AcsPanel::Complete,
        "a 404 vintage is fine"
    );
    assert_eq!(acs_panel(14, 12, 1), AcsPanel::Gappy);
    assert_eq!(
        acs_panel(14, 7, 7),
        AcsPanel::Gappy,
        "exactly half still counts"
    );
    assert_eq!(acs_panel(14, 6, 8), AcsPanel::TooThin);
    assert_eq!(acs_panel(14, 0, 0), AcsPanel::TooThin);
}

#[test]
fn usafacts_states_from_acs() {
    let years = acs_state_years(days_from_civil(2026, 10, 16));
    assert_eq!(years.first(), Some(&2012));
    assert_eq!(years.last(), Some(&2025));
    assert!(!years.contains(&2020));

    let table = usafacts_fixture("usafacts_acs1_2024.sse");
    let rows = acs_states_rows(&[(2024, table)], None, None);
    assert_eq!(rows.len(), 52);
    let al = rows.iter().find(|r| r[1] == s("AL")).unwrap();
    assert_eq!(al.len(), spec("usafacts_states").columns.len());
    assert_eq!(al[0], s("01"));
    assert_eq!(al[2], s("Alabama"));
    assert_eq!(al[3], Cell::I64(2024));
    assert_eq!(al[4], Cell::I64(5_157_699));
    assert_eq!(al[5], Cell::F64(66_659.0));
    assert_eq!(al[6], Cell::F64(15.19));
    assert_eq!(al[7], Cell::F64(39.6));
    assert_eq!(al[8], Cell::F64(4.23));
    // (637,543 bachelor's + 419,292 graduate) / 3,540,061 adults (B06009).
    assert_eq!(al[9], Cell::F64(29.85));
    assert_eq!(al[10], s("South"));
    assert_eq!(al[11], Cell::Null, "no CPI → no real income");
    let pr = rows.iter().find(|r| r[1] == s("PR")).unwrap();
    assert_eq!(pr[10], s("Puerto Rico"));
    // Puerto Rico leaves B06009 null and fills B06009PR: (506,436 + 214,691) / 2,428,065.
    assert_eq!(pr[9], Cell::F64(29.7));
    let dc = rows.iter().find(|r| r[1] == s("DC")).unwrap();
    assert_eq!(dc[9], Cell::F64(65.46));
    assert!(
        rows.iter().all(|r| matches!(r[9], Cell::F64(_))),
        "every state has an education share"
    );
    let regions: HashSet<String> = rows
        .iter()
        .map(|r| match &r[10] {
            Cell::Str(v) => v.clone(),
            other => panic!("region {:?}", other),
        })
        .collect();
    assert_eq!(regions.len(), 5, "{:?}", regions);

    let db = test_db();
    assert_eq!(write_rows(&db, spec("usafacts_states"), &rows).unwrap(), 52);
    assert!(one(
        &db,
        "SELECT state_abbr FROM usafacts_states ORDER BY median_household_income DESC LIMIT 1"
    )
    .is_some());
    assert_eq!(
        one(
            &db,
            "SELECT COUNT(*) FROM usafacts_states WHERE region = 'West'"
        )
        .as_deref(),
        Some("13")
    );
}

#[test]
fn usafacts_states_education_falls_back_to_pr_tables() {
    assert_eq!(ACS_STATE_VARS.len(), 14);
    assert!(ACS_STATE_VARS.iter().all(|v| !v.starts_with("B15003")));
    let header = [
        "NAME",
        "B01003_001E",
        "B06009_001E",
        "B06009_005E",
        "B06009_006E",
        "B06009PR_001E",
        "B06009PR_005E",
        "B06009PR_006E",
        "state",
    ];
    let row = |fips: &str, us: [Value; 3], pr: [Value; 3]| -> Value {
        let mut r = vec![Value::Null, Value::from("1000")];
        r.extend(us);
        r.extend(pr);
        r.push(Value::from(fips));
        Value::Array(r)
    };
    let n = |v: &str| Value::from(v);
    let null = || [Value::Null, Value::Null, Value::Null];
    let table = serde_json::json!({ "results": [
        header,
        // State: B06009 complete → used.
        row("01", [n("1000"), n("200"), n("100")], null()),
        // Puerto Rico: B06009 null → B06009PR.
        row("72", null(), [n("2428065"), n("506436"), n("214691")]),
        // B06009 incomplete (graduate jammed) → B06009PR, which is null → no share.
        row("06", [n("1000"), n("200"), n("-666666666")], null()),
        // Both trios present but B06009 complete wins.
        row("36", [n("400"), n("100"), n("100")], [n("1000"), n("1"), n("1")]),
        // Adults missing but degrees present → no share.
        row("48", null(), [Value::Null, n("5"), n("5")]),
    ]});
    let rows = acs_states_rows(&[(2024, table)], None, None);
    let edu = |abbr: &str| {
        rows.iter()
            .find(|r| r[1] == s(abbr))
            .unwrap_or_else(|| panic!("{abbr}"))[9]
            .clone()
    };
    assert_eq!(edu("AL"), Cell::F64(30.0));
    assert_eq!(edu("PR"), Cell::F64(29.7));
    assert_eq!(edu("CA"), Cell::Null);
    assert_eq!(edu("NY"), Cell::F64(50.0));
    assert_eq!(edu("TX"), Cell::Null);
    // Name falls back when NAME is null.
    assert_eq!(
        rows.iter().find(|r| r[1] == s("PR")).unwrap()[2],
        s("Puerto Rico")
    );

    // A vintage fetched without a dropped variable just lacks that column → NULL, rest intact.
    let without = serde_json::json!({ "results": [
        ["NAME", "B01003_001E", "B19013_001E", "B06009_001E", "B06009_005E", "state"],
        ["Alabama", "5157699", "66659", "3540061", "637543", "01"],
    ]});
    let rows = acs_states_rows(&[(2025, without)], None, None);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0][4], Cell::I64(5_157_699));
    assert_eq!(rows[0][5], Cell::F64(66_659.0));
    assert_eq!(rows[0][9], Cell::Null);
}

#[test]
fn usafacts_acs_unknown_variable_is_dropped_and_retried() {
    let census_400 = |body: &str| {
        usafacts_err(&usafacts_tool_reply(
            serde_json::json!({
                "kind": "upstream_rejected",
                "message": "HTTP 400 from https://api.census.gov/data/2025/acs/acs1",
                "upstream_status": 400,
                "upstream_body": body,
                "retryable": false,
            }),
            true,
        ))
    };
    let err = census_400("error: unknown variable 'B15003_024E'");
    assert_eq!(err.upstream_status, Some(400));
    assert!(!err.retryable && !err.not_found());
    assert_eq!(
        err.detail.as_deref(),
        Some("error: unknown variable 'B15003_024E'")
    );
    assert_eq!(acs_unknown_variable(&err).as_deref(), Some("B15003_024E"));
    assert_eq!(
        acs_unknown_variable(&census_400(
            "unknown variable 'bad name' then unknown variable 'B06009PR_005E'"
        ))
        .as_deref(),
        Some("B06009PR_005E"),
        "first well-formed match, like the regex"
    );
    assert_eq!(
        acs_unknown_variable(&census_400("error: unknown predicate")),
        None
    );
    assert_eq!(
        acs_unknown_variable(&census_400("unknown variable ''")),
        None
    );
    // Only a 400 with an agency body counts.
    let not_found = usafacts_err(&fixture_text("usafacts_error.sse"));
    assert!(not_found
        .detail
        .as_deref()
        .unwrap()
        .starts_with("HTTP Status 404"));
    assert_eq!(acs_unknown_variable(&not_found), None);
    let mut overloaded = census_400("error: unknown variable 'B06009_005E'");
    overloaded.upstream_status = Some(503);
    assert_eq!(acs_unknown_variable(&overloaded), None);
    assert_eq!(
        acs_unknown_variable(&usafacts_err(
            r#"{"jsonrpc":"2.0","error":{"code":-32603,"message":"unknown variable 'X'"}}"#
        )),
        None
    );
    // upstream_body is kept to 300 chars.
    let long = census_400(&"x".repeat(500));
    assert_eq!(long.detail.map(|d| d.chars().count()), Some(300));

    // Drop rules: the named variable only, ≤ 3 drops, never population, only if still asked.
    let vars: Vec<&'static str> = ACS_STATE_VARS.to_vec();
    let edu_gone = census_400("error: unknown variable 'B06009_005E'");
    let next = acs_vars_without_unknown(&vars, &edu_gone, 0).unwrap();
    assert_eq!(next.len(), vars.len() - 1);
    assert!(!next.contains(&"B06009_005E"));
    assert_eq!(next[0], "NAME");
    assert!(acs_vars_without_unknown(&vars, &edu_gone, 2).is_some());
    assert!(
        acs_vars_without_unknown(&vars, &edu_gone, 3).is_none(),
        "3 drops max"
    );
    assert!(
        acs_vars_without_unknown(&next, &edu_gone, 1).is_none(),
        "already dropped"
    );
    assert!(
        acs_vars_without_unknown(&vars, &err, 0).is_none(),
        "not asked for"
    );
    let pop_gone = census_400("error: unknown variable 'B01003_001E'");
    assert!(acs_vars_without_unknown(&vars, &pop_gone, 0).is_none());
    assert!(acs_vars_without_unknown(&vars, &not_found, 0).is_none());
}

#[test]
fn usafacts_states_region_name_fallback_and_real_income() {
    let cpi = fred_annual_cpi(&usafacts_fixture("usafacts_fred_cpi_annual.sse"));
    assert_eq!(cpi.get(&2012), Some(&229.586));
    assert_eq!(cpi.get(&2024), Some(&313.698));
    assert_eq!(cpi.get(&2025), Some(&321.962));
    assert!(
        !cpi.contains_key(&2026),
        "\".\" for an unfinished year is skipped"
    );
    assert_eq!(usafacts_cpi_annual_args()["frequency"], "a");
    assert_eq!(
        usafacts_cpi_annual_args()["observation_start"],
        "2012-01-01"
    );

    let table = usafacts_fixture("usafacts_acs1_2024.sse");
    let al_of = |rows: &[Row], year: i64| -> Row {
        rows.iter()
            .find(|r| r[1] == s("AL") && r[3] == Cell::I64(year))
            .unwrap()
            .clone()
    };

    // Newest vintage with a CPI level is 2024 → its real income equals nominal.
    let rows = acs_states_rows(&[(2024, table.clone())], Some(&cpi), None);
    assert_eq!(al_of(&rows, 2024)[11], Cell::F64(66_659.0));

    // A 2012 table restated in 2024 dollars: × CPI2024 / CPI2012.
    let rows = acs_states_rows(
        &[(2012, table.clone()), (2024, table.clone())],
        Some(&cpi),
        None,
    );
    assert_eq!(rows.len(), 104);
    assert_eq!(rows[0][3], Cell::I64(2024), "newest year first");
    let al12 = al_of(&rows, 2012);
    assert_eq!(al12[5], Cell::F64(66_659.0));
    assert_eq!(
        al12[11],
        Cell::F64((66_659.0_f64 * 313.698 / 229.586).round())
    );
    assert_eq!(al12[11], Cell::F64(91_080.0));

    // 2026 has no CPI level yet: dollars stay 2025's, and 2026 itself gets no real income.
    let rows = acs_states_rows(
        &[
            (2024, table.clone()),
            (2025, table.clone()),
            (2026, table.clone()),
        ],
        Some(&cpi),
        None,
    );
    assert_eq!(al_of(&rows, 2025)[11], Cell::F64(66_659.0));
    assert_eq!(al_of(&rows, 2024)[11], Cell::F64(68_415.0));
    assert_eq!(al_of(&rows, 2026)[11], Cell::Null);

    // NAME missing → the state's own name; numeric FIPS is padded.
    let bare = serde_json::json!({ "results": [
        ["B01003_001E", "B19013_001E", "state"],
        ["3203295", "-666666666", "72"],
        ["5157699", "66659", 1],
        ["1", "1", "99"],
    ]});
    let rows = acs_states_rows(&[(2024, bare)], Some(&cpi), None);
    assert_eq!(rows.len(), 2, "unknown FIPS dropped");
    let pr = rows.iter().find(|r| r[1] == s("PR")).unwrap();
    assert_eq!(pr[2], s("Puerto Rico"));
    assert_eq!(pr[10], s("Puerto Rico"));
    assert_eq!(pr[5], Cell::Null, "jam value is no estimate");
    assert_eq!(pr[11], Cell::Null);
    let al = rows.iter().find(|r| r[1] == s("AL")).unwrap();
    assert_eq!(al[0], s("01"));
    assert_eq!(al[2], s("Alabama"));
    assert_eq!(al[10], s("South"));
    assert_eq!(al[11], Cell::F64(66_659.0));

    let db = test_db();
    assert_eq!(write_rows(&db, spec("usafacts_states"), &rows).unwrap(), 2);
}

#[test]
fn usafacts_nation_from_fred_and_fallback() {
    assert_eq!(USAFACTS_NATION_SERIES.len(), 8);
    let unrate = usafacts_fixture("usafacts_fred_unrate.sse");
    let gas = usafacts_fixture("usafacts_fred_gas.sse");
    let payloads: Vec<Option<Value>> = USAFACTS_NATION_SERIES
        .iter()
        .map(|(_, id, _, _)| match *id {
            "UNRATE" => Some(unrate.clone()),
            "GASREGW" => Some(gas.clone()),
            _ => None,
        })
        .collect();
    let rows = fred_nation_rows(&payloads);
    let jan = rows.iter().find(|r| r[0] == s("2024-01-01")).unwrap();
    assert_eq!(jan.len(), spec("usafacts_nation").columns.len());
    assert_eq!(jan[1], Cell::I64(2024));
    assert_eq!(jan[3], Cell::Null);
    assert!(matches!(jan[2], Cell::F64(v) if (v - 3.7).abs() < 0.05));
    assert_eq!(jan[10], Cell::Null, "no payrolls → no jobs added");
    assert_eq!(jan[11], s("2020s"));
    assert_eq!(jan[12], s("Expansion"));

    let fb = fredgraph_nation_rows(
        &fixture_text("fredgraph_monthly.csv"),
        &fixture_text("fredgraph_gas.csv"),
    );
    let jan = fb.iter().find(|r| r[0] == s("2024-01-01")).unwrap();
    assert!(
        matches!(jan[3], Cell::F64(v) if v > 1.0 && v < 6.0),
        "{:?}",
        jan[3]
    );
    assert_eq!(jan[3], Cell::F64(3.09));
    assert_eq!(jan[4], Cell::F64(157_032.0));
    assert_eq!(jan[7], Cell::F64(3.075));
    assert_eq!(jan[8], Cell::Null, "JTSJOL not in the CSV fixture");
    assert_eq!(jan[10], Cell::F64(175.0), "157032 − 156857");
    let jan23 = fb.iter().find(|r| r[0] == s("2023-01-01")).unwrap();
    assert_eq!(jan23[3], Cell::Null);
    assert_eq!(jan23[10], Cell::Null, "no 2022-12 payrolls");

    let db = test_db();
    assert_eq!(
        write_rows(&db, spec("usafacts_nation"), &fb).unwrap() as usize,
        fb.len()
    );
    assert_eq!(
        one(&db, "SELECT recession FROM usafacts_nation LIMIT 1").as_deref(),
        Some("Expansion")
    );
    let sql = snapshot_sql_limited("usafacts_nation", 2).unwrap();
    let res = source_query(&db, "usafacts_nation", &sql, 2).unwrap();
    assert_eq!(res.rows.len(), 2);
}

#[test]
fn usafacts_nation_derived_columns() {
    // PAYEMS-only payload: jobs added needs both this month and the calendar month before.
    let obs = |pairs: &[(&str, &str)]| {
        serde_json::json!({
            "observations": pairs
                .iter()
                .map(|(d, v)| serde_json::json!({ "date": d, "value": v }))
                .collect::<Vec<_>>()
        })
    };
    let pay_i = USAFACTS_NATION_SERIES
        .iter()
        .position(|s| s.1 == "PAYEMS")
        .unwrap();
    let payrolls = obs(&[
        ("1989-12-01", "107000"),
        ("1990-01-01", "107133"),
        ("1999-12-01", "130500"),
        ("2007-12-01", "138000"),
        ("2008-01-01", "137950.04"),
        ("2009-06-01", "131000"),
        ("2009-07-01", "130700"),
        ("2020-02-01", "152500"),
        ("2020-03-01", "151100"),
        ("2020-04-01", "130400"),
        ("2020-05-01", "."),
        ("2020-06-01", "137800"),
    ]);
    let mut payloads = vec![None; USAFACTS_NATION_SERIES.len()];
    payloads[pay_i] = Some(payrolls);
    let rows = fred_nation_rows(&payloads);
    let row = |m: &str| -> Row {
        rows.iter()
            .find(|r| r[0] == s(&format!("{m}-01")))
            .unwrap_or_else(|| panic!("{m}"))
            .clone()
    };
    assert!(rows.iter().all(|r| r[0] != s("1989-12-01")), "before 1990");
    assert!(
        rows.iter().all(|r| r[0] != s("2020-05-01")),
        "all-null month dropped"
    );
    // 1989-12 is before the start but still the "month before" for 1990-01.
    assert_eq!(row("1990-01")[10], Cell::F64(133.0));
    assert_eq!(row("1990-01")[11], s("1990s"));
    assert_eq!(row("1999-12")[10], Cell::Null, "1999-11 missing");
    assert_eq!(row("1999-12")[11], s("1990s"));
    assert_eq!(row("2008-01")[10], Cell::F64(-50.0), "−49.96 rounds to 0.1");
    assert_eq!(row("2008-01")[11], s("2000s"));
    assert_eq!(row("2009-07")[10], Cell::F64(-300.0));
    assert_eq!(row("2020-04")[10], Cell::F64(-20_700.0));
    assert_eq!(row("2020-06")[10], Cell::Null, "2020-05 was \".\"");
    assert_eq!(row("2020-06")[11], s("2020s"));

    for (m, state) in [
        ("2007-12", "Expansion"),
        ("2008-01", "Recession"),
        ("2009-06", "Recession"),
        ("2009-07", "Expansion"),
        ("2020-02", "Expansion"),
        ("2020-03", "Recession"),
        ("2020-04", "Recession"),
        ("2020-06", "Expansion"),
    ] {
        assert_eq!(row(m)[12], s(state), "{m}");
    }
    assert!(nber_recession("1990-08-01"));
    assert!(nber_recession("1991-03"));
    assert!(!nber_recession("1991-04"));
    assert!(nber_recession("2001-11-01"));
    assert!(!nber_recession("2001-12-01"));
    assert_eq!(prev_month("2020-01"), "2019-12");
    assert_eq!(prev_month("2020-10"), "2020-09");

    let db = test_db();
    assert_eq!(
        write_rows(&db, spec("usafacts_nation"), &rows).unwrap() as usize,
        rows.len()
    );
    assert_eq!(
        one(
            &db,
            "SELECT COUNT(*) FROM usafacts_nation WHERE recession = 'Recession'"
        )
        .as_deref(),
        Some("4")
    );
}

#[test]
fn usafacts_nation_fredgraph_fills_only_missing_series() {
    assert_eq!(
        fredgraph_nation_monthly_ids(),
        vec!["UNRATE", "CPIAUCSL", "PAYEMS", "FEDFUNDS", "HOUST", "JTSJOL", "GS10"]
    );
    let fb = fredgraph_nation_payloads(
        &fixture_text("fredgraph_monthly.csv"),
        &fixture_text("fredgraph_gas.csv"),
    );
    assert_eq!(fb.len(), USAFACTS_NATION_SERIES.len());
    let ids: Vec<&str> = USAFACTS_NATION_SERIES.iter().map(|s| s.1).collect();
    let at = |id: &str| ids.iter().position(|x| *x == id).unwrap();
    assert!(fb[at("JTSJOL")].is_none() && fb[at("GS10")].is_none());
    // CPI comes back as YoY from levels; the first year has none.
    let cpi_obs = fb[at("CPIAUCSL")].as_ref().unwrap()["observations"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(cpi_obs[0]["date"], "2023-01-01");
    assert_eq!(cpi_obs[0]["value"], ".");

    // The gateway returned UNRATE (one distinctive month) — the CSV must not touch it.
    let mut payloads: Vec<Option<Value>> = vec![None; USAFACTS_NATION_SERIES.len()];
    payloads[at("UNRATE")] = Some(serde_json::json!({
        "observations": [{ "date": "2024-01-01", "value": "9.9" }]
    }));
    let merged = fill_missing_series(&payloads, fb);
    let rows = fred_nation_rows(&merged);
    let jan = rows.iter().find(|r| r[0] == s("2024-01-01")).unwrap();
    assert_eq!(jan[2], Cell::F64(9.9), "gateway value kept");
    assert_eq!(jan[4], Cell::F64(157_032.0), "payrolls filled from CSV");
    let feb = rows.iter().find(|r| r[0] == s("2024-02-01")).unwrap();
    assert_eq!(
        feb[2],
        Cell::Null,
        "CSV UNRATE not mixed into a gateway series"
    );
    assert_eq!(feb[4], Cell::F64(157_238.0));
    assert_eq!(feb[10], Cell::F64(206.0));
}

#[test]
fn usafacts_state_jobs_from_bls() {
    assert_eq!(
        state_jobs_year_range(days_from_civil(2026, 11, 18)),
        (2008, 2026)
    );
    let batches = bls_state_ur_batches(50);
    assert_eq!(
        batches.iter().map(Vec::len).collect::<Vec<_>>(),
        vec![50, 2]
    );
    assert_eq!(batches[0][0], "LASST010000000000003");
    assert_eq!(
        batches[1],
        vec!["LASST560000000000003", "LASST720000000000003"]
    );
    assert_eq!(bls_state_ur_series_id("06"), "LASST060000000000003");

    let bls = usafacts_fixture("usafacts_bls_state_ur.sse");
    let rows = bls_state_rows(std::slice::from_ref(&bls));
    assert_eq!(rows.len(), 99, "3 states × 33 months");
    assert_eq!(rows[0].len(), spec("usafacts_state_jobs").columns.len());
    // Oldest month first, then state.
    assert_eq!(rows[0][0], s("2024-01-01"));
    assert_eq!(
        rows[..3].iter().map(|r| r[3].clone()).collect::<Vec<_>>(),
        vec![s("AL"), s("CA"), s("PR")]
    );
    assert_eq!(rows[98][0], s("2026-09-01"));
    let find = |m: &str, abbr: &str| -> Row {
        rows.iter()
            .find(|r| r[0] == s(&format!("{m}-01")) && r[3] == s(abbr))
            .unwrap_or_else(|| panic!("{m} {abbr}"))
            .clone()
    };
    let pr = find("2024-01", "PR");
    assert_eq!(pr[1], Cell::I64(2024));
    assert_eq!(pr[2], s("72"));
    assert_eq!(pr[4], s("Puerto Rico"));
    assert_eq!(pr[5], s("Puerto Rico"));
    assert_eq!(pr[6], Cell::F64(5.8));
    let al = find("2025-01", "AL");
    assert_eq!(al[2], s("01"));
    assert_eq!(al[4], s("Alabama"));
    assert_eq!(al[5], s("South"));
    assert_eq!(find("2025-01", "CA")[5], s("West"));
    // Year-over-year change exists from 2025 on (rounded to 0.01), never in 2024.
    assert!(rows
        .iter()
        .filter(|r| r[1] == Cell::I64(2024))
        .all(|r| r[7] == Cell::Null));
    assert_eq!(al[7], Cell::F64(0.2));
    assert_eq!(find("2025-11", "AL")[7], Cell::F64(-0.4));
    assert_eq!(find("2026-09", "CA")[7], Cell::F64(-0.4));
    assert_eq!(find("2026-09", "PR")[7], Cell::F64(0.5));
    // October 2025 wasn't collected ("-") → NULL rate and change.
    let oct = find("2025-10", "AL");
    assert_eq!(oct[6], Cell::Null);
    assert_eq!(oct[7], Cell::Null);
    assert_eq!(find("2025-10", "PR")[7], Cell::F64(0.3));
    assert!(rows
        .iter()
        .filter(|r| r[1] != Cell::I64(2024) && r[6] != Cell::Null)
        .all(|r| r[7] != Cell::Null));

    // M13 (annual average) and unknown series are skipped.
    let extra = serde_json::json!({ "Results": { "series": [
        { "seriesID": "LASST010000000000003", "data": [
            { "year": "2024", "period": "M13", "value": "3.0" },
            { "year": "2024", "period": "M00", "value": "3.0" }
        ]},
        { "seriesID": "LASST990000000000003", "data": [{ "year": "2024", "period": "M01", "value": "1" }] },
        { "seriesID": "LASST0100000000000003", "data": [{ "year": "2024", "period": "M01", "value": "1" }] },
        { "seriesID": "LNS14000000", "data": [{ "year": "2024", "period": "M01", "value": "1" }] }
    ]}});
    assert!(bls_state_rows(&[extra]).is_empty());

    let db = test_db();
    let sp = spec("usafacts_state_jobs");
    assert_eq!(sp.mode, WriteMode::Replace);
    assert!(KEEP_NEWEST_KINDS.contains(&sp.kind));
    assert_eq!(write_rows(&db, sp, &rows).unwrap(), 99);
    assert_eq!(
        one(
            &db,
            "SELECT COUNT(*) FROM usafacts_state_jobs WHERE region = 'Puerto Rico'"
        )
        .as_deref(),
        Some("33")
    );
    assert_eq!(
        one(
            &db,
            "SELECT CAST(MAX(month) AS VARCHAR) FROM usafacts_state_jobs"
        )
        .as_deref(),
        Some("2026-09-01")
    );
    // Keep-newest snapshot: the last rows of `month ASC, state_abbr`, still in that order.
    let sql = snapshot_sql_limited("usafacts_state_jobs", 4).unwrap();
    assert!(
        sql.contains("ORDER BY month DESC, state_abbr DESC LIMIT 4"),
        "{sql}"
    );
    let res = source_query(&db, "usafacts_state_jobs", &sql, 4).unwrap();
    let got: Vec<(String, String)> = res
        .rows
        .iter()
        .map(|r| (r[0].to_string(), r[3].to_string()))
        .collect();
    assert_eq!(got.len(), 4);
    assert!(
        got[0].0.contains("2026-08") && got[0].1.contains("PR"),
        "{got:?}"
    );
    assert!(
        got[1].0.contains("2026-09") && got[1].1.contains("AL"),
        "{got:?}"
    );
    assert!(
        got[3].0.contains("2026-09") && got[3].1.contains("PR"),
        "{got:?}"
    );

    // ~12k rows (19 years × 12 months × 52 states) fit a Replace write.
    let mut big: Vec<Row> = Vec::new();
    for year in 2008..2027 {
        for month in 1..=12 {
            for st in US_STATES {
                big.push(vec![
                    s(&format!("{year}-{month:02}-01")),
                    Cell::I64(year),
                    s(st.0),
                    s(st.1),
                    s(st.2),
                    s(st.3),
                    Cell::F64(4.0),
                    Cell::Null,
                ]);
            }
        }
    }
    assert_eq!(big.len(), 11_856);
    assert_eq!(write_rows(&db, sp, &big).unwrap(), 11_856);
    assert_eq!(
        one(&db, "SELECT COUNT(*) FROM usafacts_state_jobs").as_deref(),
        Some("11856")
    );
}

#[test]
fn usafacts_state_jobs_fredgraph_fallback_matches_bls() {
    let batches = fredgraph_state_id_batches(26);
    assert_eq!(
        batches.iter().map(Vec::len).collect::<Vec<_>>(),
        vec![26, 26]
    );
    assert_eq!(batches[0][0], "ALUR");
    assert!(batches.concat().contains(&"DCUR".to_string()));
    assert_eq!(batches[1].last().map(String::as_str), Some("PRUR"));

    let csv = fixture_text("fredgraph_state_ur.csv");
    let fred = fredgraph_state_rows(&[csv.as_str()], 2024);
    assert_eq!(fred.len(), 99);
    // Same months, states, rates and year-over-year change as the BLS transform.
    let bls = bls_state_rows(&[usafacts_fixture("usafacts_bls_state_ur.sse")]);
    assert_eq!(fred, bls);

    // From 2023 the CSV has 45 months; 2024 now gets its year-over-year change.
    let all = fredgraph_state_rows(&[csv.as_str()], 2023);
    assert_eq!(all.len(), 135);
    let al24 = all
        .iter()
        .find(|r| r[0] == s("2024-01-01") && r[3] == s("AL"))
        .unwrap();
    assert_eq!(al24[6], Cell::F64(2.9));
    assert_eq!(al24[7], Cell::F64(0.6));
    // Blank cells (2025-10 AL/CA) are NULL rates.
    let oct = all
        .iter()
        .find(|r| r[0] == s("2025-10-01") && r[3] == s("CA"))
        .unwrap();
    assert_eq!(oct[6], Cell::Null);
    // Headers that aren't `{USPS}UR` are ignored.
    assert!(fredgraph_state_rows(
        &["observation_date,UNRATE,XXUR\n2024-01-01,3.7,1.0\n"],
        2000
    )
    .is_empty());

    let db = test_db();
    assert_eq!(
        write_rows(&db, spec("usafacts_state_jobs"), &all).unwrap(),
        135
    );
}

#[test]
fn usafacts_fredgraph_guard_and_single_series() {
    assert!(fredgraph_looks_like_csv(
        "observation_date,UNRATE\n2024-01-01,3.7\n"
    ));
    assert!(fredgraph_looks_like_csv("\u{feff}observation_date,ALUR\n"));
    assert!(fredgraph_looks_like_csv("DATE,GASREGW\n"));
    assert!(fredgraph_looks_like_csv("date,x\n"), "case-insensitive");
    assert!(fredgraph_looks_like_csv(&fixture_text(
        "fredgraph_state_ur.csv"
    )));
    assert!(fredgraph_looks_like_csv(&fixture_text(
        "fredgraph_monthly.csv"
    )));
    assert!(
        !fredgraph_looks_like_csv("PK\u{3}\u{4}\u{14}\0observation_date,"),
        "ZIP"
    );
    assert!(!fredgraph_looks_like_csv(
        "<!DOCTYPE html><title>Error</title>"
    ));
    assert!(!fredgraph_looks_like_csv(" observation_date,X"));
    assert!(!fredgraph_looks_like_csv(""));

    let csv = fixture_text("fredgraph_q_psavert.csv");
    let obs = fredgraph_observations(&csv, "PSAVERT").unwrap();
    let list = obs["observations"].as_array().unwrap();
    assert_eq!(list.len(), 35);
    assert_eq!(
        list[0],
        serde_json::json!({ "date": "2018-01-01", "value": "5.8" })
    );
    assert!(has_observations(&obs));
    assert!(
        fredgraph_observations(&csv, "MSPUS").is_none(),
        "wrong column"
    );
    assert!(fredgraph_observations("PK\u{3}\u{4}junk", "PSAVERT").is_none());
    assert!(fredgraph_observations("<html>oops</html>", "PSAVERT").is_none());
    let gaps = fredgraph_observations("observation_date,ICSA\n2020-01-01,\nnot-a-date,5\n", "ICSA")
        .unwrap();
    assert_eq!(
        gaps["observations"],
        serde_json::json!([{ "date": "2020-01-01", "value": "." }])
    );
}

#[test]
fn usafacts_bea_state_years_and_carry_forward() {
    let sarpp = usafacts_fixture("usafacts_bea_sarpp1.sse");
    assert!(bea_has_data(&sarpp));
    assert!(!bea_has_data(
        &serde_json::json!({ "BEAAPI": { "Results": { "Data": [] } } })
    ));
    let rpp = bea_state_years(&sarpp);
    assert_eq!(rpp.len(), 51, "50 states + DC; US total dropped");
    assert!(!rpp.contains_key("00"));
    let al = rpp.get("01").unwrap();
    assert_eq!(
        al.keys().copied().collect::<Vec<_>>(),
        (2020..=2024).collect::<Vec<_>>()
    );
    assert_eq!(al.get(&2024), Some(&88.823));
    assert_eq!(rpp["06"].get(&2024), Some(&110.72));
    assert_eq!(rpp["11"].get(&2024), Some(&109.901));

    // The fixture ends at 2024; 2025 borrows it, 2026 is too far, earlier years are their own.
    assert_eq!(bea_value_for(Some(al), 2024, 1), Some(88.823));
    assert_eq!(bea_value_for(Some(al), 2025, 1), Some(88.823));
    assert_eq!(bea_value_for(Some(al), 2026, 1), None);
    assert_eq!(bea_value_for(Some(al), 2025, 0), None);
    assert_eq!(bea_value_for(Some(al), 2021, 1), Some(88.062));
    assert_eq!(bea_value_for(Some(al), 2019, 1), None);
    assert_eq!(bea_value_for(None, 2024, 1), None);

    // Thousands commas, counties, non-states and "(NA)".
    let rpi = bea_state_years(&serde_json::json!({ "BEAAPI": { "Results": { "Data": [
        { "GeoFips": "01000", "TimePeriod": "2024", "DataValue": "52,345" },
        { "GeoFips": "00000", "TimePeriod": "2024", "DataValue": "60,000" },
        { "GeoFips": "01001", "TimePeriod": "2024", "DataValue": "1" },
        { "GeoFips": "99000", "TimePeriod": "2024", "DataValue": "1" },
        { "GeoFips": "06000", "TimePeriod": "2024", "DataValue": "(NA)" },
        { "GeoFips": "72000", "TimePeriod": 2023, "DataValue": 21000 }
    ]}}}));
    assert_eq!(rpi.len(), 2);
    assert_eq!(rpi["01"].get(&2024), Some(&52_345.0));
    assert_eq!(rpi["72"].get(&2023), Some(&21_000.0));
    assert_eq!(
        bea_regional_args("SARPP", "3"),
        serde_json::json!({ "TableName": "SARPP", "LineCode": "3", "GeoFips": "STATE", "Year": "ALL" })
    );
    assert_eq!(
        BEA_STATE_TABLES,
        [("SARPP", "1"), ("SARPP", "3"), ("SARPI", "2")]
    );

    // Joined into the ACS panel: price level (carried into 2025), no rents table, local income.
    let acs = usafacts_fixture("usafacts_acs1_2024.sse");
    let cpi = fred_annual_cpi(&usafacts_fixture("usafacts_fred_cpi_annual.sse"));
    let panel = BeaStatePanel {
        rpp: Some(rpp),
        rent: None,
        rpi: Some(rpi),
    };
    let rows = acs_states_rows(
        &[(2024, acs.clone()), (2025, acs)],
        Some(&cpi),
        Some(&panel),
    );
    let row = |abbr: &str, year: i64| -> Row {
        rows.iter()
            .find(|r| r[1] == s(abbr) && r[3] == Cell::I64(year))
            .unwrap()
            .clone()
    };
    let sp = spec("usafacts_states");
    assert_eq!(sp.columns.len(), 16);
    let at = |name: &str| sp.columns.iter().position(|c| c.0 == name).unwrap();
    let al25 = row("AL", 2025);
    assert_eq!(al25.len(), 16);
    assert_eq!(
        al25[at("real_median_income")],
        Cell::F64(66_659.0),
        "2025 dollars"
    );
    assert_eq!(
        al25[at("price_level")],
        Cell::F64(88.823),
        "borrowed from 2024"
    );
    assert_eq!(al25[at("rent_price_level")], Cell::Null);
    assert_eq!(al25[at("income_local_usd")], Cell::F64(75_047.0));
    assert_eq!(al25[at("real_personal_income_pc")], Cell::F64(52_345.0));
    let al24 = row("AL", 2024);
    assert_eq!(al24[at("real_median_income")], Cell::F64(68_415.0));
    assert_eq!(al24[at("income_local_usd")], Cell::F64(77_024.0));
    let pr = row("PR", 2024);
    assert_eq!(
        pr[at("price_level")],
        Cell::Null,
        "BEA has no Puerto Rico RPP"
    );
    assert_eq!(pr[at("income_local_usd")], Cell::Null);
    assert_eq!(
        pr[at("real_personal_income_pc")],
        Cell::F64(21_000.0),
        "2024 borrows 2023"
    );
    assert_eq!(
        row("PR", 2025)[at("real_personal_income_pc")],
        Cell::Null,
        "two years back is too far"
    );

    // No BEA at all → the four columns are NULL, the rest unchanged.
    let plain = acs_states_rows(
        &[(2024, usafacts_fixture("usafacts_acs1_2024.sse"))],
        None,
        None,
    );
    assert!(plain
        .iter()
        .all(|r| r[12..].iter().all(|c| *c == Cell::Null)));

    let db = test_db();
    assert_eq!(write_rows(&db, sp, &rows).unwrap(), 104);
    assert_eq!(
        one(
            &db,
            "SELECT CAST(price_level AS VARCHAR) FROM usafacts_states WHERE state_abbr = 'CA' AND yr = 2025"
        )
        .as_deref(),
        Some("110.72")
    );
}

#[test]
fn usafacts_budget_from_mts() {
    assert_eq!(
        mts9_filter(),
        "line_code_nbr:in:(20,30,50,80,100,120,140,240,250,260,270,280,320,340)"
    );
    assert!(fiscaldata_mts9_url().contains(
        "/v1/accounting/mts/mts_table_9?fields=record_date,line_code_nbr,current_month_rcpt_outly_amt&filter=line_code_nbr%3Ain%3A(20%2C30%2C50%2C"
    ));
    assert!(fiscaldata_mts9_url().ends_with("&sort=record_date&page%5Bsize%5D=10000"));
    assert!(fiscaldata_avg_rates_url()
        .contains("/v2/accounting/od/avg_interest_rates?fields=record_date,security_desc,avg_interest_rate_amt&filter=security_desc%3Aeq%3ATotal%20Marketable&"));
    assert_eq!(fiscal_year("2024-09"), 2024);
    assert_eq!(fiscal_year("2024-10"), 2025);

    let mts = usafacts_fixture("usafacts_treasury_mts9.sse");
    assert!(fiscal_data_has_rows(&mts));
    assert!(!fiscal_data_has_rows(&serde_json::json!({ "data": [] })));
    let months = mts_months(std::slice::from_ref(&mts));
    assert_eq!(months.len(), 34);
    assert!(months.values().all(|by_code| by_code.len() == 14));
    assert_eq!(months.keys().next().map(String::as_str), Some("2024-01"));
    assert_eq!(months.keys().last().map(String::as_str), Some("2026-10"));
    assert_eq!(
        months["2024-01"][&20],
        Some(282.58),
        "$282,579,404,979.89 → $B"
    );

    let rates = usafacts_fixture("usafacts_treasury_avg_rates.sse");
    let rows = budget_rows(std::slice::from_ref(&mts), Some(&rates));
    let sp = spec("usafacts_budget");
    assert_eq!(rows.len(), 34);
    assert_eq!(rows[0].len(), sp.columns.len());
    let at = |name: &str| sp.columns.iter().position(|c| c.0 == name).unwrap();
    let row = |m: &str| -> Row {
        rows.iter()
            .find(|r| r[0] == s(&format!("{m}-01")))
            .unwrap_or_else(|| panic!("{m}"))
            .clone()
    };
    assert_eq!(rows[0][0], s("2024-01-01"), "oldest month first");
    assert_eq!(row("2024-01")[at("fy")], Cell::I64(2024));
    assert_eq!(row("2024-10")[at("fy")], Cell::I64(2025));

    // Deficit = outlays − receipts: positive is a deficit, April's tax month a surplus.
    for m in ["2024-01", "2024-04", "2024-12", "2026-10"] {
        let r = row(m);
        let d = f64_of(&r[at("outlays_b")]) - f64_of(&r[at("receipts_b")]);
        assert!((f64_of(&r[at("deficit_b")]) - d).abs() < 0.006, "{m}");
    }
    assert_eq!(row("2024-01")[at("deficit_b")], Cell::F64(21.93));
    assert_eq!(row("2024-04")[at("deficit_b")], Cell::F64(-209.53));
    assert_eq!(row("2024-04")[at("receipts_b")], Cell::F64(776.2));

    // Interest TTM for 2024-12 = the twelve 2024 months; 2024-11 lacks 2023-12 → NULL.
    let interest_2024: f64 = (1..=12)
        .map(|mo| f64_of(&row(&format!("2024-{mo:02}"))[at("net_interest_b")]))
        .sum();
    let dec = row("2024-12");
    assert_eq!(dec[at("net_interest_ttm_b")], Cell::F64(907.59));
    assert!((f64_of(&dec[at("net_interest_ttm_b")]) - interest_2024).abs() < 0.005);
    assert_eq!(row("2024-11")[at("net_interest_ttm_b")], Cell::Null);
    assert_eq!(row("2024-11")[at("receipts_ttm_b")], Cell::Null);
    assert_eq!(dec[at("receipts_ttm_b")], Cell::F64(4894.11));
    assert_eq!(dec[at("outlays_ttm_b")], Cell::F64(6922.86));
    assert_eq!(dec[at("deficit_ttm_b")], Cell::F64(2028.75));
    assert_eq!(dec[at("interest_share_pct")], Cell::F64(18.54));
    assert!(matches!(dec[at("defense_ttm_b")], Cell::F64(_)));
    assert!(matches!(dec[at("customs_ttm_b")], Cell::F64(_)));

    // Average rate on marketable debt joins by month; without it only that column is NULL.
    assert_eq!(
        row("2024-01")[at("avg_interest_rate_pct")],
        Cell::F64(3.211)
    );
    assert_eq!(row("2026-10")[at("avg_interest_rate_pct")], Cell::F64(3.57));
    let by_month = avg_rate_by_month(&rates);
    assert_eq!(by_month.len(), 34);
    let other_desc = serde_json::json!({ "data": [
        { "record_date": "2024-01-31", "security_desc": "Treasury Bills", "avg_interest_rate_amt": "5.2" },
        { "record_date": "2024-02-29", "avg_interest_rate_amt": "3.3" }
    ]});
    let only = avg_rate_by_month(&other_desc);
    assert_eq!(only.len(), 1);
    assert_eq!(only.get("2024-02"), Some(&3.3));
    let no_rates = budget_rows(std::slice::from_ref(&mts), None);
    for (a, b) in no_rates.iter().zip(&rows) {
        for (i, (x, y)) in a.iter().zip(b).enumerate() {
            if i == at("avg_interest_rate_pct") {
                assert_eq!(*x, Cell::Null);
            } else {
                assert_eq!(x, y);
            }
        }
    }

    // trailing12 needs twelve consecutive months.
    let mut series: MonthSeries = (1..=12)
        .map(|mo| (format!("2025-{mo:02}"), Some(0.1)))
        .collect();
    assert_eq!(trailing12(&series, "2025-12"), Some(1.2));
    series.insert("2025-06".into(), None);
    assert_eq!(trailing12(&series, "2025-12"), None);

    let db = test_db();
    assert_eq!(write_rows(&db, sp, &rows).unwrap(), 34);
    let sql = snapshot_sql_limited("usafacts_budget", 2).unwrap();
    let res = source_query(&db, "usafacts_budget", &sql, 2).unwrap();
    assert_eq!(res.rows.len(), 2);
    assert!(res.rows[1][0].to_string().contains("2026-10"));
}

#[test]
fn usafacts_budget_lines_from_mts() {
    let mts = usafacts_fixture("usafacts_treasury_mts9.sse");
    let rows = budget_line_rows(std::slice::from_ref(&mts));
    let sp = spec("usafacts_budget_lines");
    assert_eq!(
        rows.len(),
        34 * 14,
        "12 lines + Other receipts + Other outlays a month"
    );
    assert_eq!(rows[0].len(), sp.columns.len());
    let find = |m: &str, line: &str| -> Row {
        rows.iter()
            .find(|r| r[0] == s(&format!("{m}-01")) && r[3] == s(line))
            .unwrap_or_else(|| panic!("{m} {line}"))
            .clone()
    };
    let flow_rows = |m: &str, flow: &str| -> Vec<Row> {
        rows.iter()
            .filter(|r| r[0] == s(&format!("{m}-01")) && r[2] == s(flow))
            .cloned()
            .collect()
    };
    let months = mts_months(std::slice::from_ref(&mts));
    // Each month's lines (with "Other …") add up to its totals.
    for m in ["2024-01", "2024-12", "2026-10"] {
        for (flow, total) in [("Receipts", 120), ("Outlays", 340)] {
            let parts = flow_rows(m, flow);
            assert_eq!(parts.len(), if flow == "Receipts" { 6 } else { 8 });
            let sum: f64 = parts.iter().map(|r| f64_of(&r[4])).sum();
            let t = months[m][&total].unwrap();
            assert!((sum - t).abs() < 0.011, "{m} {flow}: {sum} vs {t}");
        }
    }
    let other = find("2024-12", "Other outlays");
    assert_eq!(
        other[1],
        Cell::I64(2025),
        "December is in the next fiscal year"
    );
    assert_eq!(other[2], s("Outlays"));
    assert_eq!(other[4], Cell::F64(59.99));
    assert_eq!(other[5], Cell::F64(721.47));
    assert_eq!(other[6], Cell::F64(10.42));
    let interest = find("2024-12", "Net interest");
    assert_eq!(interest[5], Cell::F64(907.59));
    assert_eq!(interest[6], Cell::F64(13.11));
    assert_eq!(
        find("2024-12", "Individual income taxes")[6],
        Cell::F64(49.43)
    );
    let other_rec = find("2024-12", "Other receipts");
    assert_eq!(other_rec[4], Cell::F64(5.97));
    assert_eq!(other_rec[5], Cell::F64(133.5));
    assert_eq!(other_rec[6], Cell::F64(2.73));
    assert_eq!(
        find("2024-12", "Customs duties (tariffs)")[2],
        s("Receipts")
    );
    // Shares of each flow add up to ~100% once 12 months exist; before that they're NULL.
    for flow in ["Receipts", "Outlays"] {
        let total: f64 = flow_rows("2024-12", flow)
            .iter()
            .map(|r| f64_of(&r[6]))
            .sum();
        assert!((total - 100.0).abs() < 0.1, "{flow}: {total}");
        assert!(flow_rows("2024-11", flow)
            .iter()
            .all(|r| r[5] == Cell::Null && r[6] == Cell::Null));
    }
    assert!(
        rows.iter().all(|r| r[4] != Cell::Null),
        "fixture is complete"
    );

    // A missing part makes that month's "Other" unknown rather than wrong.
    let gap = serde_json::json!({ "data": [
        { "record_date": "2025-01-31", "line_code_nbr": "120", "current_month_rcpt_outly_amt": "500000000000" },
        { "record_date": "2025-01-31", "line_code_nbr": "20", "current_month_rcpt_outly_amt": "300000000000" }
    ]});
    let g = budget_line_rows(&[gap]);
    assert_eq!(g.len(), 14);
    let other = g.iter().find(|r| r[3] == s("Other receipts")).unwrap();
    assert_eq!(other[4], Cell::Null);
    assert_eq!(
        g.iter()
            .find(|r| r[3] == s("Individual income taxes"))
            .unwrap()[4],
        Cell::F64(300.0)
    );

    let db = test_db();
    assert_eq!(write_rows(&db, sp, &rows).unwrap(), 476);
    let sql = snapshot_sql_limited("usafacts_budget_lines", 14).unwrap();
    assert!(
        sql.contains("ORDER BY month DESC, flow DESC, line DESC LIMIT 14"),
        "{sql}"
    );
    let res = source_query(&db, "usafacts_budget_lines", &sql, 14).unwrap();
    assert_eq!(res.rows.len(), 14);
    assert!(res
        .rows
        .iter()
        .all(|r| r[0].to_string().contains("2026-10")));
}

#[test]
fn usafacts_household_quarterly_from_fred() {
    assert_eq!(USAFACTS_HOUSEHOLD_SERIES.len(), 14);
    assert_eq!(
        household_fred_args("MSPUS"),
        serde_json::json!({
            "series_id": "MSPUS",
            "observation_start": "1990-01-01",
            "frequency": "q",
            "aggregation_method": "avg",
        })
    );
    assert_eq!(
        household_fredgraph_url("PSAVERT"),
        "https://fred.stlouisfed.org/graph/fredgraph.csv?id=PSAVERT&cosd=1990-01-01&fq=Quarterly&fam=avg"
    );

    let ids: Vec<&str> = USAFACTS_HOUSEHOLD_SERIES.iter().map(|s| s.1).collect();
    let at_id = |id: &str| ids.iter().position(|x| *x == id).unwrap();
    let mut payloads: Vec<Option<Value>> = vec![None; ids.len()];
    payloads[at_id("MSPUS")] = Some(usafacts_fixture("usafacts_fred_q_mspus.sse"));
    payloads[at_id("LES1252881500Q")] = Some(usafacts_fixture("usafacts_fred_q_les.sse"));
    // The keyless fallback's shape feeds the same transform.
    payloads[at_id("PSAVERT")] =
        fredgraph_observations(&fixture_text("fredgraph_q_psavert.csv"), "PSAVERT");
    let rows = household_rows(&payloads);
    let sp = spec("usafacts_household");
    assert_eq!(rows.len(), 35, "2018-Q1 … 2026-Q3");
    assert_eq!(rows[0].len(), sp.columns.len());
    let at = |name: &str| sp.columns.iter().position(|c| c.0 == name).unwrap();
    let q = |d: &str| -> Row {
        rows.iter()
            .find(|r| r[0] == s(d))
            .unwrap_or_else(|| panic!("{d}"))
            .clone()
    };
    let first = q("2018-01-01");
    assert_eq!(first[at("yr")], Cell::I64(2018));
    assert_eq!(first[at("saving_rate_pct")], Cell::F64(5.8));
    assert_eq!(first[at("median_home_price_usd")], Cell::F64(331_800.0));
    assert_eq!(first[at("median_weekly_earnings_usd")], Cell::F64(875.0));
    // 331,800 / (875 × 52) years of median full-time pay.
    assert_eq!(first[at("home_price_years_of_pay")], Cell::F64(7.29));
    assert_eq!(first[at("decade")], s("2010s"));
    assert_eq!(first[at("card_delinquency_pct")], Cell::Null);
    assert_eq!(
        q("2020-01-01")[at("home_price_years_of_pay")],
        Cell::F64(6.65)
    );
    assert_eq!(
        q("2020-04-01")[at("home_price_years_of_pay")],
        Cell::F64(6.05)
    );
    assert_eq!(
        q("2026-07-01")[at("home_price_years_of_pay")],
        Cell::F64(6.1)
    );
    // LES is "." for 2025-Q4 → no ratio.
    assert_eq!(
        q("2025-10-01")[at("median_weekly_earnings_usd")],
        Cell::Null
    );
    assert_eq!(q("2025-10-01")[at("home_price_years_of_pay")], Cell::Null);
    // NBER: 2020-Q1 holds March, 2020-Q2 holds April.
    assert_eq!(q("2019-10-01")[at("recession")], s("Expansion"));
    assert_eq!(q("2020-01-01")[at("recession")], s("Recession"));
    assert_eq!(q("2020-04-01")[at("recession")], s("Recession"));
    assert_eq!(q("2020-07-01")[at("recession")], s("Expansion"));
    assert_eq!(q("2020-07-01")[at("decade")], s("2020s"));
    assert!(quarter_in_recession("1990-07-01"), "August 1990");
    assert!(!quarter_in_recession("1990-04-01"));
    assert!(!quarter_in_recession("2007-10-01"));
    assert!(quarter_in_recession("2008-01-01"));
    assert!(quarter_in_recession("2009-04-01"));
    assert!(!quarter_in_recession("2009-07-01"));
    assert!(quarter_in_recession("2001-10-01"));
    assert!(!quarter_in_recession("2019-10-01"), "Dec → Jan rollover");

    // Monthly dates snap to the quarter start; REVOLSL / ICSA are scaled; pre-1990 dropped.
    let mut scaled: Vec<Option<Value>> = vec![None; ids.len()];
    scaled[at_id("REVOLSL")] = Some(serde_json::json!({ "observations": [
        { "date": "2020-05-01", "value": "1234567" },
        { "date": "1989-10-01", "value": "1" }
    ]}));
    scaled[at_id("ICSA")] = Some(serde_json::json!({ "observations": [
        { "date": "2020-06-01", "value": "212000" }
    ]}));
    let s_rows = household_rows(&scaled);
    assert_eq!(s_rows.len(), 1);
    assert_eq!(s_rows[0][0], s("2020-04-01"));
    assert_eq!(s_rows[0][at("revolving_credit_b")], Cell::F64(1234.57));
    assert_eq!(s_rows[0][at("initial_claims_k")], Cell::F64(212.0));
    assert!(household_rows(&vec![None; ids.len()]).is_empty());

    let db = test_db();
    assert_eq!(write_rows(&db, sp, &rows).unwrap(), 35);
    let sql = snapshot_sql_limited("usafacts_household", 4).unwrap();
    let res = source_query(&db, "usafacts_household", &sql, 4).unwrap();
    assert_eq!(res.rows.len(), 4);
    assert!(res.rows[3][0].to_string().contains("2026-07"));
}

#[test]
fn keep_newest_kinds_match_typescript_registry() {
    let src = include_str!("../../src/lib/sourceRegistry.ts");
    let defs = &src[src.find("export const SOURCE_DEFS").expect("SOURCE_DEFS")..];
    let mut ts: Vec<String> = defs
        .split("def({")
        .skip(1)
        .filter(|chunk| chunk.lines().any(|l| l.trim() == "keepNewest: true,"))
        .map(|chunk| unquote(line_value(chunk, "kind")))
        .collect();
    ts.sort();
    let mut rust: Vec<String> = KEEP_NEWEST_KINDS.iter().map(|k| k.to_string()).collect();
    rust.sort();
    assert_eq!(rust, ts);
}

// ---------------------------------------------------------------
// 2026-10 keyless batch (sources_extra.rs) — same fixtures as
// src/lib/__tests__/extraSources.test.ts
// ---------------------------------------------------------------

fn f64_of(c: &Cell) -> f64 {
    match c {
        Cell::F64(v) => *v,
        Cell::I64(v) => *v as f64,
        other => panic!("not a number: {:?}", other),
    }
}

#[test]
fn extra_space_and_web_parse() {
    let fb = fireballs_rows(&fixture("fireballs.json")).unwrap();
    assert_eq!(fb[0][0], s("2026-10-04 03:14:45"));
    assert_eq!(fb[0][1], Cell::F64(-41.8));
    assert_eq!(fb[0][2], Cell::F64(-173.1));
    assert_eq!(fb[0][6], Cell::F64(0.18));

    let sats = satellites_rows(&fixture("satellites.json")).unwrap();
    assert_eq!(sats[0][0], Cell::I64(694));
    assert_eq!(sats[0][2], s("Payload"));
    assert_eq!(sats[0][3], Cell::I64(1963));
    assert!((f64_of(&sats[0][5]) - 101.92).abs() < 0.05);
    assert!(f64_of(&sats[0][6]) > f64_of(&sats[0][7]));
    assert!(sats.iter().any(|r| r[2] == s("Rocket body")));
    assert_eq!(satellite_object_type("FENGYUN 1C DEB"), "Debris");

    let ioda = ioda_rows(&fixture("ioda.json")).unwrap();
    assert_eq!(ioda.len(), 3, "asn entities dropped");
    let fi = ioda.iter().find(|r| r[1] == s("FI")).unwrap();
    assert_eq!(fi[7], Cell::F64(24.2));
    assert_eq!(ioda_window(1_000_000_000), (999_395_100, 999_999_900));

    let arxiv = arxiv_rows(&[fixture_text("arxiv.xml"), fixture_text("arxiv.xml")]).unwrap();
    assert_eq!(arxiv.len(), 2);
    assert_eq!(arxiv[0][0], s("2610.26863v1"));
    assert_eq!(arxiv[0][2], s("cs.LG"));
    assert_eq!(arxiv[0][3], s("Computer science"));
    assert_eq!(arxiv[0][6], s("2026-10-19 17:59:59"));
    assert!(matches!(arxiv[0][5], Cell::I64(n) if n > 0));

    let gh = github_events_rows(&fixture("github_events.json")).unwrap();
    assert_eq!(gh[0][1], s("Push"));
    assert_eq!(gh[0][3], Cell::Bool(false));
    assert!(
        !format!("{:?}", gh).contains("someone"),
        "actor logins dropped"
    );

    let books = books_rows(
        Some(&fixture("openlibrary.json")),
        Some(&fixture("gutendex.json")),
    )
    .unwrap();
    assert_eq!(books[0][2], s("Atomic Habits"));
    assert_eq!(books[0][7], s("en"));
    assert_eq!(books[2][3], s("Jane Austen"));
    assert_eq!(books[2][6], Cell::I64(190246));
    assert_eq!(
        gutenberg_author("Shelley, Mary Wollstonecraft (1797-1851)"),
        "Mary Wollstonecraft Shelley"
    );

    let db = test_db();
    for (kind, rows) in [
        ("fireballs", &fb),
        ("satellites", &sats),
        ("internet_outages", &ioda),
        ("arxiv", &arxiv),
        ("github_events", &gh),
        ("books", &books),
    ] {
        assert_eq!(
            write_rows(&db, spec(kind), rows).unwrap() as usize,
            rows.len(),
            "{kind}"
        );
    }
}

#[test]
fn extra_faa_xml_parse() {
    let rows = faa_rows(&fixture_text("faa.xml")).unwrap();
    let by = |a: &str| rows.iter().find(|r| r[0] == s(a)).unwrap().clone();
    let sfo = by("SFO");
    assert_eq!(sfo[1], s("Ground delay"));
    assert_eq!(sfo[2], s("low ceilings & wind"));
    assert_eq!(sfo[4], Cell::F64(121.0));
    assert_eq!(sfo[5], Cell::F64(63.0));
    assert_eq!(by("EWR")[1], s("Ground stop"));
    let ege = by("EGE");
    assert_eq!(ege[1], s("Arrival delay"));
    assert_eq!(ege[3], Cell::F64(31.0));
    assert_eq!(ege[6], s("Increasing"));
    assert_eq!(by("SNA")[1], s("Closure"));
    assert_eq!(sfo[7], s("2026-10-20 16:22:47"));
    assert_eq!(faa_minutes(Some("2 hours")), Some(120.0));
    assert!(faa_rows("<html>maintenance</html>").is_err());
    let db = test_db();
    assert_eq!(
        write_rows(&db, spec("faa_delays"), &rows).unwrap() as usize,
        rows.len()
    );
}

#[test]
fn extra_us_and_city_parse() {
    let lda = lobbying_rows(&fixture("lda.json")).unwrap();
    assert_eq!(lda[0][1], s("WILLIAMS AND JENSEN, PLLC"));
    assert_eq!(lda[0][3], s("VA"));
    assert_eq!(lda[0][6], s("third quarter"));
    assert_eq!(lda[0][7], Cell::F64(60000.0));
    assert_eq!(lda[0][8], s("income"));
    assert_eq!(lda[0][11], s("2026-10-20 16:22:37"));

    let fda = fda_rows(&[
        fixture("fda_food.json"),
        fixture("fda_drug.json"),
        fixture("fda_food.json"),
    ])
    .unwrap();
    assert_eq!(fda.len(), 4, "duplicate recall numbers dropped");
    assert_eq!(fda[0][1], s("Food"));
    assert_eq!(fda[0][11], s("2026-10-07"));

    let veh = vehicle_recalls_rows(&fixture("nhtsa.json")).unwrap();
    assert_eq!(veh[0][1], s("2026-10-16"));
    assert_eq!(veh[0][6], Cell::I64(3686));
    assert_eq!(veh[0][7], Cell::Bool(false));

    let insp = nyc_inspections_rows(&fixture("nyc_inspections.json")).unwrap();
    assert_eq!(insp[0][1], s("FISH CHEEKS"));
    assert_eq!(insp[0][4], s("2026-10-17 00:00:00"));
    assert_eq!(insp[0][6], Cell::I64(0));

    let crime = chicago_crime_rows(&fixture("chicago_crime.json")).unwrap();
    assert_eq!(crime[0][3], s("MOTOR VEHICLE THEFT"));
    assert_eq!(crime[0][6], Cell::Bool(false));

    let parking = nyc_parking_rows(&serde_json::json!([
        {"summons_number": "1", "issue_date": "2025-07-27T00:00:00.000", "fine_amount": "180", "state": "NY", "plate": "ABC123"},
        {"summons_number": "2", "issue_date": "70/40/2000"}
    ]))
    .unwrap();
    assert_eq!(parking[0][1], s("2025-07-27"));
    assert_eq!(parking[0][4], Cell::F64(180.0));
    assert_eq!(parking[0][8], s("NY"));
    assert_eq!(parking[1][1], Cell::Null);
    assert!(!format!("{:?}", parking).contains("ABC123"));

    let pb = powerball_rows(&fixture("powerball.json")).unwrap();
    assert_eq!(pb[0][0], s("2026-10-19"));
    assert_eq!(pb[0][1], Cell::I64(2026));
    assert_eq!(pb[0][2], Cell::I64(8));
    assert_eq!(pb[0][7], Cell::I64(23));
    assert_eq!(pb[0][8], Cell::I64(4));

    let fed = fed_spending_rows(&fixture("usaspending.json")).unwrap();
    assert_eq!(fed[0][1], s("TREAS"));
    assert!((f64_of(&fed[0][7]) - 24.609).abs() < 0.01);

    let info = citibike_info(&fixture("gbfs_parity_info.json")).unwrap();
    let bikes = bikeshare_rows(
        "Divvy (Chicago)",
        &fixture("gbfs_parity_status.json"),
        &info,
    )
    .unwrap();
    assert!(!bikes.is_empty());
    assert_eq!(bikes[0][0], s("Divvy (Chicago)"));
    assert_eq!(bikes[0].len(), spec("bikeshare").columns.len());

    let nobel = nobel_rows(&fixture("nobel.json")).unwrap();
    assert_eq!(nobel.len(), 3);
    assert_eq!(nobel[0][1], s("Wilhelm Conrad Röntgen"));
    assert_eq!(nobel[0][5], Cell::I64(1901));
    assert_eq!(nobel[0][6], s("Physics"));

    let trivia = trivia_rows(&[fixture("trivia.json")]).unwrap();
    assert_eq!(trivia[0][0], s("Science: Computers"));
    assert_eq!(trivia[0][5], Cell::I64(3));
    assert!(matches!(&trivia[1][3], Cell::Str(q) if q.contains("2001: A Space Odyssey")));

    let food = openfood_rows(&[fixture("openfood.json")]).unwrap();
    assert_eq!(food[0][1], s("Nutella"));
    assert_eq!(food[0][3], s("E"));
    assert_eq!(food[0][6], Cell::F64(539.0));

    let radio = radio_rows(&fixture("radio.json")).unwrap();
    assert_eq!(radio[0][1], s("SomaFM Groove Salad"));
    assert_eq!(radio[0][7], Cell::I64(4200));

    let poke_body = serde_json::json!({
        "columns": ["id", "name", "type1", "type2", "height_m", "weight_kg", "hp", "attack", "defense", "sp_attack", "sp_defense", "speed", "total"],
        "rows": [[1, "bulbasaur", "grass", "poison", 0.7, 6.9, 45, 49, 49, 65, 65, 45, 318]]
    });
    let poke = columnar_rows(&poke_body, spec("pokemon")).unwrap();
    assert_eq!(poke[0][1], s("bulbasaur"));
    assert_eq!(poke[0][12], Cell::I64(318));

    let met_body = serde_json::json!({
        "columns": ["object_id", "title", "artist", "department", "culture", "object_date", "object_begin_year", "medium", "is_public_domain", "is_highlight"],
        "rows": [[436535, "Wheat Field with Cypresses", "Vincent van Gogh", "European Paintings", null, "1889", 1889, "Oil on canvas", true, true]]
    });
    let met = columnar_rows(&met_body, spec("met")).unwrap();
    assert_eq!(met[0][0], Cell::I64(436535));
    assert_eq!(met[0][8], Cell::Bool(true));

    let db = test_db();
    for (kind, rows) in [
        ("lobbying", &lda),
        ("fda_recalls", &fda),
        ("vehicle_recalls", &veh),
        ("nyc_inspections", &insp),
        ("chicago_crime", &crime),
        ("nyc_parking", &parking),
        ("powerball", &pb),
        ("fed_spending", &fed),
        ("bikeshare", &bikes),
        ("nobel", &nobel),
        ("trivia", &trivia),
        ("openfood", &food),
        ("radio", &radio),
        ("pokemon", &poke),
        ("met", &met),
    ] {
        assert_eq!(
            write_rows(&db, spec(kind), rows).unwrap() as usize,
            rows.len(),
            "{kind}"
        );
    }
}

#[test]
fn extra_worker_columnar_feeds() {
    // Shape the Worker sends for bluesky / bgp (workers/extraSources.ts)
    let body = serde_json::json!({
        "columns": ["id", "ts", "dimension", "key", "posts", "window_secs", "posts_per_min"],
        "rows": [
            ["2026-10-20T16:24:00.000Z|total|all posts", "2026-10-20T16:24:00.000Z", "total", "all posts", 300, 5.0, 3600.0],
            ["2026-10-20T16:24:00.000Z|language|en", "2026-10-20T16:24:00.000Z", "language", "en", 200, 5.0, 2400.0]
        ]
    });
    let rows = columnar_rows(&body, spec("bluesky")).unwrap();
    assert_eq!(rows[0][1], s("2026-10-20 16:24:00"));
    assert_eq!(rows[1][4], Cell::I64(200));
    let db = test_db();
    assert_eq!(write_rows(&db, spec("bluesky"), &rows).unwrap(), 2);
    // Same poll again: upsert on id keeps one row per (ts, dimension, key)
    write_rows(&db, spec("bluesky"), &rows).unwrap();
    assert_eq!(
        one(&db, "SELECT COUNT(*) FROM bluesky_activity"),
        Some("2".into())
    );

    // Reordered / missing columns map by name
    let bgp = serde_json::json!({"columns": ["ts", "id", "announcements"], "rows": [["2026-10-20T16:24:00Z", "x", 7]]});
    let rows = columnar_rows(&bgp, spec("bgp")).unwrap();
    assert_eq!(rows[0][0], s("x"));
    assert_eq!(rows[0][4], Cell::I64(7));
    assert_eq!(rows[0][5], Cell::Null);
}
