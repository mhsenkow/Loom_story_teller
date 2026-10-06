import { describe, expect, it } from "vitest";
import {
  buildShareDataSnapshot,
  parseShareDataSnapshot,
  SHARE_DATA_MAX_ROWS,
  sharedStoryPath,
} from "../shareLineage";
import type { QueryResult } from "../store";

function sample(n: number): QueryResult {
  return {
    columns: ["x", "y"],
    types: ["DOUBLE", "DOUBLE"],
    rows: Array.from({ length: n }, (_, i) => [i, i * 2]),
    total_rows: n,
  };
}

describe("shareLineage", () => {
  it("builds a snapshot with source + rows", () => {
    const snap = buildShareDataSnapshot({
      sample: sample(10),
      file: { path: "stream://usgs", name: "USGS Quakes" },
      chart: {
        src: "stream://usgs",
        chart: { kind: "scatter", xField: "x", yField: "y" },
      },
    });
    expect(snap).toBeTruthy();
    expect(snap!.rows).toHaveLength(10);
    expect(snap!.source.label).toBe("USGS Quakes");
    expect(snap!.chart?.chart.kind).toBe("scatter");
    expect(parseShareDataSnapshot(JSON.parse(JSON.stringify(snap)))?.rows).toHaveLength(10);
  });

  it("caps very large tables", () => {
    const snap = buildShareDataSnapshot({
      sample: sample(SHARE_DATA_MAX_ROWS * 3),
      file: { path: "web://big.csv", name: "big.csv", sourceUrl: "https://example.com/big.csv" },
    });
    expect(snap).toBeTruthy();
    expect(snap!.rows.length).toBeLessThanOrEqual(SHARE_DATA_MAX_ROWS);
    expect(snap!.truncated).toBe(true);
    expect(snap!.totalRows).toBe(SHARE_DATA_MAX_ROWS * 3);
  });

  it("sharedStoryPath is stable", () => {
    expect(sharedStoryPath("abcdefghijkl")).toBe("web://shared/abcdefghijkl");
  });
});
