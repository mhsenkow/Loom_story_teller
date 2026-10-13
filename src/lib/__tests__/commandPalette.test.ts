import { describe, expect, it } from "vitest";
import {
  COMMAND_PALETTE_CHIPS,
  searchCommandPalette,
  shouldSearchOpenDataCatalog,
} from "../commandPalette";

describe("searchCommandPalette", () => {
  it("returns chip-backed defaults when empty", () => {
    const hits = searchCommandPalette("");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.id === "view:explorer")).toBe(true);
  });

  it("matches short keywords", () => {
    expect(searchCommandPalette("share")[0]?.id).toBe("chrome:share");
    expect(searchCommandPalette("schema")[0]?.id).toBe("preview:schema");
  });

  it("matches polite sentences to views", () => {
    expect(searchCommandPalette("please open chart")[0]?.id).toBe("view:chart");
    expect(searchCommandPalette("go to query")[0]?.id).toBe("view:query");
  });

  it("routes ask phrases into Query NL", () => {
    const hit = searchCommandPalette("ask how many sites above flood stage")[0];
    expect(hit?.id).toBe("query:nl");
    expect(hit?.nlAsk).toMatch(/flood/i);
  });

  it("prefers chart vernacular over Query for show-me analysis talk", () => {
    expect(searchCommandPalette("show me the distribution")[0]?.id).toBe("chart:histogram");
    expect(searchCommandPalette("plot over time")[0]?.id).toBe("chart:line");
  });

  it("finds chart kinds from natural phrasing", () => {
    const hit = searchCommandPalette("make a bar chart").find((h) => h.id.startsWith("chart:"));
    expect(hit?.id).toBe("chart:bar");
  });

  it("resolves looks and extras from talk", () => {
    expect(searchCommandPalette("tufte")[0]?.id).toBe("look:tufte");
    expect(searchCommandPalette("100% stacked")[0]?.chartExtras?.barStackMode).toBe("percent");
  });

  it("uses column names in X vs Y talk", () => {
    const hit = searchCommandPalette("latitude vs longitude", {
      columns: ["latitude", "longitude", "site_name"],
    })[0];
    expect(hit?.id).toBe("chart:scatter");
    expect(hit?.fields).toEqual(expect.arrayContaining(["latitude", "longitude"]));
  });

  it("finds live sources", () => {
    const hit = searchCommandPalette("usgs river");
    expect(hit.some((h) => h.id === "source:nwis" || h.id === "source:usgs")).toBe(true);
  });

  it("ranks recent files when paths match", () => {
    const hit = searchCommandPalette("sales", {
      recentPaths: ["web://sales.csv"],
      recentLabels: { "web://sales.csv": "sales.csv" },
    });
    expect(hit[0]?.id).toBe("file:web://sales.csv");
  });

  it("exposes a short chip row", () => {
    expect(COMMAND_PALETTE_CHIPS.length).toBeGreaterThan(4);
    expect(COMMAND_PALETTE_CHIPS.map((c) => c.chip)).toContain("chart");
  });

  it("ranks vault uploads and catalog hits", () => {
    const hits = searchCommandPalette("flood", {
      vaultFiles: [{ path: "web://flood.csv", name: "flood.csv" }],
      catalogHits: [
        {
          url: "https://example.com/flood.csv",
          filename: "flood.csv",
          title: "Flood zones",
          portal: "data.gov",
        },
      ],
    });
    expect(hits.some((h) => h.id === "file:web://flood.csv")).toBe(true);
    expect(hits.some((h) => h.id.startsWith("catalog:") && h.catalog?.title === "Flood zones")).toBe(true);
  });

  it("only deep-searches catalog for dataset-like queries", () => {
    expect(shouldSearchOpenDataCatalog("ab")).toBe(false);
    expect(shouldSearchOpenDataCatalog("share")).toBe(false);
    expect(shouldSearchOpenDataCatalog("flood")).toBe(true);
  });
});
