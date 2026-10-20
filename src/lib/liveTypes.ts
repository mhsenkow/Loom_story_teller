// =================================================================
// Loom — live stream / poll source shapes shared by IPC and web buffers
// (DOM-free; re-exported from tauri.ts)
// =================================================================

import type { ColumnInfo, QueryResult } from "./queryTypes";

export interface InspectResult {
  stats: ColumnInfo[];
  sample: QueryResult;
}

export interface StreamStatus {
  running: boolean;
  total_events: number;
  events_per_sec: number;
  buffer_rows: number;
  wikis_seen: number;
  started_at: number | null;
  uptime_secs: number;
}

export interface SourceStatus {
  running: boolean;
  total_events: number;
  events_per_sec: number;
  buffer_rows: number;
  started_at: number | null;
  uptime_secs: number;
  /** Web: last upstream failure while polling (null once a poll succeeds). */
  last_error?: string | null;
  /** Web: wall-clock ms when the buffer last accepted a successful poll. */
  last_success_at?: number | null;
  /** Desktop poll success, Unix seconds (normalized by discovery at its boundary). */
  last_ok_at?: number | null;
  /** Web: rows are from a cached snapshot — not a current live measurement. */
  snapshot_stale?: boolean;
  /** Web: ms when the cached snapshot was captured (if snapshot_stale). */
  snapshot_captured_at?: number | null;
}
