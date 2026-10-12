import { describe, it, expect } from "vitest";
import { CHANGELOG, latestRelease, unseenReleases } from "../changelog";

describe("changelog", () => {
  it("is newest-first with unique ids (the seen marker relies on id order)", () => {
    const ids = CHANGELOG.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort().reverse()).toEqual(ids);
    expect(latestRelease()?.id).toBe(ids[0]);
  });

  it("every release has a title and at least one item", () => {
    for (const r of CHANGELOG) {
      expect(r.title.trim()).not.toBe("");
      expect(r.items.length).toBeGreaterThan(0);
    }
  });

  it("unseenReleases returns only releases newer than the seen id", () => {
    const [newest, second] = CHANGELOG;
    expect(unseenReleases(newest!.id)).toEqual([]);
    expect(unseenReleases(second!.id)).toEqual([newest]);
    expect(unseenReleases(null)).toEqual(CHANGELOG);
  });

  it("keeps user-facing detail copy (LOOM-692)", () => {
    const devJargon = /(\b[a-z]+_[a-z]+\b|\b\d+px\b|Socrata|token at)/i;
    for (const release of CHANGELOG.filter((r) => r.id === "2026-10-12" || r.id === "2026-10-06c")) {
      for (const item of release.items) {
        expect(item.detail, `${release.id} ${item.title}`).not.toMatch(devJargon);
      }
    }
  });
});
