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
use crate::http_client::LoomHttp;
use crate::path_gate::{normalize_path_key, unique_csv_path, MountedFolder, WritePathGate};
use crate::sources::SourcesState;
use crate::stream::StreamState;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::sync::Arc;
use tauri::State;
use tauri_plugin_dialog::{DialogExt, FilePath};

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
    mounted: State<'_, Arc<MountedFolder>>,
    folder_path: String,
) -> Result<Vec<FileEntry>, String> {
    let folder_path = normalize_path_key(&folder_path);
    let path = Path::new(&folder_path);
    if !path.exists() {
        return Err(format!("Folder does not exist: {}", folder_path));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", folder_path));
    }
    mounted.set(&folder_path);
    let db = Arc::clone(&*db);
    let folder_path = folder_path.clone();
    tokio::task::spawn_blocking(move || db.scan_folder(Path::new(&folder_path)))
        .await
        .map_err(|e| format!("Scan task: {}", e))?
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
    let db = Arc::clone(&*db);
    let limit = limit.unwrap_or(1000);
    tokio::task::spawn_blocking(move || db.query_file(&file_path, &sql, limit))
        .await
        .map_err(|e| format!("Query task: {}", e))?
}

/// Retrieve column-level stats (type, nulls, distinct, min, max).
#[tauri::command]
pub async fn get_column_stats(
    db: State<'_, Arc<LoomDb>>,
    file_path: String,
) -> Result<Vec<ColumnInfo>, String> {
    let db = Arc::clone(&*db);
    tokio::task::spawn_blocking(move || db.get_column_stats(&file_path))
        .await
        .map_err(|e| format!("Stats task: {}", e))?
}

/// Fetch a small sample of rows from a file for the preview pane.
#[tauri::command]
pub async fn get_sample_rows(
    db: State<'_, Arc<LoomDb>>,
    file_path: String,
    limit: Option<u32>,
) -> Result<QueryResult, String> {
    let db = Arc::clone(&*db);
    let limit = limit.unwrap_or(100);
    tokio::task::spawn_blocking(move || {
        db.query_file(&file_path, "SELECT * FROM loom_active", limit)
    })
    .await
    .map_err(|e| format!("Sample task: {}", e))?
}

/// Combined stats + sample in one call — avoids Mutex contention.
#[tauri::command]
pub async fn inspect_file(
    db: State<'_, Arc<LoomDb>>,
    file_path: String,
    limit: Option<u32>,
) -> Result<InspectResult, String> {
    let db = Arc::clone(&*db);
    let limit = limit.unwrap_or(100);
    let (stats, sample) = tokio::task::spawn_blocking(move || db.inspect_file(&file_path, limit))
        .await
        .map_err(|e| format!("Inspect task: {}", e))??;
    Ok(InspectResult { stats, sample })
}

/// Normalize path: strip file:// or file:/// prefix if the dialog returns a URI.
fn normalize_folder_path(s: &str) -> String {
    let s = s.trim();
    if s.starts_with("file://") {
        s.replacen("file://", "", 1)
    } else {
        s.to_string()
    }
}

/// Download a CSV from a URL and save it to the mounted folder.
/// Only allows writing under the folder last successfully scanned.
#[tauri::command]
pub async fn save_csv_to_folder(
    http: State<'_, LoomHttp>,
    mounted: State<'_, Arc<MountedFolder>>,
    folder_path: String,
    url: String,
    filename: String,
) -> Result<String, String> {
    use std::fs::OpenOptions;
    use std::io::Write;

    let folder_path = normalize_path_key(&folder_path);
    if folder_path.is_empty() {
        return Err("Folder path is empty".to_string());
    }
    if !mounted.matches(&folder_path) {
        return Err(
            "Folder is not the currently mounted folder — pick the folder again".to_string(),
        );
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
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    let filename_owned = if sanitized.to_ascii_lowercase().ends_with(".csv") {
        sanitized
    } else {
        format!("{}.csv", sanitized)
    };
    let file_path = unique_csv_path(path, &filename_owned);

    use futures_util::StreamExt;

    const MAX_DOWNLOAD_BYTES: u64 = 500 * 1024 * 1024;

    let client = http.client();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file_path)
        .map_err(|e| format!("Write failed: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download failed: {}", e))?;
        downloaded += chunk.len() as u64;
        if downloaded > MAX_DOWNLOAD_BYTES {
            let _ = std::fs::remove_file(&file_path);
            return Err("Download exceeds 500 MB limit".to_string());
        }
        f.write_all(&chunk)
            .map_err(|e| format!("Write failed: {}", e))?;
    }

    file_path
        .to_str()
        .map(String::from)
        .ok_or_else(|| "Invalid path".to_string())
}

/// Native save dialog that records a one-time write approval for the chosen path.
#[tauri::command]
pub async fn pick_save_path(
    app: tauri::AppHandle,
    gate: State<'_, Arc<WritePathGate>>,
    default_path: Option<String>,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let gate = Arc::clone(&*gate);
    let filter_name = filter_name.unwrap_or_else(|| "File".into());
    let extensions = extensions.unwrap_or_else(|| vec!["bin".into()]);

    let chosen = tokio::task::spawn_blocking(move || {
        let mut builder = app.dialog().file();
        if let Some(dp) = default_path.as_deref() {
            // Prefer file name only so the dialog opens in a sensible default folder.
            let name = Path::new(dp)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(dp);
            builder = builder.set_file_name(name);
        }
        let ext_refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
        builder = builder.add_filter(&filter_name, &ext_refs);
        builder.blocking_save_file()
    })
    .await
    .map_err(|e| format!("Dialog task: {}", e))?;

    let Some(fp) = chosen else {
        return Ok(None);
    };
    let path = match fp {
        FilePath::Path(p) => p.to_string_lossy().to_string(),
        FilePath::Url(u) => normalize_path_key(u.as_str()),
    };
    let path = normalize_path_key(&path);
    if path.is_empty() {
        return Ok(None);
    }
    gate.approve(&path);
    Ok(Some(path))
}

/// Write text content to a path just chosen in the save dialog.
#[tauri::command]
pub async fn write_text_file(
    gate: State<'_, Arc<WritePathGate>>,
    path: String,
    content: String,
) -> Result<(), String> {
    let path = normalize_path_key(&path);
    if path.is_empty() {
        return Err("Path is empty".to_string());
    }
    if !gate.consume(&path) {
        return Err("Write path not approved — use the save dialog first".to_string());
    }
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Create dir failed: {}", e))?;
    }
    std::fs::write(p, content.as_bytes()).map_err(|e| format!("Write failed: {}", e))?;
    Ok(())
}

/// Write binary content to a path just chosen in the save dialog.
#[tauri::command]
pub async fn write_binary_file(
    gate: State<'_, Arc<WritePathGate>>,
    path: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let path = normalize_path_key(&path);
    if path.is_empty() {
        return Err("Path is empty".to_string());
    }
    if bytes.len() > 80 * 1024 * 1024 {
        return Err("File too large (80MB limit)".to_string());
    }
    if !gate.consume(&path) {
        return Err("Write path not approved — use the save dialog first".to_string());
    }
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Create dir failed: {}", e))?;
    }
    std::fs::write(p, &bytes).map_err(|e| format!("Write failed: {}", e))?;
    Ok(())
}

/// Reveal a file in the system file manager (Finder on macOS).
#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    let path = normalize_folder_path(&path);
    if path.is_empty() {
        return Err("Path is empty".to_string());
    }
    let p = Path::new(&path);
    if !p.exists() {
        return Err("File does not exist".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Reveal failed: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let parent = p.parent().unwrap_or(p);
        opener::open(parent).map_err(|e| format!("Reveal failed: {}", e))?;
        Ok(())
    }
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

/// Maps UI sort keys to CKAN `sort` parameter (allowlist only) — UK portal.
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

/// Data.gov Catalog API `sort` query value (not CKAN — see resources.data.gov/catalog-api).
fn catalog_data_gov_sort(sort: Option<String>) -> &'static str {
    match sort.as_deref() {
        Some("relevance") => "relevance",
        Some("popularity") => "popularity",
        Some("newest") | Some("updated") | Some("title_az") | Some("title_za") | None => {
            "last_harvested_date"
        }
        _ => "last_harvested_date",
    }
}

fn distribution_http_url(dist: &Value) -> Option<String> {
    let du = dist.get("downloadURL").and_then(|v| v.as_str())?;
    if du.starts_with("http://") || du.starts_with("https://") {
        return Some(du.to_string());
    }
    None
}

fn distribution_access_fallback(dist: &Value) -> Option<String> {
    let u = dist.get("accessURL").and_then(|v| v.as_str())?;
    if u.starts_with("http://") || u.starts_with("https://") {
        return Some(u.to_string());
    }
    None
}

/// True if this DCAT distribution points to CSV data (new Catalog API shape).
fn is_csv_distribution(dist: &Value) -> bool {
    let fmt = dist
        .get("format")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_uppercase();
    let mt = dist
        .get("mediaType")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let du = dist
        .get("downloadURL")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let ac = dist.get("accessURL").and_then(|v| v.as_str()).unwrap_or("");
    let title = dist.get("title").and_then(|v| v.as_str()).unwrap_or("");
    if fmt.contains("CSV") || mt.contains("csv") {
        return true;
    }
    if du.to_lowercase().ends_with(".csv") || ac.to_lowercase().ends_with(".csv") {
        return true;
    }
    if du.contains("format=csv") || du.contains("format=CSV") {
        return true;
    }
    // Common DCAT pattern: title "CSV" with a direct download link
    title.trim().eq_ignore_ascii_case("csv")
        && !du.is_empty()
        && (du.starts_with("http://") || du.starts_with("https://"))
}

/// Skip portal landing HTML; keep tabular / archive / API distributions (Catalog API mix).
fn is_usable_catalog_distribution(dist: &Value, url: &str) -> bool {
    if is_csv_distribution(dist) {
        return true;
    }
    let mt = dist
        .get("mediaType")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let fmt = dist
        .get("format")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_uppercase();
    let ul = url.to_lowercase();
    if mt == "text/html"
        && !ul.ends_with(".csv")
        && !ul.contains("format=csv")
        && !fmt.contains("CSV")
    {
        return false;
    }
    if fmt.contains("ZIP") || mt.contains("zip") || ul.ends_with(".zip") {
        return true;
    }
    if mt.contains("json")
        || fmt.contains("JSON")
        || ul.ends_with(".json")
        || ul.ends_with(".geojson")
    {
        return true;
    }
    if mt.contains("geo+json") || fmt.contains("GEOJSON") {
        return true;
    }
    if mt.contains("spreadsheet") || fmt.contains("XLSX") || fmt.contains("XLS") {
        return true;
    }
    false
}

fn catalog_distribution_format(dist: &Value) -> String {
    if is_csv_distribution(dist) {
        return "CSV".to_string();
    }
    let fmt = dist
        .get("format")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_uppercase();
    let mt = dist
        .get("mediaType")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    if fmt.contains("ZIP") || mt.contains("zip") {
        return "ZIP".to_string();
    }
    if mt.contains("geo+json") || fmt.contains("GEOJSON") {
        return "GeoJSON".to_string();
    }
    if mt.contains("json") || fmt.contains("JSON") {
        return "JSON".to_string();
    }
    if fmt.contains("XLSX") || mt.contains("spreadsheet") {
        return "XLSX".to_string();
    }
    "File".to_string()
}

/// ZIP/JSON/CSV/etc. from DCAT `distribution`; empty if only HTML links.
fn data_resources_from_catalog_dcat(dcat: Option<&Value>, slug: &str) -> Vec<DataGovResource> {
    let mut out = Vec::new();
    let Some(dcat) = dcat else {
        return out;
    };
    let Some(arr) = dcat.get("distribution").and_then(|d| d.as_array()) else {
        return out;
    };
    for (idx, dist) in arr.iter().enumerate() {
        let Some(url) = distribution_http_url(dist).or_else(|| distribution_access_fallback(dist))
        else {
            continue;
        };
        if !is_usable_catalog_distribution(dist, &url) {
            continue;
        }
        let fmt_label = catalog_distribution_format(dist);
        let name = dist
            .get("title")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(fmt_label.as_str())
            .to_string();
        let id = format!("{}-{}", slug, idx);
        out.push(DataGovResource {
            id,
            name,
            format: fmt_label,
            url,
        });
    }
    out
}

fn catalog_row_resources(row: &Value, dcat: Option<&Value>, slug: &str) -> Vec<DataGovResource> {
    let mut out = data_resources_from_catalog_dcat(dcat, slug);
    if !out.is_empty() {
        return out;
    }
    if let Some(u) = row.get("harvest_record").and_then(|v| v.as_str()) {
        if u.starts_with("http://") || u.starts_with("https://") {
            out.push(DataGovResource {
                id: format!("{}-harvest", slug),
                name: "Catalog record (metadata)".to_string(),
                format: "Metadata".to_string(),
                url: u.to_string(),
            });
        }
    }
    out
}

fn data_gov_from_catalog_row(row: &Value) -> Option<DataGovDataset> {
    let identifier = row.get("identifier").and_then(|v| v.as_str())?;
    let slug = row.get("slug").and_then(|v| v.as_str()).unwrap_or("");
    let name = if slug.is_empty() {
        identifier.to_string()
    } else {
        slug.to_string()
    };
    let title = row
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or(&name)
        .to_string();
    let organization = row
        .get("organization")
        .and_then(|o| o.get("name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            row.get("publisher")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });
    let notes = row
        .get("description")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string());
    let dcat = row.get("dcat");
    let resources = catalog_row_resources(row, dcat, &name);
    if resources.is_empty() {
        return None;
    }
    Some(DataGovDataset {
        id: identifier.to_string(),
        name,
        title,
        organization,
        notes,
        resources,
        portal_id: "data.gov".to_string(),
    })
}

/// Fetch Data.gov datasets (Catalog `/search`): CSV/ZIP/JSON/XLSX downloads, else harvest metadata link.
#[tauri::command]
pub async fn fetch_data_gov_recent_csv(
    http: State<'_, LoomHttp>,
    rows: Option<u32>,
    query: Option<String>,
    sort: Option<String>,
) -> Result<Vec<DataGovDataset>, String> {
    let rows = rows.unwrap_or(40).clamp(1, 200);
    let sort_api = catalog_data_gov_sort(sort.clone());
    let q = sanitize_ckan_q(query);

    let client = http.client();

    let mut collected: Vec<DataGovDataset> = Vec::new();
    let mut after_cursor: Option<String> = None;
    let started = std::time::Instant::now();
    let deadline = std::time::Duration::from_secs(10);

    for _page in 0..25 {
        if collected.len() >= rows as usize {
            break;
        }
        if started.elapsed() >= deadline {
            break;
        }

        let mut url = reqwest::Url::parse("https://catalog.data.gov/search")
            .map_err(|e| format!("Data.gov URL: {}", e))?;
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("per_page", "100");
            pairs.append_pair("sort", sort_api);
            if let Some(ref query_str) = q {
                pairs.append_pair("q", query_str);
            }
            if let Some(ref a) = after_cursor {
                pairs.append_pair("after", a);
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
            .get("results")
            .and_then(|r| r.as_array())
            .ok_or_else(|| "Unexpected Data.gov payload (missing results)".to_string())?;

        for item in results {
            if collected.len() >= rows as usize {
                break;
            }
            if let Some(ds) = data_gov_from_catalog_row(item) {
                collected.push(ds);
            }
        }

        after_cursor = body
            .get("after")
            .and_then(|a| a.as_str())
            .map(|s| s.to_string());
        if after_cursor.is_none() || results.is_empty() {
            break;
        }
    }

    if collected.is_empty() && started.elapsed() >= deadline {
        return Err("Data.gov search timed out before returning results".to_string());
    }

    match sort.as_deref() {
        Some("title_az") => collected.sort_by_key(|a| a.title.to_lowercase()),
        Some("title_za") => collected.sort_by_key(|a| std::cmp::Reverse(a.title.to_lowercase())),
        _ => {}
    }

    Ok(collected)
}

/// UK open data (CKAN). Same shape as Data.gov for unified UI.
#[tauri::command]
pub async fn fetch_uk_data_recent_csv(
    http: State<'_, LoomHttp>,
    rows: Option<u32>,
    query: Option<String>,
    sort: Option<String>,
) -> Result<Vec<DataGovDataset>, String> {
    let rows = rows.unwrap_or(40).clamp(1, 200);
    let sort_s = ckan_sort_param(sort);
    let q = sanitize_ckan_q(query);

    let client = http.client();

    let mut url = reqwest::Url::parse("https://www.data.gov.uk/api/action/package_search")
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
                    Some(u) if u.starts_with("http://") || u.starts_with("https://") => {
                        u.to_string()
                    }
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
const GITHUB_BODY_MAX: usize = 65_536;

fn decode_feedback_png(b64: &str) -> Result<Vec<u8>, String> {
    let payload = b64
        .strip_prefix("data:image/png;base64,")
        .or_else(|| b64.strip_prefix("data:image/jpeg;base64,"))
        .unwrap_or(b64);
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|e| format!("Invalid screenshot encoding: {}", e))
}

async fn upload_feedback_screenshot(
    client: &reqwest::Client,
    token: &str,
    png: &[u8],
) -> Result<String, String> {
    use base64::Engine;
    let path = format!(
        ".loom-feedback/{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let content = base64::engine::general_purpose::STANDARD.encode(png);
    let res = client
        .put(format!(
            "https://api.github.com/repos/{}/contents/{}",
            GITHUB_REPO, path
        ))
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {}", token))
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&serde_json::json!({
            "message": "Loom feedback screenshot",
            "content": content,
        }))
        .send()
        .await
        .map_err(|e| format!("Screenshot upload failed: {}", e))?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Screenshot upload {}: {}", status, text));
    }
    let json: Value = res
        .json()
        .await
        .map_err(|e| format!("Screenshot upload response: {}", e))?;
    json.pointer("/content/download_url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Screenshot upload missing download_url".to_string())
}

async fn github_issue_body(
    client: &reqwest::Client,
    token: &str,
    body: &str,
    image_base64: Option<String>,
) -> String {
    let Some(b64) = image_base64.filter(|s| !s.trim().is_empty()) else {
        return body.to_string();
    };
    match decode_feedback_png(&b64) {
        Ok(bytes) => match upload_feedback_screenshot(client, token, &bytes).await {
            Ok(url) => format!("{}\n\n![screenshot]({})", body.trim(), url),
            Err(e) => {
                log::warn!(target: "loom", "feedback screenshot: {e}");
                format!("{}\n\n_Screenshot omitted ({})._", body.trim(), e)
            }
        },
        Err(e) => format!("{}\n\n_Screenshot omitted ({})._", body.trim(), e),
    }
}

/// Create a GitHub issue (feedback). Requires GITHUB_TOKEN env to be set.
/// Returns the new issue URL on success.
#[tauri::command]
pub async fn create_github_issue(
    http: State<'_, LoomHttp>,
    title: String,
    body: String,
    image_base64: Option<String>,
) -> Result<String, String> {
    let token = std::env::var("GITHUB_TOKEN").map_err(|_| {
        "GITHUB_TOKEN not set. Open the issue link to submit feedback in the browser.".to_string()
    })?;

    let client = http.client();
    let body_with_image = github_issue_body(client, &token, &body, image_base64).await;
    if body_with_image.len() > GITHUB_BODY_MAX {
        return Err(format!(
            "Issue body too large ({} chars). Shorten the description.",
            body_with_image.len()
        ));
    }

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

/// Allow only http(s) and mailto — reject file:, custom schemes, and bare paths.
pub fn is_allowed_external_url(url: &str) -> bool {
    let url = url.trim();
    if url.is_empty() {
        return false;
    }
    // Bare paths / Windows paths must not reach opener.
    if url.starts_with('/') || url.starts_with('\\') {
        return false;
    }
    let Some(colon) = url.find(':') else {
        return false;
    };
    // Scheme must be at the start (reject "C:\…" style and "evilhttps:").
    if !url[..colon].bytes().all(|b| b.is_ascii_alphabetic()) {
        return false;
    }
    let scheme = url[..colon].to_ascii_lowercase();
    matches!(scheme.as_str(), "http" | "https" | "mailto")
}

/// Open a URL in the system default browser. Used for feedback issue links.
#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("URL is empty".to_string());
    }
    if !is_allowed_external_url(&url) {
        return Err("URL scheme not allowed (use http, https, or mailto)".to_string());
    }
    tokio::task::spawn_blocking(move || {
        opener::open(&url).map_err(|e| format!("Failed to open URL: {}", e))
    })
    .await
    .map_err(|e| format!("Task join: {}", e))?
}

#[cfg(test)]
mod feedback_ipc_tests {
    use serde::Deserialize;

    /// Mirrors the JSON payload `src/lib/tauri.ts` sends to `create_github_issue`.
    #[derive(Debug, Deserialize)]
    struct FeedbackInvokeArgs {
        title: String,
        body: String,
        #[serde(default, alias = "imageBase64")]
        image_base64: Option<String>,
    }

    #[test]
    fn feedback_invoke_payload_snake_case() {
        let args: FeedbackInvokeArgs =
            serde_json::from_str(r#"{"title":"Bug","body":"Details","image_base64":"aGVsbG8="}"#)
                .unwrap();
        assert_eq!(args.title, "Bug");
        assert_eq!(args.body, "Details");
        assert_eq!(args.image_base64.as_deref(), Some("aGVsbG8="));
    }

    #[test]
    fn feedback_invoke_payload_camel_case_alias() {
        let args: FeedbackInvokeArgs =
            serde_json::from_str(r#"{"title":"Bug","body":"Details","imageBase64":"aGVsbG8="}"#)
                .unwrap();
        assert_eq!(args.image_base64.as_deref(), Some("aGVsbG8="));
    }

    #[test]
    fn feedback_without_image_deserializes() {
        let args: FeedbackInvokeArgs = serde_json::from_str(r#"{"title":"T","body":"B"}"#).unwrap();
        assert!(args.image_base64.is_none());
    }
}

#[cfg(test)]
mod open_external_url_tests {
    use super::is_allowed_external_url;

    #[test]
    fn accepts_http_https_mailto() {
        assert!(is_allowed_external_url("https://loom.ibm.io/"));
        assert!(is_allowed_external_url("http://localhost:3000"));
        assert!(is_allowed_external_url("mailto:hello@example.com"));
    }

    #[test]
    fn rejects_file_and_bare_paths() {
        assert!(!is_allowed_external_url("file:///tmp/x.command"));
        assert!(!is_allowed_external_url("/Applications/Terminal.app"));
        assert!(!is_allowed_external_url("javascript:alert(1)"));
        assert!(!is_allowed_external_url("C:\\Windows\\System32"));
        assert!(!is_allowed_external_url(""));
    }
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
pub async fn stream_stop(stream: State<'_, Arc<StreamState>>) -> Result<(), String> {
    crate::stream::stop_stream(Arc::clone(&*stream)).await
}

/// Get the current stream status (running, event count, eps, buffer size).
#[tauri::command]
pub async fn stream_status(
    db: State<'_, Arc<LoomDb>>,
    stream: State<'_, Arc<StreamState>>,
) -> Result<crate::stream::StreamStatus, String> {
    Ok(stream.status(&db).await)
}

/// Query the stream buffer table (wiki_stream) with arbitrary SQL.
#[tauri::command]
pub async fn stream_query(
    db: State<'_, Arc<LoomDb>>,
    sql: String,
    limit: Option<u32>,
) -> Result<QueryResult, String> {
    crate::stream::query_stream(&db, &sql, limit.unwrap_or(5000))
}

/// Get a snapshot: column stats + recent rows from wiki_stream.
#[tauri::command]
pub async fn stream_snapshot(
    db: State<'_, Arc<LoomDb>>,
    limit: Option<u32>,
) -> Result<InspectResult, String> {
    let stats = crate::stream::stream_column_stats(&db)?;
    let sample = crate::stream::query_stream(
        &db,
        "SELECT * FROM wiki_stream ORDER BY ts DESC",
        limit.unwrap_or(500),
    )?;
    Ok(InspectResult { stats, sample })
}

/// Clear the stream buffer table.
#[tauri::command]
pub async fn stream_clear(db: State<'_, Arc<LoomDb>>) -> Result<(), String> {
    let conn = db.lock_connection();
    conn.execute_batch("DELETE FROM wiki_stream")
        .map_err(|e| e.to_string())
}

// =================================================================
// Poll-Based Data Sources (see SOURCE_SPECS in sources.rs)
// =================================================================

#[tauri::command]
pub async fn source_start(
    kind: String,
    db: State<'_, Arc<LoomDb>>,
    sources: State<'_, Arc<SourcesState>>,
) -> Result<(), String> {
    crate::sources::source_start(&kind, Arc::clone(&db), Arc::clone(&*sources)).await
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
    let table = crate::sources::table_for_kind(&kind).ok_or("Unknown source kind")?;
    Ok(inst.status(table, &db).await)
}

#[tauri::command]
pub async fn source_query(
    kind: String,
    sql: String,
    limit: Option<u32>,
    db: State<'_, Arc<LoomDb>>,
) -> Result<QueryResult, String> {
    crate::sources::source_query(&db, &kind, &sql, limit.unwrap_or(5000))
}

#[tauri::command]
pub async fn source_snapshot(
    kind: String,
    limit: Option<u32>,
    db: State<'_, Arc<LoomDb>>,
) -> Result<InspectResult, String> {
    let stats = crate::sources::source_stats(&db, &kind)?;
    // Table + ORDER BY come from the registry mirror in sources.rs.
    let limit = limit.unwrap_or(500);
    let sql = crate::sources::snapshot_sql_limited(&kind, limit).ok_or("Unknown source kind")?;
    let sample = crate::sources::source_query(&db, &kind, &sql, limit)?;
    Ok(InspectResult { stats, sample })
}

#[tauri::command]
pub async fn source_clear(kind: String, db: State<'_, Arc<LoomDb>>) -> Result<(), String> {
    crate::sources::source_clear(&db, &kind)
}

#[cfg(test)]
mod command_helper_tests {
    use super::*;

    #[test]
    fn normalize_folder_path_strips_file_uri() {
        assert_eq!(normalize_folder_path("file:///Users/x"), "/Users/x");
        assert_eq!(normalize_folder_path("/plain/path"), "/plain/path");
    }

    #[test]
    fn sanitize_ckan_q_rejects_newlines() {
        assert_eq!(sanitize_ckan_q(Some("hello".into())), Some("hello".into()));
        assert_eq!(sanitize_ckan_q(Some("bad\nline".into())), None);
    }
}
