// =================================================================
// Loom — Tauri IPC Commands
// =================================================================
// Each `#[tauri::command]` here is callable from the frontend via
// `invoke("command_name", { args })`. These are the "API endpoints"
// of the Rust backend.
//
// Convention: commands return Result<T, String> so errors propagate
// to the JS side as rejected promises.
// =================================================================

use crate::db::{ColumnInfo, FileEntry, LoomDb, QueryResult};
use serde::Serialize;
use std::path::Path;
use tauri::State;

#[derive(Serialize)]
pub struct InspectResult {
    pub stats: Vec<ColumnInfo>,
    pub sample: QueryResult,
}

/// Scan a local folder for .parquet and .csv files.
/// Returns a list of files with names, paths, and row counts.
#[tauri::command]
pub async fn scan_folder(
    db: State<'_, LoomDb>,
    folder_path: String,
) -> Result<Vec<FileEntry>, String> {
    let path = Path::new(&folder_path);
    if !path.exists() {
        return Err(format!("Folder does not exist: {}", folder_path));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", folder_path));
    }
    db.scan_folder(path)
}

/// Execute a SQL query scoped to a specific data file.
/// The file is exposed as the table "loom_active" in the query.
#[tauri::command]
pub async fn query_file(
    db: State<'_, LoomDb>,
    file_path: String,
    sql: String,
    limit: Option<u32>,
) -> Result<QueryResult, String> {
    db.query_file(&file_path, &sql, limit.unwrap_or(1000))
}

/// Retrieve column-level stats (type, nulls, distinct, min, max).
#[tauri::command]
pub async fn get_column_stats(
    db: State<'_, LoomDb>,
    file_path: String,
) -> Result<Vec<ColumnInfo>, String> {
    db.get_column_stats(&file_path)
}

/// Fetch a small sample of rows from a file for the preview pane.
#[tauri::command]
pub async fn get_sample_rows(
    db: State<'_, LoomDb>,
    file_path: String,
    limit: Option<u32>,
) -> Result<QueryResult, String> {
    db.query_file(&file_path, "SELECT * FROM loom_active", limit.unwrap_or(100))
}

/// Combined stats + sample in one call — avoids Mutex contention.
#[tauri::command]
pub async fn inspect_file(
    db: State<'_, LoomDb>,
    file_path: String,
    limit: Option<u32>,
) -> Result<InspectResult, String> {
    let (stats, sample) = db.inspect_file(&file_path, limit.unwrap_or(100))?;
    Ok(InspectResult { stats, sample })
}
