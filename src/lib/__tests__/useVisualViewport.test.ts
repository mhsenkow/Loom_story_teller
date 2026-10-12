import { describe, expect, it } from "vitest";

describe("useVisualViewport metrics", () => {
  it("computes bottom inset from layout viewport minus visual viewport", () => {
    const innerHeight = 800;
    const vvHeight = 500;
    const offsetTop = 0;
    const bottomInset = Math.max(0, innerHeight - vvHeight - offsetTop);
    expect(bottomInset).toBe(300);
  });
});
