// =================================================================
// spatialHitIndex — grid index for canvas hit targets (LOOM-596)
// =================================================================

import type { HitTarget } from "./chartTooltip";

export type SpatialHitIndex = {
  cellSize: number;
  buckets: Map<string, HitTarget[]>;
};

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

function hitCenter(t: HitTarget): { x: number; y: number } {
  if (t.shape === "rect") return { x: t.x + t.w / 2, y: t.y + t.h / 2 };
  if (t.shape === "circle") return { x: t.cx, y: t.cy };
  return { x: t.cx, y: t.cy };
}

export function buildSpatialHitIndex(
  targets: HitTarget[],
  _bounds: { w: number; h: number },
  cellSize = 48,
): SpatialHitIndex {
  const buckets = new Map<string, HitTarget[]>();
  for (const t of targets) {
    const { x, y } = hitCenter(t);
    const cx = Math.floor(x / cellSize);
    const cy = Math.floor(y / cellSize);
    const key = cellKey(cx, cy);
    const list = buckets.get(key);
    if (list) list.push(t);
    else buckets.set(key, [t]);
  }
  return { cellSize, buckets };
}

export function spatialCandidates(index: SpatialHitIndex, x: number, y: number): HitTarget[] {
  const cs = index.cellSize;
  const cx = Math.floor(x / cs);
  const cy = Math.floor(y / cs);
  const out: HitTarget[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const list = index.buckets.get(cellKey(cx + dx, cy + dy));
      if (list) out.push(...list);
    }
  }
  return out.length ? out : [];
}
