// =================================================================
// Loom — parsers for the 2026-10 keyless feed batch
// =================================================================
// Rust mirror of workers/extraSources.ts: fireballs, satellites,
// internet_outages, faa_delays, lobbying, fda_recalls, vehicle_recalls,
// arxiv, github_events, books, nyc_inspections, chicago_crime,
// nyc_parking, powerball, fed_spending, bikeshare. Upstream URLs live in
// sources.rs (the endpoint parity test reads that file).
//
// bluesky / bgp are WebSocket samples: the desktop app reads the Worker's
// aggregated `{ columns, rows }` (`columnar_rows`) instead of holding its
// own socket, so there is no tungstenite dependency and the privacy
// filtering (counts only) lives in one place.
//
// Privacy: GitHub actor logins, lobbyist names / filer contacts and
// parking plates are never read into rows.
// =================================================================

use super::*;

fn clip(v: Option<&Value>, max: usize) -> Cell {
    match v.and_then(Value::as_str) {
        Some(s) => {
            let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
            if s.is_empty() {
                Cell::Null
            } else if s.chars().count() > max {
                let cut: String = s.chars().take(max - 1).collect();
                Cell::Str(format!("{}…", cut))
            } else {
                Cell::Str(s)
            }
        }
        None => Cell::Null,
    }
}

/// "20261007" / "2026-10-07…" → "2026-10-07".
pub(crate) fn iso_day(v: Option<&Value>) -> Cell {
    let Some(s) = v.and_then(Value::as_str).map(str::trim) else {
        return Cell::Null;
    };
    if s.len() == 8 && s.bytes().all(|b| b.is_ascii_digit()) {
        return Cell::Str(format!("{}-{}-{}", &s[0..4], &s[4..6], &s[6..8]));
    }
    match s.get(0..10) {
        Some(d)
            if d.as_bytes()[4] == b'-'
                && d.as_bytes()[7] == b'-'
                && d.bytes()
                    .enumerate()
                    .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit()) =>
        {
            Cell::str(d)
        }
        _ => Cell::Null,
    }
}

fn round_to(v: f64, places: i32) -> f64 {
    let f = 10f64.powi(places);
    (v * f).round() / f
}

fn non_zero_coord(v: Option<&Value>) -> Cell {
    match v.and_then(as_f64_loose) {
        Some(f) if f != 0.0 => Cell::F64(f),
        _ => Cell::Null,
    }
}

fn bool_loose(v: Option<&Value>) -> Cell {
    match v {
        Some(Value::Bool(b)) => Cell::Bool(*b),
        Some(Value::String(s)) if s == "true" => Cell::Bool(true),
        Some(Value::String(s)) if s == "false" => Cell::Bool(false),
        _ => Cell::Null,
    }
}

fn yes_no(v: Option<&Value>) -> Cell {
    match v
        .and_then(Value::as_str)
        .map(|s| s.trim().to_ascii_lowercase())
    {
        Some(s) if s == "yes" => Cell::Bool(true),
        Some(s) if s == "no" => Cell::Bool(false),
        _ => Cell::Null,
    }
}

fn arr<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

// ---- NASA JPL fireballs ----

pub(crate) fn fireballs_rows(body: &Value) -> Result<Vec<Row>, String> {
    let fields: Vec<&str> = arr(body, "fields")
        .iter()
        .filter_map(Value::as_str)
        .collect();
    let data = body
        .get("data")
        .and_then(Value::as_array)
        .ok_or("Fireballs: no data")?;
    let pos = |f: &str| fields.iter().position(|x| *x == f);
    let (date, lat, lat_dir, lon, lon_dir) = (
        pos("date"),
        pos("lat"),
        pos("lat-dir"),
        pos("lon"),
        pos("lon-dir"),
    );
    let (alt, vel, energy, impact) = (pos("alt"), pos("vel"), pos("energy"), pos("impact-e"));
    fn at(r: &Value, i: Option<usize>) -> Option<&Value> {
        i.and_then(|i| r.get(i))
    }
    fn signed(r: &Value, v: Option<usize>, dir: Option<usize>, neg: &str) -> Cell {
        match at(r, v).and_then(as_f64_loose) {
            Some(x) => Cell::F64(if at(r, dir).and_then(Value::as_str) == Some(neg) {
                -x
            } else {
                x
            }),
            None => Cell::Null,
        }
    }
    Ok(data
        .iter()
        .filter_map(|r| {
            let ts = jts(at(r, date));
            if ts == Cell::Null {
                return None;
            }
            Some(vec![
                ts,
                signed(r, lat, lat_dir, "S"),
                signed(r, lon, lon_dir, "W"),
                jf(at(r, alt)),
                jf(at(r, vel)),
                jf(at(r, energy)),
                jf(at(r, impact)),
            ])
        })
        .collect())
}

// ---- CelesTrak visual satellites ----

const MU_EARTH: f64 = 398_600.441_8;
const EARTH_RADIUS_KM: f64 = 6378.137;

/// Mirrors `satelliteObjectType` in workers/extraSources.ts.
pub(crate) fn satellite_object_type(name: &str) -> &'static str {
    let words: Vec<&str> = name
        .split(|c: char| c.is_whitespace() || c == '(' || c == ')')
        .collect();
    if name.contains("R/B") {
        "Rocket body"
    } else if words.contains(&"DEB") {
        "Debris"
    } else {
        "Payload"
    }
}

pub(crate) fn satellites_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body.as_array().ok_or("CelesTrak: expected an array")?;
    Ok(list
        .iter()
        .map(|g| {
            let mm = g
                .get("MEAN_MOTION")
                .and_then(as_f64_loose)
                .filter(|m| *m > 0.0);
            let e = g.get("ECCENTRICITY").and_then(as_f64_loose);
            let (apo, peri) = match (mm, e) {
                (Some(mm), Some(e)) => {
                    let n = mm * 2.0 * std::f64::consts::PI / 86_400.0;
                    let a = (MU_EARTH / (n * n)).cbrt();
                    (
                        Cell::F64(round_to(a * (1.0 + e) - EARTH_RADIUS_KM, 1)),
                        Cell::F64(round_to(a * (1.0 - e) - EARTH_RADIUS_KM, 1)),
                    )
                }
                _ => (Cell::Null, Cell::Null),
            };
            let name = g
                .get("OBJECT_NAME")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            let year = g
                .get("OBJECT_ID")
                .and_then(Value::as_str)
                .and_then(|s| s.get(0..4))
                .and_then(|s| s.parse::<i64>().ok());
            vec![
                ji(g.get("NORAD_CAT_ID")),
                if name.is_empty() {
                    Cell::Null
                } else {
                    Cell::str(name)
                },
                Cell::str(satellite_object_type(name)),
                Cell::opt_i64(year),
                jf(g.get("INCLINATION")),
                Cell::opt_f64(mm.map(|m| round_to(1440.0 / m, 2))),
                apo,
                peri,
                Cell::opt_f64(e),
                jts(g.get("EPOCH")),
            ]
        })
        .collect())
}

// ---- IODA outage alerts ----

pub(crate) const IODA_MAX_ROWS: usize = 2000;

/// (from, until) epoch seconds: past 7 days, `until` floored to 15 minutes.
pub(crate) fn ioda_window(now: i64) -> (i64, i64) {
    let until = now.div_euclid(900) * 900;
    (until - 7 * 86_400, until)
}

pub(crate) fn ioda_rows(body: &Value) -> Result<Vec<Row>, String> {
    let data = body
        .get("data")
        .and_then(Value::as_array)
        .ok_or("IODA: no data")?;
    let mut rows: Vec<(i64, Row)> = data
        .iter()
        .filter_map(|a| {
            let ent = a.get("entity")?;
            if ent.get("type").and_then(Value::as_str) != Some("country") {
                return None;
            }
            let t = a.get("time").and_then(as_i64_loose)?;
            let value = a.get("value").and_then(as_f64_loose);
            let hist = a.get("historyValue").and_then(as_f64_loose);
            let drop = match (value, hist) {
                (Some(v), Some(h)) if h > 0.0 => Cell::F64(round_to((1.0 - v / h) * 100.0, 1)),
                _ => Cell::Null,
            };
            Some((
                t,
                vec![
                    epoch_secs_cell(t),
                    js(ent.get("code")),
                    js(ent.get("name")),
                    js(a.get("datasource")),
                    js(a.get("level")),
                    Cell::opt_f64(value),
                    Cell::opt_f64(hist),
                    drop,
                ],
            ))
        })
        .collect();
    rows.sort_by_key(|r| std::cmp::Reverse(r.0));
    Ok(rows
        .into_iter()
        .take(IODA_MAX_ROWS)
        .map(|(_, r)| r)
        .collect())
}

// ---- Minimal XML helpers (FAA status, arXiv Atom) ----

pub(crate) fn xml_decode(s: &str) -> String {
    let s = s.replace("<![CDATA[", "").replace("]]>", "");
    let mut out = String::with_capacity(s.len());
    let mut rest = s.as_str();
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let Some(end) = tail.find(';').filter(|e| *e <= 10) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let ent = &tail[1..end];
        let rep = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => {
                u32::from_str_radix(&ent[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
            }
            _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match rep {
            Some(c) => {
                out.push(c);
                rest = &tail[end + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Inner text of every `<tag>` / `<tag attr…>` element with exactly this name.
pub(crate) fn xml_blocks<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let mut out = Vec::new();
    let mut pos = 0;
    while let Some(i) = xml[pos..].find(&open) {
        let start = pos + i + open.len();
        let next = xml[start..].chars().next();
        if !matches!(
            next,
            Some('>') | Some(' ') | Some('\n') | Some('\t') | Some('\r')
        ) {
            pos = start;
            continue;
        }
        let Some(gt) = xml[start..].find('>') else {
            break;
        };
        let body_start = start + gt + 1;
        let Some(end) = xml[body_start..].find(&close) else {
            break;
        };
        out.push(&xml[body_start..body_start + end]);
        pos = body_start + end + close.len();
    }
    out
}

pub(crate) fn xml_text(xml: &str, tag: &str) -> Option<String> {
    let b = xml_blocks(xml, tag).into_iter().next()?;
    let t = xml_decode(b).trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

fn xml_attr<'a>(xml: &'a str, tag_prefix: &str, attr: &str) -> Vec<&'a str> {
    let needle = format!("{}=\"", attr);
    let mut out = Vec::new();
    let mut pos = 0;
    while let Some(i) = xml[pos..].find(tag_prefix) {
        let start = pos + i;
        let Some(gt) = xml[start..].find('>') else {
            break;
        };
        let tag = &xml[start..start + gt];
        if let Some(a) = tag.find(&needle) {
            let v = &tag[a + needle.len()..];
            if let Some(q) = v.find('"') {
                out.push(&v[..q]);
            }
        }
        pos = start + gt;
    }
    out
}

// ---- FAA NAS airport status ----

/// "1 hour and 3 minutes", "45 minutes" → minutes.
pub(crate) fn faa_minutes(s: Option<&str>) -> Option<f64> {
    let s = s?.to_ascii_lowercase();
    let num_before = |word: &str| -> Option<f64> {
        let i = s.find(word)?;
        let digits: String = s[..i]
            .trim_end()
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        digits.parse::<f64>().ok()
    };
    let h = num_before("hour");
    let m = num_before("min");
    if h.is_none() && m.is_none() {
        return None;
    }
    Some(h.unwrap_or(0.0) * 60.0 + m.unwrap_or(0.0))
}

/// "Tue Oct 20 16:22:47 2026 GMT" → "2026-10-20 16:22:47".
pub(crate) fn faa_update_time(s: Option<&str>) -> Cell {
    let Some(s) = s else { return Cell::Null };
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() < 5 {
        return Cell::Null;
    }
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let Some(m) = MONTHS.iter().position(|x| *x == parts[1]) else {
        return Cell::Null;
    };
    let Ok(d) = parts[2].parse::<u32>() else {
        return Cell::Null;
    };
    Cell::Str(format!("{}-{:02}-{:02} {}", parts[4], m + 1, d, parts[3]))
}

pub(crate) fn faa_rows(xml: &str) -> Result<Vec<Row>, String> {
    if !xml.contains("AIRPORT_STATUS_INFORMATION") {
        return Err("FAA: unexpected response".into());
    }
    let updated = faa_update_time(xml_text(xml, "Update_Time").as_deref());
    let mut rows = Vec::new();
    let base = |b: &str,
                status: &str,
                min: Option<f64>,
                max: Option<f64>,
                avg: Option<f64>,
                trend: Option<String>|
     -> Option<Row> {
        let airport = xml_text(b, "ARPT")?;
        let reason = xml_text(b, "Reason").map(Value::String);
        Some(vec![
            Cell::Str(airport),
            Cell::str(status),
            clip(reason.as_ref(), 160),
            Cell::opt_f64(min),
            Cell::opt_f64(max),
            Cell::opt_f64(avg),
            trend.map(Cell::Str).unwrap_or(Cell::Null),
            updated.clone(),
        ])
    };
    for b in xml_blocks(xml, "Ground_Delay") {
        rows.extend(base(
            b,
            "Ground delay",
            None,
            faa_minutes(xml_text(b, "Max").as_deref()),
            faa_minutes(xml_text(b, "Avg").as_deref()),
            None,
        ));
    }
    for b in xml_blocks(xml, "Program") {
        rows.extend(base(b, "Ground stop", None, None, None, None));
    }
    for b in xml_blocks(xml, "Delay") {
        let ad = xml_attr(b, "<Arrival_Departure", "Type").into_iter().next();
        let status = ad
            .map(|t| format!("{} delay", t))
            .unwrap_or_else(|| "Delay".into());
        rows.extend(base(
            b,
            &status,
            faa_minutes(xml_text(b, "Min").as_deref()),
            faa_minutes(xml_text(b, "Max").as_deref()),
            None,
            xml_text(b, "Trend"),
        ));
    }
    for b in xml_blocks(xml, "Airport") {
        rows.extend(base(b, "Closure", None, None, None, None));
    }
    Ok(rows)
}

// ---- Lobbying Disclosure Act ----

pub(crate) fn lobbying_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body
        .get("results")
        .and_then(Value::as_array)
        .ok_or("LDA: no results")?;
    Ok(list
        .iter()
        .map(|f| {
            let income = f.get("income").and_then(as_f64_loose);
            let expenses = f.get("expenses").and_then(as_f64_loose);
            let mut codes: Vec<String> = Vec::new();
            for a in arr(f, "lobbying_activities") {
                if let Some(c) = a
                    .get("general_issue_code")
                    .and_then(Value::as_str)
                    .map(str::trim)
                {
                    if !c.is_empty() && !codes.iter().any(|x| x == c) {
                        codes.push(c.to_string());
                    }
                }
            }
            vec![
                js(f.get("filing_uuid")),
                js(f.pointer("/registrant/name")),
                js(f.pointer("/client/name")),
                js(f.pointer("/client/state")),
                js(f.get("filing_type")),
                ji(f.get("filing_year")),
                match f.get("filing_period").and_then(Value::as_str) {
                    Some(p) if !p.is_empty() => Cell::Str(p.replace('_', " ")),
                    _ => Cell::Null,
                },
                Cell::opt_f64(income.or(expenses)),
                if income.is_some() {
                    Cell::str("income")
                } else if expenses.is_some() {
                    Cell::str("expenses")
                } else {
                    Cell::Null
                },
                if codes.is_empty() {
                    Cell::Null
                } else {
                    Cell::Str(codes.join(","))
                },
                Cell::I64(codes.len() as i64),
                jts(f.get("dt_posted")),
            ]
        })
        .collect())
}

// ---- openFDA enforcement ----

pub(crate) fn fda_rows(bodies: &[Value]) -> Result<Vec<Row>, String> {
    let mut seen = HashSet::new();
    let mut rows = Vec::new();
    for body in bodies {
        for r in arr(body, "results") {
            let Some(id) = r
                .get("recall_number")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            else {
                continue;
            };
            if !seen.insert(id.to_string()) {
                continue;
            }
            rows.push(vec![
                Cell::str(id),
                js(r.get("product_type")),
                js(r.get("classification")),
                js(r.get("status")),
                js(r.get("recalling_firm")),
                js(r.get("state")),
                js(r.get("country")),
                clip(r.get("reason_for_recall"), 200),
                clip(r.get("product_description"), 160),
                clip(r.get("product_quantity"), 80),
                js(r.get("voluntary_mandated")),
                iso_day(r.get("report_date")),
                iso_day(r.get("recall_initiation_date")),
            ]);
        }
    }
    if rows.is_empty() && bodies.is_empty() {
        return Err("openFDA: no feeds".into());
    }
    Ok(rows)
}

// ---- NHTSA recalls ----

pub(crate) fn vehicle_recalls_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body.as_array().ok_or("NHTSA: expected an array")?;
    Ok(list
        .iter()
        .map(|r| {
            vec![
                js(r.get("nhtsa_id")),
                iso_day(r.get("report_received_date")),
                js(r.get("manufacturer")),
                clip(r.get("subject"), 160),
                js(r.get("component")),
                js(r.get("recall_type")),
                ji(r.get("potentially_affected")),
                yes_no(r.get("fire_risk_when_parked")),
                yes_no(r.get("do_not_drive")),
            ]
        })
        .collect())
}

// ---- arXiv Atom ----

/// Mirrors `arxivField` in workers/extraSources.ts.
pub(crate) fn arxiv_field(category: &str) -> String {
    let archive = category.split('.').next().unwrap_or(category);
    match archive {
        "cs" => "Computer science",
        "astro-ph" => "Astrophysics",
        "q-bio" => "Biology",
        "econ" => "Economics",
        "stat" => "Statistics",
        "math" => "Mathematics",
        "physics" => "Physics",
        "q-fin" => "Finance",
        "eess" => "Engineering",
        a if a.contains('-') || a == "hep" => "Physics",
        a => return a.to_string(),
    }
    .to_string()
}

pub(crate) fn arxiv_rows(feeds: &[String]) -> Result<Vec<Row>, String> {
    let mut seen = HashSet::new();
    let mut rows = Vec::new();
    for xml in feeds {
        for e in xml_blocks(xml, "entry") {
            let Some(id) = xml_text(e, "id").map(|s| {
                s.trim_start_matches("http://arxiv.org/abs/")
                    .trim_start_matches("https://arxiv.org/abs/")
                    .to_string()
            }) else {
                continue;
            };
            if !seen.insert(id.clone()) {
                continue;
            }
            let cats = xml_attr(e, "<category", "term");
            let primary = xml_attr(e, "<arxiv:primary_category", "term")
                .into_iter()
                .next()
                .or_else(|| cats.first().copied());
            let title = xml_text(e, "title").map(Value::String);
            let published = xml_text(e, "published").map(Value::String);
            let updated = xml_text(e, "updated").map(Value::String);
            rows.push(vec![
                Cell::Str(id),
                clip(title.as_ref(), 240),
                primary.map(Cell::str).unwrap_or(Cell::Null),
                primary
                    .map(|p| Cell::Str(arxiv_field(p)))
                    .unwrap_or(Cell::Null),
                Cell::I64(cats.len() as i64),
                Cell::I64(e.matches("<author>").count() as i64),
                jts(published.as_ref()),
                jts(updated.as_ref()),
            ]);
        }
    }
    Ok(rows)
}

// ---- GitHub public events ----

pub(crate) fn github_events_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body.as_array().ok_or("GitHub: expected an array")?;
    Ok(list
        .iter()
        .map(|e| {
            vec![
                js(e.get("id")),
                match e.get("type").and_then(Value::as_str) {
                    Some(t) if !t.is_empty() => Cell::str(t.strip_suffix("Event").unwrap_or(t)),
                    _ => Cell::Null,
                },
                js(e.pointer("/repo/name")),
                Cell::Bool(e.get("org").is_some_and(|o| !o.is_null())),
                jts(e.get("created_at")),
            ]
        })
        .collect())
}

// ---- Books ----

pub(crate) const OPEN_LIBRARY_TOP: usize = 50;

/// "Austen, Jane" → "Jane Austen" (mirrors `gutenbergAuthor`).
pub(crate) fn gutenberg_author(name: &str) -> String {
    match name.split_once(',') {
        Some((last, first)) if !first.trim().is_empty() => {
            let mut s = format!("{} {}", first.trim(), last.trim());
            while let (Some(a), Some(b)) = (s.find('('), s.find(')')) {
                if b < a {
                    break;
                }
                s.replace_range(a..=b, " ");
            }
            s.split_whitespace().collect::<Vec<_>>().join(" ")
        }
        _ => name.to_string(),
    }
}

pub(crate) fn books_rows(
    open_library: Option<&Value>,
    gutenberg: Option<&Value>,
) -> Result<Vec<Row>, String> {
    let mut rows = Vec::new();
    if let Some(ol) = open_library {
        for (i, w) in arr(ol, "works").iter().take(OPEN_LIBRARY_TOP).enumerate() {
            let langs: Vec<&str> = arr(w, "language")
                .iter()
                .filter_map(Value::as_str)
                .collect();
            rows.push(vec![
                Cell::str("Open Library"),
                Cell::I64(i as i64 + 1),
                clip(w.get("title"), 200),
                js(w.get("author_name").and_then(|a| a.get(0))),
                ji(w.get("first_publish_year")),
                ji(w.get("edition_count")),
                Cell::Null,
                if langs.contains(&"eng") {
                    Cell::str("en")
                } else {
                    langs.first().map(|l| Cell::str(*l)).unwrap_or(Cell::Null)
                },
            ]);
        }
    }
    if let Some(g) = gutenberg {
        for (i, b) in arr(g, "results").iter().enumerate() {
            let author = b
                .pointer("/authors/0/name")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(|s| Cell::Str(gutenberg_author(s.trim())))
                .unwrap_or(Cell::Null);
            rows.push(vec![
                Cell::str("Project Gutenberg"),
                Cell::I64(i as i64 + 1),
                clip(b.get("title"), 200),
                author,
                Cell::Null,
                Cell::Null,
                ji(b.get("download_count")),
                js(b.pointer("/languages/0")),
            ]);
        }
    }
    Ok(rows)
}

// ---- Socrata city feeds ----

pub(crate) fn nyc_inspections_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body
        .as_array()
        .ok_or("NYC inspections: expected an array")?;
    Ok(list
        .iter()
        .map(|r| {
            vec![
                js(r.get("camis")),
                js(r.get("dba")),
                js(r.get("boro")),
                js(r.get("cuisine_description")),
                jts(r.get("inspection_date")),
                js(r.get("grade")),
                ji(r.get("score")),
                js(r.get("critical_flag")),
                js(r.get("violation_code")),
                clip(r.get("violation_description"), 160),
                non_zero_coord(r.get("latitude")),
                non_zero_coord(r.get("longitude")),
            ]
        })
        .collect())
}

pub(crate) fn chicago_crime_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body.as_array().ok_or("Chicago crime: expected an array")?;
    Ok(list
        .iter()
        .map(|r| {
            vec![
                js(r.get("id")),
                jts(r.get("date")),
                js(r.get("block")),
                js(r.get("primary_type")),
                js(r.get("description")),
                js(r.get("location_description")),
                bool_loose(r.get("arrest")),
                bool_loose(r.get("domestic")),
                js(r.get("district")),
                js(r.get("community_area")),
                non_zero_coord(r.get("latitude")),
                non_zero_coord(r.get("longitude")),
            ]
        })
        .collect())
}

pub(crate) fn nyc_parking_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body.as_array().ok_or("NYC parking: expected an array")?;
    Ok(list
        .iter()
        .map(|r| {
            vec![
                js(r.get("summons_number")),
                iso_day(r.get("issue_date")),
                js(r.get("violation_time")),
                js(r.get("violation")),
                jf(r.get("fine_amount")),
                jf(r.get("penalty_amount")),
                jf(r.get("amount_due")),
                js(r.get("county")),
                js(r.get("state")),
                js(r.get("issuing_agency")),
                js(r.get("precinct")),
            ]
        })
        .collect())
}

pub(crate) fn powerball_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body.as_array().ok_or("Powerball: expected an array")?;
    Ok(list
        .iter()
        .filter_map(|r| {
            let day = match iso_day(r.get("draw_date")) {
                Cell::Str(d) => d,
                _ => return None,
            };
            let nums: Vec<Option<i64>> = r
                .get("winning_numbers")
                .and_then(Value::as_str)
                .unwrap_or("")
                .split_whitespace()
                .map(|n| n.parse::<i64>().ok())
                .collect();
            if nums.len() < 6 {
                return None;
            }
            let yr = day[0..4].parse::<i64>().ok();
            let mut row = vec![Cell::Str(day), Cell::opt_i64(yr)];
            row.extend(nums[..6].iter().map(|n| Cell::opt_i64(*n)));
            row.push(ji(r.get("multiplier")));
            Some(row)
        })
        .collect())
}

// ---- USAspending toptier agencies ----

pub(crate) fn fed_spending_rows(body: &Value) -> Result<Vec<Row>, String> {
    let list = body
        .get("results")
        .and_then(Value::as_array)
        .ok_or("USAspending: no results")?;
    Ok(list
        .iter()
        .map(|a| {
            vec![
                js(a.get("agency_name")),
                js(a.get("abbreviation")),
                js(a.get("toptier_code")),
                ji(a.get("active_fy")),
                jf(a.get("budget_authority_amount")),
                jf(a.get("obligated_amount")),
                jf(a.get("outlay_amount")),
                Cell::opt_f64(
                    a.get("percentage_of_total_budget_authority")
                        .and_then(as_f64_loose)
                        .map(|p| round_to(p * 100.0, 4)),
                ),
            ]
        })
        .collect())
}

// ---- GBFS bike share ----

pub(crate) fn bikeshare_rows(
    system: &str,
    status: &Value,
    info: &HashMap<String, CitiStation>,
) -> Result<Vec<Row>, String> {
    Ok(citibike_rows(status, info)?
        .into_iter()
        .map(|r| {
            let mut row = Vec::with_capacity(r.len() + 1);
            row.push(Cell::str(system));
            row.extend(r);
            row
        })
        .collect())
}

// ---- Worker `{ columns, rows }` (bluesky, bgp) ----

/// Map a Worker columnar body onto `spec` column order, coercing by type.
pub(crate) fn columnar_rows(body: &Value, spec: &SourceSpec) -> Result<Vec<Row>, String> {
    let cols: Vec<&str> = body
        .get("columns")
        .and_then(Value::as_array)
        .ok_or("Worker: no columns")?
        .iter()
        .map(|c| c.as_str().unwrap_or(""))
        .collect();
    let rows = body
        .get("rows")
        .and_then(Value::as_array)
        .ok_or("Worker: no rows")?;
    let idx: Vec<Option<usize>> = spec
        .columns
        .iter()
        .map(|(n, _)| cols.iter().position(|c| c == n))
        .collect();
    Ok(rows
        .iter()
        .filter_map(Value::as_array)
        .map(|r| {
            spec.columns
                .iter()
                .zip(&idx)
                .map(|((_, ty), i)| {
                    let v = i.and_then(|i| r.get(i));
                    match *ty {
                        "DOUBLE" => jf(v),
                        "INTEGER" | "BIGINT" => ji(v),
                        "BOOLEAN" => jb(v),
                        "TIMESTAMP" => jts(v),
                        "DATE" => iso_day(v),
                        _ => js(v),
                    }
                })
                .collect()
        })
        .collect())
}
