import { describe, expect, it } from "vitest";
import { feedHealthFromSourceStatus, feedHealthNote, isFeedResting, parseFeedHealth } from "../sourceHealth";
import { digestEntries } from "../feedBrowser";
import { sourceCatalog } from "../sourceCatalog";
import { emptySourcePreferences, setSourceReaction } from "../sourcePreferences";
import { feedKindFromRef, feedRef } from "../sourceRef";

describe("feed health (client)", () => {
  it("parses /api/health defensively", () => {
    const h = parseFeedHealth({
      sources: { met: { state: "resting", lastOk: 1, error: "410" }, usgs: { state: "ok" }, junk: { state: "??" } },
    });
    expect(h.met).toEqual({ state: "resting", lastOk: 1, lastFail: undefined, error: "410" });
    expect(h.junk).toBeUndefined();
    expect(parseFeedHealth(null)).toEqual({});
    expect(isFeedResting("met", h)).toBe(true);
    expect(isFeedResting("usgs", h)).toBe(false);
    expect(isFeedResting("unknown_kind", h)).toBe(false);
  });

  it("derives desktop health from local status and does not call a feed resting", () => {
    expect(feedHealthFromSourceStatus(undefined)).toEqual({ state: "unknown" });
    expect(feedHealthFromSourceStatus({ running: false, buffer_rows: 0 })).toEqual({ state: "unknown" });
    expect(feedHealthFromSourceStatus({ running: true, buffer_rows: 12, last_ok_at: 1_700_000_000 }).state).toBe("ok");
    expect(feedHealthFromSourceStatus({ running: true, last_error: "HTTP 503", last_ok_at: 1_700_000_000 }).state).toBe("degraded");
  });

  it("explains resting and patchy feeds, says nothing for healthy ones", () => {
    const now = 10 * 3_600_000;
    expect(feedHealthNote({ state: "ok" }, now)).toBeNull();
    expect(feedHealthNote({ state: "unknown" }, now)).toBeNull();
    expect(feedHealthNote({ state: "resting", lastOk: now - 5 * 3_600_000 }, now)).toMatch(/since 5 h ago/);
    expect(feedHealthNote({ state: "degraded", lastOk: now - 20 * 60_000 }, now)).toMatch(/patchy — last answered 20 min ago/);
    expect(feedHealthNote({ state: "degraded" }, now)).toBe("The upstream service is patchy right now.");
  });

  it("keeps a resting feed out of Digest even when it's loved", () => {
    const prefs = setSourceReaction(emptySourcePreferences(), feedRef("met"), "love");
    const health = parseFeedHealth({ sources: { met: { state: "resting" } } });
    const leads = digestEntries(sourceCatalog(), prefs, {
      limit: 20,
      skip: (e) => {
        const kind = feedKindFromRef(e.ref);
        return !!kind && isFeedResting(kind, health);
      },
    });
    expect(leads.some((e) => e.ref === feedRef("met"))).toBe(false);
    expect(digestEntries(sourceCatalog(), prefs, { limit: 20 }).some((e) => e.ref === feedRef("met"))).toBe(true);
  });
});
