// Every map / globe / scene kind must register hoverable, pinnable marks
// (markFocus.ts draws focus rings and pinned callouts from these).
import { beforeAll, describe, expect, it } from "vitest";
import { GEO_MAP_KINDS, renderGeoMapCanvas } from "../geoMaps";
import { loadAtlas } from "../geoAtlas";
import { GPU_SCENE_KINDS, extractGpuScenePoints, renderGpuSceneCanvas } from "../gpuScenes";
import type { HitTarget } from "../chartTooltip";

function mockCtx(): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { font: "10px sans-serif" };
  return new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "measureText") return (s: string) => ({ width: String(s).length * 6 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop: () => {} });
      if (prop in state) return state[prop];
      return () => {};
    },
    set(_t, prop: string, value) {
      state[prop] = value;
      return true;
    },
  }) as CanvasRenderingContext2D;
}

beforeAll(async () => {
  const g = globalThis as unknown as { Path2D?: unknown };
  if (!g.Path2D) g.Path2D = class {};
  await loadAtlas("world");
});

const W = 640;
const H = 420;
const columns = ["id", "group", "value", "other", "third", "longitude", "latitude", "when"];
const rows: unknown[][] = Array.from({ length: 60 }, (_, i) => [
  `craft-${i % 6}`,
  ["A", "B", "C"][i % 3],
  10 + ((i * 37) % 90),
  5 + ((i * 13) % 40),
  1 + ((i * 7) % 9),
  -100 + (i % 6) * 8 + Math.floor(i / 6) * 1.5,
  30 + (i % 6) * 3 + Math.floor(i / 6) * 0.8,
  `2024-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
]);

function insideCanvas(t: HitTarget): boolean {
  const [x, y] = t.shape === "rect" ? [t.x + t.w / 2, t.y + t.h / 2] : [t.cx, t.cy];
  return x >= -1 && x <= W + 1 && y >= -1 && y <= H + 1;
}

describe("hoverable marks on maps, globes and scenes", () => {
  for (const kind of GEO_MAP_KINDS) {
    it(`${kind} registers marks`, () => {
      const hits: HitTarget[] = [];
      renderGeoMapCanvas(kind, mockCtx(), rows, columns, { xField: "longitude", yField: "latitude", colorField: kind === "globeTrail" || kind === "arcMap" ? "id" : "group", sizeField: "value" }, W, H, 56, { colors: ["#3366cc", "#dc3912"], opacity: 0.85, hits });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every(insideCanvas)).toBe(true);
      // Points identify a source row; hex bins carry an aggregate readout.
      expect(hits.every((h) => (h.rowIndex != null && h.rowIndex >= 0) || !!h.summary)).toBe(true);
    });
  }
  for (const kind of GPU_SCENE_KINDS.filter((k) => k !== "dataCube")) {
    it(`${kind} registers marks`, () => {
      const packed = extractGpuScenePoints(rows, columns, {
        xField: kind === "loomWeave" ? "group" : "value",
        yField: "other",
        zField: "third",
        colorField: kind === "loomWeave" ? "group" : null,
        timeField: "when",
        trailId: kind === "trailRibbon" ? "id" : null,
      })!;
      const hits: HitTarget[] = [];
      renderGpuSceneCanvas(kind, mockCtx(), packed, W, H, 56, { colors: ["#3366cc"], opacity: 0.85, hits });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every(insideCanvas)).toBe(true);
    });
  }
});
