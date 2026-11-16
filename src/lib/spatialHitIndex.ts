// =================================================================
// spatialHitIndex — grid index for canvas hit targets (LOOM-596)
// =================================================================
// Each target is filed under every cell its hit box overlaps, so long bars,
// bands and big heatmap cells are found from any point on them (not just near
// their center). Huge targets (and arcs) skip the grid and are always checked.

import type { HitTarget } from "./chartTooltip";

export type SpatialHitIndex = {
  cellSize: number;
  /** Cell key → indices into the targets array, in ascending (paint) order. */
  buckets: Map<number, number[]>;
  /** Targets checked at every point: arcs and boxes spanning too many cells. */
  always: number[];
};

/** Targets covering more cells than this go to `always` instead. */
const MAX_CELLS_PER_TARGET = 64;
/** Cell coordinates are offset so negatives (marks bleeding off-canvas) key cleanly. */
const CELL_OFFSET = 1024;
/** Matches hitDistance's slop: thin rects get up to 3px, circles at least 6px. */
const RECT_SLOP = 3;
const MIN_CIRCLE_R = 6;

function cellCoord(v: number, cellSize: number): number {
  return Math.min(65535, Math.max(0, Math.floor(v / cellSize) + CELL_OFFSET));
}

function cellKey(cx: number, cy: number): number {
  return cy * 65536 + cx;
}

function hitBox(t: HitTarget): { x0: number; y0: number; x1: number; y1: number } | null {
  if (t.shape === "rect") {
    return { x0: t.x - RECT_SLOP, y0: t.y - RECT_SLOP, x1: t.x + t.w + RECT_SLOP, y1: t.y + t.h + RECT_SLOP };
  }
  if (t.shape === "circle") {
    const r = Math.max(t.r, MIN_CIRCLE_R);
    return { x0: t.cx - r, y0: t.cy - r, x1: t.cx + r, y1: t.cy + r };
  }
  return null;
}

export function buildSpatialHitIndex(
  targets: HitTarget[],
  _bounds: { w: number; h: number },
  cellSize = 48,
): SpatialHitIndex {
  const buckets = new Map<number, number[]>();
  const always: number[] = [];
  for (let i = 0; i < targets.length; i++) {
    const box = hitBox(targets[i]!);
    if (!box || ![box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)) {
      always.push(i);
      continue;
    }
    const cx0 = cellCoord(box.x0, cellSize);
    const cx1 = cellCoord(box.x1, cellSize);
    const cy0 = cellCoord(box.y0, cellSize);
    const cy1 = cellCoord(box.y1, cellSize);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_CELLS_PER_TARGET) {
      always.push(i);
      continue;
    }
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cellKey(cx, cy);
        const list = buckets.get(key);
        if (list) list.push(i);
        else buckets.set(key, [i]);
      }
    }
  }
  return { cellSize, buckets, always };
}

/**
 * Targets whose hit box may contain (x, y), in their original order so a
 * reverse scan still finds the topmost (last painted) mark first.
 */
export function spatialCandidates(
  index: SpatialHitIndex,
  x: number,
  y: number,
  targets: HitTarget[],
): HitTarget[] {
  const cell = index.buckets.get(cellKey(cellCoord(x, index.cellSize), cellCoord(y, index.cellSize))) ?? [];
  if (!index.always.length) return cell.map((i) => targets[i]!);
  if (!cell.length) return index.always.map((i) => targets[i]!);
  // Merge two ascending index lists.
  const out: HitTarget[] = [];
  let a = 0;
  let b = 0;
  while (a < cell.length || b < index.always.length) {
    const next =
      b >= index.always.length || (a < cell.length && cell[a]! < index.always[b]!) ? cell[a++]! : index.always[b++]!;
    out.push(targets[next]!);
  }
  return out;
}
