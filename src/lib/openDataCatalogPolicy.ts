// =================================================================
// Catalog CSV fetch retry policy (same-origin 404 → Worker fallback)
// =================================================================

/** SPA/static hosts often return index.html (200) for missing `/api/*`. */
export function looksLikeHtmlDocument(text: string): boolean {
  const head = text.slice(0, 512).trimStart();
  return /^<!DOCTYPE\s+html\b/i.test(head) || /^<html\b/i.test(head);
}

export function shouldRetryCsvOnCatalogFallback(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const msg = err.message;
  if (msg.includes("Excel workbook") || /\bxlsx\b/i.test(msg)) return false;
  if (/Fetch CSV failed \([45]\d\d\)/.test(msg)) return false;
  // Relative `/api/fetch-csv` served the app shell — try the Worker origin.
  if (/HTML page instead of CSV/i.test(msg)) return true;
  return true;
}
