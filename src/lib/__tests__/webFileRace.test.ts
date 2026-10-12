// =================================================================
// webFileStore race policy (LOOM-560)
// =================================================================

import { describe, expect, it } from "vitest";
import { shouldAcceptWebFilePut } from "../webFileStore";

describe("shouldAcceptWebFilePut", () => {
  it("rejects puts stale relative to a delete tombstone", () => {
    expect(
      shouldAcceptWebFilePut(
        { path: "web://a.csv", updatedAt: 100, revision: 100 },
        null,
        { deletedAt: 200, revision: 200 },
      ),
    ).toBe(false);
  });

  it("accepts a newer reimport after delete", () => {
    expect(
      shouldAcceptWebFilePut(
        { path: "web://a.csv", updatedAt: 300, revision: 300 },
        null,
        { deletedAt: 200, revision: 200 },
      ),
    ).toBe(true);
  });

  it("keeps newest-wins against an older existing row", () => {
    expect(
      shouldAcceptWebFilePut(
        { path: "web://a.csv", updatedAt: 50, revision: 50 },
        { updatedAt: 100, revision: 100 },
        null,
      ),
    ).toBe(false);
    expect(
      shouldAcceptWebFilePut(
        { path: "web://a.csv", updatedAt: 150, revision: 150 },
        { updatedAt: 100, revision: 100 },
        null,
      ),
    ).toBe(true);
  });
});
