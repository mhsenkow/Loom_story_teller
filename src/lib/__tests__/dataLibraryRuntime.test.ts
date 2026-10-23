import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateCombination, openCombination } from "../dataLibraryRuntime";
import { sourceStart, sourceSnapshot, sourceStatus } from "../tauri";
import { activateDataset } from "../datasetPipeline";
import type { DataCombination } from "../dataLibrary";
vi.mock("../tauri", () => ({
  sourceStart: vi.fn(),
  sourceSnapshot: vi.fn(),
  sourceStatus: vi.fn(),
  streamStart: vi.fn(),
  streamSnapshot: vi.fn(),
  fetchCsvTextWeb: vi.fn(),
  inspectFile: vi.fn(),
  isDesktop: () => false,
}));
vi.mock("../datasetPipeline", () => ({
  activateDataset: vi.fn(),
  statsForQueryResult: vi.fn(() => []),
}));
const recipe: DataCombination = {
  id: "live",
  name: "Live lookup",
  left: { ref: "feed:usgs", name: "Quakes" },
  right: { ref: "feed:meteo", name: "Weather" },
  leftKey: "id",
  rightKey: "id",
  mode: "left",
  createdAt: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sourceStatus).mockResolvedValue({
    running: true,
    total_events: 1,
    events_per_sec: 0,
    buffer_rows: 1,
    started_at: 0,
    uptime_secs: 1,
  });
});
describe("combination refresh", () => {
  it("re-reads both live buffers every time and uses changed values", async () => {
    let value = 1;
    vi.mocked(sourceSnapshot).mockImplementation(async () => ({
      stats: [],
      sample: {
        columns: ["id", "value"],
        types: ["VARCHAR", "DOUBLE"],
        rows: [["A", value]],
        total_rows: 1,
      },
    }));
    expect((await evaluateCombination(recipe)).sample.rows[0]).toEqual([
      "A",
      1,
      "A",
      1,
    ]);
    value = 2;
    expect((await evaluateCombination(recipe)).sample.rows[0]).toEqual([
      "A",
      2,
      "A",
      2,
    ]);
    expect(sourceStart).toHaveBeenCalledTimes(4);
  });
  it("does not relabel a stale feed snapshot as refreshed", async () => {
    vi.mocked(sourceStatus).mockResolvedValue({
      running: true,
      total_events: 1,
      events_per_sec: 0,
      buffer_rows: 1,
      started_at: 0,
      uptime_secs: 1,
      snapshot_stale: true,
    });
    await expect(evaluateCombination(recipe)).rejects.toThrow(
      /could not refresh/,
    );
  });
  it("does not replace the active dataset after the library was left during a load", async () => {
    vi.mocked(sourceSnapshot).mockResolvedValue({
      stats: [],
      sample: {
        columns: ["id"],
        types: ["VARCHAR"],
        rows: [["A"]],
        total_rows: 1,
      },
    });
    await openCombination(recipe, () => false);
    expect(activateDataset).not.toHaveBeenCalled();
  });
});
