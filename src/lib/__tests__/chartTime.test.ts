// =================================================================
// chartTime — parse timestamps and slice rows by a window
// =================================================================

import { describe, expect, it } from "vitest";
import {
  applyChartTimeWindow,
  chartDataTimeSpan,
  chartTimeAnchorMode,
  chartTimeRangeOptions,
  chartTimeWindowLabel,
  columnLooksTemporal,
  composeChartFootnote,
  fieldLooksFutureDated,
  formatChartTimeFootnote,
  formatChartTimeSpanRange,
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

  it("uses wall clock for live samples (not sample-max)", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    const rows = [
      [new Date(now - 3 * 86_400_000).toISOString(), "old"],
      [new Date(now - 2 * 3_600_000).toISOString(), "recent"],
      [new Date(now - 30 * 60_000).toISOString(), "newest"],
    ];
    const out = applyChartTimeWindow(
      rows,
      ["ts", "label"],
      { timeWindowField: "ts", timeWindow: "24h" },
      now,
    );
    expect(out.mode).toBe("wall");
    expect(out.kept).toBe(2);
    expect(out.rows.map((r) => r[1])).toEqual(["recent", "newest"]);
  });

  it("counts back from sample-max on historical files", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    const t0 = Date.parse("2019-06-01T00:00:00Z");
    const rows = [
      [new Date(t0 - 3 * 86_400_000).toISOString(), "old"],
      [new Date(t0 - 2 * 3_600_000).toISOString(), "recent"],
      [new Date(t0).toISOString(), "newest"],
    ];
    const out = applyChartTimeWindow(
      rows,
      ["ts", "label"],
      { timeWindowField: "ts", timeWindow: "24h" },
      now,
    );
    expect(out.mode).toBe("sample");
    expect(out.kept).toBe(2);
    expect(out.rows.map((r) => r[1])).toEqual(["recent", "newest"]);
  });

  it("uses a forward window for upcoming event times", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    const rows = [
      [new Date(now + 2 * 3_600_000).toISOString(), "soon"],
      [new Date(now + 3 * 86_400_000).toISOString(), "later"],
    ];
    const out = applyChartTimeWindow(
      rows,
      ["approach_ts", "label"],
      { timeWindowField: "approach_ts", timeWindow: "24h" },
      now,
    );
    expect(out.mode).toBe("forward");
    expect(out.kept).toBe(1);
    expect(out.rows[0]![1]).toBe("soon");
    expect(chartTimeWindowLabel("24h", "forward")).toBe("Next 24 hours");
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
    expect(suggestedChartTimeWindows("approach_ts")).toEqual(["24h", "7d", "30d"]);
    expect(fieldLooksFutureDated("net")).toBe(true);
  });

  it("classifies anchor modes from sample max vs now", () => {
    const now = 1_700_000_000_000;
    expect(chartTimeAnchorMode(now - 3_600_000, now)).toBe("wall");
    expect(chartTimeAnchorMode(now - 40 * 86_400_000, now)).toBe("sample");
    expect(chartTimeAnchorMode(now + 86_400_000, now)).toBe("forward");
  });

  it("formats multi-year and same-day spans for footnotes", () => {
    expect(formatChartTimeSpanRange(Date.UTC(2020, 0, 8), Date.UTC(2026, 9, 6))).toBe(
      "Jan 2020 – Oct 2026",
    );
    expect(formatChartTimeSpanRange(Date.UTC(2026, 9, 6), Date.UTC(2026, 9, 6))).toBe(
      "Oct 6, 2026",
    );
    const a = Date.parse("2026-10-06T08:00:00Z");
    const b = Date.parse("2026-10-06T18:30:00Z");
    expect(formatChartTimeSpanRange(a, b)).toBe("Oct 6, 2026 · 08:00–18:30 UTC");
  });

  it("builds a time footnote from Encoding Time even when Window is All", () => {
    const rows = [
      ["2020-01-08T00:00:00Z", "Flood"],
      ["2026-10-06T00:00:00Z", "Fire"],
    ];
    const line = formatChartTimeFootnote(
      rows,
      ["declarationDate", "incident_type"],
      { timeWindowField: "declarationDate", timeWindow: "all" },
    );
    expect(line).toBe("Jan 2020 – Oct 2026");
    expect(chartDataTimeSpan(rows, ["declarationDate", "incident_type"], "declarationDate")?.count).toBe(2);
  });

  it("prefixes the window label when a recent slice is active", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    const rows = [
      [new Date(now - 2 * 86_400_000).toISOString(), "a"],
      [new Date(now - 3_600_000).toISOString(), "b"],
    ];
    const line = formatChartTimeFootnote(
      rows,
      ["ts", "label"],
      { timeWindowField: "ts", timeWindow: "7d" },
    );
    expect(line).toMatch(/^Last 7 days · /);
  });

  it("composeChartFootnote stacks source over time", () => {
    expect(composeChartFootnote("FEMA · OpenFEMA", "Jan 2020 – Oct 2026")).toBe(
      "FEMA · OpenFEMA\nJan 2020 – Oct 2026",
    );
    expect(composeChartFootnote(null, "Oct 6, 2026")).toBe("Oct 6, 2026");
    expect(composeChartFootnote("FEMA", null)).toBe("FEMA");
  });
});
