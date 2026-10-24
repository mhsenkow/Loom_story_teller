import { describe, it, expect } from "vitest";
import { rollingStd } from "../dsTransforms";

describe("rollingStd", () => {
  it("is zero on a flat series and matches the population sd of the window", () => {
    expect(rollingStd([5, 5, 5, 5], 3)).toEqual([0, 0, 0, 0]);
    const out = rollingStd([1, 2, 3, 4], 2);
    expect(out[0]).toBe(0);
    for (const v of out.slice(1)) expect(v).toBeCloseTo(0.5, 10);
  });
});
