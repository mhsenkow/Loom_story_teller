// =================================================================
// loomDatasetEvents — open datasets from the command palette
// =================================================================
// Sidebar owns the full reopen / CSV ingest paths; the palette asks via
// events so we don't fork that logic.
// =================================================================

import type { FileEntry } from "./store/types";

export const LOOM_OPEN_RECENT_EVENT = "loom:open-recent";
export const LOOM_LOAD_CSV_EVENT = "loom:load-csv";

export type LoomOpenRecentDetail = { file: FileEntry };

export type LoomLoadCsvDetail = {
  url: string;
  filename: string;
  rowLimit?: number;
  sourceCredit?: string;
  sourceHome?: string;
};

export function requestOpenRecentFile(file: FileEntry): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOOM_OPEN_RECENT_EVENT, { detail: { file } satisfies LoomOpenRecentDetail }));
}

export function requestLoadRemoteCsv(detail: LoomLoadCsvDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOOM_LOAD_CSV_EVENT, { detail }));
}
