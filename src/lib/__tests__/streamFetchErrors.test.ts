import { describe, expect, it } from "vitest";
import { formatStreamFetchError } from "../webStreams";

describe("formatStreamFetchError", () => {
  it("maps abort, offline, and rate limit cases", () => {
    expect(formatStreamFetchError("usgs", new DOMException("aborted", "AbortError"))).toMatch(/timed out/i);
    expect(formatStreamFetchError("usgs", new Error("Failed to fetch"))).toMatch(/offline/i);
    expect(formatStreamFetchError("usgs", new Error("Source usgs failed (429)"))).toMatch(/Rate-limited/i);
  });
});
