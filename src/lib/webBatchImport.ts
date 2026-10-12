// =================================================================
// Loom — Unified browser batch import outcomes (LOOM-251, LOOM-253)
// =================================================================

export type WebBatchFileOutcome =
  | { status: "loaded"; fileName: string; path: string }
  | { status: "failed"; fileName: string; error: string }
  | { status: "skipped"; fileName: string; reason: string };

export type WebBatchImportSummary = {
  loaded: WebBatchFileOutcome[];
  failed: WebBatchFileOutcome[];
  skipped: WebBatchFileOutcome[];
};

export function summarizeWebBatchOutcomes(outcomes: WebBatchFileOutcome[]): WebBatchImportSummary {
  const loaded: WebBatchFileOutcome[] = [];
  const failed: WebBatchFileOutcome[] = [];
  const skipped: WebBatchFileOutcome[] = [];
  for (const o of outcomes) {
    if (o.status === "loaded") loaded.push(o);
    else if (o.status === "failed") failed.push(o);
    else skipped.push(o);
  }
  return { loaded, failed, skipped };
}

export function formatWebBatchImportToast(summary: WebBatchImportSummary, vaultLabel: string): string {
  if (!summary.loaded.length) {
    const f = summary.failed[0];
    return f?.status === "failed" ? f.error : "Couldn’t load those files";
  }
  const base =
    summary.loaded.length > 1
      ? `Added ${summary.loaded.length} files to ${vaultLabel}`
      : `Added ${summary.loaded[0]!.fileName} to ${vaultLabel}`;
  if (summary.failed.length) return `${base} (${summary.failed.length} failed)`;
  if (summary.skipped.length) return `${base} (${summary.skipped.length} skipped)`;
  return base;
}
