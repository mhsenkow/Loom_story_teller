// =================================================================
// chartTime — parse timestamps and slice rows by a window
// =================================================================

import { describe, expect, it } from "vitest";
import {
  applyChartTimeWindow,
  chartTimeRangeOptions,
  columnLooksTemporal,
  parseChartTime,
  suggestedChartTimeWindows,
  timeColumnSpanMs,
} from "../chartTime";

describe("chartTime", () => {
  it("treats DATE/TIMESTAMP and ts-like names as temporal", () => {
    expect(columnLooksTemporal("TIMESTAMP", "created_at")).toBe(true);
    expect(columnLooksTemporal("DATE", "record_date")).toBe(true);
    expect(columnLooksTemporal("BIGINT", "ts")).toBe(true);
    expect(columnLooksTemporal("VARCHAR", "title")).toBe(false);
  });

  it("parses ISO, epoch ms/s, and year integers", () => {
    expect(parseChartTime("2026-10-06T12:00:00Z")).toBe(Date.parse("2026-10-06T12:00:00Z"));
    expect(parseChartTime(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(parseChartTime(1_700_000_000)).toBe(1_700_000_000_000);
    expect(parseChartTime(2020)).toBe(Date.UTC(2020, 0, 1));
    expect(parseChartTime("n/a")).toBeNull();
  });

  it("filters from the newest parseable value", () => {
    const t0 = Date.parse("2026-10-06T00:00:00Z");
    const rows = [
      [new Date(t0 - 3 * 86_400_000).toISOString(), "old"],
      [new Date(t0 - 2 * 3_600_000).toISOString(), "recent"],
      [new Date(t0).toISOString(), "newest"],
    ];
    const out = applyChartTimeWindow(rows, ["ts", "label"], {
      timeWindowField: "ts",
      timeWindow: "24h",
    });
    expect(out.filtered).toBe(true);
    expect(out.kept).toBe(2);
    expect(out.rows.map((r) => r[1])).toEqual(["recent", "newest"]);
  });

  it("leaves rows alone for All or a missing column", () => {
    const rows = [["2026-01-01", 1]];
    expect(applyChartTimeWindow(rows, ["ts"], { timeWindowField: "ts", timeWindow: "all" }).filtered).toBe(false);
    expect(applyChartTimeWindow(rows, ["ts"], { timeWindowField: "date", timeWindow: "7d" }).rows).toBe(rows);
  });

  it("hides presets wider than the sample span", () => {
    const sixHours = [
      [Date.parse("2026-10-06T00:00:00Z"), 1],
      [Date.parse("2026-10-06T06:00:00Z"), 2],
    ];
    const opts = chartTimeRangeOptions(timeColumnSpanMs(sixHours, 0));
    expect(opts[0]).toBe("all");
    expect(opts).toContain("1h");
    expect(opts).not.toContain("7d");
    expect(opts).not.toContain("1y");
  });

  it("suggestedChartTimeWindows matches column cadence", () => {
    expect(suggestedChartTimeWindows("ts")).toEqual(["1h", "6h", "24h"]);
    expect(suggestedChartTimeWindows("created_date")).toEqual(["7d", "30d", "90d"]);
    expect(suggestedChartTimeWindows("yr")).toEqual(["1y"]);
  });
});
