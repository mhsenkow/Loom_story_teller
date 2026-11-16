import { describe, expect, it } from "vitest";
import { CURATED_OPEN_PACKS } from "../curatedPacks";
import { PUBLIC_PORTALS } from "../publicPortals";
import { SOCRATA_PORTALS } from "../publicCatalogs";
import { SOURCE_BY_KIND } from "../sourceRegistry";

describe("public portals", () => {
  it("connects every catalog to a live feed or a curated CSV", () => {
    const packIds = new Set(CURATED_OPEN_PACKS.map((p) => p.id));
    const ids = PUBLIC_PORTALS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const portal of PUBLIC_PORTALS) {
      expect(portal.homepage.startsWith("https://"), portal.id).toBe(true);
      expect(portal.feedKinds.length + portal.packIds.length, portal.id).toBeGreaterThan(0);
      for (const kind of portal.feedKinds) {
        expect(SOURCE_BY_KIND[kind]?.kind, kind).toBe(kind);
      }
      for (const packId of portal.packIds) {
        expect(packIds.has(packId), `${portal.id} → ${packId}`).toBe(true);
      }
    }
  });

  it("keeps curated pack ids and urls unique", () => {
    const ids = CURATED_OPEN_PACKS.map((p) => p.id);
    const urls = CURATED_OPEN_PACKS.map((p) => p.url);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(urls).size).toBe(urls.length);
    for (const pack of CURATED_OPEN_PACKS) {
      expect(pack.url.startsWith("https://"), pack.id).toBe(true);
    }
  });
});

describe("socrata portal shortcuts", () => {
  it("lists unique city, state, and agency domains", () => {
    const domains = SOCRATA_PORTALS.map((p) => p.domain);
    expect(new Set(domains).size).toBe(domains.length);
    expect(SOCRATA_PORTALS.filter((p) => p.group === "city").length).toBeGreaterThan(10);
    expect(SOCRATA_PORTALS.filter((p) => p.group === "state").map((p) => p.domain)).toEqual(
      expect.arrayContaining(["data.texas.gov", "data.colorado.gov", "data.oregon.gov", "data.pa.gov"]),
    );
    expect(domains).toEqual(expect.arrayContaining(["data.nola.gov", "data.oaklandca.gov", "data.cdc.gov"]));
    for (const portal of SOCRATA_PORTALS) {
      expect(portal.domain).toMatch(/^[a-z0-9.-]+$/);
      expect(portal.label.length).toBeGreaterThan(0);
    }
  });
});
