/**
 * Unit tests for the rows × columns × depth data cube.
 */
import { describe, it, expect } from "vitest";
import {
  buildCubeAxis,
  buildDataCube,
  buildPivotTable,
  cubeCellCenter,
  cubeCellKey,
  cubeCellTooltip,
  cubeView,
  pickDataCubeCell,
  pickDataCubeEncoding,
  projectCube,
  sortCellsBackToFront,
} from "../dataCube";
import { buildGpuSceneRec, gpuSceneDataSupport, suggestDataCubeRec } from "../gpuScenes";
import { chartKindDataSupport, createChartRec } from "../recommendations";
import { getChartRenderIssue } from "../chartSupport";
import type { ColumnInfo } from "../store";

const columns = ["region", "product", "year", "sales"];
const rows: unknown[][] = [
  ["East", "Apples", 2022, 10],
  ["East", "Apples", 2023, 14],
  ["East", "Pears", 2022, 6],
  ["West", "Apples", 2022, 8],
  ["West", "Pears", 2023, 20],
  ["West", "Pears", 2023, 4],
  ["North", "Plums", 2024, 3],
];

const stats: ColumnInfo[] = [
  { name: "order_id", data_type: "BIGINT", null_count: 0, distinct_count: 7, min_value: "1", max_value: "7" },
  { name: "region", data_type: "VARCHAR", null_count: 0, distinct_count: 3, min_value: null, max_value: null },
  { name: "product", data_type: "VARCHAR", null_count: 0, distinct_count: 3, min_value: null, max_value: null },
  { name: "year", data_type: "INTEGER", null_count: 0, distinct_count: 3, min_value: "2022", max_value: "2024" },
  { name: "sales", data_type: "DOUBLE", null_count: 0, distinct_count: 40, min_value: "3", max_value: "20" },
];

describe("buildCubeAxis", () => {
  it("keeps low-cardinality numerics as ordered slots", () => {
    const ax = buildCubeAxis([2024, 2022, 2023, 2022], "year")!;
    expect(ax.axis.kind).toBe("numeric");
    expect(ax.axis.labels).toEqual(["2022", "2023", "2024"]);
    expect(ax.indexOf(2023)).toBe(1);
  });

  it("bins wide numeric ranges into equal-width ranges", () => {
    const vals = Array.from({ length: 100 }, (_, i) => i);
    const ax = buildCubeAxis(vals, "n", 12)!;
    expect(ax.axis.labels.length).toBe(8);
    expect(ax.indexOf(0)).toBe(0);
    expect(ax.indexOf(99)).toBe(7);
  });

  it("folds overflow categories into Other", () => {
    const vals = Array.from({ length: 30 }, (_, i) => `c${i % 15}`);
    const ax = buildCubeAxis(vals, "cat", 6)!;
    expect(ax.axis.labels.length).toBe(6);
    expect(ax.axis.labels[5]).toBe("Other");
    expect(ax.indexOf("c14")).toBe(5);
  });

  it("detects date strings as time", () => {
    const ax = buildCubeAxis(["2024-01-05", "2024-03-01", "2024-01-05"], "day")!;
    expect(ax.axis.kind).toBe("time");
    expect(ax.axis.labels.length).toBe(2);
  });
});

describe("buildDataCube", () => {
  it("aggregates sum of a measure per cell", () => {
    const cube = buildDataCube(rows, columns, {
      xField: "region",
      yField: "product",
      zField: "year",
      valueField: "sales",
      aggregate: "sum",
    })!;
    expect(cube).not.toBeNull();
    expect(cube.x.labels).toEqual(["East", "West", "North"]);
    expect(cube.cells.length).toBe(6);
    const westPears2023 = cube.cells.find(
      (c) => cube.x.labels[c.xi] === "West" && cube.y.labels[c.yi] === "Pears" && cube.z.labels[c.zi] === "2023",
    )!;
    expect(westPears2023.value).toBe(24);
    expect(westPears2023.count).toBe(2);
    expect(cube.vMax).toBe(24);
    expect(westPears2023.t).toBe(1);
    expect(cube.valueLabel).toBe("Sum of sales");
  });

  it("falls back to row counts without a measure", () => {
    const cube = buildDataCube(rows, columns, { xField: "region", yField: "product", zField: "year" })!;
    expect(cube.aggregate).toBe("count");
    expect(cube.valueLabel).toBe("Rows");
    expect(cube.cells.reduce((n, c) => n + c.value, 0)).toBe(rows.length);
  });

  it("requires all three dimensions", () => {
    expect(buildDataCube(rows, columns, { xField: "region", yField: "product", zField: null })).toBeNull();
    expect(buildDataCube(rows, columns, { xField: "region", yField: "product", zField: "nope" })).toBeNull();
  });

  it("formats hover tooltips with axis labels and value", () => {
    const cube = buildDataCube(rows, columns, { xField: "region", yField: "product", zField: "year", valueField: "sales", aggregate: "mean" })!;
    const tip = cubeCellTooltip(cube, cube.cells[0]!);
    expect(tip.columns.slice(0, 4)).toEqual(["region", "product", "year", "Average of sales"]);
    expect(tip.columns).toContain("Rows");
  });

  it("Encoding Tooltip fields merge onto the structural cube tip", async () => {
    const { mergeChartTooltip } = await import("../chartTooltip");
    const cube = buildDataCube(rows, columns, {
      xField: "region",
      yField: "product",
      zField: "year",
      valueField: "sales",
      aggregate: "sum",
    })!;
    const cell = cube.cells[0]!;
    const tip = cubeCellTooltip(cube, cell);
    const allCols = [...columns, "note"];
    const raw = [...(rows[cell.rowIndex] as (string | number)[]), "picked"];
    const merged = mergeChartTooltip(tip, allCols, raw, ["region", "sales", "note"]);
    expect(merged.columns.slice(0, 3)).toEqual(["region", "product", "year"]);
    // Axis + "Sum of sales" already cover region/sales — only extra chip appends
    expect(merged.columns).not.toContain("sales");
    expect(merged.columns).toContain("note");
    expect(merged.row[merged.columns.indexOf("note")]).toBe("picked");
  });
});


describe("cube camera", () => {
  const cube = buildDataCube(rows, columns, { xField: "region", yField: "product", zField: "year" })!;

  it("projects the cube center to the middle of the viewport", () => {
    const v = cubeView({ yaw: 0.6, pitch: 0.4, zoom: 1 }, 800, 600);
    const p = projectCube(v, 0, 0, 0);
    expect(p.sx).toBeCloseTo(400, 3);
    expect(p.sy).toBeCloseTo(300, 3);
    expect(p.depth).toBeGreaterThan(0);
  });

  it("puts the first row above the last row on screen", () => {
    const v = cubeView({ yaw: 0, pitch: 0, zoom: 1 }, 800, 600);
    const top = cubeCellCenter(cube, 0, 0, 0);
    const bottom = cubeCellCenter(cube, cube.x.labels.length - 1, 0, 0);
    expect(projectCube(v, ...top).sy).toBeLessThan(projectCube(v, ...bottom).sy);
  });

  it("sorts voxels far → near and picks the voxel under the cursor", () => {
    const v = cubeView({ yaw: 0.6, pitch: 0.4, zoom: 1 }, 800, 600);
    const sorted = sortCellsBackToFront(cube, v);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i - 1]!.depth).toBeGreaterThanOrEqual(sorted[i]!.depth);
    const target = sorted[sorted.length - 1]!.cell;
    const c = projectCube(v, ...cubeCellCenter(cube, target.xi, target.yi, target.zi));
    expect(pickDataCubeCell(cube, v, c.sx, c.sy)).toBe(target);
    expect(pickDataCubeCell(cube, v, 2, 2)).toBeNull();
  });
});

describe("data cube recommendations", () => {
  it("picks categorical dimensions, skips ids, and finds a measure", () => {
    const enc = pickDataCubeEncoding(stats)!;
    expect(enc).not.toBeNull();
    expect([enc.xField, enc.yField, enc.zField].sort()).toEqual(["product", "region", "year"]);
    expect(enc.valueField).toBe("sales");
    expect(enc.aggregate).toBe("sum");
  });

  it("builds a rec with depth + value and reports support", () => {
    expect(gpuSceneDataSupport(stats, "dataCube").ok).toBe(true);
    expect(chartKindDataSupport(stats.slice(0, 3), "dataCube").ok).toBe(false);
    const rec = suggestDataCubeRec(stats)!;
    expect(rec.kind).toBe("dataCube");
    expect(rec.zField).toBeTruthy();
    expect(rec.sizeField).toBe("sales");
    const viaCreate = createChartRec("dataCube", stats, "region", "product", null, "t", { zField: "year", sizeField: "sales", yAggregate: "mean" })!;
    expect(viaCreate.zField).toBe("year");
    expect(viaCreate.yAggregate).toBe("mean");
    const auto = buildGpuSceneRec("dataCube", stats, "region", null, null)!;
    expect(new Set([auto.xField, auto.yField, auto.zField]).size).toBe(3);
  });

  it("flags a missing depth field as a render issue", () => {
    const rec = createChartRec("dataCube", stats, "region", "product", null, "t", { zField: "year" })!;
    const sample = { columns, rows: rows as (string | number | boolean | null)[][], total_rows: rows.length };
    expect(getChartRenderIssue(rec, sample as never)).toBeNull();
    expect(getChartRenderIssue({ ...rec, zField: "missing" }, sample as never)?.code).toBe("bad_z");
  });
});

describe("pivot table", () => {
  const enc = { xField: "region", yField: "product", zField: "year", valueField: "sales", aggregate: "sum" as const };

  it("rolls up across depth with row / column / grand totals", () => {
    const t = buildPivotTable(rows, columns, enc, null)!;
    expect(t.rows).toEqual(["East", "West", "North"]);
    const east = t.rows.indexOf("East");
    const apples = t.cols.indexOf("Apples");
    expect(t.values[east]![apples]).toBe(24); // 10 + 14 across 2022 + 2023
    expect(t.rowTotals[east]).toBe(30);
    expect(t.grand).toBe(65);
    expect(t.sliceLabel).toBeNull();
  });

  it("slices to one depth layer", () => {
    const t = buildPivotTable(rows, columns, enc, 1)!; // 2023
    expect(t.sliceLabel).toBe("2023");
    expect(t.grand).toBe(38); // 14 + 20 + 4
    const north = t.rows.indexOf("North");
    expect(t.rowTotals[north]).toBeNull();
  });

  it("re-aggregates averages from raw rows instead of averaging cells", () => {
    const t = buildPivotTable(rows, columns, { ...enc, aggregate: "mean" }, null)!;
    const west = t.rows.indexOf("West");
    expect(t.rowTotals[west]).toBeCloseTo((8 + 20 + 4) / 3, 6);
  });
});

describe("pivoting", () => {
  it("keys cells by field=label so they survive axis permutations", () => {
    const a = buildDataCube(rows, columns, { xField: "region", yField: "product", zField: "year" })!;
    const b = buildDataCube(rows, columns, { xField: "year", yField: "region", zField: "product" })!;
    const ka = new Set(a.cells.map((c) => cubeCellKey(a, c)));
    const kb = new Set(b.cells.map((c) => cubeCellKey(b, c)));
    expect(kb).toEqual(ka);
  });

  it("shifts the cube up on screen with camera offsetY", () => {
    const base = projectCube(cubeView({ yaw: 0.5, pitch: 0.3, zoom: 1 }, 800, 600), 0, 0, 0);
    const up = projectCube(cubeView({ yaw: 0.5, pitch: 0.3, zoom: 1, offsetY: 0.4 }, 800, 600), 0, 0, 0);
    expect(up.sx).toBeCloseTo(base.sx, 3);
    expect(up.sy).toBeCloseTo(base.sy - 0.4 * 300, 3);
  });

  it("skips ghosted voxels outside the active slice when picking", () => {
    const cube = buildDataCube(rows, columns, { xField: "region", yField: "product", zField: "year" })!;
    const v = cubeView({ yaw: 0.6, pitch: 0.4, zoom: 1 }, 800, 600);
    const target = cube.cells.find((c) => c.zi === 0)!;
    const p = projectCube(v, ...cubeCellCenter(cube, target.xi, target.yi, target.zi));
    expect(pickDataCubeCell(cube, v, p.sx, p.sy, { slice: 0 })?.zi).toBe(0);
    expect(pickDataCubeCell(cube, v, p.sx, p.sy, { slice: 2 })?.zi ?? 2).toBe(2);
  });
});
