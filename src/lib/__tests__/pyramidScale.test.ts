import { describe, expect, it } from "vitest";
import { resolvePyramidScaleMode } from "../pyramidScale";

describe("resolvePyramidScaleMode", () => {
  it("honors explicit shared / independent", () => {
    expect(resolvePyramidScaleMode("shared", 1, 1000)).toBe("shared");
    expect(resolvePyramidScaleMode("independent", 10, 12)).toBe("independent");
  });

  it("auto uses independent when magnitudes diverge", () => {
    expect(resolvePyramidScaleMode("auto", 250_000_000, 2_000_000)).toBe("independent");
    expect(resolvePyramidScaleMode(null, 250_000_000, 2_000_000)).toBe("independent");
  });

  it("auto shares when arms are comparable", () => {
    expect(resolvePyramidScaleMode("auto", 48, 52)).toBe("shared");
    expect(resolvePyramidScaleMode("auto", 100, 400)).toBe("shared");
  });
});
