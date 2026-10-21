// Feed browser: search, facets, Saved group, affinity order, hidden toggle, Digest leads.
import { describe, expect, it } from "vitest";
import { browseFeeds, DEFAULT_FEED_BROWSER_STATE, digestEntries, feedSortLabel } from "../feedBrowser";
import { sourceCatalog } from "../sourceCatalog";
import { emptySourcePreferences, setSourceReaction, toggleSourceSaved } from "../sourcePreferences";

const refs = (r: ReturnType<typeof browseFeeds>, id: string) => r.groups.find((g) => g.id === id)?.entries.map((e) => e.ref) ?? [];

describe("browseFeeds", () => {
  const catalog = sourceCatalog();

  it("lists every feed and pack in registry order by default", () => {
    const r = browseFeeds(catalog, DEFAULT_FEED_BROWSER_STATE, emptySourcePreferences());
    expect(r.total).toBe(catalog.length);
    expect(r.groups.some((g) => g.id === "packs")).toBe(true);
    expect(r.groups.some((g) => g.id === "saved")).toBe(false);
    expect(feedSortLabel("foryou", emptySourcePreferences())).toBe("Featured");
  });

  it("loving lifts a feed to the top of its group; saving moves it to Saved", () => {
    const base = refs(browseFeeds(catalog, DEFAULT_FEED_BROWSER_STATE, emptySourcePreferences()), "space");
    const last = base[base.length - 1]!;
    const loved = setSourceReaction(emptySourcePreferences(), last, "love");
    expect(refs(browseFeeds(catalog, DEFAULT_FEED_BROWSER_STATE, loved), "space")[0]).toBe(last);
    expect(feedSortLabel("foryou", loved)).toBe("For you");
    const saved = toggleSourceSaved(loved, "feed:hn");
    const r = browseFeeds(catalog, DEFAULT_FEED_BROWSER_STATE, saved);
    expect(r.groups[0]!.id).toBe("saved");
    expect(refs(r, "saved")).toEqual(["feed:hn"]);
    expect(refs(r, "web")).not.toContain("feed:hn");
    expect(refs(browseFeeds(catalog, { ...DEFAULT_FEED_BROWSER_STATE, savedOnly: true }, saved), "saved")).toEqual(["feed:hn"]);
  });

  it("hides hidden sources until Show hidden, and counts them", () => {
    const prefs = setSourceReaction(emptySourcePreferences(), "feed:crypto", "hide");
    const r = browseFeeds(catalog, DEFAULT_FEED_BROWSER_STATE, prefs);
    expect(r.hiddenCount).toBe(1);
    expect(r.groups.flatMap((g) => g.entries).some((e) => e.ref === "feed:crypto")).toBe(false);
    const shown = browseFeeds(catalog, { ...DEFAULT_FEED_BROWSER_STATE, showHidden: true }, prefs);
    expect(shown.groups.flatMap((g) => g.entries).some((e) => e.ref === "feed:crypto")).toBe(true);
  });

  it("filters by text, topic, where and freshness", () => {
    const quake = browseFeeds(catalog, { ...DEFAULT_FEED_BROWSER_STATE, query: "earthquake" }, emptySourcePreferences());
    expect(quake.groups.flatMap((g) => g.entries).map((e) => e.ref)).toContain("feed:usgs");
    const us = browseFeeds(catalog, { ...DEFAULT_FEED_BROWSER_STATE, where: ["us"] }, emptySourcePreferences());
    expect(us.groups.flatMap((g) => g.entries).every((e) => e.geo === "us")).toBe(true);
    const space = browseFeeds(catalog, { ...DEFAULT_FEED_BROWSER_STATE, topics: ["space"], freshness: ["live"] }, emptySourcePreferences());
    const all = space.groups.flatMap((g) => g.entries);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => e.topics.includes("space") && e.freshness === "live")).toBe(true);
  });
});

describe("digestEntries", () => {
  const catalog = sourceCatalog();

  it("prefers loved feeds, then culture/people topics, and respects a limit", () => {
    const loved = setSourceReaction(emptySourcePreferences(), "feed:usgs", "love");
    const leads = digestEntries(catalog, loved, { limit: 6 });
    expect(leads).toHaveLength(6);
    expect(leads[0]!.ref).toBe("feed:usgs");
    const plain = digestEntries(catalog, emptySourcePreferences(), { limit: 4 });
    expect(plain).toHaveLength(4);
    expect(plain.some((e) => e.topics.includes("culture") || e.topics.includes("people"))).toBe(true);
  });

  it("skips hidden sources and can reuse a filtered browse result", () => {
    const prefs = setSourceReaction(emptySourcePreferences(), "feed:books", "hide");
    const leads = digestEntries(catalog, prefs, { limit: 20 });
    expect(leads.every((e) => e.ref !== "feed:books")).toBe(true);
    const browsed = browseFeeds(catalog, { ...DEFAULT_FEED_BROWSER_STATE, topics: ["space"] }, emptySourcePreferences());
    const fromBrowse = digestEntries(catalog, emptySourcePreferences(), { fromBrowse: browsed, limit: 10 });
    expect(fromBrowse.length).toBeGreaterThan(0);
    expect(fromBrowse.every((e) => e.topics.includes("space"))).toBe(true);
  });
});
