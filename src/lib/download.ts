// =================================================================
// Browser download helper (object URLs)
// =================================================================
// Revoke URLs after a delay so Safari/Firefox can finish the download.
// The iPhone/iPad Tauri webview cancels <a download> clicks, so there we
// hand the file to the system share sheet (Save Image / Save to Files).
// =================================================================

import { isMobileOs, isTauri } from "./tauri";
import { shareBlob, type NativeExportOutcome } from "./nativeExport";

const REVOKE_AFTER_MS = 30_000;

/** True where anchor downloads are silently dropped (iOS Tauri shell). */
export function anchorDownloadsBlocked(): boolean {
  return isTauri() && isMobileOs();
}

/**
 * Save a blob for the user. Resolves "downloaded" for an anchor download,
 * or the share sheet's outcome on iPhone/iPad — callers should only say
 * "saved" for "downloaded" / "shared".
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<NativeExportOutcome> {
  if (typeof document === "undefined") return "unsupported";
  if (anchorDownloadsBlocked()) return shareBlob(blob, filename);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  return "downloaded";
}

/** Toast copy for a save outcome; null when the user cancelled. */
export function savedToast(outcome: NativeExportOutcome, saved: string): string | null {
  if (outcome === "downloaded" || outcome === "shared") return saved;
  if (outcome === "cancelled") return null;
  return "Couldn’t save the file on this device";
}

export function downloadCsv(csv: string, filename: string): Promise<NativeExportOutcome> {
  const name = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  return downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), name);
}
