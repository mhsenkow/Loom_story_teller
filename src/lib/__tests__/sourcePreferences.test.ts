/**
 * Unit tests for source preferences (Love / Less / Hide / Save + opens → affinity).
 */
import { describe, expect, it } from "vitest";
import {
  discoverAffinityMap,
  emptySourcePreferences,
  explicitOnly,
  explicitSourceRefs,
  hasExplicitSourcePreferences,
  HIDDEN_RANK_PENALTY,
  isHidden,
  isSourceSaved,
  LESS_PENALTY,
  LOVE_BOOST,
  mergeSourcePreferences,
  OPEN_CAP,
  openWeight,
  parseSourcePreferences,
  recordSourceOpen,
  SAVED_BOOST,
  setSourceReaction,
  SOURCE_AFFINITY_CLAMP,
  sourceAffinity,
  toggleSourceSaved,
  TOPIC_SPILLOVER,
  TOPIC_SPILLOVER_CAP,
} from "../sourcePreferences";
import { wrapPersist } from "../persistEnvelope";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("sourcePreferences", () => {
  it("love / less / save shift affinity, and clearing a reaction removes it", () => {
    let p = emptySourcePreferences();
    expect(sourceAffinity("feed:hn", p, NOW)).toBe(0);
    p = setSourceReaction(p, "feed:hn", "love", NOW);
    expect(sourceAffinity("feed:hn", p, NOW)).toBe(LOVE_BOOST);
    p = toggleSourceSaved(p, "feed:hn", NOW);
    expect(isSourceSaved("feed:hn", p)).toBe(true);
    expect(sourceAffinity("feed:hn", p, NOW)).toBe(LOVE_BOOST + SAVED_BOOST);
    p = setSourceReaction(p, "feed:hn", "less", NOW);
    expect(sourceAffinity("feed:hn", p, NOW)).toBe(LESS_PENALTY + SAVED_BOOST);
    p = setSourceReaction(p, "feed:hn", null, NOW);
    p = toggleSourceSaved(p, "feed:hn", NOW);
    expect(p.entries["feed:hn"]).toBeUndefined();
    expect(hasExplicitSourcePreferences(p)).toBe(false);
  });

  it("hidden sources sit at the floor and get the Discover rank penalty", () => {
    const p = setSourceReaction(emptySourcePreferences(), "feed:crypto", "hide", NOW);
    expect(isHidden("feed:crypto", p)).toBe(true);
    expect(sourceAffinity("feed:crypto", p, NOW)).toBe(-SOURCE_AFFINITY_CLAMP);
    expect(discoverAffinityMap(["crypto", "usgs"], p, NOW)).toEqual({ crypto: HIDDEN_RANK_PENALTY });
  });

  it("opens decay with a ~30-day half-life, de-dupe quick re-opens, and stay capped", () => {
    let p = recordSourceOpen(emptySourcePreferences(), "feed:usgs", NOW);
    p = recordSourceOpen(p, "feed:usgs", NOW + 60_000); // same session → one open
    expect(openWeight(p.entries["feed:usgs"], NOW)).toBeCloseTo(1);
    expect(sourceAffinity("feed:usgs", p, NOW + 30 * DAY)).toBeCloseTo(0.5, 1);
    for (let i = 1; i <= 20; i++) p = recordSourceOpen(p, "feed:usgs", NOW + i * DAY);
    expect(sourceAffinity("feed:usgs", p, NOW + 20 * DAY)).toBe(OPEN_CAP);
    // Explicit beats heavy use.
    const less = setSourceReaction(p, "feed:usgs", "less", NOW + 20 * DAY);
    expect(sourceAffinity("feed:usgs", less, NOW + 20 * DAY)).toBeLessThan(0);
  });

  it("loving a feed nudges same-topic feeds, capped, but not other topics", () => {
    let p = setSourceReaction(emptySourcePreferences(), "feed:usgs", "love", NOW);
    expect(sourceAffinity("feed:gdacs", p, NOW)).toBe(TOPIC_SPILLOVER);
    expect(sourceAffinity("feed:hn", p, NOW)).toBe(0);
    p = setSourceReaction(p, "feed:eonet", "love", NOW);
    p = setSourceReaction(p, "feed:firms", "love", NOW);
    expect(sourceAffinity("feed:gdacs", p, NOW)).toBe(TOPIC_SPILLOVER_CAP);
    // A loved feed doesn't spill onto itself.
    expect(sourceAffinity("feed:usgs", p, NOW)).toBeLessThanOrEqual(LOVE_BOOST + TOPIC_SPILLOVER_CAP);
  });

  it("clamps to ±20", () => {
    let p = setSourceReaction(emptySourcePreferences(), "feed:usgs", "love", NOW);
    for (const k of ["eonet", "firms", "gdacs", "fema"]) p = setSourceReaction(p, `feed:${k}`, "love", NOW);
    p = toggleSourceSaved(p, "feed:usgs", NOW);
    for (let i = 0; i < 10; i++) p = recordSourceOpen(p, "feed:usgs", NOW + i * DAY);
    const a = sourceAffinity("feed:usgs", p, NOW + 9 * DAY);
    expect(a).toBeLessThanOrEqual(SOURCE_AFFINITY_CLAMP);
    expect(a).toBeGreaterThan(LOVE_BOOST);
  });

  it("parses the {v,data} envelope, a bare model, and a v0 ref→reaction map", () => {
    const model = toggleSourceSaved(setSourceReaction(emptySourcePreferences(), "pack:owid-co2-per-capita", "love", NOW), "feed:hn", NOW);
    expect(parseSourcePreferences(JSON.parse(JSON.stringify(wrapPersist(model))))).toEqual(model);
    expect(parseSourcePreferences(model)).toEqual(model);
    const v0 = parseSourcePreferences({ "feed:usgs": "love", "feed:hn": "hide", "feed:steam": "like", "feed:nope": "love", bogus: "love", "feed:fx": "meh" });
    expect(v0.entries["feed:usgs"]).toEqual({ reaction: "love" });
    expect(isHidden("feed:hn", v0)).toBe(true);
    expect(v0.entries["feed:steam"]?.opens).toBe(1);
    expect(Object.keys(v0.entries).sort()).toEqual(["feed:hn", "feed:steam", "feed:usgs"]);
  });

  it("validates junk without throwing", () => {
    for (const junk of [null, undefined, 3, "x", [], { entries: [] }, { v: 1, data: null }]) {
      expect(parseSourcePreferences(junk)).toEqual(emptySourcePreferences());
    }
    const p = parseSourcePreferences({ entries: { "feed:usgs": { reaction: "adore", saved: "yes", opens: -4, openedAt: "now" }, "feed:hn": { saved: true, savedAt: NOW } } });
    expect(p.entries).toEqual({ "feed:hn": { saved: true, savedAt: NOW } });
  });

  it("merges backups non-destructively and keeps opens on the device", () => {
    let local = setSourceReaction(emptySourcePreferences(), "feed:usgs", "less", NOW);
    local = recordSourceOpen(local, "feed:hn", NOW);
    let incoming = setSourceReaction(emptySourcePreferences(), "feed:usgs", "love", NOW);
    incoming = setSourceReaction(incoming, "feed:hn", "love", NOW);
    incoming = recordSourceOpen(incoming, "feed:steam", NOW);
    const out = explicitOnly(incoming);
    expect(out.entries["feed:steam"]).toBeUndefined();
    const { merged, added, skipped } = mergeSourcePreferences(local, out);
    expect(merged.entries["feed:usgs"]?.reaction).toBe("less");
    expect(merged.entries["feed:hn"]?.reaction).toBe("love");
    expect(merged.entries["feed:hn"]?.opens).toBe(1);
    expect([added, skipped]).toEqual([1, 1]);
    expect(explicitSourceRefs(merged).sort()).toEqual(["feed:hn", "feed:usgs"]);
  });
});
