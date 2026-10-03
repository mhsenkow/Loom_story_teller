// Unit + in-memory DuckDB tests for sources.rs. Fixtures under
// tests/fixtures/sources/ are trimmed real responses (captured with curl).

use super::*;
use std::sync::Mutex;

fn fixture(name: &str) -> Value {
    let path = format!("{}/tests/fixtures/sources/{}", env!("CARGO_MANIFEST_DIR"), name);
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
        out.push((0..n).map(|i| r.get::<_, Option<String>>(i).unwrap()).collect());
    }
    out
}

fn one(db: &LoomDb, sql: &str) -> Option<String> {
    query(db, sql).into_iter().next().and_then(|r| r.into_iter().next().flatten())
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
            poll_ms: line_value(chunk, "pollMs").replace('_', "").parse().unwrap(),
        })
        .collect()
}

#[test]
fn specs_match_typescript_registry() {
    let reg = registry();
    let reg_kinds: Vec<&str> = reg.iter().map(|r| r.kind.as_str()).collect();
    let rust_kinds: Vec<&str> = SOURCE_SPECS.iter().map(|s| s.kind).collect();
    assert_eq!(rust_kinds, reg_kinds, "kinds / order differ from sourceRegistry.ts");
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
    assert_eq!(snapshot_sql("fx").unwrap(), "SELECT * FROM fx_rates ORDER BY as_of DESC, quote");
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
        assert!(schema_matches(&existing_columns(&conn, sp.table).unwrap(), sp), "{}", kind);
    }
    drop(conn);
    assert_eq!(one(&db, "SELECT COUNT(*) FROM world_bank").as_deref(), Some("0"));
    // Matching tables keep their rows.
    assert_eq!(one(&db, "SELECT title FROM hn_stories").as_deref(), Some("kept"));
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
    assert_eq!(p("2026-10-02T16:43:00-04:00").as_deref(), Some("2026-10-02 20:43:00"));
    assert_eq!(p("2026-10-02T22:30Z").as_deref(), Some("2026-10-02 22:30:00"));
    assert_eq!(p("2026-10-02T03:54:00Z").as_deref(), Some("2026-10-02 03:54:00"));
    assert_eq!(p("2026-09-20T00:00:00.000Z").as_deref(), Some("2026-09-20 00:00:00"));
    assert_eq!(p("2026-10-02T01:23:45.000").as_deref(), Some("2026-10-02 01:23:45"));
    assert_eq!(p("2026-09-30T00:00").as_deref(), Some("2026-09-30 00:00:00"));
    assert_eq!(p("2026-10-02T23:30:00+0530").as_deref(), Some("2026-10-02 18:00:00"));
    assert_eq!(p("2026-12-31T23:00:00-02:00").as_deref(), Some("2027-01-01 01:00:00"));
    assert_eq!(p("2026-09-25 09:00:00").as_deref(), Some("2026-09-25 09:00:00"));
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
    assert_eq!(one(&db, "SELECT COUNT(*) FROM usgs_quakes").as_deref(), Some("2"));
    assert_eq!(
        one(&db, "SELECT magnitude FROM usgs_quakes WHERE id = 'hv75048562'").as_deref(),
        Some("2.0")
    );
    assert_eq!(
        one(&db, "SELECT CAST(ts AS VARCHAR) FROM usgs_quakes WHERE id = 'hv75048562'").as_deref(),
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
        one(&db, "SELECT COUNT(*) FROM nws_alerts WHERE expires > effective").as_deref(),
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
    assert_eq!(one(&db, "SELECT COUNT(*) FROM meteo_weather").as_deref(), Some("6"));
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
        Cell::F64(c) => assert!((c - (1.1415 / 1.1448 - 1.0) * 100.0).abs() < 1e-9),
        ref other => panic!("{:?}", other),
    }
    let db = test_db();
    assert_eq!(write_rows(&db, spec("fx"), &rows).unwrap(), 9);
    assert_eq!(
        one(&db, &format!("{} LIMIT 1", snapshot_sql("fx").unwrap().replace("SELECT *", "SELECT CAST(as_of AS VARCHAR)"))).as_deref(),
        Some("2026-07-07")
    );
    assert_eq!(fx_url(days_from_civil(2026, 10, 2)), "https://api.frankfurter.app/2026-07-04..");
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
    assert_eq!(one(&db, "SELECT COUNT(*) FROM opensky_aircraft").as_deref(), Some("4"));
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
    assert_eq!(r[7], s("Classified payload for the US National Reconnaissance Office."));
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
        one(&db, &format!("{} LIMIT 1", snapshot_sql("countries").unwrap().replace("SELECT *", "SELECT name"))).as_deref(),
        Some("United States")
    );
}

#[test]
fn world_bank_pivots_wide_and_drops_aggregates() {
    let countries = wb_country_names(&fixture("wb_countries.json")).unwrap();
    assert!(countries.contains_key("USA"));
    assert!(countries.contains_key("XKX"));
    assert!(!countries.contains_key("WLD"), "aggregates (region NA) are dropped");
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
        one(&db, "SELECT COUNT(DISTINCT country_code || yr) = COUNT(*) FROM world_bank").as_deref(),
        Some("true")
    );
    assert!(wb_indicator_url("EN.GHG.CO2.PC.CE.AR5").contains("date=2000:2023"));
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

    let iss = iss_rows(&serde_json::json!([{"latitude": 1.0, "longitude": 2.0, "altitude": 420.1, "velocity": 27600.0, "visibility": "daylight", "timestamp": 1790974000}, {"latitude": 3.0, "longitude": 4.0, "timestamp": 1790974600}])).unwrap();
    assert_eq!(iss.len(), 2);
    assert_eq!(iss_rows(&serde_json::json!({"latitude": 1.0, "longitude": 2.0, "timestamp": 1})).unwrap().len(), 1);

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
    assert_eq!(one(&db, "SELECT COUNT(*) FROM natural_events").as_deref(), Some("1"));
}

#[test]
fn citibike_joins_info_and_status() {
    let info = citibike_info(&fixture("gbfs_info.json")).unwrap();
    assert_eq!(info.len(), 3);
    let rows = citibike_rows(&fixture("gbfs_status.json"), &info).unwrap();
    // Not-installed dock and the station missing from info are skipped.
    assert_eq!(rows.len(), 2);
    let vesey = rows.iter().find(|r| r[1] == s("Vesey St & Church St")).unwrap();
    assert_eq!(vesey[4], Cell::I64(78));
    assert_eq!(vesey[5], Cell::I64(60));
    assert_eq!(vesey[6], Cell::I64(12));
    assert_eq!(vesey[7], Cell::I64(18));
    assert_eq!(vesey[8], Cell::F64(76.9)); // 60 / 78 → 76.9 %
    assert_eq!(vesey[9], Cell::Bool(true));
    assert_eq!(vesey[10], s(&fmt_ts(1_790_974_027)));

    let db = test_db();
    assert_eq!(write_rows(&db, spec("citibike"), &rows).unwrap(), 2);
    assert_eq!(
        one(&db, &format!("{} LIMIT 1", snapshot_sql("citibike").unwrap().replace("SELECT *", "SELECT bikes_available"))).as_deref(),
        Some("60")
    );
}

#[test]
fn space_weather_kp_and_storm_levels() {
    assert_eq!(storm_level(4.67), "G0");
    assert_eq!(storm_level(5.0), "G1");
    assert_eq!(storm_level(6.33), "G2");
    assert_eq!(storm_level(7.0), "G3");
    assert_eq!(storm_level(8.67), "G4");
    assert_eq!(storm_level(9.0), "G5");

    let rows = kp_rows(&fixture("kp.json")).unwrap();
    assert_eq!(rows.len(), 4);
    assert_eq!(rows[0], vec![s("2026-09-25 00:00:00"), Cell::F64(3.67), Cell::I64(22), Cell::I64(8), s("G0")]);
    assert_eq!(rows[3][4], s("G3"));

    // Older SWPC shape: array of string arrays with a header row.
    let legacy = serde_json::json!([
        ["time_tag", "Kp", "a_running", "station_count"],
        ["2024-05-10 21:00:00.000", "9.00", "400", "8"]
    ]);
    let rows2 = kp_rows(&legacy).unwrap();
    assert_eq!(rows2, vec![vec![s("2024-05-10 21:00:00"), Cell::F64(9.0), Cell::I64(400), Cell::I64(8), s("G5")]]);

    let db = test_db();
    assert_eq!(write_rows(&db, spec("spaceweather"), &rows).unwrap(), 4);
}

#[test]
fn uk_carbon_merges_yesterday_and_today() {
    let rows = ukcarbon_rows(&[fixture("ukc_yesterday.json"), fixture("ukc_today.json")]).unwrap();
    assert_eq!(rows.len(), 4);
    assert_eq!(rows[0], vec![s("2026-09-30 23:00:00"), Cell::I64(161), Cell::I64(181), s("high")]);
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
    assert_eq!(rows[0], vec![Cell::I64(1), s("Christa Pike"), Cell::I64(4_309_025), s("2026-10-01")]);
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
    assert!(top.iter().all(|r| matches!(&r[1], Cell::Str(a) if a.starts_with("A "))));

    let db = test_db();
    assert_eq!(write_rows(&db, spec("pageviews"), &rows).unwrap(), 9);
    assert_eq!(
        one(&db, "SELECT CAST(day AS VARCHAR) FROM wiki_top_articles LIMIT 1").as_deref(),
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
    assert_eq!(rows[0], vec![s("1880-01-01"), Cell::I64(1880), Cell::I64(1), Cell::F64(-0.4)]);
    let last = rows.last().unwrap();
    assert_eq!(last[1], Cell::I64(2026));
    assert_eq!(last[2], Cell::I64(8));
    assert_eq!(last[3], Cell::F64(1.32));
    // Older shape: bare values, sometimes strings.
    let alt = climate_rows(&serde_json::json!({"data": {"202001": "1.05", "202002": {"anomaly": 1.2}, "junk": 1}})).unwrap();
    assert_eq!(alt.len(), 2);
    assert_eq!(alt[0][3], Cell::F64(1.05));

    let db = test_db();
    assert_eq!(write_rows(&db, spec("climate"), &rows).unwrap(), 5);
    assert_eq!(
        one(&db, "SELECT CAST(ts AS VARCHAR) FROM global_temperature ORDER BY ts ASC LIMIT 1").as_deref(),
        Some("1880-01-01")
    );
    assert!(climate_url(2026).ends_with("/1880-2026/data.json"));
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
    assert_eq!(one(&db, "SELECT COUNT(*) FROM space_weather").as_deref(), Some("4"));
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
        vec![s("2026-01-01 00:00:00"), Cell::F64(1.0), Cell::I64(1), Cell::I64(8), s("G0")],
        vec![s("not a time"), Cell::F64(2.0), Cell::I64(1), Cell::I64(8), s("G0")],
    ];
    assert_eq!(write_rows(&db, spec("spaceweather"), &rows).unwrap(), 2);
    assert_eq!(one(&db, "SELECT COUNT(*) FROM space_weather WHERE ts IS NULL").as_deref(), Some("1"));
}

#[test]
fn query_json_formats_temporal_and_wide_ints() {
    let db = test_db();
    let rows = vec![vec![s("2026-01-01 12:34:56"), Cell::F64(1.0), Cell::I64(1), Cell::I64(8), s("G0")]];
    write_rows(&db, spec("spaceweather"), &rows).unwrap();
    let climate = climate_rows(&fixture("climate.json")).unwrap();
    write_rows(&db, spec("climate"), &climate).unwrap();
    let a = source_query(&db, "spaceweather", "", 5).unwrap();
    assert_eq!(a.rows[0][0], serde_json::json!("2026-01-01T12:34:56.000Z"));
    let b = source_query(&db, "climate", "SELECT * FROM global_temperature ORDER BY ts", 5).unwrap();
    assert_eq!(b.rows[0][0], serde_json::json!("1880-01-01"));
    let c = source_query(&db, "spaceweather", "SELECT SUM(station_count::BIGINT) AS s, 1.5::DECIMAL(4,1) AS d FROM space_weather", 5).unwrap();
    assert_eq!(c.rows[0], vec![serde_json::json!(8.0), serde_json::json!(1.5)]);
}

/// Live network smoke test of every kind's real fetch → parse → write path.
/// Run with: cargo test --lib live_fetch_every_source -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn live_fetch_every_source() {
    let db = test_db();
    let mut ctx = PollCtx {
        client: build_client().unwrap(),
        citibike_info: None,
        iss_seeded: false,
        opensky_retry_at: 0,
        coingecko_retry_at: 0,
        adsb_next: 0,
    };
    let mut failed = Vec::new();
    for sp in SOURCE_SPECS {
        let t = std::time::Instant::now();
        match fetch_rows(sp, &mut ctx, &db).await {
            Ok(rows) => match write_rows(&db, sp, &rows) {
                Ok(n) => {
                    let sample = source_query(&db, sp.kind, &snapshot_sql(sp.kind).unwrap(), 1).unwrap();
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
