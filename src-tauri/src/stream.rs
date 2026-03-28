// =================================================================
// Loom — Wikimedia Live Stream Ingestion
// =================================================================
// Connects to Wikimedia EventStreams (Server-Sent Events) and
// buffers edit events into DuckDB for Scuba-style interactive
// analytics: time bucketing, breakdowns by wiki/namespace/bot,
// anomaly detection, and live dashboards.
//
// Architecture:
//   Frontend starts/stops the stream via IPC commands.
//   A background tokio task reads SSE, parses JSON, and
//   batch-inserts rows into a DuckDB table `wiki_stream`.
//   The frontend polls `stream_snapshot` to get current data.
// =================================================================

use crate::db::{ColumnInfo, LoomDb, QueryResult};
use duckdb::params;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

const STREAM_URL: &str = "https://stream.wikimedia.org/v2/stream/recentchange";
const MAX_BUFFER_ROWS: usize = 50_000;
const BATCH_INSERT_SIZE: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WikiEditEvent {
    pub id: i64,
    pub wiki: String,
    pub title: String,
    pub user: String,
    pub bot: bool,
    pub minor: bool,
    pub namespace: i32,
    pub edit_type: String,
    pub old_len: i64,
    pub new_len: i64,
    pub delta: i64,
    pub timestamp: i64,
    pub server_name: String,
    pub comment: String,
}

#[derive(Debug, Serialize)]
pub struct StreamStatus {
    pub running: bool,
    pub total_events: u64,
    pub events_per_sec: f64,
    pub buffer_rows: u64,
    pub wikis_seen: u32,
    pub started_at: Option<i64>,
    pub uptime_secs: f64,
}

pub struct StreamState {
    pub running: Arc<AtomicBool>,
    pub total_events: Arc<std::sync::atomic::AtomicU64>,
    pub started_at: Arc<TokioMutex<Option<i64>>>,
    pub cancel_token: Arc<TokioMutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    events_last_check: Arc<TokioMutex<(u64, std::time::Instant)>>,
}

impl StreamState {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            total_events: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            started_at: Arc::new(TokioMutex::new(None)),
            cancel_token: Arc::new(TokioMutex::new(None)),
            events_last_check: Arc::new(TokioMutex::new((0, std::time::Instant::now()))),
        }
    }

    pub async fn status(&self, db: &LoomDb) -> StreamStatus {
        let running = self.running.load(Ordering::Relaxed);
        let total = self.total_events.load(Ordering::Relaxed);
        let started = *self.started_at.lock().await;
        let uptime = started
            .map(|s| {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64;
                (now - s).max(0) as f64
            })
            .unwrap_or(0.0);

        let mut last = self.events_last_check.lock().await;
        let elapsed = last.1.elapsed().as_secs_f64().max(0.001);
        let delta = total.saturating_sub(last.0);
        let eps = delta as f64 / elapsed;
        *last = (total, std::time::Instant::now());

        let buffer_rows = db
            .conn
            .lock()
            .ok()
            .and_then(|c| {
                c.query_row(
                    "SELECT COUNT(*) FROM wiki_stream",
                    params![],
                    |r| r.get::<_, i64>(0),
                )
                .ok()
            })
            .unwrap_or(0) as u64;

        let wikis_seen = db
            .conn
            .lock()
            .ok()
            .and_then(|c| {
                c.query_row(
                    "SELECT COUNT(DISTINCT wiki) FROM wiki_stream",
                    params![],
                    |r| r.get::<_, i64>(0),
                )
                .ok()
            })
            .unwrap_or(0) as u32;

        StreamStatus {
            running,
            total_events: total,
            events_per_sec: (eps * 10.0).round() / 10.0,
            buffer_rows,
            wikis_seen,
            started_at: started,
            uptime_secs: uptime,
        }
    }
}

pub fn ensure_stream_table(db: &LoomDb) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS wiki_stream (
            id BIGINT,
            wiki VARCHAR,
            title VARCHAR,
            \"user\" VARCHAR,
            bot BOOLEAN,
            minor BOOLEAN,
            namespace INTEGER,
            edit_type VARCHAR,
            old_len BIGINT,
            new_len BIGINT,
            delta BIGINT,
            ts TIMESTAMP,
            server_name VARCHAR,
            comment VARCHAR
        )",
    )
    .map_err(|e| e.to_string())
}

fn parse_sse_event(data: &str) -> Option<WikiEditEvent> {
    let v: serde_json::Value = serde_json::from_str(data).ok()?;
    let obj = v.as_object()?;
    let meta = obj.get("meta")?.as_object()?;
    let id_str = meta.get("id")?.as_str().unwrap_or("0");
    let id: i64 = id_str
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .unwrap_or(0);

    Some(WikiEditEvent {
        id,
        wiki: obj.get("wiki")?.as_str()?.to_string(),
        title: obj.get("title")?.as_str().unwrap_or("").to_string(),
        user: obj.get("user")?.as_str().unwrap_or("anonymous").to_string(),
        bot: obj.get("bot").and_then(|v| v.as_bool()).unwrap_or(false),
        minor: obj.get("minor").and_then(|v| v.as_bool()).unwrap_or(false),
        namespace: obj
            .get("namespace")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32,
        edit_type: obj.get("type")?.as_str().unwrap_or("edit").to_string(),
        old_len: obj
            .get("length")
            .and_then(|l| l.get("old"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0),
        new_len: obj
            .get("length")
            .and_then(|l| l.get("new"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0),
        delta: obj
            .get("length")
            .and_then(|l| {
                let n = l.get("new")?.as_i64()?;
                let o = l.get("old")?.as_i64()?;
                Some(n - o)
            })
            .unwrap_or(0),
        timestamp: obj.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0),
        server_name: obj
            .get("server_name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        comment: obj
            .get("comment")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

fn batch_insert(db: &LoomDb, events: &[WikiEditEvent]) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "INSERT INTO wiki_stream (id, wiki, title, \"user\", bot, minor, namespace, edit_type, old_len, new_len, delta, ts, server_name, comment)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, to_timestamp(?), ?, ?)",
        )
        .map_err(|e| e.to_string())?;

    for ev in events {
        let _ = stmt.execute(params![
            ev.id,
            ev.wiki,
            ev.title,
            ev.user,
            ev.bot,
            ev.minor,
            ev.namespace,
            ev.edit_type,
            ev.old_len,
            ev.new_len,
            ev.delta,
            ev.timestamp,
            ev.server_name,
            ev.comment,
        ]);
    }
    Ok(())
}

fn trim_buffer(db: &LoomDb) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM wiki_stream", params![], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;

    if count > MAX_BUFFER_ROWS as i64 {
        let excess = count - MAX_BUFFER_ROWS as i64;
        conn.execute_batch(&format!(
            "DELETE FROM wiki_stream WHERE rowid IN (SELECT rowid FROM wiki_stream ORDER BY ts ASC LIMIT {})",
            excess
        ))
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn start_stream(
    db: Arc<LoomDb>,
    state: Arc<StreamState>,
) -> Result<(), String> {
    if state.running.load(Ordering::Relaxed) {
        return Err("Stream already running".to_string());
    }

    ensure_stream_table(&db)?;

    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    *state.cancel_token.lock().await = Some(cancel_tx);

    state.running.store(true, Ordering::Relaxed);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    *state.started_at.lock().await = Some(now);
    state.total_events.store(0, Ordering::Relaxed);

    let db_clone = db.clone();
    let state_clone = state.clone();

    tokio::spawn(async move {
        let client = match reqwest::Client::builder()
            .user_agent("Loom-Data-Storyteller/1.0 (local analytics tool)")
            .build()
        {
            Ok(c) => c,
            Err(_) => {
                state_clone.running.store(false, Ordering::Relaxed);
                return;
            }
        };

        let response = match client.get(STREAM_URL).send().await {
            Ok(r) => r,
            Err(_) => {
                state_clone.running.store(false, Ordering::Relaxed);
                return;
            }
        };

        let mut buffer: Vec<WikiEditEvent> = Vec::with_capacity(BATCH_INSERT_SIZE);
        let mut data_buf = String::new();
        let mut bytes_stream = response.bytes_stream();
        use futures_util::StreamExt;
        let mut trim_counter: u32 = 0;

        loop {
            tokio::select! {
                _ = &mut cancel_rx => break,
                chunk = bytes_stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            let text = String::from_utf8_lossy(&bytes);
                            for line in text.lines() {
                                if line.starts_with("data: ") {
                                    data_buf.clear();
                                    data_buf.push_str(&line[6..]);
                                    if let Some(ev) = parse_sse_event(&data_buf) {
                                        buffer.push(ev);
                                        state_clone.total_events.fetch_add(1, Ordering::Relaxed);

                                        if buffer.len() >= BATCH_INSERT_SIZE {
                                            let _ = batch_insert(&db_clone, &buffer);
                                            buffer.clear();
                                            trim_counter += 1;
                                            if trim_counter % 20 == 0 {
                                                let _ = trim_buffer(&db_clone);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Some(Err(_)) | None => break,
                    }
                }
            }
        }

        if !buffer.is_empty() {
            let _ = batch_insert(&db_clone, &buffer);
        }
        state_clone.running.store(false, Ordering::Relaxed);
    });

    Ok(())
}

pub async fn stop_stream(state: Arc<StreamState>) -> Result<(), String> {
    if let Some(tx) = state.cancel_token.lock().await.take() {
        let _ = tx.send(());
    }
    state.running.store(false, Ordering::Relaxed);
    *state.started_at.lock().await = None;
    Ok(())
}

pub fn query_stream(
    db: &LoomDb,
    sql: &str,
    limit: u32,
) -> Result<QueryResult, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute_batch("CREATE OR REPLACE TEMP VIEW loom_active AS SELECT * FROM wiki_stream")
        .map_err(|e| e.to_string())?;

    let full_sql = if sql.trim().is_empty() {
        format!("SELECT * FROM wiki_stream ORDER BY ts DESC LIMIT {}", limit)
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
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut columns = Vec::new();
    let mut types = Vec::new();
    for mr in meta_rows.flatten() {
        columns.push(mr.0);
        types.push(mr.1);
    }

    let col_count = columns.len();
    let mut stmt = conn.prepare(&full_sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![], |row| {
            let mut row_vec = Vec::new();
            for i in 0..col_count {
                let val: duckdb::types::Value = row.get(i)?;
                row_vec.push(crate::db::duckdb_value_to_json(val));
            }
            Ok(row_vec)
        })
        .map_err(|e| e.to_string())?;

    let mut rows_out = Vec::new();
    for row in rows.flatten() {
        rows_out.push(row);
    }
    let total = rows_out.len() as u64;

    Ok(QueryResult {
        columns,
        types,
        rows: rows_out,
        total_rows: total,
    })
}

pub fn stream_column_stats(db: &LoomDb) -> Result<Vec<ColumnInfo>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM wiki_stream", params![], |r| r.get(0))
        .unwrap_or(0);
    if count == 0 {
        return Ok(vec![]);
    }

    conn.execute_batch("CREATE OR REPLACE TEMP VIEW loom_stats AS SELECT * FROM wiki_stream")
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("DESCRIBE loom_stats")
        .map_err(|e| e.to_string())?;
    let schema_rows = stmt
        .query_map(params![], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in schema_rows.flatten() {
        let (col_name, data_type) = row;
        let col_q = format!("\"{}\"", col_name.replace('"', "\"\""));
        let stats_sql = format!(
            "SELECT COUNT(*) - COUNT({0}) AS nulls, APPROX_COUNT_DISTINCT({0}) AS dist, TRY_CAST(MIN({0}) AS VARCHAR), TRY_CAST(MAX({0}) AS VARCHAR) FROM loom_stats",
            col_q
        );
        if let Ok(mut s) = conn.prepare(&stats_sql) {
            if let Ok(info) = s.query_row(params![], |sr| {
                Ok(ColumnInfo {
                    name: col_name.clone(),
                    data_type: data_type.clone(),
                    null_count: sr.get::<_, i64>(0).unwrap_or(0) as u64,
                    distinct_count: sr.get::<_, i64>(1).unwrap_or(0) as u64,
                    min_value: sr.get::<_, Option<String>>(2).unwrap_or(None),
                    max_value: sr.get::<_, Option<String>>(3).unwrap_or(None),
                })
            }) {
                out.push(info);
            }
        }
    }
    Ok(out)
}
