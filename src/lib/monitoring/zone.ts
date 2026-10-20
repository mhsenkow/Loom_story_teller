// =================================================================
// Loom — Monitor time zones
// =================================================================
// Schedules ("daily at 09:00"), quiet hours, expected windows and
// seasonal baselines are wall-clock ideas. The app evaluates them in the
// device's zone; the Worker cron runs in UTC, so every monitor carries
// its IANA zone (`Monitor.tz`) and all wall-clock math goes through here.
//
// A "wall" Date is a Date whose *UTC* fields read as the wall clock in
// the zone — do arithmetic with getUTC*/setUTC* on it, then `fromWall`.
// =================================================================

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

/** The device's IANA zone, when the runtime knows it. */
export function deviceTimeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : undefined;
  } catch {
    return undefined;
  }
}

/** Wall-clock minus UTC, in ms, at instant `at` (no zone = this runtime's local zone). */
export function tzOffsetMs(at: number, tz?: string): number {
  if (!tz || !isValidTimeZone(tz)) return -new Date(at).getTimezoneOffset() * 60_000;
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(new Date(at))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour === 24 ? 0 : p.hour!, p.minute!, p.second!);
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000) * 60_000;
}

export function wall(at: number, tz?: string): Date {
  return new Date(at + tzOffsetMs(at, tz));
}

/** Inverse of `wall` (two passes settle the offset across DST changes). */
export function fromWall(wallMs: number, tz?: string): number {
  let utc = wallMs - tzOffsetMs(wallMs, tz);
  utc = wallMs - tzOffsetMs(utc, tz);
  return utc;
}

export interface WallParts { weekday: number; hour: number; minute: number; hourFloat: number }

export function wallParts(at: number, tz?: string): WallParts {
  const d = wall(at, tz);
  return { weekday: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), hourFloat: d.getUTCHours() + d.getUTCMinutes() / 60 };
}
