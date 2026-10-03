// =================================================================
// Discover hook unit tests
// =================================================================

import { describe, it, expect } from "vitest";
import { DISCOVER_SEEN_KEY, DISCOVER_STORY_LIMIT } from "../discoverStories";
import { ALL_SOURCE_KINDS } from "../tauri";

describe("discoverStories", () => {
  it("exports the dismiss key used by Onboarding", () => {
    expect(DISCOVER_SEEN_KEY).toBe("loom-discover-v1");
  });

  it("scans every live SourceKind plus room for wiki variants", () => {
    expect(ALL_SOURCE_KINDS.length).toBe(30);
    expect(DISCOVER_STORY_LIMIT).toBeGreaterThanOrEqual(ALL_SOURCE_KINDS.length * 2);
  });
});
