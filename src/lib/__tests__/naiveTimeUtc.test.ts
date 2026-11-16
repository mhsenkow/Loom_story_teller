/**
 * Zoneless date-times must read as UTC so they line up with the UTC axis
 * ticks. Runs with the process zone set to Tokyo (UTC+9), where local
 * parsing would shift every point by nine hours.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildXModel, classifyKeys, timeTicks } from "../chartAxes";
import { parseChartTime, parseNaiveUtc } from "../chartTime";

const prevTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "Asia/Tokyo";
});

afterAll(() => {
  if (prevTz === undefined) delete process.env.TZ;
  else process.env.TZ = prevTz;
});

describe("naive date-times parse as UTC", () => {
  it("runs in a non-UTC zone", () => {
    expect(new Date(Date.UTC(2024, 2, 15)).getTimezoneOffset()).toBe(-540);
  });

  it("parseNaiveUtc reads zoneless shapes as UTC and keeps explicit zones", () => {
    expect(parseNaiveUtc("2024-03-15 10:00:00")).toBe(Date.UTC(2024, 2, 15, 10));
    expect(parseNaiveUtc("2024-03-15T10:00")).toBe(Date.UTC(2024, 2, 15, 10));
    expect(parseNaiveUtc("2024-03-15T10:00:00.250")).toBe(Date.UTC(2024, 2, 15, 10, 0, 0, 250));
    expect(parseNaiveUtc("3/15/2024")).toBe(Date.UTC(2024, 2, 15));
    expect(parseNaiveUtc("3/15/24")).toBe(Date.UTC(2024, 2, 15));
    expect(parseNaiveUtc("2024-03-15T10:00:00+02:00")).toBe(Date.UTC(2024, 2, 15, 8));
    expect(parseNaiveUtc("2024-03-15T10:00:00Z")).toBe(Date.UTC(2024, 2, 15, 10));
    expect(parseNaiveUtc("13/40/2024")).toBeNaN();
  });

  it("axis domain and first tick match the raw hour", () => {
    const m = buildXModel(["2024-03-15 10:00:00", "2024-03-15 12:00:00"]);
    expect(m.kind).toBe("time");
    expect(m.domain![0]).toBe(Date.UTC(2024, 2, 15, 10));
    const t = timeTicks(m.domain![0], m.domain![1]);
    expect(t.format(t.ticks[0]!)).toBe("10:00");
  });

  it("M/D/YYYY keys land on their UTC day", () => {
    expect(classifyKeys(["3/15/2024", "3/16/2024"]).values[0]).toBe(Date.UTC(2024, 2, 15));
  });

  it("parseChartTime agrees with the axis", () => {
    expect(parseChartTime("2024-03-15 10:00:00")).toBe(Date.UTC(2024, 2, 15, 10));
    expect(parseChartTime("3/15/2024")).toBe(Date.UTC(2024, 2, 15));
  });
});
