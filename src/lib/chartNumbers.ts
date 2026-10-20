// Numeric chart cells share one boundary: missing, boolean and nonfinite values
// are not observations. Numeric strings remain supported for imported tables.
export function chartNumber(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") return NaN;
  if (typeof value === "string" && value.trim() === "") return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}
