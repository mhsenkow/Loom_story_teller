import { describe, expect, it } from "vitest";
import { CURATED_OPEN_PACKS } from "../curatedPacks";
import { buildSourceCatalog, catalogEntryFor, filterCatalog, freshnessForPoll, sourceCatalog } from "../sourceCatalog";
import { SOURCE_DEFS } from "../sourceRegistry";
import { feedRef, isSourceRef } from "../sourceRef";

describe("sourceCatalog", () => {
  it("lists wiki, every feed, and every pack once with valid refs", () => {
    const all = buildSourceCatalog();
    expect(all.length).toBe(1 + SOURCE_DEFS.length + CURATED_OPEN_PACKS.length);
    expect(new Set(all.map((e) => e.ref)).size).toBe(all.length);
    for (const e of all) {
      expect(isSourceRef(e.ref), e.ref).toBe(true);
      expect(e.topics.length, e.ref).toBeGreaterThan(0);
    }
    expect(sourceCatalog()).toBe(sourceCatalog());
  });

  it("derives freshness from poll cadence", () => {
    expect(freshnessForPoll(0)).toBe("historical");
    expect(freshnessForPoll(60_000)).toBe("live");
    expect(freshnessForPoll(3_600_000)).toBe("live");
    expect(freshnessForPoll(21_600_000)).toBe("daily");
    expect(catalogEntryFor(feedRef("usgs"))?.freshness).toBe("live");
    expect(catalogEntryFor(feedRef("world_bank"))?.freshness).toBe("historical");
  });

  it("searches labels, descriptions, topics, and column names", () => {
    const all = sourceCatalog();
    expect(filterCatalog(all, { query: "quake" })[0]?.ref).toBe(feedRef("usgs"));
    expect(filterCatalog(all, { query: "life expectancy" }).map((e) => e.ref)).toContain(feedRef("world_bank"));
    expect(filterCatalog(all, { query: "gdp per capita" }).map((e) => e.ref)).toContain(feedRef("world_bank"));
    expect(filterCatalog(all, { query: "Disasters" }).map((e) => e.ref)).toContain(feedRef("fema"));
    expect(filterCatalog(all, { query: "zzzz-no-match" })).toEqual([]);
  });

  it("filters by facet and join role", () => {
    const all = sourceCatalog();
    const us = filterCatalog(all, { geo: ["us"] });
    expect(us.every((e) => e.geo === "us")).toBe(true);
    expect(us.map((e) => e.ref)).toContain(feedRef("fema"));
    const states = filterCatalog(all, { joinRole: "state" });
    expect(states.map((e) => e.ref)).toContain(feedRef("fema"));
    expect(states.every((e) => e.joinKeys.state)).toBe(true);
    const live = filterCatalog(all, { freshness: ["live"], topics: ["space"] });
    expect(live.length).toBeGreaterThan(0);
    expect(live.every((e) => e.freshness === "live" && e.topics.includes("space"))).toBe(true);
  });
});
