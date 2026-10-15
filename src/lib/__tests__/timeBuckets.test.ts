import { describe, expect, it } from "vitest";
import { timeBuckets } from "../canvasCharts/axisHelpers";

const rowsEvery = (startMs: number, stepMs: number, n: number) =>
  Array.from({ length: n }, (_, i) => [new Date(startMs + i * stepMs).toISOString(), i]);

const T0 = Date.UTC(2026, 9, 12, 0, 0, 0);

describe("timeBuckets", () => {
  it("keeps raw keys for small samples", () => {
    const tb = timeBuckets(rowsEvery(T0, 3_600_000, 40), 0);
    expect(tb.unit).toBe("");
  });

  it("buckets a two-day 15-minute feed by hour, not by day", () => {
    const rows = rowsEvery(T0, 15 * 60_000, 192);
    const tb = timeBuckets(rows, 0);
    expect(tb.unit).toBe("hour");
    const keys = new Set(rows.map(tb.keyOf));
    expect(keys.size).toBe(48);
    expect(Number.isFinite(Date.parse([...keys][0]!))).toBe(true);
  });

  it("leaves very short spans unbucketed", () => {
    const tb = timeBuckets(rowsEvery(T0, 60_000, 200), 0);
    expect(tb.unit).toBe("");
  });

  it("uses day / week / month as the span grows", () => {
    expect(timeBuckets(rowsEvery(T0, 3_600_000, 24 * 30), 0).unit).toBe("day");
    expect(timeBuckets(rowsEvery(T0, 86_400_000, 200), 0).unit).toBe("week");
    expect(timeBuckets(rowsEvery(T0, 3 * 86_400_000, 300), 0).unit).toBe("month");
  });
});
