/** Collision-free endpoint labels for line charts, in CSS-pixel coordinates. */
export function layoutLineEndLabels(
  endpoints: number[],
  top: number,
  bottom: number,
  labelHeight: number,
  gap = 8,
): number[] | null {
  if (!endpoints.length || ![top, bottom, labelHeight, gap, ...endpoints].every(Number.isFinite)
    || labelHeight <= 0 || gap < 0 || bottom - top < endpoints.length * labelHeight + (endpoints.length - 1) * gap) return null;
  const half = labelHeight / 2;
  const step = labelHeight + gap;
  const sorted = endpoints.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y || a.index - b.index);
  const centers = sorted.map(({ y }) => Math.max(top + half, Math.min(bottom - half, y)));
  for (let i = 1; i < centers.length; i++) centers[i] = Math.max(centers[i], centers[i - 1] + step);
  centers[centers.length - 1] = Math.min(centers.at(-1)!, bottom - half);
  for (let i = centers.length - 2; i >= 0; i--) centers[i] = Math.min(centers[i], centers[i + 1] - step);
  const result = new Array<number>(endpoints.length);
  sorted.forEach(({ index }, i) => { result[index] = centers[i]; });
  return result;
}
