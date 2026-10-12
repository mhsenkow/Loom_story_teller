// =================================================================
// Loom — Tauri IPC Bridge
// =================================================================
// Typed wrappers around `invoke()` so the frontend never constructs
// raw IPC calls. Each function maps 1:1 to a Rust #[tauri::command]
// (folder/db, Data.gov, stream_*, source_*, export helpers).
//
// Desktop Tauri → DuckDB IPC. Browser and the iOS/Android shell share
// the web data path (webStreams, catalog proxy, file pick / upload).
// =================================================================

import type { FileEntry, ColumnInfo, QueryResult } from "./store";
async function webMockData() {
  return import("./mock-data");
}
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

/** True inside any Tauri shell (macOS desktop or iOS/Android). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** iPhone / iPad / Android — including iPadOS that reports as MacIntel. */
export function isMobileOs(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return true;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  if (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1) return true;
  return false;
}

/**
 * Desktop app with DuckDB / folder mount.
 * False in the browser and in the iPad/iPhone Tauri shell (web-parity).
 */
export function isDesktop(): boolean {
  return isTauri() && !isMobileOs();
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
  if (isDesktop()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    if (selected == null) return null;
    return normalizePath(selected as string);
  }
  return "mock://demo-folder";
}

export async function scanFolder(folderPath: string): Promise<FileEntry[]> {
  if (isDesktop()) {
    return invoke<FileEntry[]>("scan_folder", { folderPath });
  }
  const { getMockFiles } = await webMockData();
  return getMockFiles();
}

export const WEB_FILE_SQL_ERROR =
  "SQL on uploaded files needs the desktop app (DuckDB). Use Explore on web.";

export async function queryFile(
  filePath: string,
  sql: string,
  limit?: number
): Promise<QueryResult> {
  if (isDesktop()) {
    return invoke<QueryResult>("query_file", { filePath, sql, limit });
  }
  void filePath;
  void sql;
  void limit;
  throw new Error(WEB_FILE_SQL_ERROR);
}

export async function getColumnStats(filePath: string): Promise<ColumnInfo[]> {
  if (isDesktop()) {
    return invoke<ColumnInfo[]>("get_column_stats", { filePath });
  }
  const { mockInspect } = await webMockData();
  return mockInspect(filePath).stats;
}

export async function getSampleRows(
  filePath: string,
  limit?: number
): Promise<QueryResult> {
  if (isDesktop()) {
    return invoke<QueryResult>("get_sample_rows", { filePath, limit });
  }
  const { mockQuery } = await webMockData();
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
  if (isDesktop()) {
    return invoke<InspectResult>("inspect_file", { filePath, limit });
  }
  const { mockInspect } = await webMockData();
  return mockInspect(filePath);
}

/** Download CSV from URL and save to the mounted folder (desktop only). */
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

/** Fetch Data.gov datasets — desktop IPC, or browser/iOS via Cloudflare `/api/catalog/us`. */
export async function fetchDataGovRecentCsv(opts?: FetchDataGovOptions): Promise<DataGovDataset[]> {
  if (isDesktop()) {
    return invoke<DataGovDataset[]>("fetch_data_gov_recent_csv", {
      rows: opts?.rows ?? 40,
      query: opts?.query?.trim() || null,
      sort: opts?.sort ?? null,
    });
  }
  return fetchUsCatalogWeb(opts);
}

/** Fetch data.gov.uk datasets — desktop IPC, or browser/iOS (CKAN CORS / Worker fallback). */
export async function fetchUkDataRecentCsv(opts?: FetchDataGovOptions): Promise<DataGovDataset[]> {
  if (isDesktop()) {
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
  if (!isDesktop()) {
    const { webStreamStart } = await import("./webStreams");
    return webStreamStart();
  }
  return invoke<void>("stream_start", {});
}

export async function streamStop(): Promise<void> {
  if (!isDesktop()) {
    const { webStreamStop } = await import("./webStreams");
    return webStreamStop();
  }
  return invoke<void>("stream_stop", {});
}

export async function streamStatus(): Promise<StreamStatus> {
  if (!isDesktop()) {
    const { webStreamStatus } = await import("./webStreams");
    return webStreamStatus();
  }
  return invoke<StreamStatus>("stream_status", {});
}

export async function streamQuery(sql: string, limit?: number): Promise<QueryResult> {
  if (!isDesktop()) {
    throw new Error("SQL on live streams needs the desktop app (DuckDB). Use Explore snapshot on web.");
  }
  return invoke<QueryResult>("stream_query", { sql, limit });
}

export async function streamSnapshot(limit?: number): Promise<InspectResult> {
  if (!isDesktop()) {
    const { webStreamSnapshot } = await import("./webStreams");
    return webStreamSnapshot(limit);
  }
  return invoke<InspectResult>("stream_snapshot", { limit });
}

export async function streamClear(): Promise<void> {
  if (!isDesktop()) {
    const { webStreamClear } = await import("./webStreams");
    return webStreamClear();
  }
  return invoke<void>("stream_clear", {});
}

// =================================================================
// Poll-Based Data Sources (see sourceRegistry.ts)
// =================================================================

export type { SourceKind } from "./sourceRegistry";
import { SOURCE_KINDS, type SourceKind } from "./sourceRegistry";

/** Canonical live poll sources (registry order) — discover scan + sidebar read this. */
export const ALL_SOURCE_KINDS: readonly SourceKind[] = SOURCE_KINDS;

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
  /** Web: rows are from a cached snapshot — not a current live measurement. */
  snapshot_stale?: boolean;
  /** Web: ms when the cached snapshot was captured (if snapshot_stale). */
  snapshot_captured_at?: number | null;
}

export async function sourceStart(kind: SourceKind): Promise<void> {
  if (!isDesktop()) {
    const { webSourceStart } = await import("./webStreams");
    return webSourceStart(kind);
  }
  return invoke<void>("source_start", { kind });
}

export async function sourceStop(kind: SourceKind): Promise<void> {
  if (!isDesktop()) {
    const { webSourceStop } = await import("./webStreams");
    return webSourceStop(kind);
  }
  return invoke<void>("source_stop", { kind });
}

export async function sourceStatus(kind: SourceKind): Promise<SourceStatus> {
  if (!isDesktop()) {
    const { webSourceStatus } = await import("./webStreams");
    return webSourceStatus(kind);
  }
  return invoke<SourceStatus>("source_status", { kind });
}

export async function sourceQuery(kind: SourceKind, sql: string, limit?: number): Promise<QueryResult> {
  if (!isDesktop()) {
    throw new Error("SQL on live sources needs the desktop app (DuckDB). Use Explore snapshot on web.");
  }
  return invoke<QueryResult>("source_query", { kind, sql, limit });
}

export async function sourceSnapshot(kind: SourceKind, limit?: number): Promise<InspectResult> {
  if (!isDesktop()) {
    const { webSourceSnapshot } = await import("./webStreams");
    return webSourceSnapshot(kind, limit);
  }
  return invoke<InspectResult>("source_snapshot", { kind, limit });
}

export async function sourceClear(kind: SourceKind): Promise<void> {
  if (!isDesktop()) {
    const { webSourceClear } = await import("./webStreams");
    return webSourceClear(kind);
  }
  return invoke<void>("source_clear", { kind });
}

const GITHUB_REPO = "mhsenkow/Loom_story_teller";

/** Create a GitHub issue (feedback). Desktop uses GITHUB_TOKEN env; web/iOS uses Worker secret. */
export async function createGitHubIssue(
  title: string,
  body: string,
  imageBase64?: string | null
): Promise<string> {
  if (!isDesktop()) {
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

/** Open save-as dialog (desktop only). Returns chosen path or null if cancelled.
 *  Goes through Rust so the path is one-time approved for write_text/binary_file. */
export async function saveDialog(options: {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  if (!isDesktop()) return null;
  const filter = options.filters?.[0] ?? { name: "HTML", extensions: ["html"] };
  const path = await invoke<string | null>("pick_save_path", {
    defaultPath: options.defaultPath ?? null,
    filterName: filter.name,
    extensions: filter.extensions,
  });
  return path ?? null;
}

/** Write text to a file at path (desktop only; path typically from save dialog). */
export async function writeTextFile(path: string, content: string): Promise<void> {
  if (isDesktop()) {
    await invoke<void>("write_text_file", { path, content });
  }
}

/**
 * Export dashboard as microsite: desktop = save dialog then write file;
 * Web / iOS = download as file.
 */
export async function exportDashboardMicrosite(html: string, defaultName: string): Promise<boolean> {
  const baseName = defaultName.replace(/[^\w\-.]/g, "_").replace(/.html$/i, "") || "dashboard";
  const filename = `${baseName}.html`;

  if (isDesktop()) {
    const path = await saveDialog({ defaultPath: filename, filters: [{ name: "HTML", extensions: ["html"] }] });
    if (!path) return false;
    await writeTextFile(path, html);
    return true;
  }

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const { saveOrShareBlob } = await import("./nativeExport");
  const outcome = await saveOrShareBlob(blob, filename, { title: "Loom dashboard" });
  return outcome !== "cancelled" && outcome !== "unsupported";
}

/** Write binary bytes to a path chosen by the user (desktop). */
export async function writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
  if (!isDesktop()) throw new Error("Desktop Tauri not available");
  // Pass as number[] for serde; chunked base64 would also work for huge files.
  await invoke<void>("write_binary_file", { path, bytes: Array.from(bytes) });
}

/** Reveal a file in Finder / file manager (desktop). */
export async function revealInFinder(path: string): Promise<void> {
  if (!isDesktop()) return;
  await invoke<void>("reveal_in_finder", { path });
}

/**
 * Save a Blob via native dialog and reveal it. Falls back to browser download / share.
 * Returns the saved path (desktop) or null (web / iOS / cancelled).
 */
export async function saveBinaryAndReveal(blob: Blob, defaultName: string): Promise<string | null> {
  const filename = defaultName.replace(/[^\w\-.]/g, "_") || "loom-export.bin";
  const bytes = new Uint8Array(await blob.arrayBuffer());

  if (isDesktop()) {
    const ext = filename.includes(".") ? filename.split(".").pop()! : "bin";
    const path = await saveDialog({
      defaultPath: filename,
      filters: [{ name: "Export", extensions: [ext] }],
    });
    if (!path) return null;
    await writeBinaryFile(path, bytes);
    await revealInFinder(path);
    return path;
  }

  const { saveOrShareBlob } = await import("./nativeExport");
  await saveOrShareBlob(blob, filename, { title: "Loom export" });
  return null;
}
