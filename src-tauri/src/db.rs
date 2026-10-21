// =================================================================
// Loom — DuckDB Integration
// =================================================================
// Wraps an in-process DuckDB connection with helpers for:
//   1. Scanning local folders for .parquet, .csv, .json/.ndjson/.jsonl,
//      .xlsx, and .db/.sqlite files (SQLite = one entry per table)
//   2. Running analytic queries over those files
//   3. Returning schema + row-count metadata
//
// DuckDB runs in-process (no server) — perfect for local-first.
// =================================================================

use duckdb::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Escape a path for use inside single-quoted SQL strings.
pub(crate) fn escape_path_for_sql(path: &str) -> String {
    path.replace('\'', "''")
}

/// Friendlier copy when Parquet/JSON/Excel fail without network-installed extensions.
pub(crate) fn map_duckdb_file_err(err: impl std::fmt::Display, file_path: &str) -> String {
    let msg = err.to_string();
    let lower = msg.to_lowercase();
    let needs_helper = file_path.ends_with(".parquet")
        || file_path.ends_with(".xlsx")
        || file_path.ends_with(".json")
        || file_path.ends_with(".ndjson")
        || file_path.ends_with(".jsonl");
    // Match DuckDB "function/extension missing" noise — not every "not found" path miss.
    let missing_helper = lower.contains("extension")
        || lower.contains("autoload")
        || lower.contains("autoinstall")
        || lower.contains("table function")
        || lower.contains("catalog error")
        || lower.contains("read_parquet")
        || lower.contains("read_json")
        || lower.contains("read_xlsx");
    if needs_helper && missing_helper {
        return "This file type needs a signed DuckDB helper Loom doesn’t ship yet (avoids macOS Gatekeeper blocks). Open a CSV for now, or export CSV from your tool.".into();
    }
    msg
}

/// Stop DuckDB from downloading / dlopening unsigned community extensions (Gatekeeper).
pub(crate) fn disable_extension_auto_fetch(conn: &Connection) -> Result<(), duckdb::Error> {
    // Prefer SET; fall back to older aliases if a build renames them.
    for sql in [
        "SET autoinstall_known_extensions = false",
        "SET autoload_known_extensions = false",
        "SET allow_unsigned_extensions = false",
        "SET allow_community_extensions = false",
    ] {
        match conn.execute_batch(sql) {
            Ok(()) => {}
            Err(e) => {
                // Unknown setting on older builds — keep going; other SETs may still apply.
                log::debug!("duckdb setting skipped ({sql}): {e}");
            }
        }
    }
    Ok(())
}

/// Compute the table expression (read_* or sqlite_src.main."table") for a file path.
/// Used by table_expr and testable without a DB connection.
pub(crate) fn table_expr_for_path(file_path: &str) -> String {
    if file_path.contains('|') {
        let (_path, table) = file_path.split_once('|').unwrap_or((file_path, ""));
        let table_escaped = table.replace('"', "\"\"");
        format!(r#"sqlite_src.main."{}""#, table_escaped)
    } else {
        let escaped = escape_path_for_sql(file_path);
        if file_path.ends_with(".parquet") {
            format!("read_parquet('{}')", escaped)
        } else if file_path.ends_with(".csv") {
            format!("read_csv_auto('{}')", escaped)
        } else if file_path.ends_with(".json")
            || file_path.ends_with(".ndjson")
            || file_path.ends_with(".jsonl")
        {
            format!("read_json_auto('{}')", escaped)
        } else if file_path.ends_with(".xlsx") {
            format!("read_xlsx('{}')", escaped)
        } else {
            format!("read_csv_auto('{}')", escaped)
        }
    }
}

/// Thread-safe wrapper around DuckDB connection.
/// Managed as Tauri state so all commands share one instance.
pub struct LoomDb {
    pub conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub row_count: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub null_count: u64,
    pub distinct_count: u64,
    pub min_value: Option<String>,
    pub max_value: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub types: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total_rows: u64,
}

fn lock_conn(conn: &Mutex<Connection>) -> std::sync::MutexGuard<'_, Connection> {
    match conn.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn should_skip_scan_path(path: &Path) -> bool {
    path.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        matches!(
            s.as_ref(),
            "node_modules" | ".git" | "target" | "__pycache__" | ".next" | "out"
        )
    })
}

impl LoomDb {
    pub(crate) fn lock_connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        lock_conn(&self.conn)
    }

    /// Clone the shared in-memory connection so long scans don't block polls.
    pub fn with_cloned_conn<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Connection) -> Result<T, String>,
    {
        let conn = {
            let guard = lock_conn(&self.conn);
            guard.try_clone().map_err(|e| e.to_string())?
        };
        f(&conn)
    }

    pub fn new() -> Result<Self, duckdb::Error> {
        let conn = Connection::open_in_memory()?;
        // Bundled libduckdb defaults AUTOINSTALL/AUTOLOAD on. On macOS that downloads
        // ad-hoc–signed *.duckdb_extension files into ~/.duckdb; Gatekeeper then blocks
        // dlopen (parquet/json/excel "Not Opened" dialogs). Never INSTALL from the network.
        // CSV is built-in; parquet/json/xlsx need a future signed-bundle or static link.
        disable_extension_auto_fetch(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Discover data files in a folder (recursive): parquet, csv, json/ndjson/jsonl, xlsx, db/sqlite.
    /// SQLite files yield one entry per table (path stored as "file_path|table_name").
    pub fn scan_folder(&self, folder: &Path) -> Result<Vec<FileEntry>, String> {
        let mut entries = Vec::new();

        let patterns: &[(&str, &str)] = &[
            ("**/*.parquet", "parquet"),
            ("**/*.csv", "csv"),
            ("**/*.json", "json"),
            ("**/*.ndjson", "ndjson"),
            ("**/*.jsonl", "jsonl"),
            ("**/*.xlsx", "xlsx"),
        ];

        for (glob_suffix, ext) in patterns {
            let pattern_str = folder.join(glob_suffix).to_string_lossy().to_string();
            if let Ok(paths) = glob::glob(&pattern_str) {
                for path_result in paths.flatten() {
                    if should_skip_scan_path(&path_result) {
                        continue;
                    }
                    if let Ok(e) =
                        self.with_cloned_conn(|conn| Self::probe_file(conn, &path_result, ext))
                    {
                        entries.push(e);
                    }
                }
            }
        }

        // SQLite: one entry per table per file
        let sqlite_globs = ["**/*.db", "**/*.sqlite", "**/*.sqlite3"];
        for glob_suffix in &sqlite_globs {
            let pattern_str = folder.join(glob_suffix).to_string_lossy().to_string();
            if let Ok(paths) = glob::glob(&pattern_str) {
                for path_result in paths.flatten() {
                    if should_skip_scan_path(&path_result) {
                        continue;
                    }
                    if let Ok(mut sqlite_entries) = Self::probe_sqlite(&path_result) {
                        entries.append(&mut sqlite_entries);
                    }
                }
            }
        }

        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(entries)
    }

    fn probe_file(conn: &Connection, path: &PathBuf, ext: &str) -> Result<FileEntry, String> {
        let path_str = path.to_string_lossy().to_string();
        let escaped = escape_path_for_sql(&path_str);
        let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

        // CSV is built-in — COUNT at mount so the sidebar isn't stuck on "0 rows".
        // Parquet/json/xlsx need signed helpers we don't autoinstall (Gatekeeper).
        let row_count: u64 = match ext {
            "csv" => {
                let count_sql = format!("SELECT COUNT(*) FROM read_csv_auto('{}')", escaped);
                conn.query_row(&count_sql, params![], |row| row.get(0))
                    .map(|v: i64| v as u64)
                    .unwrap_or(0)
            }
            "parquet" | "json" | "ndjson" | "jsonl" | "xlsx" => 0,
            _ => return Err(format!("Unsupported file type: {}", ext)),
        };

        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        Ok(FileEntry {
            path: path_str,
            name,
            extension: ext.to_string(),
            row_count,
            size_bytes,
        })
    }

    /// For a SQLite file, attach and list tables; return one FileEntry per table.
    /// path in each entry is "file_path|table_name" for use in table_expr.
    fn probe_sqlite(path: &PathBuf) -> Result<Vec<FileEntry>, String> {
        let path_str = path.to_string_lossy().to_string();
        let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let file_stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "db".to_string());

        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        // ATTACH autoloads sqlite_scanner — on a fresh connection that would download an
        // unsigned extension, which Gatekeeper flags as malware (Mac App Store rejection).
        disable_extension_auto_fetch(&conn).map_err(|e| e.to_string())?;
        let escaped = escape_path_for_sql(&path_str);
        conn.execute_batch(&format!("ATTACH '{}' AS sqlite_probe;", escaped))
            .map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_probe.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let tables: Vec<String> = rows.filter_map(Result::ok).collect();

        let table_escaped = |t: &str| t.replace('"', "\"\"");
        let mut entries = Vec::new();
        for table in &tables {
            let composite_path = format!("{}|{}", path_str, table);
            let name = format!("{}.{}", file_stem, table);
            let row_count = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM sqlite_probe.\"{}\"",
                        table_escaped(table)
                    ),
                    params![],
                    |row| row.get::<_, i64>(0),
                )
                .map(|n| n as u64)
                .unwrap_or(0);
            entries.push(FileEntry {
                path: composite_path,
                name,
                extension: "sqlite".to_string(),
                row_count,
                size_bytes,
            });
        }
        let _ = conn.execute_batch("DETACH sqlite_probe;");
        Ok(entries)
    }

    /// Run a SQL query scoped to a specific file.
    pub fn query_file(
        &self,
        file_path: &str,
        sql: &str,
        limit: u32,
    ) -> Result<QueryResult, String> {
        self.with_cloned_conn(|conn| Self::query_inner(conn, file_path, sql, limit))
    }

    /// Get column-level statistics for a file.
    pub fn get_column_stats(&self, file_path: &str) -> Result<Vec<ColumnInfo>, String> {
        self.with_cloned_conn(|conn| Self::column_stats_inner(conn, file_path))
    }

    /// Combined: stats + sample rows in a single lock acquisition.
    /// Avoids Mutex contention from concurrent IPC calls.
    pub fn inspect_file(
        &self,
        file_path: &str,
        sample_limit: u32,
    ) -> Result<(Vec<ColumnInfo>, QueryResult), String> {
        self.with_cloned_conn(|conn| {
            Self::ensure_sqlite_attached(conn, file_path)?;
            let table_expr = Self::table_expr(file_path);
            conn.execute_batch(&format!(
                "CREATE OR REPLACE TEMP VIEW loom_active AS SELECT * FROM {}",
                table_expr
            ))
            .map_err(|e| map_duckdb_file_err(e, file_path))?;

            let stats = Self::column_stats_inner(conn, file_path)?;
            let mut sample =
                Self::query_inner(conn, file_path, "SELECT * FROM loom_active", sample_limit)?;
            // Sample LIMIT must not masquerade as the table size (Explorer "0 rows" / "N of N").
            let total: u64 = conn
                .query_row("SELECT COUNT(*) FROM loom_active", params![], |r| {
                    r.get::<_, i64>(0)
                })
                .map(|n| n as u64)
                .unwrap_or(sample.rows.len() as u64);
            sample.total_rows = total;
            Ok((stats, sample))
        })
    }

    /// For SQLite (path format "file_path|table_name"), attach the DB so table_expr can reference it.
    fn ensure_sqlite_attached(conn: &Connection, file_path: &str) -> Result<(), String> {
        if !file_path.contains('|') {
            return Ok(());
        }
        let (db_path, _table) = file_path
            .split_once('|')
            .ok_or_else(|| "Invalid SQLite path".to_string())?;
        if db_path.trim().is_empty() {
            return Err("SQLite path is empty".to_string());
        }
        let escaped = escape_path_for_sql(db_path);
        conn.execute_batch("DETACH IF EXISTS sqlite_src;")
            .map_err(|e| e.to_string())?;
        conn.execute_batch(&format!("ATTACH '{}' AS sqlite_src;", escaped))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn table_expr(file_path: &str) -> String {
        table_expr_for_path(file_path)
    }

    fn column_stats_inner(conn: &Connection, file_path: &str) -> Result<Vec<ColumnInfo>, String> {
        Self::ensure_sqlite_attached(conn, file_path)?;
        let table_expr = Self::table_expr(file_path);
        conn.execute_batch(&format!(
            "CREATE OR REPLACE TEMP VIEW loom_active AS SELECT * FROM {}",
            table_expr
        ))
        .map_err(|e| map_duckdb_file_err(e, file_path))?;
        crate::query_engine::column_stats_for_table(conn, "loom_active")
    }

    fn query_inner(
        conn: &Connection,
        file_path: &str,
        sql: &str,
        limit: u32,
    ) -> Result<QueryResult, String> {
        crate::sql_policy::validate_user_sql(sql)?;
        Self::ensure_sqlite_attached(conn, file_path)?;
        let table_expr = Self::table_expr(file_path);

        conn.execute_batch(&format!(
            "CREATE OR REPLACE TEMP VIEW loom_active AS SELECT * FROM {}",
            table_expr
        ))
        .map_err(|e| map_duckdb_file_err(e, file_path))?;

        crate::query_engine::run_user_query(
            conn,
            sql,
            limit,
            "SELECT * FROM loom_active LIMIT {limit}",
        )
    }
}

fn json_i64_lossless(i: i64) -> serde_json::Value {
    if i.abs() > crate::query_engine::JS_MAX_SAFE_INTEGER {
        serde_json::Value::String(i.to_string())
    } else {
        serde_json::json!(i)
    }
}

fn json_u64_lossless(i: u64) -> serde_json::Value {
    if i > crate::query_engine::JS_MAX_SAFE_INTEGER as u64 {
        serde_json::Value::String(i.to_string())
    } else {
        serde_json::json!(i)
    }
}

fn json_i128_lossless(i: i128) -> serde_json::Value {
    if i.abs() > crate::query_engine::JS_MAX_SAFE_INTEGER as i128 {
        serde_json::Value::String(i.to_string())
    } else if i >= i64::MIN as i128 && i <= i64::MAX as i128 {
        serde_json::json!(i as i64)
    } else {
        serde_json::Value::String(i.to_string())
    }
}

fn duckdb_value_to_json_inner(val: duckdb::types::Value) -> serde_json::Value {
    use duckdb::types::Value;
    match val {
        Value::List(items) => {
            serde_json::Value::Array(items.into_iter().map(duckdb_value_to_json).collect())
        }
        Value::Array(items) => {
            serde_json::Value::Array(items.into_iter().map(duckdb_value_to_json).collect())
        }
        Value::Struct(fields) => {
            let mut map = serde_json::Map::new();
            for (k, v) in fields.iter() {
                map.insert(k.clone(), duckdb_value_to_json(v.clone()));
            }
            serde_json::Value::Object(map)
        }
        Value::Map(fields) => {
            let mut map = serde_json::Map::new();
            for (k, v) in fields.iter() {
                let key = match k {
                    Value::Text(s) => s.clone(),
                    other => format!("{:?}", other),
                };
                map.insert(key, duckdb_value_to_json(v.clone()));
            }
            serde_json::Value::Object(map)
        }
        Value::Blob(bytes) => {
            use base64::Engine;
            serde_json::Value::String(base64::engine::general_purpose::STANDARD.encode(bytes))
        }
        Value::Time64(unit, v) => {
            let micros = unit.to_micros(v);
            let secs = micros.div_euclid(1_000_000);
            let micro = micros.rem_euclid(1_000_000);
            serde_json::Value::String(format!(
                "{:02}:{:02}:{:02}.{:06}",
                (secs / 3600) % 24,
                (secs / 60) % 60,
                secs % 60,
                micro
            ))
        }
        Value::Interval {
            months,
            days,
            nanos,
        } => serde_json::Value::String(format!("P{}M{}DT{}S", months, days, nanos as f64 / 1e9)),
        Value::Enum(s) => serde_json::Value::String(s),
        Value::Union(inner) => duckdb_value_to_json(*inner),
        other => duckdb_value_to_json_inner_scalar(other),
    }
}

fn duckdb_value_to_json_inner_scalar(val: duckdb::types::Value) -> serde_json::Value {
    match val {
        duckdb::types::Value::Null => serde_json::Value::Null,
        duckdb::types::Value::Boolean(b) => serde_json::Value::Bool(b),
        duckdb::types::Value::TinyInt(i) => serde_json::json!(i),
        duckdb::types::Value::SmallInt(i) => serde_json::json!(i),
        duckdb::types::Value::Int(i) => serde_json::json!(i),
        duckdb::types::Value::BigInt(i) => json_i64_lossless(i),
        duckdb::types::Value::Float(f) => serde_json::json!(f),
        duckdb::types::Value::Double(f) => serde_json::json!(f),
        duckdb::types::Value::Text(s) => serde_json::Value::String(s),
        duckdb::types::Value::HugeInt(i) => json_i128_lossless(i),
        duckdb::types::Value::UTinyInt(i) => serde_json::json!(i),
        duckdb::types::Value::USmallInt(i) => serde_json::json!(i),
        duckdb::types::Value::UInt(i) => serde_json::json!(i),
        duckdb::types::Value::UBigInt(i) => json_u64_lossless(i),
        duckdb::types::Value::Decimal(d) => d
            .to_string()
            .parse::<f64>()
            .map(|f| serde_json::json!(f))
            .unwrap_or_else(|_| serde_json::Value::String(d.to_string())),
        duckdb::types::Value::Timestamp(unit, v) => {
            let micros = unit.to_micros(v);
            let secs = micros.div_euclid(1_000_000);
            let millis = micros.rem_euclid(1_000_000) / 1000;
            let ts = crate::sources::fmt_ts(secs).replacen(' ', "T", 1);
            serde_json::Value::String(format!("{}.{:03}Z", ts, millis))
        }
        duckdb::types::Value::Date32(days) => {
            serde_json::Value::String(crate::sources::fmt_date(days as i64))
        }
        other => serde_json::Value::String(format!("{:?}", other)),
    }
}

pub(crate) fn duckdb_value_to_json(val: duckdb::types::Value) -> serde_json::Value {
    duckdb_value_to_json_inner(val)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_path_for_sql_doubles_single_quotes() {
        assert_eq!(escape_path_for_sql("/foo/bar"), "/foo/bar");
        assert_eq!(escape_path_for_sql("/foo's/bar"), "/foo''s/bar");
        assert_eq!(escape_path_for_sql("'"), "''");
    }

    fn setting_value(conn: &Connection, name: &str) -> String {
        let mut stmt = conn
            .prepare("SELECT value FROM duckdb_settings() WHERE name = ?")
            .expect("prepare");
        stmt.query_row(params![name], |r| r.get::<_, String>(0))
            .unwrap_or_else(|e| format!("ERR:{e}"))
    }

    #[test]
    fn map_duckdb_file_err_explains_missing_helpers() {
        let msg = map_duckdb_file_err(
            "Catalog Error: Table Function with name read_parquet does not exist!",
            "/data/x.parquet",
        );
        assert!(msg.contains("CSV"), "got: {msg}");
        assert!(!msg.to_lowercase().contains("catalog error"));
    }

    #[test]
    fn every_connection_disables_extension_fetch() {
        // A fresh DuckDB connection autoinstalls unsigned extensions on first use
        // (e.g. ATTACH → sqlite_scanner); Gatekeeper reports that as malware.
        let src = include_str!("db.rs");
        let body = src.split("#[cfg(test)]").next().unwrap();
        for (i, _) in body.match_indices("Connection::open") {
            let window = &body[i..(i + 700).min(body.len())];
            assert!(
                window.contains("disable_extension_auto_fetch"),
                "connection opened without disable_extension_auto_fetch: {}",
                &body[i..(i + 80).min(body.len())]
            );
        }
    }

    #[test]
    fn new_disables_extension_autoinstall() {
        let db = LoomDb::new().expect("LoomDb::new");
        let conn = db.lock_connection();
        let autoinstall = setting_value(&conn, "autoinstall_known_extensions");
        let autoload = setting_value(&conn, "autoload_known_extensions");
        let community = setting_value(&conn, "allow_community_extensions");
        assert!(
            autoinstall.eq_ignore_ascii_case("false"),
            "autoinstall must stay off (Gatekeeper); got {autoinstall}"
        );
        assert!(
            autoload.eq_ignore_ascii_case("false"),
            "autoload must stay off (Gatekeeper); got {autoload}"
        );
        assert!(
            community.eq_ignore_ascii_case("false"),
            "community extensions must stay off; got {community}"
        );
        let n: i64 = conn
            .query_row("SELECT 1 + 1", [], |r| r.get(0))
            .expect("builtin sql");
        assert_eq!(n, 2);
    }

    #[test]
    fn table_expr_for_path_parquet_csv() {
        assert_eq!(
            table_expr_for_path("/data/x.parquet"),
            "read_parquet('/data/x.parquet')"
        );
        assert_eq!(
            table_expr_for_path("/data/x.csv"),
            "read_csv_auto('/data/x.csv')"
        );
    }

    #[test]
    fn table_expr_for_path_json_variants() {
        assert_eq!(
            table_expr_for_path("/data/x.json"),
            "read_json_auto('/data/x.json')"
        );
        assert_eq!(
            table_expr_for_path("/data/x.ndjson"),
            "read_json_auto('/data/x.ndjson')"
        );
        assert_eq!(
            table_expr_for_path("/data/x.jsonl"),
            "read_json_auto('/data/x.jsonl')"
        );
    }

    #[test]
    fn table_expr_for_path_xlsx() {
        assert_eq!(
            table_expr_for_path("/data/sheet.xlsx"),
            "read_xlsx('/data/sheet.xlsx')"
        );
    }

    #[test]
    fn table_expr_for_path_sqlite_pipe() {
        assert_eq!(
            table_expr_for_path("/path/to/db.sqlite|users"),
            r#"sqlite_src.main."users""#
        );
        assert_eq!(
            table_expr_for_path("/path/to/db.db|my_table"),
            r#"sqlite_src.main."my_table""#
        );
        assert_eq!(table_expr_for_path("/a|b|c"), r#"sqlite_src.main."b|c""#);
    }

    #[test]
    fn table_expr_for_path_escapes_quotes_in_path() {
        assert_eq!(
            table_expr_for_path("/foo's/file.csv"),
            "read_csv_auto('/foo''s/file.csv')"
        );
    }

    #[test]
    fn table_expr_for_path_escapes_quotes_in_sqlite_table_name() {
        assert_eq!(
            table_expr_for_path(r#"/db.sqlite|foo"bar"#),
            r#"sqlite_src.main."foo""bar""#
        );
    }

    #[test]
    fn table_expr_for_path_unknown_extension_falls_back_to_csv() {
        assert_eq!(
            table_expr_for_path("/data/unknown.txt"),
            "read_csv_auto('/data/unknown.txt')"
        );
    }

    #[test]
    fn loom_db_new_succeeds() {
        let db = LoomDb::new().unwrap();
        drop(db.conn.lock().unwrap());
    }

    #[test]
    fn scan_folder_empty_dir_returns_empty() {
        let db = LoomDb::new().unwrap();
        let tmp = std::env::temp_dir();
        let empty = tmp.join("loom_test_empty_scan");
        let _ = std::fs::create_dir_all(&empty);
        let result = db.scan_folder(empty.as_path()).unwrap();
        assert!(result.is_empty());
        let _ = std::fs::remove_dir_all(empty);
    }

    #[test]
    fn scan_folder_finds_csv() {
        let db = LoomDb::new().unwrap();
        let tmp = std::env::temp_dir().join("loom_test_scan_csv");
        let _ = std::fs::create_dir_all(&tmp);
        let csv_path = tmp.join("data.csv");
        std::fs::write(&csv_path, "a,b\n1,2\n3,4\n").unwrap();
        let result = db.scan_folder(tmp.as_path()).unwrap();
        let _ = std::fs::remove_dir_all(&tmp);
        assert!(!result.is_empty());
        let entry = result.iter().find(|e| e.name == "data.csv").unwrap();
        assert_eq!(entry.extension, "csv");
        assert_eq!(entry.row_count, 2);
    }

    #[test]
    fn inspect_file_invalid_sqlite_path_returns_error() {
        let db = LoomDb::new().unwrap();
        let err = db.inspect_file("|not_a_real_table", 10).unwrap_err();
        assert!(err.contains("empty") || err.contains("Invalid"));
    }

    #[test]
    fn inspect_file_csv_returns_stats_and_sample() {
        let db = LoomDb::new().unwrap();
        let tmp = std::env::temp_dir().join("loom_test_inspect_csv");
        let _ = std::fs::create_dir_all(&tmp);
        let csv_path = tmp.join("inspect_test.csv");
        std::fs::write(&csv_path, "x,y\n1,2\n3,4\n5,6\n").unwrap();
        let path_str = csv_path.to_string_lossy();
        let (stats, sample) = db.inspect_file(path_str.as_ref(), 10).unwrap();
        let _ = std::fs::remove_dir_all(&tmp);
        assert_eq!(stats.len(), 2);
        assert_eq!(sample.columns, vec!["x", "y"]);
        assert_eq!(sample.rows.len(), 3);
        assert_eq!(sample.total_rows, 3);
    }

    #[test]
    fn inspect_file_total_rows_is_full_count_not_sample_limit() {
        let db = LoomDb::new().unwrap();
        let tmp = std::env::temp_dir().join("loom_test_inspect_total");
        let _ = std::fs::create_dir_all(&tmp);
        let csv_path = tmp.join("many.csv");
        let mut body = String::from("n\n");
        for i in 0..20 {
            body.push_str(&format!("{i}\n"));
        }
        std::fs::write(&csv_path, body).unwrap();
        let path_str = csv_path.to_string_lossy();
        let (_stats, sample) = db.inspect_file(path_str.as_ref(), 5).unwrap();
        let _ = std::fs::remove_dir_all(&tmp);
        assert_eq!(sample.rows.len(), 5);
        assert_eq!(sample.total_rows, 20);
    }

    #[test]
    fn bigint_above_js_safe_integer_is_string_json() {
        let db = LoomDb::new().unwrap();
        db.with_cloned_conn(|conn| {
            conn.execute_batch(
                "CREATE TABLE loom_bigint_test AS SELECT 9007199254740993::BIGINT AS id",
            )
            .map_err(|e| e.to_string())?;
            let r = crate::query_engine::run_query(conn, "SELECT id FROM loom_bigint_test")?;
            assert_eq!(r.rows[0][0], serde_json::json!("9007199254740993"));
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn json_list_column_renders_as_array() {
        let db = LoomDb::new().unwrap();
        let tmp = std::env::temp_dir().join("loom_json_list_test");
        let _ = std::fs::create_dir_all(&tmp);
        let path = tmp.join("arr.json");
        std::fs::write(&path, r#"[{"tags":[1,2]}]"#).unwrap();
        let path_str = path.to_string_lossy().into_owned();
        match db.query_file(&path_str, "SELECT tags FROM loom_active", 10) {
            Ok(sample) => {
                assert_eq!(sample.rows[0][0], serde_json::json!([1, 2]));
            }
            Err(e) => {
                // Gatekeeper path: json extension is not auto-fetched; users get CSV guidance.
                assert!(
                    e.contains("CSV") || e.to_lowercase().contains("helper"),
                    "unexpected json open error: {e}"
                );
            }
        }
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn query_file_rejects_disallowed_sql() {
        let db = LoomDb::new().unwrap();
        let tmp = std::env::temp_dir().join("loom_test_query_policy");
        let _ = std::fs::create_dir_all(&tmp);
        let csv_path = tmp.join("data.csv");
        std::fs::write(&csv_path, "x\n1\n").unwrap();
        let path_str = csv_path.to_string_lossy().into_owned();
        let ok = db
            .query_file(&path_str, "SELECT x FROM loom_active", 10)
            .unwrap();
        assert_eq!(ok.rows.len(), 1);
        let err = db
            .query_file(&path_str, "SELECT * FROM read_parquet('/etc/passwd')", 10)
            .unwrap_err();
        assert!(
            err.contains("READ_PARQUET") || err.to_lowercase().contains("not allowed"),
            "unexpected error: {err}"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
