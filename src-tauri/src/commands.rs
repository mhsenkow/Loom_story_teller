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
use crate::sources::SourcesState;
use crate::stream::StreamState;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::sync::Arc;
use tauri::State;

#[derive(Serialize)]
pub struct InspectResult {
    pub stats: Vec<ColumnInfo>,
    pub sample: QueryResult,
}

#[derive(Serialize)]
pub struct DataGovResource {
    pub id: String,
    pub name: String,
    pub format: String,
    pub url: String,
}

#[derive(Serialize)]
pub struct DataGovDataset {
    pub id: String,
    pub name: String,
    pub title: String,
    pub organization: Option<String>,
    /// Description/notes from the portal (for preview modal).
    pub notes: Option<String>,
    pub resources: Vec<DataGovResource>,
    /// Portal id for building view URL, e.g. "data.gov", "data.gov.uk".
    pub portal_id: String,
}

/// Scan a local folder for data files: .parquet, .csv, .json/.ndjson/.jsonl, .xlsx, and .db/.sqlite (one entry per table).
/// Returns a list of files with names, paths, and row counts.
#[tauri::command]
pub async fn scan_folder(
    db: State<'_, Arc<LoomDb>>,
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
    db: State<'_, Arc<LoomDb>>,
    file_path: String,
    sql: String,
    limit: Option<u32>,
) -> Result<QueryResult, String> {
    db.query_file(&file_path, &sql, limit.unwrap_or(1000))
}

/// Retrieve column-level stats (type, nulls, distinct, min, max).
#[tauri::command]
pub async fn get_column_stats(
    db: State<'_, Arc<LoomDb>>,
    file_path: String,
) -> Result<Vec<ColumnInfo>, String> {
    db.get_column_stats(&file_path)
}

/// Fetch a small sample of rows from a file for the preview pane.
#[tauri::command]
pub async fn get_sample_rows(
    db: State<'_, Arc<LoomDb>>,
    file_path: String,
    limit: Option<u32>,
) -> Result<QueryResult, String> {
    db.query_file(&file_path, "SELECT * FROM loom_active", limit.unwrap_or(100))
}

/// Combined stats + sample in one call — avoids Mutex contention.
#[tauri::command]
pub async fn inspect_file(
    db: State<'_, Arc<LoomDb>>,
    file_path: String,
    limit: Option<u32>,
) -> Result<InspectResult, String> {
    let (stats, sample) = db.inspect_file(&file_path, limit.unwrap_or(100))?;
    Ok(InspectResult { stats, sample })
}

/// Normalize path: strip file:// or file:/// prefix if the dialog returns a URI.
fn normalize_folder_path(s: &str) -> String {
    let s = s.trim();
    if s.starts_with("file:///") {
        s.replacen("file:///", "", 1)
    } else if s.starts_with("file://") {
        s.replacen("file://", "", 1)
    } else {
        s.to_string()
    }
}

/// Download a CSV from a URL and save it to the mounted folder.
/// Only allows writing under folder_path (the path the user picked).
#[tauri::command]
pub async fn save_csv_to_folder(
    folder_path: String,
    url: String,
    filename: String,
) -> Result<String, String> {
    use std::io::Write;

    let folder_path = normalize_folder_path(&folder_path);
    if folder_path.is_empty() {
        return Err("Folder path is empty".to_string());
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL must start with http:// or https://".to_string());
    }
    if filename.trim().is_empty() {
        return Err("Filename is empty".to_string());
    }

    let path = Path::new(&folder_path);
    if !path.exists() || !path.is_dir() {
        return Err("Folder does not exist or is not a directory".to_string());
    }
    let sanitized = filename
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let filename_owned = if sanitized.ends_with(".csv") {
        sanitized
    } else {
        format!("{}.csv", sanitized)
    };
    let file_path = path.join(&filename_owned);

    let client = reqwest::Client::builder()
        .user_agent("Loom-Data-Storyteller/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let body = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    let mut f = std::fs::File::create(&file_path).map_err(|e| format!("Write failed: {}", e))?;
    f.write_all(&body).map_err(|e| format!("Write failed: {}", e))?;

    file_path
        .to_str()
        .map(String::from)
        .ok_or_else(|| "Invalid path".to_string())
}

/// Write text content to a file at the given path (e.g. path from save dialog).
#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    let path = normalize_folder_path(&path);
    if path.is_empty() {
        return Err("Path is empty".to_string());
    }
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Create dir failed: {}", e))?;
    }
    std::fs::write(p, content.as_bytes()).map_err(|e| format!("Write failed: {}", e))?;
    Ok(())
}

fn sanitize_ckan_q(q: Option<String>) -> Option<String> {
    let s = q?.trim().to_string();
    if s.is_empty() || s.len() > 500 {
        return None;
    }
    if s.contains('\n') || s.contains('\r') {
        return None;
    }
    Some(s)
}

/// Maps UI sort keys to CKAN `sort` parameter (allowlist only).
fn ckan_sort_param(sort: Option<String>) -> &'static str {
    match sort.as_deref() {
        Some("newest") => "metadata_created desc",
        Some("updated") => "metadata_modified desc",
        Some("relevance") => "score desc",
        Some("title_az") => "title_string asc",
        Some("title_za") => "title_string desc",
        _ => "metadata_created desc",
    }
}

/// Fetch Data.gov datasets that have CSV resources (search, sort, and row limit).
#[tauri::command]
pub async fn fetch_data_gov_recent_csv(
    rows: Option<u32>,
    query: Option<String>,
    sort: Option<String>,
) -> Result<Vec<DataGovDataset>, String> {
    let rows = rows.unwrap_or(40).clamp(1, 200);
    let sort_s = ckan_sort_param(sort);
    let q = sanitize_ckan_q(query);

    let client = reqwest::Client::builder()
        .user_agent("Loom-Data-Storyteller/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut url = reqwest::Url::parse("https://catalog.data.gov/api/3/action/package_search")
        .map_err(|e| format!("Data.gov URL: {}", e))?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("rows", &rows.to_string());
        pairs.append_pair("sort", sort_s);
        pairs.append_pair("fq", "res_format:CSV");
        if let Some(ref query_str) = q {
            pairs.append_pair("q", query_str);
        }
    }

    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Data.gov request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Data.gov returned {}", res.status()));
    }

    let body: Value = res
        .json()
        .await
        .map_err(|e| format!("Invalid Data.gov response: {}", e))?;

    let results = body
        .get("result")
        .and_then(|r| r.get("results"))
        .and_then(|r| r.as_array())
        .ok_or_else(|| "Unexpected Data.gov payload".to_string())?;

    let mut out: Vec<DataGovDataset> = Vec::new();
    for pkg in results {
        let pkg_id = pkg.get("id").and_then(|v| v.as_str()).unwrap_or_default();
        let pkg_name = pkg.get("name").and_then(|v| v.as_str()).unwrap_or_default();
        if pkg_id.is_empty() || pkg_name.is_empty() {
            continue;
        }
        let pkg_title = pkg
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(pkg_name)
            .to_string();
        let organization = pkg
            .get("organization")
            .and_then(|o| o.get("title"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let notes = pkg
            .get("notes")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string());

        let mut csv_resources: Vec<DataGovResource> = Vec::new();
        if let Some(resources) = pkg.get("resources").and_then(|r| r.as_array()) {
            for (idx, res) in resources.iter().enumerate() {
                let format = res.get("format").and_then(|v| v.as_str()).unwrap_or("");
                if format.to_uppercase() != "CSV" {
                    continue;
                }
                let url = match res.get("url").and_then(|v| v.as_str()) {
                    Some(u) if u.starts_with("http://") || u.starts_with("https://") => u.to_string(),
                    _ => continue,
                };
                let id = res
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("{}-{}", pkg_id, idx));
                let name = res
                    .get("name")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or("CSV")
                    .to_string();

                csv_resources.push(DataGovResource {
                    id,
                    name,
                    format: "CSV".to_string(),
                    url,
                });
            }
        }

        if !csv_resources.is_empty() {
            out.push(DataGovDataset {
                id: pkg_id.to_string(),
                name: pkg_name.to_string(),
                title: pkg_title,
                organization,
                notes,
                resources: csv_resources,
                portal_id: "data.gov".to_string(),
            });
        }
    }

    Ok(out)
}

/// UK open data (CKAN). Same shape as Data.gov for unified UI.
#[tauri::command]
pub async fn fetch_uk_data_recent_csv(
    rows: Option<u32>,
    query: Option<String>,
    sort: Option<String>,
) -> Result<Vec<DataGovDataset>, String> {
    let rows = rows.unwrap_or(40).clamp(1, 200);
    let sort_s = ckan_sort_param(sort);
    let q = sanitize_ckan_q(query);

    let client = reqwest::Client::builder()
        .user_agent("Loom-Data-Storyteller/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut url = reqwest::Url::parse("https://data.gov.uk/api/action/package_search")
        .map_err(|e| format!("UK data URL: {}", e))?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("rows", &rows.to_string());
        pairs.append_pair("sort", sort_s);
        pairs.append_pair("fq", "res_format:CSV");
        if let Some(ref query_str) = q {
            pairs.append_pair("q", query_str);
        }
    }

    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("UK data request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("UK data returned {}", res.status()));
    }

    let body: Value = res
        .json()
        .await
        .map_err(|e| format!("Invalid UK data response: {}", e))?;

    let results = body
        .get("result")
        .and_then(|r| r.get("results"))
        .and_then(|r| r.as_array())
        .ok_or_else(|| "Unexpected UK data payload".to_string())?;

    let mut out: Vec<DataGovDataset> = Vec::new();
    for pkg in results {
        let pkg_id = pkg.get("id").and_then(|v| v.as_str()).unwrap_or_default();
        let pkg_name = pkg.get("name").and_then(|v| v.as_str()).unwrap_or_default();
        if pkg_id.is_empty() || pkg_name.is_empty() {
            continue;
        }
        let pkg_title = pkg
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(pkg_name)
            .to_string();
        let organization = pkg
            .get("organization")
            .and_then(|o| o.get("title"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let notes = pkg
            .get("notes")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string());

        let mut csv_resources: Vec<DataGovResource> = Vec::new();
        if let Some(resources) = pkg.get("resources").and_then(|r| r.as_array()) {
            for (idx, res) in resources.iter().enumerate() {
                let format = res.get("format").and_then(|v| v.as_str()).unwrap_or("");
                if format.to_uppercase() != "CSV" {
                    continue;
                }
                let url = match res.get("url").and_then(|v| v.as_str()) {
                    Some(u) if u.starts_with("http://") || u.starts_with("https://") => u.to_string(),
                    _ => continue,
                };
                let id = res
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("{}-{}", pkg_id, idx));
                let name = res
                    .get("name")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or("CSV")
                    .to_string();
                csv_resources.push(DataGovResource {
                    id,
                    name,
                    format: "CSV".to_string(),
                    url,
                });
            }
        }

        if !csv_resources.is_empty() {
            out.push(DataGovDataset {
                id: pkg_id.to_string(),
                name: pkg_name.to_string(),
                title: pkg_title,
                organization,
                notes,
                resources: csv_resources,
                portal_id: "data.gov.uk".to_string(),
            });
        }
    }

    Ok(out)
}

const GITHUB_REPO: &str = "mhsenkow/Loom_story_teller";

/// Create a GitHub issue (feedback). Requires GITHUB_TOKEN env to be set.
/// Returns the new issue URL on success.
#[tauri::command]
pub async fn create_github_issue(
    title: String,
    body: String,
    image_base64: Option<String>,
) -> Result<String, String> {
    let token = std::env::var("GITHUB_TOKEN").map_err(|_| {
        "GITHUB_TOKEN not set. Open the issue link to submit feedback in the browser.".to_string()
    })?;

    let body_with_image = match image_base64 {
        Some(b64) if !b64.is_empty() => {
            let data_url = if b64.starts_with("data:") {
                b64.to_string()
            } else {
                format!("data:image/png;base64,{}", b64)
            };
            format!("{}\n\n![screenshot]({})", body.trim(), data_url)
        }
        _ => body,
    };

    let client = reqwest::Client::builder()
        .user_agent("Loom-Data-Storyteller")
        .build()
        .map_err(|e| format!("HTTP client: {}", e))?;

    let res = client
        .post(format!(
            "https://api.github.com/repos/{}/issues",
            GITHUB_REPO
        ))
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {}", token))
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&serde_json::json!({
            "title": title,
            "body": body_with_image,
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("GitHub API {}: {}", status, text));
    }

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;
    let url = json
        .get("html_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "No html_url in response".to_string())?;
    Ok(url.to_string())
}

/// Open a URL in the system default browser. Used for feedback issue links.
#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("URL is empty".to_string());
    }
    tokio::task::spawn_blocking(move || {
        opener::open(&url).map_err(|e| format!("Failed to open URL: {}", e))
    })
    .await
    .map_err(|e| format!("Task join: {}", e))?
}

// =================================================================
// Wikipedia Live Stream Commands
// =================================================================

/// Start the Wikimedia recent-changes SSE stream.
#[tauri::command]
pub async fn stream_start(
    db: State<'_, Arc<LoomDb>>,
    stream: State<'_, Arc<StreamState>>,
) -> Result<(), String> {
    crate::stream::start_stream(Arc::clone(&*db), Arc::clone(&*stream)).await
}

/// Stop the live stream.
#[tauri::command]
pub async fn stream_stop(
    stream: State<'_, Arc<StreamState>>,
) -> Result<(), String> {
    crate::stream::stop_stream(Arc::clone(&*stream)).await
}

/// Get the current stream status (running, event count, eps, buffer size).
#[tauri::command]
pub async fn stream_status(
    db: State<'_, Arc<LoomDb>>,
    stream: State<'_, Arc<StreamState>>,
) -> Result<crate::stream::StreamStatus, String> {
    Ok(stream.status(&*db).await)
}

/// Query the stream buffer table (wiki_stream) with arbitrary SQL.
#[tauri::command]
pub async fn stream_query(
    db: State<'_, Arc<LoomDb>>,
    sql: String,
    limit: Option<u32>,
) -> Result<QueryResult, String> {
    crate::stream::query_stream(&*db, &sql, limit.unwrap_or(5000))
}

/// Get a snapshot: column stats + recent rows from wiki_stream.
#[tauri::command]
pub async fn stream_snapshot(
    db: State<'_, Arc<LoomDb>>,
    limit: Option<u32>,
) -> Result<InspectResult, String> {
    let stats = crate::stream::stream_column_stats(&*db)?;
    let sample = crate::stream::query_stream(
        &*db,
        "SELECT * FROM wiki_stream ORDER BY ts DESC",
        limit.unwrap_or(500),
    )?;
    Ok(InspectResult { stats, sample })
}

/// Clear the stream buffer table.
#[tauri::command]
pub async fn stream_clear(
    db: State<'_, Arc<LoomDb>>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute_batch("DELETE FROM wiki_stream")
        .map_err(|e| e.to_string())
}

// =================================================================
// Poll-Based Data Sources (USGS, Open-Meteo, NWS, World Bank)
// =================================================================

#[tauri::command]
pub async fn source_start(
    kind: String,
    db: State<'_, Arc<LoomDb>>,
    sources: State<'_, Arc<SourcesState>>,
) -> Result<(), String> {
    crate::sources::source_start(&kind, Arc::clone(&*db), Arc::clone(&*sources)).await
}

#[tauri::command]
pub async fn source_stop(
    kind: String,
    sources: State<'_, Arc<SourcesState>>,
) -> Result<(), String> {
    crate::sources::source_stop(&kind, Arc::clone(&*sources)).await
}

#[tauri::command]
pub async fn source_status(
    kind: String,
    db: State<'_, Arc<LoomDb>>,
    sources: State<'_, Arc<SourcesState>>,
) -> Result<crate::sources::SourceStatus, String> {
    let inst = sources.get(&kind).ok_or("Unknown source kind")?;
    let table = match kind.as_str() {
        "usgs" => "usgs_quakes",
        "meteo" => "meteo_weather",
        "nws" => "nws_alerts",
        "world_bank" => "world_bank",
        _ => return Err("Unknown source kind".to_string()),
    };
    Ok(inst.status(table, &*db).await)
}

#[tauri::command]
pub async fn source_query(
    kind: String,
    sql: String,
    limit: Option<u32>,
    db: State<'_, Arc<LoomDb>>,
) -> Result<QueryResult, String> {
    crate::sources::source_query(&*db, &kind, &sql, limit.unwrap_or(5000))
}

#[tauri::command]
pub async fn source_snapshot(
    kind: String,
    limit: Option<u32>,
    db: State<'_, Arc<LoomDb>>,
) -> Result<InspectResult, String> {
    let stats = crate::sources::source_stats(&*db, &kind)?;
    let table = match kind.as_str() {
        "usgs" => "usgs_quakes",
        "meteo" => "meteo_weather",
        "nws" => "nws_alerts",
        "world_bank" => "world_bank",
        _ => return Err("Unknown source kind".to_string()),
    };
    let order = match kind.as_str() {
        "usgs" => "ORDER BY ts DESC",
        "meteo" => "ORDER BY ts DESC",
        "nws" => "ORDER BY effective DESC",
        "world_bank" => "ORDER BY yr DESC, country_code",
        _ => "",
    };
    let sql = format!("SELECT * FROM {} {}", table, order);
    let sample = crate::sources::source_query(&*db, &kind, &sql, limit.unwrap_or(500))?;
    Ok(InspectResult { stats, sample })
}

#[tauri::command]
pub async fn source_clear(
    kind: String,
    db: State<'_, Arc<LoomDb>>,
) -> Result<(), String> {
    crate::sources::source_clear(&*db, &kind)
}

