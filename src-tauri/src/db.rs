// =================================================================
// Loom — DuckDB Integration
// =================================================================
// Wraps an in-process DuckDB connection with helpers for:
//   1. Scanning local folders for .parquet / .csv files
//   2. Running analytic queries over those files
//   3. Returning schema + row-count metadata
//
// DuckDB runs in-process (no server) — perfect for local-first.
// =================================================================

use duckdb::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

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
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Discover all .csv and .parquet files in a folder (recursive).
    pub fn scan_folder(&self, folder: &Path) -> Result<Vec<FileEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut entries = Vec::new();

        let patterns = [
            (folder.join("**/*.parquet"), "parquet"),
            (folder.join("**/*.csv"), "csv"),
        ];

        for (pattern, ext) in &patterns {
            let pattern_str = pattern.to_string_lossy().to_string();
            if let Ok(paths) = glob::glob(&pattern_str) {
                for path_result in paths.flatten() {
                    let entry = Self::probe_file(&conn, &path_result, ext);
                    if let Ok(e) = entry {
                        entries.push(e);
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

        let size_bytes = std::fs::metadata(path)
            .map(|m| m.len())
            .unwrap_or(0);

        let count_sql = match ext {
            "parquet" => format!("SELECT COUNT(*) FROM read_parquet('{}')", path_str),
            "csv" => format!("SELECT COUNT(*) FROM read_csv_auto('{}')", path_str),
            _ => return Err("Unsupported file type".into()),
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

    fn table_expr(file_path: &str) -> String {
        if file_path.ends_with(".parquet") {
            format!("read_parquet('{}')", file_path)
        } else {
            format!("read_csv_auto('{}')", file_path)
        }
    }

    fn column_stats_inner(conn: &Connection, file_path: &str) -> Result<Vec<ColumnInfo>, String> {
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

            let stats_sql = format!(
                "SELECT \
                 COUNT(*) - COUNT(\"{col}\") AS nulls, \
                 APPROX_COUNT_DISTINCT(\"{col}\") AS distinct_ct, \
                 TRY_CAST(MIN(\"{col}\") AS VARCHAR) AS min_val, \
                 TRY_CAST(MAX(\"{col}\") AS VARCHAR) AS max_val \
                 FROM loom_stats",
                col = col_name
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

    fn query_inner(
        conn: &Connection,
        file_path: &str,
        sql: &str,
        limit: u32,
    ) -> Result<QueryResult, String> {
        let table_expr = Self::table_expr(file_path);

        conn.execute_batch(&format!(
            "CREATE OR REPLACE TEMP VIEW loom_active AS SELECT * FROM {}",
            table_expr
        ))
        .map_err(|e| e.to_string())?;

        let full_sql = if sql.trim().is_empty() {
            format!("SELECT * FROM loom_active LIMIT {}", limit)
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

fn duckdb_value_to_json(val: duckdb::types::Value) -> serde_json::Value {
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
