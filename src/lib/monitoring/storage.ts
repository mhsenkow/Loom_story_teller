// =================================================================
// Loom — Monitor persistence (localStorage, all runtimes)
// =================================================================
// Monitors, their recent checks and alerts survive reloads on web,
// desktop and iOS. Malformed payloads are dropped, never thrown.
// =================================================================

import type { CheckRecord, Monitor, MonitorAlert } from "./types";
import type { Moment } from "./moments";

const KEY = "loom-monitors";
const VERSION = 1;

export interface MonitorBundle {
  monitors: Monitor[];
  checks: Record<string, CheckRecord[]>;
  alerts: MonitorAlert[];
  moments?: Moment[];
  dismissedMoments?: string[];
}

const EMPTY: MonitorBundle = { monitors: [], checks: {}, alerts: [], moments: [] };

function isMonitor(v: unknown): v is Monitor {
  const m = v as Monitor;
  return !!m && typeof m.id === "string" && typeof m.name === "string" && !!m.metric && typeof m.metric.source === "string"
    && !!m.rule && typeof m.rule.kind === "string" && !!m.schedule && Array.isArray(m.expected);
}

export function loadMonitors(): MonitorBundle {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as { v?: number; data?: MonitorBundle };
    if (parsed.v !== VERSION || !parsed.data) return EMPTY;
    const monitors = Array.isArray(parsed.data.monitors) ? parsed.data.monitors.filter(isMonitor) : [];
    const ids = new Set(monitors.map((m) => m.id));
    const checks: Record<string, CheckRecord[]> = {};
    for (const [id, list] of Object.entries(parsed.data.checks ?? {})) {
      if (ids.has(id) && Array.isArray(list)) checks[id] = list.filter((c) => c && typeof c.at === "number");
    }
    const alerts = Array.isArray(parsed.data.alerts)
      ? parsed.data.alerts.filter((a) => a && typeof a.id === "string" && ids.has(a.monitorId))
      : [];
    const moments = Array.isArray(parsed.data.moments)
      ? parsed.data.moments.filter((m) => m && typeof m.id === "string" && typeof m.at === "number" && Array.isArray(m.series))
      : [];
    const dismissedMoments = Array.isArray(parsed.data.dismissedMoments) ? parsed.data.dismissedMoments.filter((x) => typeof x === "string").slice(0, 300) : [];
    return { monitors, checks, alerts, moments, dismissedMoments };
  } catch {
    return EMPTY;
  }
}

/** @returns false when storage is full or unavailable. */
export function saveMonitors(bundle: MonitorBundle): boolean {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ v: VERSION, data: bundle }));
    return true;
  } catch {
    // Quota: keep definitions and alerts, trim history to the last 100 checks each.
    try {
      const checks = Object.fromEntries(Object.entries(bundle.checks).map(([k, v]) => [k, v.slice(-100)]));
      const moments = (bundle.moments ?? []).slice(0, 30);
      globalThis.localStorage?.setItem(KEY, JSON.stringify({ v: VERSION, data: { ...bundle, checks, moments } }));
      return true;
    } catch {
      return false;
    }
  }
}

/** Portable JSON (export / import between devices). */
export function exportMonitorsJson(monitors: Monitor[]): string {
  return JSON.stringify({ loomMonitors: VERSION, monitors: monitors.map(({ nextRunAt: _n, ...m }) => m) }, null, 2);
}

export function parseMonitorsJson(text: string): Monitor[] {
  const parsed = JSON.parse(text) as { loomMonitors?: number; monitors?: unknown[] };
  if (parsed.loomMonitors !== VERSION || !Array.isArray(parsed.monitors)) throw new Error("Not a Loom monitors file");
  return parsed.monitors.filter(isMonitor);
}
