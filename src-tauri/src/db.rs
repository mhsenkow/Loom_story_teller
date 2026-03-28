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

use duckdb::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Escape a path for use inside single-quoted SQL strings.
pub(crate) fn escape_path_for_sql(path: &str) -> String {
    path.replace('\'', "''")
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
        } else if file_path.ends_with(".json") || file_path.ends_with(".ndjson") || file_path.ends_with(".jsonl") {
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

impl LoomDb {
    pub fn new() -> Result<Self, duckdb::Error> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("INSTALL parquet; LOAD parquet;")?;
        // Optional extensions for JSON, Excel (ignore errors if offline or missing)
        let _ = conn.execute_batch("INSTALL json; LOAD json;");
        let _ = conn.execute_batch("INSTALL excel; LOAD excel;");
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Discover data files in a folder (recursive): parquet, csv, json/ndjson/jsonl, xlsx, db/sqlite.
    /// SQLite files yield one entry per table (path stored as "file_path|table_name").
    pub fn scan_folder(&self, folder: &Path) -> Result<Vec<FileEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
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
                    if let Ok(e) = Self::probe_file(&conn, &path_result, ext) {
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
                    if let Ok(mut sqlite_entries) = Self::probe_sqlite(&path_result) {
                        entries.append(&mut sqlite_entries);
                    }
                }
            }
        }

        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(entries)
    }

    fn probe_file(
        conn: &Connection,
        path: &PathBuf,
        ext: &str,
    ) -> Result<FileEntry, String> {
        let path_str = path.to_string_lossy().to_string();
        let escaped = escape_path_for_sql(&path_str);

        let size_bytes = std::fs::metadata(path)
            .map(|m| m.len())
            .unwrap_or(0);

        let count_sql = match ext {
            "parquet" => format!("SELECT COUNT(*) FROM read_parquet('{}')", escaped),
            "csv" => format!("SELECT COUNT(*) FROM read_csv_auto('{}')", escaped),
            "json" | "ndjson" | "jsonl" => format!("SELECT COUNT(*) FROM read_json_auto('{}')", escaped),
            "xlsx" => format!("SELECT COUNT(*) FROM read_xlsx('{}')", escaped),
            _ => return Err(format!("Unsupported file type: {}", ext)),
        };

        let row_count: u64 = conn
            .query_row(&count_sql, params![], |row| row.get(0))
            .map(|v: i64| v as u64)
            .unwrap_or(0);

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
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Self::query_inner(&conn, file_path, sql, limit)
    }

    /// Get column-level statistics for a file.
    pub fn get_column_stats(&self, file_path: &str) -> Result<Vec<ColumnInfo>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Self::column_stats_inner(&conn, file_path)
    }

    /// Combined: stats + sample rows in a single lock acquisition.
    /// Avoids Mutex contention from concurrent IPC calls.
    pub fn inspect_file(&self, file_path: &str, sample_limit: u32) -> Result<(Vec<ColumnInfo>, QueryResult), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        Self::ensure_sqlite_attached(&conn, file_path)?;
        let table_expr = Self::table_expr(file_path);
        conn.execute_batch(&format!(
            "CREATE OR REPLACE TEMP VIEW loom_active AS SELECT * FROM {}",
            table_expr
        ))
        .map_err(|e| e.to_string())?;

        let stats = Self::column_stats_inner(&conn, file_path)?;
        let sample = Self::query_inner(&conn, file_path, "SELECT * FROM loom_active", sample_limit)?;

        Ok((stats, sample))
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
            "CREATE OR REPLACE TEMP VIEW loom_stats AS SELECT * FROM {}",
            table_expr
        ))
        .map_err(|e| e.to_string())?;

        let schema_sql = "DESCRIBE loom_stats";
        let mut stmt = conn.prepare(schema_sql).map_err(|e| e.to_string())?;
        let schema_rows = stmt
            .query_map(params![], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut columns = Vec::new();

        for row in schema_rows.flatten() {
            let (col_name, data_type) = row;
            let col_quoted = format!("\"{}\"", col_name.replace('"', "\"\""));

            let stats_sql = format!(
                "SELECT \
                 COUNT(*) - COUNT({}) AS nulls, \
                 APPROX_COUNT_DISTINCT({}) AS distinct_ct, \
                 TRY_CAST(MIN({}) AS VARCHAR) AS min_val, \
                 TRY_CAST(MAX({}) AS VARCHAR) AS max_val \
                 FROM loom_stats",
                col_quoted, col_quoted, col_quoted, col_quoted
            );

            if let Ok(mut stats_stmt) = conn.prepare(&stats_sql) {
                let result = stats_stmt.query_row(params![], |sr| {
                    Ok(ColumnInfo {
                        name: col_name.clone(),
                        data_type: data_type.clone(),
                        null_count: sr.get::<_, i64>(0).unwrap_or(0) as u64,
                        distinct_count: sr.get::<_, i64>(1).unwrap_or(0) as u64,
                        min_value: sr.get::<_, Option<String>>(2).unwrap_or(None),
                        max_value: sr.get::<_, Option<String>>(3).unwrap_or(None),
                    })
                });

                if let Ok(info) = result {
                    columns.push(info);
                }
            }
        }

        Ok(columns)
    }

    /// Strip trailing "LIMIT n" and return (sql_without_limit, user_limit_if_any).
    /// Caller should use min(user_limit, backend_limit) so the user's LIMIT is respected.
    fn strip_trailing_limit(sql: &str) -> (String, Option<u32>) {
        let s = sql.trim().trim_end_matches(';').trim();
        if s.is_empty() {
            return (String::new(), None);
        }
        let s_upper = s.to_uppercase();
        if let Some(pos) = s_upper.rfind(" LIMIT ") {
            let after = s_upper.get(pos + 7..).unwrap_or("");
            if !after.is_empty() && after.chars().all(|c| c.is_ascii_digit()) {
                let base = s.get(..pos).unwrap_or(s).trim().to_string();
                let n: u32 = after.parse().unwrap_or(0);
                return (base, Some(n));
            }
        }
        (s.to_string(), None)
    }

    fn query_inner(
        conn: &Connection,
        file_path: &str,
        sql: &str,
        limit: u32,
    ) -> Result<QueryResult, String> {
        Self::ensure_sqlite_attached(conn, file_path)?;
        let table_expr = Self::table_expr(file_path);

        conn.execute_batch(&format!(
            "CREATE OR REPLACE TEMP VIEW loom_active AS SELECT * FROM {}",
            table_expr
        ))
        .map_err(|e| e.to_string())?;

        let full_sql = if sql.trim().is_empty() {
            format!("SELECT * FROM loom_active LIMIT {}", limit)
        } else {
            let (base, user_limit) = Self::strip_trailing_limit(sql);
            let effective_limit = user_limit
                .map(|n| n.min(limit))
                .unwrap_or(limit);
            format!("{} LIMIT {}", base, effective_limit)
        };

        let meta_sql = format!(
            "SELECT column_name, column_type FROM (DESCRIBE ({}))",
            full_sql
        );
        let mut meta_stmt = conn.prepare(&meta_sql).map_err(|e| e.to_string())?;
        let meta_rows = meta_stmt
            .query_map(params![], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut columns = Vec::new();
        let mut types = Vec::new();
        for mr in meta_rows.flatten() {
            columns.push(mr.0);
            types.push(mr.1);
        }

        let column_count = columns.len();

        let mut stmt = conn.prepare(&full_sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![], |row| {
                let mut row_vec = Vec::new();
                for i in 0..column_count {
                    let val: duckdb::types::Value = row.get(i)?;
                    let json_val = duckdb_value_to_json(val);
                    row_vec.push(json_val);
                }
                Ok(row_vec)
            })
            .map_err(|e| e.to_string())?;

        let mut rows_out: Vec<Vec<serde_json::Value>> = Vec::new();
        for row in rows {
            if let Ok(r) = row {
                rows_out.push(r);
            }
        }

        let total_rows = rows_out.len() as u64;

        Ok(QueryResult {
            columns,
            types,
            rows: rows_out,
            total_rows,
        })
    }
}

pub(crate) fn duckdb_value_to_json(val: duckdb::types::Value) -> serde_json::Value {
    match val {
        duckdb::types::Value::Null => serde_json::Value::Null,
        duckdb::types::Value::Boolean(b) => serde_json::Value::Bool(b),
        duckdb::types::Value::TinyInt(i) => serde_json::json!(i),
        duckdb::types::Value::SmallInt(i) => serde_json::json!(i),
        duckdb::types::Value::Int(i) => serde_json::json!(i),
        duckdb::types::Value::BigInt(i) => serde_json::json!(i),
        duckdb::types::Value::Float(f) => serde_json::json!(f),
        duckdb::types::Value::Double(f) => serde_json::json!(f),
        duckdb::types::Value::Text(s) => serde_json::Value::String(s),
        _ => serde_json::Value::String(format!("{:?}", val)),
    }
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
        assert_eq!(
            table_expr_for_path("/a|b|c"),
            r#"sqlite_src.main."b|c""#
        );
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
    }
}
