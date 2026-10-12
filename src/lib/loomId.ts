// =================================================================
// loomId — stable client-side entity ids (LOOM-173)
// =================================================================

export function newLoomId(prefix: string): string {
  const core =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  return `${prefix}${core}`;

}
