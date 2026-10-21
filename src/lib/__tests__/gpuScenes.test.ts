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
  fireflyGlowPoints,
  fireflyLayout,
  fireflyPalette,
} from "../gpuScenes";
import { contrastRatio } from "../wcagColor";
import type { ColumnInfo } from "../store";

const cols: ColumnInfo[] = [
  { name: "longitude", data_type: "DOUBLE", null_count: 0, distinct_count: 100, min_value: "-180", max_value: "180" },
  { name: "latitude", data_type: "DOUBLE", null_count: 0, distinct_count: 100, min_value: "-90", max_value: "90" },
  { name: "depth", data_type: "DOUBLE", null_count: 0, distinct_count: 50, min_value: "0", max_value: "700" },
  { name: "magnitude", data_type: "DOUBLE", null_count: 0, distinct_count: 40, min_value: "1", max_value: "8" },
  { name: "mag_type", data_type: "VARCHAR", null_count: 0, distinct_count: 4, min_value: null, max_value: null },
];

describe("gpuScenes shortlist", () => {
  it("registers the scene kinds from the plan shortlist plus the data cube", () => {
    expect(GPU_SCENE_KINDS).toEqual([
      "scatter3d",
      "trailRibbon",
      "quakeTerrain",
      "firefly",
      "loomWeave",
      "dataCube",
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

  it("quakeTerrain Height uses zField (sizeField is a legacy fallback)", () => {
    const viaZ = buildGpuSceneRec("quakeTerrain", cols, "longitude", "latitude", null, {
      zField: "depth",
    });
    expect(viaZ?.zField).toBe("depth");
    expect(viaZ?.sizeField).toBeUndefined();
    const viaLegacySize = buildGpuSceneRec("quakeTerrain", cols, "longitude", "latitude", null, {
      sizeField: "magnitude",
    });
    expect(viaLegacySize?.zField).toBe("magnitude");
    expect(viaLegacySize?.sizeField).toBeUndefined();
  });
});

describe("firefly field", () => {
  const rows = [
    [0, 0, 1],
    [5, 10, 2],
    [10, 20, 3],
  ];
  it("keeps the source row for hover lookups", () => {
    const packed = extractGpuScenePoints(rows, ["x", "y", "s"], { xField: "x", yField: "y" })!;
    expect(packed.points.map((p) => p.row)).toEqual([0, 1, 2]);
  });
  it("uses equal weight without a metric, and Size when set", () => {
    const plain = extractGpuScenePoints(rows, ["x", "y", "s"], { xField: "x", yField: "y" })!;
    const glow = fireflyGlowPoints(plain).map((p) => p.size);
    expect(glow).toEqual([0.5, 0.5, 0.5]);
    const sized = extractGpuScenePoints(rows, ["x", "y", "s"], { xField: "x", yField: "y", sizeField: "s" })!;
    expect(fireflyGlowPoints(sized)).toBe(sized.points);
  });
  it("uses actual time rather than row order and excludes missing timestamps from its range", () => {
    const packed = extractGpuScenePoints([[0, 2, 300], [1, 3, null], [2, 4, 100], [3, 5, 200]], ["x", "y", "time"], { xField: "x", yField: "y", timeField: "time" })!;
    expect(packed.tRange).toEqual([100, 300]);
    expect(fireflyGlowPoints(packed).map(p => p.size)).toEqual([1, 0.5, 0.15, 0.575]);
  });
  it("keeps constant measures visible and missing coordinates out of the plot", () => {
    const packed = extractGpuScenePoints([[1, 2, 4], [2, 3, 4], [null, 3, 4]], ["x", "y", "s"], { xField: "x", yField: "y", sizeField: "s" })!;
    expect(fireflyGlowPoints(packed).map(p => p.size)).toEqual([0.5, 0.5]);
  });
  it("gives every palette color at least 3:1 contrast on light and dark surfaces", () => {
    for (const background of ["#ffffff", "#f0efeb", "#0a0a0c"]) {
      for (const color of fireflyPalette(["#ffffcc", "#ffbb88", "#111111", "#3366cc"], background)) {
        expect(contrastRatio(color, background)).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it("reads bigint and Date cells (DuckDB BIGINT / TIMESTAMP)", () => {
    const packed = extractGpuScenePoints(
      [[BigInt(1), BigInt(10), new Date(1000)], [BigInt(2), BigInt(20), new Date(2000)]],
      ["x", "y", "ts"],
      { xField: "x", yField: "y", timeField: "ts" },
    )!;
    expect(packed.points).toHaveLength(2);
    expect(packed.tRange).toEqual([1000, 2000]);
  });
  it("maps into a flat plot rect on nice domains", () => {
    const packed = extractGpuScenePoints(rows, ["x", "y", "s"], { xField: "x", yField: "y" })!;
    const lay = fireflyLayout(packed, 400, 300, 40);
    expect(lay.sx(lay.xs.min)).toBe(40);
    expect(lay.sx(lay.xs.max)).toBe(360);
    expect(lay.sy(lay.ys.min)).toBe(260);
    expect(lay.sy(lay.ys.max)).toBe(40);
  });
});
