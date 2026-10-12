import { describe, expect, it } from "vitest";
import { clampSmartInt, SMART_TOP_N } from "../smartInputClamp";

describe("smartInputClamp", () => {
  it("clamps top N", () => {
    expect(clampSmartInt(9999, SMART_TOP_N)).toBe(500);
    expect(clampSmartInt(0, SMART_TOP_N)).toBe(2);
  });
});
