// =================================================================
// Loom — Monitor schedules (interval / daily / weekly / cron)
// =================================================================
// Pure next-run math in local time. Cron is the classic 5-field form
// (minute hour day-of-month month day-of-week) with `*`, lists, ranges
// and steps; when both day fields are restricted, either may match.
// =================================================================

import type { MonitorSchedule } from "./types";
import { fromWall, tzOffsetMs, wall } from "./zone";

export const MIN_INTERVAL_MINUTES = 1;

interface CronField { values: Set<number>; any: boolean }
export interface ParsedCron { minute: CronField; hour: CronField; dom: CronField; month: CronField; dow: CronField }

function parseField(src: string, min: number, max: number, label: string): CronField {
  const values = new Set<number>();
  const any = src === "*";
  for (const part of src.split(",")) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`Cron ${label}: "${part}" is not valid`);
    const step = m[3] ? Number(m[3]) : 1;
    if (step < 1) throw new Error(`Cron ${label}: step must be ≥ 1`);
    const lo = m[1] === "*" ? min : Number(m[1]);
    const hi = m[2] != null ? Number(m[2]) : m[1] === "*" || m[3] ? max : lo;
    if (lo < min || hi > max || lo > hi) throw new Error(`Cron ${label}: ${part} is outside ${min}–${max}`);
    for (let v = lo; v <= hi; v += step) values.add(label === "weekday" && v === 7 ? 0 : v);
  }
  return { values, any };
}

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron needs 5 fields: minute hour day month weekday");
  return {
    minute: parseField(parts[0]!, 0, 59, "minute"),
    hour: parseField(parts[1]!, 0, 23, "hour"),
    dom: parseField(parts[2]!, 1, 31, "day"),
    month: parseField(parts[3]!, 1, 12, "month"),
    dow: parseField(parts[4]!, 0, 7, "weekday"),
  };
}

function dayMatches(c: ParsedCron, d: Date): boolean {
  const domOk = c.dom.values.has(d.getUTCDate());
  const dowOk = c.dow.values.has(d.getUTCDay());
  if (c.dom.any && c.dow.any) return true;
  if (c.dom.any) return dowOk;
  if (c.dow.any) return domOk;
  return domOk || dowOk;
}

function cronMatches(c: ParsedCron, d: Date): boolean {
  // `d` is a wall Date (UTC fields = wall clock in the monitor's zone).
  if (!c.minute.values.has(d.getUTCMinutes()) || !c.hour.values.has(d.getUTCHours()) || !c.month.values.has(d.getUTCMonth() + 1)) return false;
  const domOk = c.dom.values.has(d.getUTCDate());
  const dowOk = c.dow.values.has(d.getUTCDay());
  if (c.dom.any && c.dow.any) return true;
  if (c.dom.any) return dowOk;
  if (c.dow.any) return domOk;
  return domOk || dowOk;
}

/** First run strictly after `from` (ms), with wall-clock schedules read in `tz` (default: this device). */
export function nextRunAfter(s: MonitorSchedule, from: number, tz?: string): number {
  if (s.kind === "interval") {
    const mins = Number(s.minutes);
    if (!Number.isFinite(mins)) throw new Error("Interval must be a number of minutes");
    return from + Math.max(MIN_INTERVAL_MINUTES, mins) * 60_000;
  }
  const d = wall(from, tz);
  d.setUTCSeconds(0, 0);
  const fromWallMs = from + tzOffsetMs(from, tz);
  switch (s.kind) {
    case "daily": {
      if (!(s.hour >= 0 && s.hour <= 23 && s.minute >= 0 && s.minute <= 59)) throw new Error("Pick a time of day");
      d.setUTCHours(s.hour, s.minute, 0, 0);
      if (d.getTime() <= fromWallMs) d.setUTCDate(d.getUTCDate() + 1);
      return fromWall(d.getTime(), tz);
    }
    case "weekly": {
      if (!(s.weekday >= 0 && s.weekday <= 6 && s.hour >= 0 && s.hour <= 23 && s.minute >= 0 && s.minute <= 59)) throw new Error("Pick a weekday and time");
      d.setUTCHours(s.hour, s.minute, 0, 0);
      let add = (s.weekday - d.getUTCDay() + 7) % 7;
      if (add === 0 && d.getTime() <= fromWallMs) add = 7;
      d.setUTCDate(d.getUTCDate() + add);
      return fromWall(d.getTime(), tz);
    }
    case "cron": {
      const c = parseCron(s.expr);
      d.setUTCMinutes(d.getUTCMinutes() + 1);
      // Search up to ~1 year, skipping whole months / hours that cannot match.
      for (let i = 0; i < 20_000; i++) {
        if (!c.month.values.has(d.getUTCMonth() + 1)) { d.setUTCMonth(d.getUTCMonth() + 1, 1); d.setUTCHours(0, 0, 0, 0); continue; }
        if (!dayMatches(c, d)) { d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(0, 0, 0, 0); continue; }
        if (!c.hour.values.has(d.getUTCHours())) { d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0); continue; }
        if (cronMatches(c, d)) return fromWall(d.getTime(), tz);
        d.setUTCMinutes(d.getUTCMinutes() + 1);
      }
      throw new Error("Cron never matches within a year");
    }
    default:
      throw new Error("Unknown schedule");
  }
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

export function describeSchedule(s: MonitorSchedule): string {
  switch (s.kind) {
    case "interval":
      return s.minutes % 1440 === 0 ? `Every ${s.minutes / 1440} day${s.minutes === 1440 ? "" : "s"}`
        : s.minutes % 60 === 0 ? `Every ${s.minutes / 60} hour${s.minutes === 60 ? "" : "s"}`
        : `Every ${s.minutes} min`;
    case "daily": return `Daily at ${hhmm(s.hour, s.minute)}`;
    case "weekly": return `${WEEKDAYS[s.weekday]}s at ${hhmm(s.hour, s.minute)}`;
    case "cron": return `Cron ${s.expr}`;
  }
}

/** Validation message, or null when the schedule is usable. */
export function scheduleError(s: MonitorSchedule, tz?: string): string | null {
  try {
    if (s.kind === "interval" && !(s.minutes >= MIN_INTERVAL_MINUTES)) return `Interval must be at least ${MIN_INTERVAL_MINUTES} minute`;
    const n = nextRunAfter(s, Date.now(), tz);
    if (!Number.isFinite(n)) return "This schedule never runs";
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
