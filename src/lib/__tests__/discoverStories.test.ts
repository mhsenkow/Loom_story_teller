// =================================================================
// Discover hook unit tests
// =================================================================

import { describe, it, expect } from "vitest";
import { DISCOVER_SEEN_KEY, DISCOVER_STORY_LIMIT, VARIANTS_PER_SOURCE } from "../discoverStories";
import { ALL_SOURCE_KINDS } from "../tauri";
import { SOURCE_BY_KIND, SOURCE_DEFS, sortRowsByOrderBy } from "../sourceRegistry";

describe("discoverStories", () => {
  it("exports the dismiss key used by Onboarding", () => {
    expect(DISCOVER_SEEN_KEY).toBe("loom-discover-v1");
  });

  it("keeps room for many chart variants across every live feed", () => {
    expect(ALL_SOURCE_KINDS.length).toBe(34);
    expect(VARIANTS_PER_SOURCE).toBeGreaterThanOrEqual(20);
    expect(DISCOVER_STORY_LIMIT).toBeGreaterThanOrEqual(10_000);
    expect(DISCOVER_STORY_LIMIT).toBeGreaterThanOrEqual(ALL_SOURCE_KINDS.length * VARIANTS_PER_SOURCE);
  });

  it("sortRowsByOrderBy puts soonest launches first (net ASC)", () => {
    const cols = ["name", "net"];
    const rows = [
      ["Late", "2026-12-01T00:00:00Z"],
      ["Soon", "2026-10-08T12:00:00Z"],
      ["Mid", "2026-11-01T00:00:00Z"],
    ];
    const ordered = sortRowsByOrderBy(rows, cols, "net ASC");
    expect(ordered.map((r) => r[0])).toEqual(["Soon", "Mid", "Late"]);
  });

  it("sortRowsByOrderBy honors DESC and multi-key clauses", () => {
    const cols = ["as_of", "quote", "rate"];
    const rows = [
      ["2026-01-01", "USD", 1.1],
      ["2026-01-02", "JPY", 160],
      ["2026-01-02", "USD", 1.08],
    ];
    const ordered = sortRowsByOrderBy(rows, cols, "as_of DESC, quote");
    expect(ordered[0]).toEqual(["2026-01-02", "JPY", 160]);
    expect(ordered[1]).toEqual(["2026-01-02", "USD", 1.08]);
  });

  it("every live source has an orderBy Discover/web snapshots can apply", () => {
    for (const def of SOURCE_DEFS) {
      expect(def.orderBy.trim().length).toBeGreaterThan(0);
      expect(SOURCE_BY_KIND[def.kind].orderBy).toBe(def.orderBy);
    }
  });
});
