// =================================================================
// Loom — Shared chart link remote CSV consent copy
// =================================================================

/** Hostname for consent UI when a #chart= link includes a refetch URL. */
export function remoteCsvLoadHost(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

export function remoteCsvLoadPrompt(url: string): string {
  const host = remoteCsvLoadHost(url);
  return host
    ? `This link loads data from ${host}. Load?`
    : "This link loads data from an external URL. Load?";
}
