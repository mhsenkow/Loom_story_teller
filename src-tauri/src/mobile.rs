// =================================================================
// Loom — iOS / Android shell (web-parity)
// =================================================================
// Mobile builds skip DuckDB, folder mount, and Rust stream/source
// polling. The WKWebView loads the same static UI as loom.ibm.io;
// live feeds and file pick use the existing browser code paths.
// =================================================================

use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

/// Allow only http(s) and mailto — reject file:, custom schemes, and bare paths.
fn is_allowed_external_url(url: &str) -> bool {
    let url = url.trim();
    if url.is_empty() {
        return false;
    }
    if url.starts_with('/') || url.starts_with('\\') {
        return false;
    }
    let Some(colon) = url.find(':') else {
        return false;
    };
    if !url[..colon].bytes().all(|b| b.is_ascii_alphabetic()) {
        return false;
    }
    let scheme = url[..colon].to_ascii_lowercase();
    matches!(scheme.as_str(), "http" | "https" | "mailto")
}

/// Open a URL in Safari / the system browser.
#[tauri::command]
pub async fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("URL is empty".to_string());
    }
    if !is_allowed_external_url(&url) {
        return Err("URL scheme not allowed (use http, https, or mailto)".to_string());
    }
    app.shell()
        .open(&url, None)
        .map_err(|e| format!("Failed to open URL: {}", e))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![open_external_url])
        .run(tauri::generate_context!())
        .expect("error while running Loom (mobile)");
}
