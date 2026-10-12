import { describe, expect, it } from "vitest";
import { extractScatterCacheKey } from "../extractScatterCacheKey";

describe("extractScatterCacheKey", () => {
  it("changes when row count changes", () => {
    const a = extractScatterCacheKey({ chartId: "c", path: "p", xField: "x", yField: "y", rowCount: 10, densityBucket: 1 });
    const b = extractScatterCacheKey({ chartId: "c", path: "p", xField: "x", yField: "y", rowCount: 11, densityBucket: 1 });
    expect(a).not.toBe(b);
  });
});
