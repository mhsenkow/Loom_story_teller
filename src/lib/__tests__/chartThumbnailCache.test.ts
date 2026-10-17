// Thumbnail rows must belong to the selected dataset and time field.
import { afterEach, describe, expect, it, vi } from "vitest";
import { downsampledRowsForThumb } from "../chartThumbnailCache";
import type { ChartRecommendation } from "../recommendations";
import type { QueryResult } from "../queryTypes";

const chart: ChartRecommendation = {
  id: "bar",
  kind: "bar",
  title: "Chart",
  subtitle: "",
  score: 80,
  spec: {},
  xField: "x",
  yField: "y",
  colorField: null,
};
const data = (rows: QueryResult["rows"]): QueryResult => ({
  columns: ["x", "y"],
  types: ["DOUBLE", "DOUBLE"],
  rows,
  total_rows: rows.length,
});

describe("thumbnail row cache", () => {
  afterEach(() => vi.useRealTimers());

  it("does not reuse rows from a different snapshot with identical columns and length", () => {
    const first = data([
      [1, 10],
      [2, 20],
    ]);
    const next = data([
      [1, 90],
      [2, 100],
    ]);
    expect(downsampledRowsForThumb(first, chart)).toEqual(first.rows);
    expect(downsampledRowsForThumb(next, chart)).toEqual(next.rows);
    expect(downsampledRowsForThumb(next, chart)).toBe(
      downsampledRowsForThumb(next, chart),
    );
  });

  it("keys time windows by their timestamp field", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    const snapshot: QueryResult = {
      columns: ["x", "created_at", "updated_at"],
      types: ["VARCHAR", "TIMESTAMP", "TIMESTAMP"],
      total_rows: 2,
      rows: [
        ["A", "2026-10-15T11:30:00Z", "2026-10-15T09:00:00Z"],
        ["B", "2026-10-15T09:00:00Z", "2026-10-15T11:30:00Z"],
      ],
    };
    expect(
      downsampledRowsForThumb(snapshot, {
        ...chart,
        timeWindow: "1h",
        timeWindowField: "created_at",
      }),
    ).toEqual([snapshot.rows[0]]);
    expect(
      downsampledRowsForThumb(snapshot, {
        ...chart,
        timeWindow: "1h",
        timeWindowField: "updated_at",
      }),
    ).toEqual([snapshot.rows[1]]);
  });

  it("honors the point budget without sampling aggregate previews", () => {
    const snapshot = data(
      Array.from({ length: 10 }, (_, index) => [index, index]),
    );
    expect(downsampledRowsForThumb(snapshot, chart, 3)).toHaveLength(3);
    expect(downsampledRowsForThumb(snapshot, chart, Infinity)).toHaveLength(10);
  });
});
