/**
 * Unit tests for GPU / 3D / particle scene shortlist.
 */
import { describe, it, expect } from "vitest";
import {
  GPU_SCENE_KINDS,
  isGpuSceneKind,
  isWebGpuDrawableScene,
  extractGpuScenePoints,
  buildGpuSceneRec,
  gpuSceneRecommendationReason,
} from "../gpuScenes";
import type { ColumnInfo } from "../store";

const cols: ColumnInfo[] = [
  { name: "longitude", data_type: "DOUBLE", null_count: 0, distinct_count: 100, min_value: "-180", max_value: "180" },
  { name: "latitude", data_type: "DOUBLE", null_count: 0, distinct_count: 100, min_value: "-90", max_value: "90" },
  { name: "depth", data_type: "DOUBLE", null_count: 0, distinct_count: 50, min_value: "0", max_value: "700" },
  { name: "magnitude", data_type: "DOUBLE", null_count: 0, distinct_count: 40, min_value: "1", max_value: "8" },
  { name: "mag_type", data_type: "VARCHAR", null_count: 0, distinct_count: 4, min_value: null, max_value: null },
];

describe("gpuScenes shortlist", () => {
  it("registers five scene kinds from the plan shortlist", () => {
    expect(GPU_SCENE_KINDS).toEqual([
      "scatter3d",
      "trailRibbon",
      "quakeTerrain",
      "firefly",
      "loomWeave",
    ]);
    for (const k of GPU_SCENE_KINDS) {
      expect(isGpuSceneKind(k)).toBe(true);
      expect(gpuSceneRecommendationReason(k).length).toBeGreaterThan(10);
    }
  });

  it("marks orbit scatter and firefly as WebGPU-drawable", () => {
    expect(isWebGpuDrawableScene("scatter3d")).toBe(true);
    expect(isWebGpuDrawableScene("firefly")).toBe(true);
    expect(isWebGpuDrawableScene("trailRibbon")).toBe(false);
    expect(isWebGpuDrawableScene("quakeTerrain")).toBe(false);
  });

  it("extracts packed points with z / size / time / trail", () => {
    const rows = [
      [-120, 35, 10, 4.2, "ml", 1],
      [-118, 37, 40, 5.1, "mw", 2],
      [-122, 36, 5, 3.0, "ml", 1],
    ];
    const columns = ["longitude", "latitude", "depth", "magnitude", "mag_type", "ts"];
    const packed = extractGpuScenePoints(rows, columns, {
      xField: "longitude",
      yField: "latitude",
      zField: "depth",
      colorField: "mag_type",
      sizeField: "magnitude",
      timeField: "ts",
      trailId: "mag_type",
    });
    expect(packed).not.toBeNull();
    expect(packed!.points.length).toBe(3);
    expect(packed!.zMax).toBeGreaterThan(packed!.zMin);
  });

  it("buildGpuSceneRec returns chart recommendations with encodings", () => {
    const rec = buildGpuSceneRec("scatter3d", cols, "longitude", "latitude", "mag_type", {
      zField: "depth",
      sizeField: "magnitude",
      score: 95,
    });
    expect(rec).not.toBeNull();
    expect(rec!.kind).toBe("scatter3d");
    expect(rec!.zField).toBe("depth");
    expect(rec!.sizeField).toBe("magnitude");
  });
});
