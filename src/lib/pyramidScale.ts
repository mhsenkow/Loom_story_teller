// =================================================================
// Pyramid (mirror bar) scale policy
// =================================================================
// Opposing measures (cases vs deaths, male vs female) often differ by
// orders of magnitude. Shared scale makes lengths comparable; independent
// scales keep each arm readable. Auto picks independent when the ratio
// of maxima is large.
// =================================================================

export type PyramidScaleMode = "auto" | "shared" | "independent";

const AUTO_RATIO = 5;

/** Resolve what drawPyramid should use for the two arms. */
export function resolvePyramidScaleMode(
  mode: PyramidScaleMode | null | undefined,
  leftMax: number,
  rightMax: number,
): "shared" | "independent" {
  if (mode === "shared") return "shared";
  if (mode === "independent") return "independent";
  const lo = Math.min(leftMax, rightMax);
  const hi = Math.max(leftMax, rightMax);
  if (!(lo > 0) || !(hi > 0) || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    return "independent";
  }
  return hi / lo >= AUTO_RATIO ? "independent" : "shared";
}

export function isPyramidScaleMode(v: unknown): v is PyramidScaleMode {
  return v === "auto" || v === "shared" || v === "independent";
}
