// =================================================================
// scatterSelection — lasso/brush against full row indices (LOOM-133)
// =================================================================

import type { GPUScatterPoint } from "./webgpu";

export function selectScatterRowIndices(args: {
  points: GPUScatterPoint[];
  rowIndices: number[];
  predicate: (px: number, py: number, point: GPUScatterPoint, rowIndex: number) => boolean;
}): number[] {
  const sel: number[] = [];
  const seen = new Set<number>();
  args.points.forEach((p, i) => {
    const ri = args.rowIndices[i] ?? i;
    if (seen.has(ri)) return;
    const px = p.x;
    const py = p.y;
    if (args.predicate(px, py, p, ri)) {
      seen.add(ri);
      sel.push(ri);
    }
  });
  return sel;
}
