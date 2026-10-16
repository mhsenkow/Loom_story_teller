import { describe, expect, it } from "vitest";
import { CURATED_OPEN_PACKS } from "../curatedPacks";
import { SOURCE_KINDS } from "../sourceRegistry";
import {
  ckanRef,
  feedKindFromRef,
  feedRef,
  fileRef,
  isSourceRef,
  packRef,
  parseSourceRef,
  pathForRef,
  refForPath,
  refForSourceUrl,
  socrataRef,
  tidyTuesdayRef,
} from "../sourceRef";

describe("sourceRef", () => {
  it("round-trips every feed through its stream path", () => {
    for (const k of [...SOURCE_KINDS, "wiki" as const]) {
      const ref = feedRef(k);
      expect(feedKindFromRef(ref)).toBe(k);
      expect(refForPath(pathForRef(ref)!)).toBe(ref);
    }
  });

  it("parses each scheme and rejects junk", () => {
    expect(parseSourceRef(socrataRef("Data.CityOfNewYork.us", "erm2-nwe9"))).toEqual({
      scheme: "socrata",
      id: "data.cityofnewyork.us/erm2-nwe9",
    });
    expect(parseSourceRef(ckanRef("us", "abc-123"))?.scheme).toBe("ckan");
    expect(parseSourceRef(tidyTuesdayRef("2024-01-02", "a.csv"))?.id).toBe("2024-01-02/a.csv");
    expect(parseSourceRef(fileRef("web://file/x.csv"))).toEqual({ scheme: "file", id: "web://file/x.csv" });
    expect(isSourceRef("feed:nope")).toBe(false);
    expect(isSourceRef("bogus:x")).toBe(false);
    expect(isSourceRef("feed:")).toBe(false);
    expect(isSourceRef(42)).toBe(false);
  });

  it("recognizes catalog URLs on loaded files", () => {
    const pack = CURATED_OPEN_PACKS[0]!;
    expect(refForSourceUrl(pack.url)).toBe(packRef(pack.id));
    expect(refForSourceUrl("https://data.cityofnewyork.us/resource/ERM2-NWE9.csv?$limit=500")).toBe(
      "socrata:data.cityofnewyork.us/erm2-nwe9",
    );
    expect(
      refForSourceUrl(
        "https://raw.githubusercontent.com/rfordatascience/tidytuesday/main/data/2024/2024-01-02/canada_births_1991_2022.csv",
      ),
    ).toBe("tt:2024-01-02/canada_births_1991_2022.csv");
    expect(refForSourceUrl("https://example.com/x.csv")).toBeNull();
    expect(refForPath("web://file/abc", { sourceUrl: pack.url })).toBe(packRef(pack.id));
    expect(refForPath("web://file/abc", { sourceUrl: "https://example.com/x.csv" })).toBe("file:web://file/abc");
  });

  it("only opens feeds and files directly", () => {
    expect(pathForRef(fileRef("/tmp/a.csv"))).toBe("/tmp/a.csv");
    expect(pathForRef(packRef("gapminder"))).toBeNull();
    expect(pathForRef("garbage")).toBeNull();
  });
});
