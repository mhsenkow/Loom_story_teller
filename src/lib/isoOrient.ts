// =================================================================
// Loom — Isometric floor orientation (terrain / iso scatter)
// =================================================================
// Kept free of chartSupport / gpuScenes imports so Canvas scene
// renderers can share these helpers without circular modules.
// =================================================================

export type IsoLayoutDirection = "auto" | "up" | "down" | "right" | "left";

/** Rotate / flip the isometric floor for terrain & iso scatter (0–3 quarter turns). */
export function resolveIsoFloorOrient(
  dir: IsoLayoutDirection | null | undefined,
): 0 | 1 | 2 | 3 {
  switch (dir) {
    case "right":
      return 1;
    case "down":
      return 2;
    case "left":
      return 3;
    default:
      return 0;
  }
}

/** Map cell (c,r) through a floor orientation (cols × rows grid). */
export function orientIsoCell(
  c: number,
  r: number,
  cols: number,
  rows: number,
  orient: 0 | 1 | 2 | 3,
): { c: number; r: number } {
  switch (orient) {
    case 1:
      return { c: r, r: cols - 1 - c };
    case 2:
      return { c: cols - 1 - c, r: rows - 1 - r };
    case 3:
      return { c: rows - 1 - r, r: c };
    default:
      return { c, r };
  }
}
