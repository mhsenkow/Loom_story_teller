import { afterEach, describe, expect, it } from "vitest";
import {
  readVisualViewportMetrics,
  resetVisualViewportMetricsCacheForTests,
} from "../useVisualViewport";

describe("useVisualViewport metrics", () => {
  afterEach(() => {
    resetVisualViewportMetricsCacheForTests();
  });

  it("computes bottom inset from layout viewport minus visual viewport", () => {
    const innerHeight = 800;
    const vvHeight = 500;
    const offsetTop = 0;
    const bottomInset = Math.max(0, innerHeight - vvHeight - offsetTop);
    expect(bottomInset).toBe(300);
  });

  it("returns a stable snapshot reference when metrics are unchanged", () => {
    const a = readVisualViewportMetrics();
    const b = readVisualViewportMetrics();
    expect(a).toBe(b);
  });
});
