import { describe, it, expect } from "vitest";
import { formatChartNumber } from "../formatChartNumber";

describe("formatChartNumber", () => {
  it("covers cube/dive cases", () => {
    expect(formatChartNumber(0.0004)).toBe("0.0004");
    expect(formatChartNumber(2024)).toBe("2024");
    expect(formatChartNumber(12345)).toBe("12.3K");
  });
});
