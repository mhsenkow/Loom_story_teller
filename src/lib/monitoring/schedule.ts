// =================================================================
// Loom — Monitor schedules (interval / daily / weekly / cron)
// =================================================================
// Pure next-run math in local time. Cron is the classic 5-field form
// (minute hour day-of-month month day-of-week) with `*`, lists, ranges
// and steps; when both day fields are restricted, either may match.
// =================================================================

import type { MonitorSchedule } from "./types";

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

function cronMatches(c: ParsedCron, d: Date): boolean {
  if (!c.minute.values.has(d.getMinutes()) || !c.hour.values.has(d.getHours()) || !c.month.values.has(d.getMonth() + 1)) return false;
  const domOk = c.dom.values.has(d.getDate());
  const dowOk = c.dow.values.has(d.getDay());
  if (c.dom.any && c.dow.any) return true;
  if (c.dom.any) return dowOk;
  if (c.dow.any) return domOk;
  return domOk || dowOk;
}

/** First run strictly after `from` (ms). */
export function nextRunAfter(s: MonitorSchedule, from: number): number {
  const d = new Date(from);
  d.setSeconds(0, 0);
  switch (s.kind) {
    case "interval": {
      const mins = Math.max(MIN_INTERVAL_MINUTES, s.minutes);
      return from + mins * 60_000;
    }
    case "daily": {
      d.setHours(s.hour, s.minute, 0, 0);
      if (d.getTime() <= from) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    case "weekly": {
      d.setHours(s.hour, s.minute, 0, 0);
      let add = (s.weekday - d.getDay() + 7) % 7;
      if (add === 0 && d.getTime() <= from) add = 7;
      d.setDate(d.getDate() + add);
      return d.getTime();
    }
    case "cron": {
      const c = parseCron(s.expr);
      d.setMinutes(d.getMinutes() + 1);
      // Search up to ~1 year minute by minute, skipping whole hours/days that cannot match.
      for (let i = 0; i < 527_040; i++) {
        if (!c.month.values.has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue; }
        if (!c.hour.values.has(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
        if (cronMatches(c, d)) return d.getTime();
        d.setMinutes(d.getMinutes() + 1);
      }
      throw new Error("Cron never matches within a year");
    }
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
export function scheduleError(s: MonitorSchedule): string | null {
  try {
    if (s.kind === "interval" && !(s.minutes >= MIN_INTERVAL_MINUTES)) return `Interval must be at least ${MIN_INTERVAL_MINUTES} minute`;
    nextRunAfter(s, Date.now());
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
