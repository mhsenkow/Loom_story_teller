// =================================================================
// Catalog CSV fetch retry policy (same-origin 404 → Worker fallback)
// =================================================================

export function shouldRetryCsvOnCatalogFallback(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const msg = err.message;
  if (msg.includes("Excel workbook") || /\bxlsx\b/i.test(msg)) return false;
  if (/Fetch CSV failed \([45]\d\d\)/.test(msg)) return false;
  return true;
}
