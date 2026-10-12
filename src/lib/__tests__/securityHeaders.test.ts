import { describe, it, expect } from "vitest";
import { applyBaselineSecurityHeaders, BASELINE_SECURITY_HEADERS } from "../securityHeaders";

describe("securityHeaders", () => {
  it("sets baseline headers on a Headers object", () => {
    const h = new Headers();
    applyBaselineSecurityHeaders(h);
    for (const [key, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
      expect(h.get(key)).toBe(value);
    }
  });

  it("does not overwrite existing values", () => {
    const h = new Headers({ "X-Frame-Options": "DENY" });
    applyBaselineSecurityHeaders(h);
    expect(h.get("X-Frame-Options")).toBe("DENY");
  });
});
