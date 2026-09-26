// =================================================================
// Loom — Tauri IPC Bridge
// =================================================================
// Typed wrappers around `invoke()` so the frontend never constructs
// raw IPC calls. Each function maps 1:1 to a Rust #[tauri::command]
// (folder/db, Data.gov, stream_*, source_*, export helpers).
//
// In browser dev mode (no Tauri), returns mock data so the UI
// is fully functional for development and demos.
// =================================================================

import type { FileEntry, ColumnInfo, QueryResult } from "./store";
import { mockFiles, mockInspect, mockQuery } from "./mock-data";
import {
  fetchCsvTextWeb,
  fetchUkCatalogWeb,
  fetchUsCatalogWeb,
  type DataGovDataset,
  type DataGovResource,
  type DataGovSortKey,
  type FetchDataGovOptions,
} from "./openDataCatalog";

export type { DataGovDataset, DataGovResource, DataGovSortKey, FetchDataGovOptions };
export { fetchCsvTextWeb };

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(cmd, args);
  }
  throw new Error(`Tauri not available — cannot invoke "${cmd}"`);
}

/** Normalize path from dialog (strip file:// so Rust and JS see a plain path). */
function normalizePath(p: string): string {
  const s = p.trim();
  if (s.startsWith("file:///")) return s.slice(7);
  if (s.startsWith("file://")) return s.slice(6);
  return s;
}

export async function pickFolder(): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    if (selected == null) return null;
    return normalizePath(selected as string);
  }
  return "mock://demo-folder";
}

export async function scanFolder(folderPath: string): Promise<FileEntry[]> {
  if (isTauri()) {
    return invoke<FileEntry[]>("scan_folder", { folderPath });
  }
  return mockFiles;
}

export async function queryFile(
  filePath: string,
  sql: string,
  limit?: number
): Promise<QueryResult> {
  if (isTauri()) {
    return invoke<QueryResult>("query_file", { filePath, sql, limit });
  }
  return mockQuery(filePath, limit ?? 1000);
}

export async function getColumnStats(filePath: string): Promise<ColumnInfo[]> {
  if (isTauri()) {
    return invoke<ColumnInfo[]>("get_column_stats", { filePath });
  }
  return mockInspect(filePath).stats;
}

export async function getSampleRows(
  filePath: string,
  limit?: number
): Promise<QueryResult> {
  if (isTauri()) {
    return invoke<QueryResult>("get_sample_rows", { filePath, limit });
  }
  return mockQuery(filePath, limit ?? 100);
}

/**
 * Future: streaming/chunked load for large files.
 * Rust could expose get_sample_rows_chunked(filePath, offset, limit) and the
 * frontend would merge chunks and optionally virtualize the table from a
 * growing buffer.
 */

export interface InspectResult {
  stats: ColumnInfo[];
  sample: QueryResult;
}

export async function inspectFile(
  filePath: string,
  limit?: number
): Promise<InspectResult> {
  if (isTauri()) {
    return invoke<InspectResult>("inspect_file", { filePath, limit });
  }
  return mockInspect(filePath);
}

/** Download CSV from URL and save to the mounted folder (Tauri only). */
export async function saveCsvToFolder(
  folderPath: string,
  url: string,
  filename: string
): Promise<string> {
  return invoke<string>("save_csv_to_folder", {
    folderPath,
    url,
    filename,
  });
}

/** Fetch Data.gov datasets — Tauri IPC, or browser via Cloudflare `/api/catalog/us`. */
export async function fetchDataGovRecentCsv(opts?: FetchDataGovOptions): Promise<DataGovDataset[]> {
  if (isTauri()) {
    return invoke<DataGovDataset[]>("fetch_data_gov_recent_csv", {
      rows: opts?.rows ?? 40,
      query: opts?.query?.trim() || null,
      sort: opts?.sort ?? null,
    });
  }
  return fetchUsCatalogWeb(opts);
}

/** Fetch data.gov.uk datasets — Tauri IPC, or browser (CKAN CORS / Worker fallback). */
export async function fetchUkDataRecentCsv(opts?: FetchDataGovOptions): Promise<DataGovDataset[]> {
  if (isTauri()) {
    return invoke<DataGovDataset[]>("fetch_uk_data_recent_csv", {
      rows: opts?.rows ?? 40,
      query: opts?.query?.trim() || null,
      sort: opts?.sort ?? null,
    });
  }
  return fetchUkCatalogWeb(opts);
}

/** Base URL and label for a portal (for preview modal "Open on …"). */
export const OPEN_DATA_PORTALS: Record<string, { url: string; label: string }> = {
  "data.gov": { url: "https://catalog.data.gov/dataset", label: "Data.gov" },
  "data.gov.uk": { url: "https://data.gov.uk/dataset", label: "data.gov.uk" },
};

// =================================================================
// Wikipedia Live Stream IPC
// =================================================================

export interface StreamStatus {
  running: boolean;
  total_events: number;
  events_per_sec: number;
  buffer_rows: number;
  wikis_seen: number;
  started_at: number | null;
  uptime_secs: number;
}

export async function streamStart(): Promise<void> {
  if (!isTauri()) {
    const { webStreamStart } = await import("./webStreams");
    return webStreamStart();
  }
  return invoke<void>("stream_start", {});
}

export async function streamStop(): Promise<void> {
  if (!isTauri()) {
    const { webStreamStop } = await import("./webStreams");
    return webStreamStop();
  }
  return invoke<void>("stream_stop", {});
}

export async function streamStatus(): Promise<StreamStatus> {
  if (!isTauri()) {
    const { webStreamStatus } = await import("./webStreams");
    return webStreamStatus();
  }
  return invoke<StreamStatus>("stream_status", {});
}

export async function streamQuery(sql: string, limit?: number): Promise<QueryResult> {
  if (!isTauri()) {
    throw new Error("SQL on live streams needs the desktop app (DuckDB). Use Explore snapshot on web.");
  }
  return invoke<QueryResult>("stream_query", { sql, limit });
}

export async function streamSnapshot(limit?: number): Promise<InspectResult> {
  if (!isTauri()) {
    const { webStreamSnapshot } = await import("./webStreams");
    return webStreamSnapshot(limit);
  }
  return invoke<InspectResult>("stream_snapshot", { limit });
}

export async function streamClear(): Promise<void> {
  if (!isTauri()) {
    const { webStreamClear } = await import("./webStreams");
    return webStreamClear();
  }
  return invoke<void>("stream_clear", {});
}

// =================================================================
// Poll-Based Data Sources (USGS, Open-Meteo, NWS, World Bank)
// =================================================================

export type SourceKind =
  | "usgs"
  | "meteo"
  | "nws"
  | "world_bank"
  | "iss"
  | "hn"
  | "crypto";

export interface SourceStatus {
  running: boolean;
  total_events: number;
  events_per_sec: number;
  buffer_rows: number;
  started_at: number | null;
  uptime_secs: number;
}

export async function sourceStart(kind: SourceKind): Promise<void> {
  if (!isTauri()) {
    const { webSourceStart } = await import("./webStreams");
    return webSourceStart(kind);
  }
  return invoke<void>("source_start", { kind });
}

export async function sourceStop(kind: SourceKind): Promise<void> {
  if (!isTauri()) {
    const { webSourceStop } = await import("./webStreams");
    return webSourceStop(kind);
  }
  return invoke<void>("source_stop", { kind });
}

export async function sourceStatus(kind: SourceKind): Promise<SourceStatus> {
  if (!isTauri()) {
    const { webSourceStatus } = await import("./webStreams");
    return webSourceStatus(kind);
  }
  return invoke<SourceStatus>("source_status", { kind });
}

export async function sourceQuery(kind: SourceKind, sql: string, limit?: number): Promise<QueryResult> {
  if (!isTauri()) {
    throw new Error("SQL on live sources needs the desktop app (DuckDB). Use Explore snapshot on web.");
  }
  return invoke<QueryResult>("source_query", { kind, sql, limit });
}

export async function sourceSnapshot(kind: SourceKind, limit?: number): Promise<InspectResult> {
  if (!isTauri()) {
    const { webSourceSnapshot } = await import("./webStreams");
    return webSourceSnapshot(kind, limit);
  }
  return invoke<InspectResult>("source_snapshot", { kind, limit });
}

export async function sourceClear(kind: SourceKind): Promise<void> {
  if (!isTauri()) {
    const { webSourceClear } = await import("./webStreams");
    return webSourceClear(kind);
  }
  return invoke<void>("source_clear", { kind });
}

const GITHUB_REPO = "mhsenkow/Loom_story_teller";

/** Create a GitHub issue (feedback). Tauri uses GITHUB_TOKEN env; web uses Worker secret. */
export async function createGitHubIssue(
  title: string,
  body: string,
  imageBase64?: string | null
): Promise<string> {
  if (!isTauri()) {
    const { webCreateGitHubIssue } = await import("./webStreams");
    return webCreateGitHubIssue(title, body, imageBase64);
  }
  return invoke<string>("create_github_issue", {
    title,
    body,
    image_base64: imageBase64 ?? null,
  });
}

/** URL to open a new GitHub issue with pre-filled title and body (no auth). */
export function getGitHubNewIssueUrl(title: string, body: string): string {
  const params = new URLSearchParams();
  if (title.trim()) params.set("title", title.trim());
  if (body.trim()) params.set("body", body.trim());
  return `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`;
}

/** Open a URL in the default browser (Tauri only). In web, returns without doing anything; caller should use window.open. */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    await invoke<void>("open_external_url", { url });
  }
}

/** Open save-as dialog (Tauri only). Returns chosen path or null if cancelled. */
export async function saveDialog(options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: options.defaultPath,
    filters: options.filters ?? [{ name: "HTML", extensions: ["html"] }],
  });
  return path ?? null;
}

/** Write text to a file at path (Tauri only; path typically from save dialog). */
export async function writeTextFile(path: string, content: string): Promise<void> {
  if (isTauri()) {
    await invoke<void>("write_text_file", { path, content });
  }
}

/**
 * Export dashboard as microsite: Tauri = save dialog then write file;
 * Web = download as file.
 */
export async function exportDashboardMicrosite(html: string, defaultName: string): Promise<boolean> {
  const baseName = defaultName.replace(/[^\w\-.]/g, "_").replace(/.html$/i, "") || "dashboard";
  const filename = `${baseName}.html`;

  if (isTauri()) {
    const path = await saveDialog({ defaultPath: filename, filters: [{ name: "HTML", extensions: ["html"] }] });
    if (!path) return false;
    await writeTextFile(path, html);
    return true;
  }

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
