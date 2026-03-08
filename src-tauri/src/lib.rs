// =================================================================
// Loom — Tauri Application Library
// =================================================================
// Entry point for the Tauri backend. Registers all IPC commands
// and initializes plugins (fs, dialog, shell).
//
// Architecture:
//   Frontend (Next.js) --invoke--> Tauri Commands ---> DuckDB
//   The Rust side owns data access; the JS side owns the UI.
// =================================================================

mod db;
mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            // Initialize the database pool on startup
            let db = db::LoomDb::new().expect("Failed to initialize DuckDB");
            handle.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_folder,
            commands::query_file,
            commands::get_column_stats,
            commands::get_sample_rows,
            commands::inspect_file,
            commands::save_csv_to_folder,
            commands::fetch_data_gov_recent_csv,
            commands::fetch_uk_data_recent_csv,
            commands::create_github_issue,
            commands::open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Loom");
}
