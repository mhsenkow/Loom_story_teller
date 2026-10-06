import { describe, expect, it } from "vitest";
import {
  formatSourceFootnote,
  guessHomepageFromDataUrl,
  resolveDataProvenance,
} from "../dataProvenance";
import type { FileEntry } from "../store";

describe("dataProvenance", () => {
  it("resolves live USGS feed to homepage + credit", () => {
    const file: FileEntry = {
      path: "stream://usgs",
      name: "USGS Quakes",
      extension: "stream",
      row_count: 100,
      size_bytes: 0,
      sourceHome: "https://earthquake.usgs.gov/earthquakes/feed/",
      sourceCredit: "USGS · public domain",
    };
    const p = resolveDataProvenance(file, { loadedRows: 80, totalRows: 100 });
    expect(p?.kind).toBe("live");
    expect(p?.credit).toContain("USGS");
    expect(p?.links.some((l) => l.href.includes("usgs.gov"))).toBe(true);
    expect(p?.rowsLabel).toContain("80");
  });

  it("guesses OWID grapher homepage from CSV URL", () => {
    const url =
      "https://ourworldindata.org/grapher/co-emissions-per-capita.csv?v=1&csvType=full";
    expect(guessHomepageFromDataUrl(url)).toBe(
      "https://ourworldindata.org/grapher/co-emissions-per-capita",
    );
  });

  it("shared snapshot keeps origin path + capturedAt", () => {
    const file: FileEntry = {
      path: "web://shared/abcdefghijkl",
      name: "USGS Quakes (shared)",
      extension: "csv",
      row_count: 50,
      size_bytes: 0,
      originPath: "stream://usgs",
      capturedAt: "2026-10-05T12:00:00.000Z",
      sourceCredit: "Shared snapshot",
    };
    const p = resolveDataProvenance(file);
    expect(p?.kind).toBe("shared");
    expect(p?.capturedAt).toBe("2026-10-05T12:00:00.000Z");
    expect(p?.links.some((l) => l.kind === "home" && l.href.includes("usgs.gov"))).toBe(true);
  });

  it("formatSourceFootnote grows with mode", () => {
    const file: FileEntry = {
      path: "stream://lobsters",
      name: "Lobsters Hottest",
      extension: "stream",
      row_count: 25,
      size_bytes: 0,
    };
    const p = resolveDataProvenance(file, { loadedRows: 25, totalRows: 25 })!;
    expect(formatSourceFootnote(p, "name")).toBe("Lobsters Hottest");
    expect(formatSourceFootnote(p, "credit")).toContain("Lobsters");
    expect(formatSourceFootnote(p, "full").length).toBeGreaterThan(
      formatSourceFootnote(p, "name").length,
    );
  });
});
