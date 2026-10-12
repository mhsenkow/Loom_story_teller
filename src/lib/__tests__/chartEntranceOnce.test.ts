import { describe, expect, it, beforeEach } from "vitest";
import {
  chartEntranceKey,
  markChartEntrancePlayed,
  resetChartEntrancePlayedForTests,
  shouldPlayChartEntrance,
} from "../chartEntranceOnce";

describe("chartEntranceOnce", () => {
  beforeEach(() => resetChartEntrancePlayedForTests());

  it("plays once per key", () => {
    const key = chartEntranceKey("a", "bar");
    expect(shouldPlayChartEntrance(key, true)).toBe(true);
    markChartEntrancePlayed(key);
    expect(shouldPlayChartEntrance(key, true)).toBe(false);
  });
});
