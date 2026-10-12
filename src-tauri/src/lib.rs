// =================================================================
// Loom — Tauri Application Library
// =================================================================
// Entry point for the Tauri backend. Registers all IPC commands
// and initializes plugins (fs, dialog, shell).
//
// Architecture:
//   Desktop: Frontend (Next.js) --invoke--> Tauri Commands ---> DuckDB
//   Mobile:  Frontend uses web data paths; shell only opens URLs.
// =================================================================

#[cfg(not(mobile))]
mod commands;
#[cfg(not(mobile))]
mod db;
#[cfg(not(mobile))]
mod http_client;
#[cfg(not(mobile))]
mod path_gate;
#[cfg(not(mobile))]
mod query_engine;
#[cfg(not(mobile))]
mod sources;
#[cfg(not(mobile))]
mod sql_policy;
#[cfg(not(mobile))]
mod stream;

#[cfg(mobile)]
mod mobile;

#[cfg(not(mobile))]
use std::sync::Arc;
#[cfg(not(mobile))]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(mobile)]
    {
        mobile::run();
        return;
    }

    #[cfg(not(mobile))]
    {
        tauri::Builder::default()
            .plugin(tauri_plugin_fs::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_shell::init())
            .plugin(
                tauri_plugin_log::Builder::new()
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::LogDir {
                            file_name: Some("loom".into()),
                        },
                    ))
                    .build(),
            )
            .setup(|app| {
                use tauri_plugin_dialog::DialogExt;
                let handle = app.handle().clone();
                let db = match db::LoomDb::new() {
                    Ok(db) => db,
                    Err(e) => {
                        let msg = format!(
                            "DuckDB failed to start — Loom cannot open local files.\n\n{}",
                            e
                        );
                        app.dialog()
                            .message(&msg)
                            .title("Loom could not start")
                            .blocking_show();
                        return Err(msg.into());
                    }
                };
                // Create source tables up front (and rebuild any whose schema drifted
                // from the registry) so status / snapshot calls never hit a missing table.
                if let Err(e) = sources::ensure_tables(&db) {
                    log::error!(target: "loom", "source tables: {e}");
                }
                if let Err(e) = stream::ensure_stream_table(&db) {
                    log::error!(target: "loom", "wiki_stream table: {e}");
                }
                let http = match http_client::build_loom_http() {
                    Ok(h) => h,
                    Err(e) => {
                        log::error!(target: "loom", "HTTP client: {e}");
                        return Err(e.into());
                    }
                };
                let db = Arc::new(db);
                let stream_state = Arc::new(stream::StreamState::new());
                let sources_state = Arc::new(sources::SourcesState::new_with_client(
                    http.client().clone(),
                ));
                let write_gate = Arc::new(path_gate::WritePathGate::new());
                let mounted = Arc::new(path_gate::MountedFolder::new());
                handle.manage(db);
                handle.manage(http);
                handle.manage(stream_state);
                handle.manage(sources_state);
                handle.manage(write_gate);
                handle.manage(mounted);
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                commands::scan_folder,
                commands::query_file,
                commands::get_column_stats,
                commands::get_sample_rows,
                commands::inspect_file,
                commands::save_csv_to_folder,
                commands::pick_save_path,
                commands::fetch_data_gov_recent_csv,
                commands::fetch_uk_data_recent_csv,
                commands::create_github_issue,
                commands::open_external_url,
                commands::write_text_file,
                commands::write_binary_file,
                commands::reveal_in_finder,
                commands::stream_start,
                commands::stream_stop,
                commands::stream_status,
                commands::stream_query,
                commands::stream_snapshot,
                commands::stream_clear,
                commands::source_start,
                commands::source_stop,
                commands::source_status,
                commands::source_query,
                commands::source_snapshot,
                commands::source_clear,
            ])
            .run(tauri::generate_context!())
            .expect("error while running Loom");
    }
}
