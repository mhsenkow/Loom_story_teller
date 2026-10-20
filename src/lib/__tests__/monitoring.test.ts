import { describe, expect, it } from "vitest";
import { computeMetric, evaluateRule, expectedWindowAt, monitorUsefulness, runCheck, windowFromReview } from "../monitoring/engine";
import { describeSchedule, nextRunAfter, parseCron, scheduleError } from "../monitoring/schedule";
import { MONITOR_TEMPLATES } from "../monitoring/templates";
import { SOURCE_BY_KIND } from "../sourceRegistry";
import type { CheckRecord, Monitor, MonitorAlert } from "../monitoring/types";
import type { QueryResult } from "../queryTypes";

const sample: QueryResult = {
  columns: ["ts", "city", "temperature"],
  types: ["TIMESTAMP", "VARCHAR", "DOUBLE"],
  rows: [
    ["2026-10-20 12:00:00", "New York", 20],
    ["2026-10-20 11:00:00", "New York", 18],
    ["2026-10-20 12:00:00", "London", 11],
    ["2026-10-20 06:00:00", "New York", 9],
  ],
  total_rows: 4,
};
const NOON = Date.parse("2026-10-20T12:05:00Z");

function monitor(patch: Partial<Monitor> = {}): Monitor {
  return {
    id: "m1",
    name: "Test",
    decision: "Do the thing",
    metric: { source: "meteo", agg: "latest", column: "temperature", timeColumn: "ts" },
    rule: { kind: "threshold", above: 25 },
    confirmChecks: 1,
    severity: "warning",
    schedule: { kind: "interval", minutes: 15 },
    notify: { inApp: true, system: false, cooldownMinutes: 60 },
    expected: [],
    enabled: true,
    createdAt: 0,
    ...patch,
  };
}

const rec = (at: number, value: number, status: CheckRecord["status"] = "ok"): CheckRecord => ({ monitorId: "m1", at, value, status, reason: "" });

describe("computeMetric", () => {
  it("latest picks the newest row after filters", () => {
    const r = computeMetric({ source: "meteo", agg: "latest", column: "temperature", timeColumn: "ts", filters: [{ column: "city", op: "=", value: "new york" }] }, sample, NOON);
    expect(r.value).toBe(20);
    expect(r.newestAt).toBe(Date.parse("2026-10-20T12:00:00Z"));
  });
  it("aggregates within a lookback window", () => {
    const r = computeMetric({ source: "meteo", agg: "avg", column: "temperature", timeColumn: "ts", lookbackMinutes: 120 }, sample, NOON);
    expect(r.rowsSeen).toBe(3);
    expect(r.value).toBeCloseTo((20 + 18 + 11) / 3);
  });
  it("counts and reports unknown columns", () => {
    expect(computeMetric({ source: "meteo", agg: "count" }, sample, NOON).value).toBe(4);
    expect(computeMetric({ source: "meteo", agg: "max", column: "nope" }, sample, NOON).error).toMatch(/nope/);
  });
  it("p95 and distinct", () => {
    expect(computeMetric({ source: "meteo", agg: "distinct", column: "city" }, sample, NOON).value).toBe(2);
    expect(computeMetric({ source: "meteo", agg: "p95", column: "temperature" }, sample, NOON).value).toBeGreaterThan(18);
  });
});

describe("rules", () => {
  it("threshold and range", () => {
    expect(evaluateRule({ kind: "threshold", above: 10 }, 12, [], NOON).breach).toBe(true);
    expect(evaluateRule({ kind: "range", low: 0, high: 10 }, 5, [], NOON).breach).toBe(false);
  });
  it("change needs a prior check", () => {
    const rule = { kind: "change", pct: 10, direction: "up", versus: "previous" } as const;
    expect(evaluateRule(rule, 12, [], NOON).warmingUp).toBe(true);
    expect(evaluateRule(rule, 12, [rec(NOON - 1, 10)], NOON).breach).toBe(true);
    expect(evaluateRule(rule, 10.5, [rec(NOON - 1, 10)], NOON).breach).toBe(false);
  });
  it("anomaly learns, ignores one past spike, and flags a real outlier", () => {
    const rule = { kind: "anomaly", sensitivity: 3.5, window: 20, seasonal: "none" } as const;
    expect(evaluateRule(rule, 50, [rec(1, 10), rec(2, 11)], NOON).warmingUp).toBe(true);
    const hist = [10, 11, 10, 12, 11, 10, 99, 11, 10, 12].map((v, i) => rec(i + 1, v));
    expect(evaluateRule(rule, 11.5, hist, NOON).breach).toBe(false);
    expect(evaluateRule(rule, 30, hist, NOON).breach).toBe(true);
  });
  it("seasonal anomaly compares like hours only", () => {
    const rule = { kind: "anomaly", sensitivity: 3.5, window: 50, seasonal: "hour" } as const;
    const at = new Date(2026, 9, 20, 14).getTime();
    const day = 86_400_000;
    // Afternoons are always ~30; nights ~10. 30 at 14:00 is normal even though most history is cold.
    const hist = [
      ...Array.from({ length: 6 }, (_, i) => rec(at - (i + 1) * day, 30 + (i % 2))),
      ...Array.from({ length: 30 }, (_, i) => rec(at - (i + 1) * day - 10 * 3_600_000, 10)),
    ].sort((a, b) => a.at - b.at);
    expect(evaluateRule(rule, 30.5, hist, at).breach).toBe(false);
    expect(evaluateRule({ ...rule, seasonal: "none" }, 30.5, hist, at).breach).toBe(true);
  });
  it("stale uses the newest timestamp", () => {
    expect(evaluateRule({ kind: "stale", maxAgeMinutes: 30 }, 0, [], NOON, undefined, NOON - 60 * 60_000).breach).toBe(true);
    expect(evaluateRule({ kind: "stale", maxAgeMinutes: 90 }, 0, [], NOON, undefined, NOON - 60 * 60_000).breach).toBe(false);
  });
});

describe("expected windows", () => {
  it("one-off and recurring overnight windows", () => {
    const at = new Date(2026, 9, 20, 2, 30).getTime(); // Tuesday 02:30 local
    expect(expectedWindowAt([{ id: "a", label: "x", start: at - 1, end: at + 1, origin: "manual" }], at)?.id).toBe("a");
    expect(expectedWindowAt([{ id: "b", label: "night", fromHour: 22, toHour: 4, origin: "manual" }], at)?.id).toBe("b");
    expect(expectedWindowAt([{ id: "c", label: "weekend", weekdays: [0, 6], fromHour: 0, toHour: 24, origin: "manual" }], at)).toBeNull();
  });
  it("review → recurring window at that weekday/hour", () => {
    const openedAt = new Date(2026, 9, 20, 9, 15).getTime();
    const w = windowFromReview({ id: "a", monitorId: "m1", openedAt, lastAt: openedAt, peakValue: 1, reason: "", severity: "info" }, "w1");
    expect(w).toMatchObject({ weekdays: [2], fromHour: 9, toHour: 10, origin: "review" });
    expect(expectedWindowAt([w], new Date(2026, 9, 27, 9, 40).getTime())).not.toBeNull();
  });
});

describe("runCheck lifecycle", () => {
  const id = () => "alr1";
  const metric = (value: number) => ({ value, rowsSeen: 1, newestAt: NOON });

  it("confirms over N checks, notifies once, honours cooldown, then resolves", () => {
    const m = monitor({ confirmChecks: 2 });
    const a = runCheck(m, metric(30), [], undefined, NOON, id);
    expect(a.record.status).toBe("breach");
    expect(a.notify).toBe(false);
    const b = runCheck(m, metric(31), [a.record], undefined, NOON + 1, id);
    expect(b.record.status).toBe("firing");
    expect(b.notify).toBe(true);
    const c = runCheck(m, metric(32), [a.record, b.record], b.alert, NOON + 60_000, id);
    expect(c.notify).toBe(false);
    expect(c.alert?.peakValue).toBe(32);
    const d = runCheck(m, metric(33), [a.record, b.record, c.record], c.alert, NOON + 61 * 60_000, id);
    expect(d.notify).toBe(true);
    const e = runCheck(m, metric(20), [], d.alert, NOON + 62 * 60_000, id);
    expect(e.record.status).toBe("ok");
    expect(e.alert?.closedAt).toBeDefined();
  });

  it("expected windows record but never alert", () => {
    const m = monitor({ expected: [{ id: "x", label: "Planned test", start: NOON - 1, end: NOON + 1, origin: "manual" }] });
    const r = runCheck(m, metric(99), [], undefined, NOON, id);
    expect(r.record.status).toBe("expected");
    expect(r.record.reason).toMatch(/Planned test/);
    expect(r.notify).toBe(false);
  });

  it("acknowledged alerts stop reminding", () => {
    const m = monitor();
    const open: MonitorAlert = { id: "a", monitorId: "m1", openedAt: 0, lastAt: 0, peakValue: 30, reason: "", severity: "warning", lastNotifiedAt: 0, acknowledgedAt: 1 };
    expect(runCheck(m, metric(40), [rec(1, 30, "firing")], open, NOON, id).notify).toBe(false);
  });

  it("errors and empty data don't open alerts", () => {
    expect(runCheck(monitor(), { value: null, rowsSeen: 0, newestAt: null }, [], undefined, NOON, id).record.status).toBe("no-data");
    expect(runCheck(monitor(), { value: null, rowsSeen: 0, newestAt: null, error: "bad" }, [], undefined, NOON, id).record.status).toBe("error");
  });
});

describe("usefulness", () => {
  it("calls a monitor noisy when reviews rarely lead to action", () => {
    const mk = (outcome: MonitorAlert["outcome"], i: number): MonitorAlert => ({ id: String(i), monitorId: "m", openedAt: i, lastAt: i, peakValue: 1, reason: "", severity: "info", outcome });
    expect(monitorUsefulness([mk("false-alarm", 1), mk("expected", 2), mk("ignored", 3), mk("false-alarm", 4), mk("acted", 5), mk("expected", 6)]).verdict).toBe("noisy");
    expect(monitorUsefulness([mk("acted", 1), mk("acted", 2), mk("false-alarm", 3)]).verdict).toBe("useful");
    expect(monitorUsefulness([mk("acted", 1)]).verdict).toBe("new");
  });
});

describe("schedule", () => {
  const from = new Date(2026, 9, 20, 10, 7).getTime(); // Tue 10:07 local
  it("interval, daily, weekly", () => {
    expect(nextRunAfter({ kind: "interval", minutes: 15 }, from)).toBe(from + 15 * 60_000);
    expect(new Date(nextRunAfter({ kind: "daily", hour: 9, minute: 0 }, from)).getDate()).toBe(21);
    const w = new Date(nextRunAfter({ kind: "weekly", weekday: 1, hour: 8, minute: 0 }, from));
    expect([w.getDay(), w.getHours(), w.getDate()]).toEqual([1, 8, 26]);
  });
  it("cron fields, steps, ranges", () => {
    const n = new Date(nextRunAfter({ kind: "cron", expr: "*/30 8-18 * * 1-5" }, from));
    expect([n.getHours(), n.getMinutes()]).toEqual([10, 30]);
    const sat = new Date(nextRunAfter({ kind: "cron", expr: "0 7 * * 6" }, from));
    expect([sat.getDay(), sat.getHours()]).toEqual([6, 7]);
    expect(parseCron("0 0 1 1 7").dow.values.has(0)).toBe(true);
    expect(scheduleError({ kind: "cron", expr: "61 * * * *" })).toMatch(/minute/);
    expect(scheduleError({ kind: "cron", expr: "* *" })).toMatch(/5 fields/);
    expect(describeSchedule({ kind: "interval", minutes: 120 })).toBe("Every 2 hours");
  });
});

describe("templates", () => {
  it("reference real feed columns and name a decision", () => {
    for (const t of MONITOR_TEMPLATES) {
      const def = SOURCE_BY_KIND[t.draft.metric.source];
      expect(def, t.id).toBeDefined();
      for (const c of [t.draft.metric.column, t.draft.metric.timeColumn, ...(t.draft.metric.filters ?? []).map((f) => f.column)]) {
        if (c) expect(def.columns, `${t.id}: ${c}`).toContain(c);
      }
      expect(t.draft.decision.length, t.id).toBeGreaterThan(10);
    }
  });
});

import { fromWall, tzOffsetMs, wallParts } from "../monitoring/zone";

describe("time zones", () => {
  it("evaluates wall-clock schedules in the monitor's zone, whatever the runtime zone", () => {
    const from = Date.parse("2026-10-20T15:00:00Z"); // 08:00 in Los Angeles (PDT)
    const next = nextRunAfter({ kind: "daily", hour: 9, minute: 0 }, from, "America/Los_Angeles");
    expect(new Date(next).toISOString()).toBe("2026-10-20T16:00:00.000Z");
    const nyCron = nextRunAfter({ kind: "cron", expr: "0 7 * * 1-5" }, from, "America/New_York");
    expect(new Date(nyCron).toISOString()).toBe("2026-10-21T11:00:00.000Z");
  });
  it("handles DST and offsets", () => {
    expect(tzOffsetMs(Date.parse("2026-07-01T12:00:00Z"), "Europe/London")).toBe(3_600_000);
    expect(tzOffsetMs(Date.parse("2026-12-01T12:00:00Z"), "Europe/London")).toBe(0);
    const w = Date.UTC(2026, 10, 1, 9, 0); // Nov 1 09:00 wall (after US DST ends)
    expect(new Date(fromWall(w, "America/Los_Angeles")).toISOString()).toBe("2026-11-01T17:00:00.000Z");
  });
  it("quiet hours, expected windows and seasonal slots use the zone", () => {
    const at = Date.parse("2026-10-20T05:30:00Z"); // 22:30 Mon in LA, 05:30 Tue in UTC
    expect(wallParts(at, "America/Los_Angeles")).toMatchObject({ weekday: 1, hour: 22 });
    expect(expectedWindowAt([{ id: "n", label: "night", fromHour: 22, toHour: 6, origin: "manual" }], at, "America/Los_Angeles")).not.toBeNull();
    expect(expectedWindowAt([{ id: "n", label: "night", fromHour: 22, toHour: 6, origin: "manual" }], at, "Asia/Tokyo")).toBeNull();
  });
  it("rejects schedules that never run", () => {
    expect(scheduleError({ kind: "cron", expr: "0 0 31 2 *" })).toMatch(/never/);
    expect(scheduleError({ kind: "daily", hour: Number.NaN, minute: 0 })).toBeTruthy();
    expect(scheduleError({ kind: "bogus" } as never)).toBeTruthy();
  });
});
