// =================================================================
// Loom — Tauri IPC Bridge
// =================================================================
// Typed wrappers around `invoke()` so the frontend never constructs
// raw IPC calls. Each function maps 1:1 to a Rust #[tauri::command].
//
// In browser dev mode (no Tauri), returns mock data so the UI
// is fully functional for development and demos.
// =================================================================

import type { FileEntry, ColumnInfo, QueryResult } from "./store";
import { mockFiles, mockInspect, mockQuery } from "./mock-data";

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

export interface InspectResult {
  stats: ColumnInfo[];
  sample: QueryResult;
}

export interface DataGovResource {
  id: string;
  name: string;
  format: string;
  url: string;
}

export interface DataGovDataset {
  id: string;
  name: string;
  title: string;
  organization?: string;
  notes?: string;
  resources: DataGovResource[];
  portal_id: string;
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

/** Fetch recent Data.gov (US) datasets that contain CSV resources (Tauri only). */
export async function fetchDataGovRecentCsv(rows = 40): Promise<DataGovDataset[]> {
  return invoke<DataGovDataset[]>("fetch_data_gov_recent_csv", { rows });
}

/** Fetch recent data.gov.uk datasets that contain CSV resources (Tauri only). */
export async function fetchUkDataRecentCsv(rows = 40): Promise<DataGovDataset[]> {
  return invoke<DataGovDataset[]>("fetch_uk_data_recent_csv", { rows });
}

/** Base URL and label for a portal (for preview modal "Open on …"). */
export const OPEN_DATA_PORTALS: Record<string, { url: string; label: string }> = {
  "data.gov": { url: "https://catalog.data.gov/dataset", label: "Data.gov" },
  "data.gov.uk": { url: "https://data.gov.uk/dataset", label: "data.gov.uk" },
};
