import { describe, expect, it } from "vitest";
import { directedUnit, packChannelInvert, unpackChannelInvert } from "../channelInvert";

describe("channel invert", () => {
  it("sends a high value to the low end of the mark", () => {
    expect(directedUnit(1, true)).toBe(0);
    expect(directedUnit(0, true)).toBe(1);
    expect(directedUnit(0.25, true)).toBeCloseTo(0.75);
    expect(directedUnit(0.25, false)).toBeCloseTo(0.25);
  });

  it("round-trips the chart-link token", () => {
    const packed = packChannelInvert({ size: true, color: true, z: true });
    expect(packed).toBe("scz");
    expect(unpackChannelInvert(packed)).toEqual({ size: true, color: true, z: true });
    expect(packChannelInvert({})).toBeUndefined();
  });
});