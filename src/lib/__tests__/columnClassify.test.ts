import { describe, expect, it } from "vitest";
import { inferColumnType } from "../columnClassify";
import { parseCsvToInspectResult } from "../mock-data";
import { recommend } from "../recommendations";

describe("inferColumnType: year columns", () => {
  it("treats whole-number DOUBLE years (web/iOS uploads) as temporal", () => {
    expect(inferColumnType("DOUBLE", "year", "1980", "2019")).toBe("temporal");
    expect(inferColumnType("BIGINT", "year", "1980", "2019")).toBe("temporal");
  });

  it("keeps fractional or non-year DOUBLE columns quantitative", () => {
    expect(inferColumnType("DOUBLE", "year", "1980.5", "2019")).toBe("quantitative");
    expect(inferColumnType("DOUBLE", "gdp", "1980", "2019")).toBe("quantitative");
  });

  it("recommends a line over year for an uploaded CSV", () => {
    const lines = ["year,country,gdp"];
    for (let y = 1980; y < 2000; y++) lines.push(`${y},A,${y - 1970}`, `${y},B,${(y - 1975) * 2}`);
    const { stats, sample } = parseCsvToInspectResult("gdp.csv", lines.join("\n"));
    const recs = recommend(stats, sample, "gdp.csv");
    expect(recs.some((r) => r.kind === "line" && r.xField === "year")).toBe(true);
  });
});

describe("inferColumnType: time-ish names on text columns", () => {
  it("does not treat categories or people as time", () => {
    expect(inferColumnType("VARCHAR", "incident_type", "fire", "flood")).toBe("nominal");
    expect(inferColumnType("VARCHAR", "created_by", "alice", "zed")).toBe("nominal");
    expect(inferColumnType("VARCHAR", "time_zone", "America/Chicago", "UTC")).toBe("nominal");
    expect(inferColumnType("VARCHAR", "day", "Friday", "Tuesday")).toBe("nominal");
  });

  it("keeps real time text temporal", () => {
    expect(inferColumnType("VARCHAR", "created", "2024-01-02", "2024-03-01")).toBe("temporal");
    expect(inferColumnType("VARCHAR", "year", "1999", "2020")).toBe("temporal");
    expect(inferColumnType("VARCHAR", "date", null, null)).toBe("temporal");
  });
});
