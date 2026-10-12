// =================================================================
// USGS payload guard (LOOM-095)
// =================================================================

import { describe, expect, it } from "vitest";
import { assertUsgsBody, parseSourceRows } from "../webStreams";

describe("USGS payload guard", () => {
  it("rejects malformed bodies with Unexpected USGS response", () => {
    expect(() => assertUsgsBody(null)).toThrow(/Unexpected USGS response/);
    expect(() => assertUsgsBody({})).toThrow(/Unexpected USGS response/);
    expect(() => assertUsgsBody({ features: "nope" })).toThrow(/Unexpected USGS response/);
  });

  it("parses a valid FeatureCollection", () => {
    const rows = parseSourceRows("usgs", {
      type: "FeatureCollection",
      features: [
        {
          id: "us1",
          properties: { mag: 4.2, place: "Test", time: Date.UTC(2026, 0, 1), magType: "ml", status: "reviewed", tsunami: 0, sig: 1, net: "us" },
          geometry: { coordinates: [-122.1, 37.2, 10] },
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe("us1");
    expect(rows[0]?.[1]).toBe(4.2);
  });
});
