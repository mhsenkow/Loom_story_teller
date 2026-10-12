import { describe, it, expect } from "vitest";
import { sanitizeChartVisualOverrides } from "../chartVisualSanitize";

describe("sanitizeChartVisualOverrides", () => {
  it("drops unknown keys and clamps numeric overrides", () => {
    const out = sanitizeChartVisualOverrides({
      pointSize: 1e6,
      chartPadding: -500,
      evilKey: "x",
      showGrid: true,
    });
    expect(out?.pointSize).toBe(24);
    expect(out?.chartPadding).toBe(24);
    expect(out?.showGrid).toBe(true);
    expect(out).not.toHaveProperty("evilKey");
  });

  it("rejects invalid enum values", () => {
    const out = sanitizeChartVisualOverrides({ legendPosition: "center" as never, showGrid: true });
    expect(out?.legendPosition).toBeUndefined();
    expect(out?.showGrid).toBe(true);
  });
});
