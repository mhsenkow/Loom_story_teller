/**
 * LOOM-197 — dataset loaded → recommend → select goes through one helper.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { activateDataset, applyQueryResult, shortlistFor, shortlistForPath, statsForQueryResult } from "../datasetPipeline";
import { useLoomStore } from "../store";
import type { ColumnInfo, FileEntry, QueryResult } from "../store";
import { recommend } from "../recommendations";

const stats: ColumnInfo[] = [
  { name: "region", data_type: "VARCHAR", null_count: 0, distinct_count: 3, min_value: null, max_value: null },
  { name: "sales", data_type: "DOUBLE", null_count: 0, distinct_count: 40, min_value: "1", max_value: "90" },
  { name: "units", data_type: "DOUBLE", null_count: 0, distinct_count: 40, min_value: "1", max_value: "50" },
];
const sample: QueryResult = {
  columns: ["region", "sales", "units"],
  types: ["VARCHAR", "DOUBLE", "DOUBLE"],
  rows: [
    ["East", 10, 3],
    ["West", 20, 5],
    ["North", 30, 8],
    ["East", 15, 4],
  ],
  total_rows: 4,
};
const fileA: FileEntry = { path: "web://a.csv", name: "a.csv", extension: "csv", row_count: 4, size_bytes: 10 };
const fileB: FileEntry = { path: "web://b.csv", name: "b.csv", extension: "csv", row_count: 4, size_bytes: 10 };

const get = () => useLoomStore.getState();

beforeEach(() => get().reset());

describe("activateDataset", () => {
  it("recommends and selects the first chart in one step", () => {
    const { charts, active } = activateDataset({ file: fileA, stats, sample });
    expect(charts.length).toBeGreaterThan(0);
    expect(active).toBe(charts[0]);
    expect(get().selectedFile?.path).toBe(fileA.path);
    expect(get().columnStats).toBe(stats);
    expect(get().sampleRows).toBe(sample);
    expect(get().chartRecs.map((c) => c.id)).toEqual(charts.map((c) => c.id));
    expect(get().activeChart?.id).toBe(charts[0]!.id);
    expect(get().vegaSpec).toBe(charts[0]!.spec);
    expect(charts.length).toBe(recommend(stats, sample, fileA.name).length);
  });

  it("patches a deferred zero row_count from the sample and updates the file list", () => {
    const zeroed: FileEntry = { ...fileA, row_count: 0 };
    get().setFiles([zeroed]);
    activateDataset({ file: zeroed, stats, sample });
    expect(get().selectedFile?.row_count).toBe(4);
    expect(get().files.find((f) => f.path === fileA.path)?.row_count).toBe(4);
  });

  it("clears per-dataset state left by the previous dataset", () => {
    activateDataset({ file: fileA, stats, sample });
    get().setSelectedRowIndices([1, 2]);
    get().setTableColumnFilters({ region: "East" });
    get().setLassoPoints([{ x: 1, y: 2 }]);
    get().setChartTitleOverride("some-chart", "Custom");
    get().setQuerySql("select 1");

    activateDataset({ file: fileB, stats, sample });
    const s = get();
    expect(s.selectedRowIndices).toEqual([]);
    expect(s.tableColumnFilters).toEqual({});
    expect(s.lassoPoints).toEqual([]);
    expect(s.chartTitleOverrides).toEqual({});
    expect(s.querySql).toBe("");
    expect(s.selectedFile?.path).toBe(fileB.path);
  });

  it("honors an explicit chart order, selection and null selection", () => {
    const charts = recommend(stats, sample, fileA.name);
    expect(charts.length).toBeGreaterThan(1);
    const picked = charts[1]!;
    const res = activateDataset({ file: fileA, stats, sample, charts, active: picked });
    expect(res.active).toBe(picked);
    expect(get().activeChart?.id).toBe(picked.id);

    activateDataset({ file: fileB, stats, sample, charts: [], active: null });
    expect(get().activeChart).toBeNull();
    expect(get().chartRecs).toEqual([]);
    expect(get().vegaSpec).toBeNull();
  });

  it("applies extra fields atomically and the none shortlist yields no charts", () => {
    activateDataset({
      file: fileA,
      stats,
      sample,
      shortlist: { type: "none" },
      extra: { viewMode: "dive", panelTab: "stats" },
    });
    expect(get().viewMode).toBe("dive");
    expect(get().panelTab).toBe("stats");
    expect(get().chartRecs).toEqual([]);
    expect(get().activeChart).toBeNull();
  });
});

describe("shortlistFor / shortlistForPath", () => {
  it("routes stream paths to the right recommender", () => {
    expect(shortlistForPath("stream://wiki")).toEqual({ type: "stream" });
    expect(shortlistForPath("stream://usgs")).toEqual({ type: "source", kind: "usgs" });
    expect(shortlistForPath("stream://unknown_kind")).toEqual({ type: "file" });
    expect(shortlistForPath("web://a.csv")).toEqual({ type: "file" });
  });

  it("file shortlist is the file recommender; none is empty", () => {
    expect(shortlistFor({ type: "file" }, fileA, stats, sample).length).toBe(
      recommend(stats, sample, fileA.name).length,
    );
    expect(shortlistFor({ type: "none" }, fileA, stats, sample)).toEqual([]);
  });
});

describe("applyQueryResult", () => {
  it("derives type-only stats from the result columns", () => {
    const s = statsForQueryResult(sample);
    expect(s.map((c) => c.name)).toEqual(sample.columns);
    expect(s.map((c) => c.data_type)).toEqual(sample.types);
  });

  it("swaps sample/stats/charts but keeps the open file and its filters", () => {
    activateDataset({ file: fileA, stats, sample });
    get().setTableColumnFilters({ region: "East" });
    const result: QueryResult = { ...sample, rows: sample.rows.slice(0, 2), total_rows: 2 };
    const { charts, active } = applyQueryResult(result, "a.csv");
    expect(get().selectedFile?.path).toBe(fileA.path);
    expect(get().sampleRows).toBe(result);
    expect(get().chartRecs).toBe(charts);
    expect(get().activeChart).toBe(active);
    expect(get().tableColumnFilters).toEqual({ region: "East" });
  });
});
