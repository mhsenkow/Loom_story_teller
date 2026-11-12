import { describe, expect, it } from "vitest";
import { extractGpuScenePoints, normalizeOrbitValue, orbitSceneLayout } from "../gpuScenes";
import { buildDataCube, cubeCellCenter, cubeView, cubeVoxelHalf, pickDataCubeCell, projectCube } from "../dataCube";
import { DEFAULT_ORBIT_CAMERA, orbitCameraKey, orbitRotation, orbitZoom } from "../orbitCamera";

describe("orbit coordinate integrity", () => {
  it.each([0, 700, -700, 1e12])("centers a constant coordinate of %s on every axis", value => {
    const packed = extractGpuScenePoints([[value, value, value]], ["x", "y", "z"], { xField: "x", yField: "y", zField: "z" })!;
    expect(normalizeOrbitValue(value, packed.xMin, packed.xMax)).toBeCloseTo(0);
    expect(normalizeOrbitValue(value, packed.yMin, packed.yMax)).toBeCloseTo(0);
    expect(normalizeOrbitValue(value, packed.zMin, packed.zMax)).toBeCloseTo(0);
    const layout = orbitSceneLayout(packed, 320, 240, 40, DEFAULT_ORBIT_CAMERA);
    expect(layout.projected[0]!.sx).toBeCloseTo(layout.frame.cx);
    expect(layout.projected[0]!.sy).toBeCloseTo(layout.frame.cy);
  });

  it("drops missing encoded depth, preserves real zero and source row identity", () => {
    const packed = extractGpuScenePoints([[1, 2, null], [2, 3, ""], [3, 4, Infinity], [4, 5, 0], [5, 6, 700]], ["x", "y", "z"], { xField: "x", yField: "y", zField: "z" })!;
    expect(packed.points.map(p => [p.row, p.z])).toEqual([[3, 0], [4, 700]]);
    expect(extractGpuScenePoints([[1, 2]], ["x", "y"], { xField: "x", yField: "y", zField: "absent" })).toBeNull();
  });

  it("centers an unencoded depth and keeps constant size unchanged when inverted", () => {
    for (const invertSize of [false, true]) {
      const p = extractGpuScenePoints([[1, 2, 50], [2, 3, 50]], ["x", "y", "s"], { xField: "x", yField: "y", sizeField: "s", invertSize })!;
      expect(p.points.map(v => v.size)).toEqual([0.5, 0.5]);
      expect(normalizeOrbitValue(0, p.zMin, p.zMax)).toBe(0);
    }
  });

  it("keeps all corners inside portrait and landscape frames throughout an orbit, ordered back to front", () => {
    const rows = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => [x, y, z])));
    const packed = extractGpuScenePoints(rows, ["x", "y", "z"], { xField: "x", yField: "y", zField: "z" })!;
    for (const [w, h] of [[320, 240], [320, 560], [1100, 400]]) {
      for (let yaw = -Math.PI; yaw <= Math.PI; yaw += Math.PI / 12) for (const pitch of [-1.2, 0, 0.35, 1.2]) {
        const { projected } = orbitSceneLayout(packed, w!, h!, 40, { yaw, pitch, zoom: 1 });
        for (const point of projected) {
          expect(point.sx).toBeGreaterThan(0); expect(point.sx).toBeLessThan(w!);
          expect(point.sy).toBeGreaterThan(0); expect(point.sy).toBeLessThan(h!);
        }
        expect(projected.map(p => p.depth)).toEqual(projected.map(p => p.depth).sort((a, b) => b - a));
      }
    }
  });
});

describe("voxel surface picking", () => {
  const cube = buildDataCube([["A", "B", "C", 10]], ["x", "y", "z", "v"], { xField: "x", yField: "y", zField: "z", valueField: "v" })!;
  const cell = cube.cells[0]!;
  const center = cubeCellCenter(cube, cell.xi, cell.yi, cell.zi);
  const half = cubeVoxelHalf(cube, cell);

  it.each([-2.5, -0.55, 0, 0.55, 2.5])("finds visible corners with yaw %s, at every pitch and an offset camera", yaw => {
    for (const pitch of [-1.2, 0, 0.35, 1.2]) {
      const view = cubeView({ yaw, pitch, zoom: 0.7, offsetY: 0.18 }, 320, 280);
      for (const x of [-0.98, 0.98]) for (const y of [-0.98, 0.98]) for (const z of [-0.98, 0.98]) {
        const p = projectCube(view, center[0] + x * half, center[1] + y * half, center[2] + z * half);
        expect(pickDataCubeCell(cube, view, p.sx, p.sy)).toBe(cell);
      }
      expect(pickDataCubeCell(cube, view, -100, -100)).toBeNull();
    }
  });

  it("does not select empty space just outside a face", () => {
    const view = cubeView({ yaw: 0, pitch: 0, zoom: 1 }, 500, 400);
    const p = projectCube(view, half * 1.1, 0, half);
    expect(pickDataCubeCell(cube, view, p.sx, p.sy)).toBeNull();
  });

  it("chooses the nearest surface, even when its voxel center is farther away", () => {
    const large = { ...cell, s: 1, rowIndex: 0 };
    const small = { ...cell, s: 0, rowIndex: 1 };
    const cells = { ...cube, cells: [small, large] };
    const view = cubeView({ yaw: 0, pitch: 0, zoom: 1 }, 500, 400);
    const style = { centerOf: (c: typeof cell): [number, number, number] => [0, 0, c.rowIndex === 1 ? 0.2 : 0] };
    expect(pickDataCubeCell(cells, view, 250, 200, style)).toBe(large);
    expect(pickDataCubeCell(cells, view, NaN, 200)).toBeNull();
  });
});

describe("accessible orbit controls", () => {
  it("preserves mark navigation and provides rotation, zoom and reset shortcuts", () => {
    expect(orbitCameraKey(DEFAULT_ORBIT_CAMERA, "ArrowLeft", false)).toBeNull();
    expect(orbitCameraKey(DEFAULT_ORBIT_CAMERA, "ArrowLeft", true)!.yaw).toBeCloseTo(0.4);
    expect(orbitCameraKey(DEFAULT_ORBIT_CAMERA, "+", false)!.zoom).toBe(1.2);
    expect(orbitCameraKey({ yaw: -2, pitch: 1, zoom: 3 }, "0", false)).toEqual(DEFAULT_ORBIT_CAMERA);
  });
  it("bounds every input method and wraps long rotations", () => {
    expect(orbitZoom(20)).toBe(3); expect(orbitZoom(0.01)).toBe(0.4);
    expect(orbitRotation(Math.PI * 100 + 0.4, 5).yaw).toBeCloseTo(0.4);
    expect(orbitRotation(0, -5).pitch).toBe(-1.2);
  });
});
