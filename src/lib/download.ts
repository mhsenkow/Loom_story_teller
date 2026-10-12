// =================================================================
// Browser download helper (object URLs)
// =================================================================
// Revoke URLs after a delay so Safari/Firefox can finish the download.
// =================================================================

const REVOKE_AFTER_MS = 30_000;

export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
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
}

export function downloadCsv(csv: string, filename: string): void {
  const name = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), name);
}
