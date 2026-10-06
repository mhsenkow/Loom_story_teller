// =================================================================
// zonedTime — NYC / London calendar helpers
// =================================================================

import { describe, expect, it } from "vitest";
import {
  londonDay,
  nycWallToUtcIso,
  pageviewsPrimaryDaysAgo,
  zonedCalendarDay,
} from "../zonedTime";
import { londonDay as workerLondonDay, pageviewsPrimaryDaysAgo as workerPageviews } from "../../../workers/sourceTransforms";

describe("zonedTime", () => {
  it("converts NYC wall clock without offset to real UTC", () => {
    // 2026-10-02 is EDT (UTC-4)
    expect(nycWallToUtcIso("2026-10-02T01:23:45.000")).toBe("2026-10-02T05:23:45.000Z");
    // Already zoned — leave as absolute
    expect(nycWallToUtcIso("2026-10-02T05:23:45.000Z")).toBe("2026-10-02T05:23:45.000Z");
  });

  it("uses London calendar days near UTC midnight", () => {
    // 2026-03-29 00:30 UTC is still 2026-03-29 in London (BST starts 01:00).
    const justAfterUtcMidnight = Date.UTC(2026, 2, 29, 0, 30, 0);
    expect(londonDay(0, justAfterUtcMidnight)).toBe("2026-03-29");
    expect(londonDay(1, justAfterUtcMidnight)).toBe("2026-03-28");
    expect(workerLondonDay(1, justAfterUtcMidnight)).toBe("2026-03-28");
  });

  it("prefers pageviews day-2 before 14:00 UTC", () => {
    expect(pageviewsPrimaryDaysAgo(Date.UTC(2026, 9, 6, 8, 0, 0))[0]).toBe(2);
    expect(pageviewsPrimaryDaysAgo(Date.UTC(2026, 9, 6, 15, 0, 0))[0]).toBe(1);
    expect(workerPageviews(Date.UTC(2026, 9, 6, 8, 0, 0))[0]).toBe(2);
  });

  it("zonedCalendarDay subtracts civil days", () => {
    expect(zonedCalendarDay(0, "UTC", Date.UTC(2026, 9, 6, 12))).toBe("2026-10-06");
    expect(zonedCalendarDay(1, "UTC", Date.UTC(2026, 9, 6, 12))).toBe("2026-10-05");
  });
});
