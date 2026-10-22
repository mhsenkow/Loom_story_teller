/**
 * View tab names: copy must use the name the tab strip shows at the current width.
 */
import { describe, it, expect } from "vitest";
import { VIEW_MODES, viewModeName } from "../viewModes";

describe("viewModeName", () => {
  it("uses the full label on wide screens and the short tab name on phones", () => {
    expect(viewModeName("explorer", false)).toBe("Explorer");
    expect(viewModeName("explorer", true)).toBe("Table");
    expect(viewModeName("monitor", true)).toBe("Watch");
  });

  it("falls back to the full label when there is no window (static export)", () => {
    expect(viewModeName("query")).toBe("Query");
  });

  it("never reuses the sidebar's \"Data\" name for a tab", () => {
    for (const m of VIEW_MODES) expect([m.label, m.short]).not.toContain("Data");
  });
});
