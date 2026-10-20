// =================================================================
// Loom — Monitoring types
// =================================================================
// A monitor is a question tied to a decision: "if <metric> does <X>,
// I will <action>". Each check records a value; a rule turns values
// into a status; alerts carry a review outcome so a monitor can earn
// (or lose) its keep. Pure data — shared by the app and the Worker cron.
// =================================================================

import type { SourceKind } from "../sourceRegistry";

export type MonitorAgg = "latest" | "count" | "sum" | "avg" | "min" | "max" | "median" | "p95" | "distinct";

/** Row filter applied before aggregation (all must match). */
export interface MetricFilter {
  column: string;
  op: "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains";
  value: string;
}

/** One number computed from a feed snapshot. */
export interface MetricSpec {
  source: SourceKind;
  agg: MonitorAgg;
  /** Not needed for `count`. */
  column?: string;
  filters?: MetricFilter[];
  /** Only rows whose `timeColumn` is within the last N minutes (when both set). */
  timeColumn?: string;
  lookbackMinutes?: number;
  /** Display unit (e.g. "°C", "%"). */
  unit?: string;
}

/**
 * How a value becomes a problem. Out-of-range is not the same as wrong:
 * `anomaly` compares against what is normal *for this moment*, and expected
 * windows (below) remove known, deliberate, or seasonal causes first.
 */
export type MonitorRule =
  | { kind: "threshold"; above?: number; below?: number }
  | { kind: "range"; low: number; high: number }
  | { kind: "change"; pct: number; direction: "up" | "down" | "either"; versus: "previous" | "baseline" }
  | {
      kind: "anomaly";
      /** Robust z-score (median / MAD) cut-off: 2.5 sensitive · 3.5 balanced · 5 conservative. */
      sensitivity: number;
      /** Trailing checks used as the baseline (5–200). */
      window: number;
      /** Compare only with past checks at the same hour of day / weekday. */
      seasonal: "none" | "hour" | "weekday-hour";
    }
  | { kind: "stale"; maxAgeMinutes: number };

export type MonitorSeverity = "info" | "warning" | "critical";

/**
 * Known reasons a value may legitimately look odd — a maintenance window,
 * a planned launch, a holiday, a deliberate test. Checks inside a window
 * are recorded but never alert ("expected").
 */
export interface ExpectedWindow {
  id: string;
  label: string;
  /** One-off window (ms). */
  start?: number;
  end?: number;
  /** Recurring: weekdays 0=Sun…6=Sat with local hour range [fromHour, toHour). */
  weekdays?: number[];
  fromHour?: number;
  toHour?: number;
  /** Where it came from: typed by a person, or learned from an "expected" review. */
  origin: "manual" | "review";
}

export type MonitorSchedule =
  | { kind: "interval"; minutes: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  /** 5-field cron (min hour dom month dow), evaluated in local time. */
  | { kind: "cron"; expr: string };

export interface MonitorNotify {
  inApp: boolean;
  /** OS / browser notification. */
  system: boolean;
  /** Re-notify at most once per cooldown while still firing. */
  cooldownMinutes: number;
  /** Local hours with no system notifications (still logged). */
  quietFromHour?: number;
  quietToHour?: number;
}

export interface Monitor {
  id: string;
  name: string;
  /** The decision this informs — "If this fires, I will …". Required to save. */
  decision: string;
  /** Optional why-it-matters note (who cares, what it costs). */
  rationale?: string;
  metric: MetricSpec;
  rule: MonitorRule;
  /** Must fail this many consecutive checks before alerting (debounce flapping). */
  confirmChecks: number;
  severity: MonitorSeverity;
  schedule: MonitorSchedule;
  notify: MonitorNotify;
  expected: ExpectedWindow[];
  /** Groups monitors into one scorecard (e.g. "City heat health"). */
  scorecard?: string;
  enabled: boolean;
  /** The chart this monitor was made from (`chart=…` link), so cards and alerts can reopen it. */
  chart?: { link: string; title: string };
  /** Extras when it fires (beyond notifications). */
  onFire?: {
    /** Publish the moment as a public story page automatically. */
    shareMoment?: boolean;
    /** Play a short chime in the app. */
    chime?: boolean;
  };
  /** Always on: evaluated by the Worker cron (app closed too) and alerts go to the webhook. */
  cloud?: boolean;
  createdAt: number;
  /** Next due time (ms) — maintained by the runner. */
  nextRunAt?: number;
}

export type CheckStatus = "ok" | "breach" | "firing" | "expected" | "no-data" | "error";

export interface CheckRecord {
  monitorId: string;
  at: number;
  value: number | null;
  status: CheckStatus;
  /** Plain-language reason ("31.4 °C is above 30 °C"). */
  reason: string;
  /** Baseline / expected value when the rule has one. */
  baseline?: number;
  /** Robust z-score for anomaly rules. */
  score?: number;
  /** Anomaly baseline MAD (draws the normal band). */
  spread?: number;
  rowsSeen?: number;
}

export type AlertOutcome = "acted" | "expected" | "deliberate" | "false-alarm" | "ignored";

export interface MonitorAlert {
  id: string;
  monitorId: string;
  openedAt: number;
  /** Last check that kept it firing. */
  lastAt: number;
  closedAt?: number;
  peakValue: number | null;
  reason: string;
  severity: MonitorSeverity;
  lastNotifiedAt?: number;
  acknowledgedAt?: number;
  outcome?: AlertOutcome;
  note?: string;
}

export const ALERT_OUTCOME_LABELS: Record<AlertOutcome, string> = {
  acted: "Acted on it",
  expected: "Expected (normal here)",
  deliberate: "Done on purpose",
  "false-alarm": "False alarm",
  ignored: "Saw it, no action",
};
