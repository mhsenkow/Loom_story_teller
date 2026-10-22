import { describe, expect, it } from "vitest";
import {
  buildShareDataSnapshot,
  chartEncodedColumnNames,
  defaultIncludeShareData,
  parseShareDataSnapshot,
  SHARE_DATA_MAX_ROWS,
  sharedStoryPath,
  storyIdFromHash,
  storyIdFromSharedPath,
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

  it("limits snapshot to chart-encoded columns", () => {
    const snap = buildShareDataSnapshot({
      sample: {
        columns: ["x", "y", "secret", "z"],
        types: ["DOUBLE", "DOUBLE", "VARCHAR", "DOUBLE"],
        rows: [[1, 2, "ssn", 3]],
        total_rows: 1,
      },
      file: { path: "/tmp/local.csv", name: "local.csv" },
      chart: {
        src: "file:local.csv",
        chart: { kind: "scatter", xField: "x", yField: "y" },
      },
      columns: chartEncodedColumnNames({
        src: "file:local.csv",
        chart: { kind: "scatter", xField: "x", yField: "y" },
      }),
    });
    expect(snap?.columns).toEqual(["x", "y"]);
    expect(snap?.rows[0]).toEqual([1, 2]);
  });

  it("keeps shape and emoji encoding columns in shared snapshots", () => {
    expect(
      chartEncodedColumnNames({
        src: "file:local.csv",
        chart: {
          kind: "scatter",
          xField: "x",
          yField: "y",
          shapeField: "group",
          emojiField: "mood",
        },
      }),
    ).toEqual(["x", "y", "group", "mood"]);
  });

  it("defaults include-data off for local files and on for streams", () => {
    expect(defaultIncludeShareData({ path: "/Users/me/secret.csv" })).toBe(false);
    expect(defaultIncludeShareData({ path: "web://upload/foo.csv" })).toBe(false);
    expect(defaultIncludeShareData({ path: "stream://usgs" })).toBe(true);
    expect(
      defaultIncludeShareData({
        path: "web://catalog/a.csv",
        sourceUrl: "https://example.com/a.csv",
      }),
    ).toBe(true);
  });

  it("rejects object cells and javascript: source URLs", () => {
    expect(
      parseShareDataSnapshot({
        v: 1,
        capturedAt: "2026-01-01T00:00:00.000Z",
        source: { label: "x", path: "web://x", url: "javascript:alert(1)" },
        columns: ["a"],
        types: ["VARCHAR"],
        rows: [[{ evil: true }]],
        totalRows: 1,
        truncated: false,
      }),
    ).toBeNull();

    const cleaned = parseShareDataSnapshot({
      v: 1,
      capturedAt: "2026-01-01T00:00:00.000Z",
      source: { label: "x", path: "web://x", url: "javascript:alert(1)" },
      columns: ["a"],
      types: ["VARCHAR"],
      rows: [["ok"]],
      totalRows: 1,
      truncated: false,
    });
    expect(cleaned).toBeTruthy();
    expect(cleaned!.source.url).toBeUndefined();
  });
});

describe("story id parsing", () => {
  it("accepts the Worker's 32-hex ids in hashes and shared paths", () => {
    const id = "a".repeat(32);
    expect(storyIdFromHash(`#story=${id}`)).toBe(id);
    expect(storyIdFromSharedPath(sharedStoryPath(id))).toBe(id);
  });

  it("still accepts short ids and ignores trailing params", () => {
    expect(storyIdFromHash("#story=abc12345")).toBe("abc12345");
    expect(storyIdFromHash("#story=abc12345&x=1")).toBe("abc12345");
  });

  it("rejects ids that are too long", () => {
    expect(storyIdFromHash(`#story=${"b".repeat(33)}`)).toBeNull();
    expect(storyIdFromSharedPath(sharedStoryPath("b".repeat(33)))).toBeNull();
  });
});
