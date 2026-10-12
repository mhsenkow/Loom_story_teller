// =================================================================
// Loom — Wikimedia Live Stream Ingestion
// =================================================================

use crate::db::{ColumnInfo, LoomDb, QueryResult};
use crate::http_client::build_loom_sse_client;
use crate::query_engine;
use duckdb::types::{TimeUnit, Value as DbValue};
use duckdb::{appender_params_from_iter, params};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex as TokioMutex;
use tokio::task::JoinHandle;

const STREAM_URL: &str = "https://stream.wikimedia.org/v2/stream/recentchange";
const MAX_BUFFER_ROWS: usize = 50_000;
const BATCH_INSERT_SIZE: usize = 50;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const SSE_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_BACKOFF_SECS: u64 = 30;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

pub struct StreamState {
    pub running: Arc<AtomicBool>,
    pub total_events: Arc<AtomicU64>,
    pub started_at: Arc<TokioMutex<Option<i64>>>,
    cancel_token: Arc<TokioMutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    cancel_flag: Arc<AtomicBool>,
    events_last_check: Arc<TokioMutex<(u64, std::time::Instant)>>,
    generation: Arc<AtomicU64>,
    worker: Arc<TokioMutex<Option<(u64, JoinHandle<()>)>>>,
    last_error: Arc<TokioMutex<Option<String>>>,
}

impl StreamState {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            total_events: Arc::new(AtomicU64::new(0)),
            started_at: Arc::new(TokioMutex::new(None)),
            cancel_token: Arc::new(TokioMutex::new(None)),
            cancel_flag: Arc::new(AtomicBool::new(false)),
            events_last_check: Arc::new(TokioMutex::new((0, std::time::Instant::now()))),
            generation: Arc::new(AtomicU64::new(0)),
            worker: Arc::new(TokioMutex::new(None)),
            last_error: Arc::new(TokioMutex::new(None)),
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
                c.query_row("SELECT COUNT(*) FROM wiki_stream", params![], |r| {
                    r.get::<_, i64>(0)
                })
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
            last_error: self.last_error.lock().await.clone(),
        }
    }
}

pub fn ensure_stream_table(db: &LoomDb) -> Result<(), String> {
    let conn = db.lock_connection();
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

pub(crate) fn parse_sse_event(data: &str) -> Option<WikiEditEvent> {
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
        namespace: obj.get("namespace").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
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

/// Append raw SSE bytes and return complete decoded lines (UTF-8 safe across chunk boundaries).
pub(crate) fn drain_sse_lines(line_buf: &mut Vec<u8>, chunk: &[u8]) -> Vec<String> {
    line_buf.extend_from_slice(chunk);
    let mut out = Vec::new();
    while let Some(pos) = line_buf.iter().position(|&b| b == b'\n') {
        let mut line_bytes: Vec<u8> = line_buf.drain(..=pos).collect();
        line_bytes.pop();
        if line_bytes.last() == Some(&b'\r') {
            line_bytes.pop();
        }
        let line = match std::str::from_utf8(&line_bytes) {
            Ok(s) => s.to_string(),
            Err(_) => String::from_utf8_lossy(&line_bytes).into_owned(),
        };
        out.push(line);
    }
    out
}

pub(crate) fn reconnect_backoff_secs(attempt: u32) -> u64 {
    (1u64 << attempt.min(5)).min(MAX_BACKOFF_SECS)
}

pub(crate) fn should_clear_running(task_generation: u64, current_generation: u64) -> bool {
    task_generation == current_generation
}

fn batch_insert(db: &LoomDb, events: &[WikiEditEvent]) -> Result<(), String> {
    if events.is_empty() {
        return Ok(());
    }
    let conn = db.lock_connection();
    conn.execute_batch("BEGIN TRANSACTION")
        .map_err(|e| e.to_string())?;
    let result = (|| {
        let mut appender = conn.appender("wiki_stream").map_err(|e| e.to_string())?;
        for ev in events {
            appender
                .append_row(appender_params_from_iter([
                    DbValue::BigInt(ev.id),
                    DbValue::Text(ev.wiki.clone()),
                    DbValue::Text(ev.title.clone()),
                    DbValue::Text(ev.user.clone()),
                    DbValue::Boolean(ev.bot),
                    DbValue::Boolean(ev.minor),
                    DbValue::Int(ev.namespace),
                    DbValue::Text(ev.edit_type.clone()),
                    DbValue::BigInt(ev.old_len),
                    DbValue::BigInt(ev.new_len),
                    DbValue::BigInt(ev.delta),
                    DbValue::Timestamp(
                        TimeUnit::Microsecond,
                        ev.timestamp.saturating_mul(1_000_000),
                    ),
                    DbValue::Text(ev.server_name.clone()),
                    DbValue::Text(ev.comment.clone()),
                ]))
                .map_err(|e| e.to_string())?;
        }
        appender.flush().map_err(|e| e.to_string())
    })();
    match result {
        Ok(()) => conn.execute_batch("COMMIT").map_err(|e| e.to_string())?,
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(e);
        }
    }
    Ok(())
}

fn trim_buffer(db: &LoomDb) -> Result<(), String> {
    let conn = db.lock_connection();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM wiki_stream", params![], |r| r.get(0))
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

async fn probe_stream_connect(client: &reqwest::Client) -> Result<(), String> {
    let response = client
        .get(STREAM_URL)
        .header("Accept", "text/event-stream")
        .timeout(CONNECT_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("Stream connect failed: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Stream connect failed: HTTP {}", response.status()));
    }
    Ok(())
}

pub async fn start_stream(db: Arc<LoomDb>, state: Arc<StreamState>) -> Result<(), String> {
    if state
        .running
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
        .is_err()
    {
        return Err("Stream already running".to_string());
    }

    ensure_stream_table(&db)?;
    *state.last_error.lock().await = None;

    let client = build_loom_sse_client()?;
    if let Err(e) = probe_stream_connect(&client).await {
        state.running.store(false, Ordering::Relaxed);
        *state.last_error.lock().await = Some(e.clone());
        return Err(e);
    }

    if let Some((_, handle)) = state.worker.lock().await.take() {
        handle.abort();
    }

    let my_gen = state.generation.fetch_add(1, Ordering::AcqRel) + 1;
    state.cancel_flag.store(false, Ordering::Relaxed);
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    *state.cancel_token.lock().await = Some(cancel_tx);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    *state.started_at.lock().await = Some(now);
    state.total_events.store(0, Ordering::Relaxed);

    let db_clone = db.clone();
    let state_clone = state.clone();
    let cancel_flag = state.cancel_flag.clone();
    let handle = tokio::spawn(async move {
        run_stream_worker(
            db_clone,
            state_clone,
            client,
            cancel_rx,
            cancel_flag,
            my_gen,
        )
        .await;
    });
    *state.worker.lock().await = Some((my_gen, handle));

    Ok(())
}

async fn run_stream_worker(
    db: Arc<LoomDb>,
    state: Arc<StreamState>,
    client: reqwest::Client,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
    cancel_flag: Arc<AtomicBool>,
    my_gen: u64,
) {
    let mut buffer: Vec<WikiEditEvent> = Vec::with_capacity(BATCH_INSERT_SIZE);
    let mut line_buf: Vec<u8> = Vec::new();
    let mut last_event_id: Option<String> = None;
    let mut reconnect_attempt: u32 = 0;
    let mut trim_counter: u32 = 0;

    'reconnect: loop {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }
        if state.generation.load(Ordering::Acquire) != my_gen {
            break;
        }

        let mut req = client.get(STREAM_URL).header("Accept", "text/event-stream");
        if let Some(ref id) = last_event_id {
            req = req.header("Last-Event-ID", id);
        }

        let response = match req.send().await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                let msg = format!("Stream HTTP {}", r.status());
                log::warn!("wiki stream: {}", msg);
                *state.last_error.lock().await = Some(msg);
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                let wait = reconnect_backoff_secs(reconnect_attempt);
                tokio::select! {
                    _ = &mut cancel_rx => break 'reconnect,
                    _ = tokio::time::sleep(Duration::from_secs(wait)) => continue 'reconnect,
                }
            }
            Err(e) => {
                let msg = format!("Stream read failed: {}", e);
                log::warn!("wiki stream: {}", msg);
                *state.last_error.lock().await = Some(msg);
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                let wait = reconnect_backoff_secs(reconnect_attempt);
                tokio::select! {
                    _ = &mut cancel_rx => break 'reconnect,
                    _ = tokio::time::sleep(Duration::from_secs(wait)) => continue 'reconnect,
                }
            }
        };

        reconnect_attempt = 0;
        *state.last_error.lock().await = None;
        let mut bytes_stream = response.bytes_stream();

        loop {
            tokio::select! {
                _ = &mut cancel_rx => break 'reconnect,
                chunk = tokio::time::timeout(SSE_IDLE_TIMEOUT, bytes_stream.next()) => {
                    match chunk {
                        Err(_) => {
                            let msg = format!("Stream idle for {}s; reconnecting", SSE_IDLE_TIMEOUT.as_secs());
                            log::warn!("wiki stream: {}", msg);
                            *state.last_error.lock().await = Some(msg);
                            continue 'reconnect;
                        }
                        Ok(chunk) => match chunk {
                        Some(Ok(bytes)) => {
                            for line in drain_sse_lines(&mut line_buf, &bytes) {
                                if let Some(id) = line.strip_prefix("id: ") {
                                    last_event_id = Some(id.trim().to_string());
                                    continue;
                                }
                                if line.starts_with("data: ") {
                                    let payload = line[6..].trim();
                                    if let Some(ev) = parse_sse_event(payload) {
                                        buffer.push(ev);
                                        state.total_events.fetch_add(1, Ordering::Relaxed);
                                        if buffer.len() >= BATCH_INSERT_SIZE {
                                            let _ = batch_insert(&db, &buffer);
                                            buffer.clear();
                                            trim_counter += 1;
                                            if trim_counter % 20 == 0 {
                                                let _ = trim_buffer(&db);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Some(Err(e)) => {
                            log::warn!("wiki stream chunk error: {}", e);
                            continue 'reconnect;
                        }
                        None => {
                            log::warn!("wiki stream EOF — reconnecting");
                            continue 'reconnect;
                        }
                        }
                    }
                }
            }
        }
    }

    if !buffer.is_empty() {
        let _ = batch_insert(&db, &buffer);
    }
    if should_clear_running(my_gen, state.generation.load(Ordering::Acquire)) {
        state.running.store(false, Ordering::Relaxed);
    }
}

pub async fn stop_stream(state: Arc<StreamState>) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::Relaxed);
    if let Some(tx) = state.cancel_token.lock().await.take() {
        let _ = tx.send(());
    }
    if let Some((_, handle)) = state.worker.lock().await.take() {
        handle.abort();
    }
    state.generation.fetch_add(1, Ordering::AcqRel);
    state.running.store(false, Ordering::Relaxed);
    *state.started_at.lock().await = None;
    Ok(())
}

pub fn query_stream(db: &LoomDb, sql: &str, limit: u32) -> Result<QueryResult, String> {
    crate::sql_policy::validate_user_sql(sql)?;
    let conn = db.lock_connection();
    conn.execute_batch("CREATE OR REPLACE TEMP VIEW loom_active AS SELECT * FROM wiki_stream")
        .map_err(|e| e.to_string())?;
    query_engine::run_user_query(
        &conn,
        sql,
        limit,
        "SELECT * FROM wiki_stream ORDER BY ts DESC LIMIT {limit}",
    )
}

pub fn stream_column_stats(db: &LoomDb) -> Result<Vec<ColumnInfo>, String> {
    let conn = db.lock_connection();
    query_engine::column_stats_for_table(&conn, "wiki_stream")
}

#[cfg(test)]
mod stream_tests {
    use super::*;

    #[test]
    fn parse_sse_event_extracts_edit() {
        let data = r#"{"meta":{"id":"12345"},"wiki":"enwiki","title":"Earth","user":"alice","bot":false,"minor":true,"namespace":0,"type":"edit","length":{"old":100,"new":110},"timestamp":1700000000,"server_name":"mw123","comment":"fix typo"}"#;
        let ev = parse_sse_event(data).expect("parsed");
        assert_eq!(ev.id, 12345);
        assert_eq!(ev.title, "Earth");
        assert_eq!(ev.delta, 10);
    }

    #[test]
    fn parse_sse_event_rejects_garbage() {
        assert!(parse_sse_event("not json").is_none());
        assert!(parse_sse_event("{}").is_none());
    }

    #[test]
    fn utf8_split_across_chunks_stays_intact() {
        let title = "日本語";
        let bytes = title.as_bytes();
        let mut buf = Vec::new();
        let a = drain_sse_lines(&mut buf, &bytes[..2]);
        assert!(a.is_empty());
        let b = drain_sse_lines(&mut buf, &bytes[2..]);
        assert!(b.is_empty());
        let c = drain_sse_lines(&mut buf, b"\n");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0], title);
    }

    #[test]
    fn reconnect_backoff_caps() {
        assert_eq!(reconnect_backoff_secs(0), 1);
        assert_eq!(reconnect_backoff_secs(10), MAX_BACKOFF_SECS);
    }

    #[test]
    fn generation_gate_only_own_task_clears_running() {
        assert!(should_clear_running(3, 3));
        assert!(!should_clear_running(3, 4));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn start_stop_start_keeps_single_worker_generation() {
        let db = Arc::new(LoomDb::new().unwrap());
        let state = Arc::new(StreamState::new());
        ensure_stream_table(&db).unwrap();
        state.generation.store(1, Ordering::Relaxed);
        state.running.store(true, Ordering::Relaxed);
        let running = state.running.clone();
        let stale = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            if should_clear_running(1, 2) {
                running.store(false, Ordering::Relaxed);
            }
        });
        state.generation.store(2, Ordering::Relaxed);
        state.running.store(true, Ordering::Relaxed);
        stale.await.unwrap();
        assert!(state.running.load(Ordering::Relaxed));
    }
}
