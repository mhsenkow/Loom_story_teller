// =================================================================
// vegaSpecDisplay — stringify Vega spec only when shown (LOOM-299)
// =================================================================

export function formatVegaSpecJson(spec: unknown | null | undefined): string {
  if (!spec) return "{}";
  try {
    return JSON.stringify(spec, null, 2);
  } catch {
    return "{}";
  }
}
