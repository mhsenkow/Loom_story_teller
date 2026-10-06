// =================================================================
// Loom — Zoned civil times (NYC Open Data, UK Carbon, pageviews)
// =================================================================
// Upstream APIs often return wall-clock timestamps without an offset.
// These helpers convert to real UTC instants / calendar days so Chart
// Time windows and “yesterday” labels stay honest across time zones.
// =================================================================

/** Format an instant as YYYY-MM-DD in a named IANA time zone. */
export function zonedYmd(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Calendar day `daysAgo` before “today” in `timeZone` (not a fixed UTC
 * millisecond lookback — that drifts near local midnight).
 */
export function zonedCalendarDay(daysAgo: number, timeZone: string, now = Date.now()): string {
  const today = zonedYmd(now, timeZone);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  // Noon UTC avoids DST edge weirdness when subtracting calendar days.
  const ms = Date.UTC(y, m - 1, d - daysAgo, 12, 0, 0);
  return zonedYmd(ms, timeZone);
}

export function londonDay(daysAgo: number, now = Date.now()): string {
  return zonedCalendarDay(daysAgo, "Europe/London", now);
}

/**
 * Convert a zone-less civil datetime to UTC epoch ms by iterating until
 * formatting that instant in `timeZone` yields the desired wall clock.
 */
export function zonedCivilToUtcMs(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number | null {
  if (![year, monthIndex, day, hour, minute, second].every((n) => Number.isFinite(n))) return null;
  let guess = Date.UTC(year, monthIndex, day, hour, minute, second);
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    if (![asUtc].every(Number.isFinite)) return null;
    const desired = Date.UTC(year, monthIndex, day, hour, minute, second);
    const delta = desired - asUtc;
    if (delta === 0) return guess;
    guess += delta;
  }
  return guess;
}

/** NYC Open Data / Socrata timestamps are America/New_York without an offset. */
export function nycWallToUtcIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const m = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?/,
  );
  if (!m) {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const h = Number(m[4] ?? 0);
  const mi = Number(m[5] ?? 0);
  const s = Number(m[6] ?? 0);
  const ms = zonedCivilToUtcMs(y, mo, d, h, mi, s, "America/New_York");
  return ms == null ? null : new Date(ms).toISOString();
}

/**
 * Which UTC “days ago” to try first for Wikimedia top pageviews.
 * The previous UTC day usually appears mid-day UTC; before ~14:00 prefer day-2.
 */
export function pageviewsPrimaryDaysAgo(now = Date.now()): number[] {
  const hour = new Date(now).getUTCHours();
  const primary = hour < 14 ? 2 : 1;
  const secondary = primary === 1 ? 2 : 1;
  return [primary, secondary, 3];
}
