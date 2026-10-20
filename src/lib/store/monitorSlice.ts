// =================================================================
// monitorSlice — monitors, check history, and alerts
// =================================================================
// The runner (useMonitorRunner) evaluates due monitors and writes back
// through `recordCheck`; the Monitor view edits definitions and reviews
// alerts. Persisted by monitoring/storage.ts (localStorage).
// =================================================================

import type { StateCreator } from "zustand";
import type { LoomState } from "./types";
import type { AlertOutcome, CheckRecord, ExpectedWindow, Monitor, MonitorAlert } from "../monitoring/types";
import type { MonitorDraft } from "../monitoring/templates";
import { MAX_HISTORY_PER_MONITOR, windowFromReview } from "../monitoring/engine";
import { nextRunAfter } from "../monitoring/schedule";
import { MAX_MOMENTS, type Moment } from "../monitoring/moments";

export const MAX_ALERTS = 300;

const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export interface MonitorState {
  monitors: Monitor[];
  /** monitorId → checks, oldest → newest (capped). */
  monitorChecks: Record<string, CheckRecord[]>;
  monitorAlerts: MonitorAlert[];
  /** Snapshots of what each alert looked like (newest first). */
  monitorMoments: Moment[];
  /** Moment opened in the Monitor view (from a notification, card, or link). */
  focusedMomentId: string | null;
  /** Ids currently being checked (spinners, no double-runs). */
  monitorsRunning: string[];
  monitorEditingId: string | "new" | null;
  monitorDraftSeed: MonitorDraft | null;
  /** Quick Watch (one sentence, over any view) or the full editor (Monitor view). */
  monitorEditorMode: "quick" | "full";

  hydrateMonitors: (data: { monitors: Monitor[]; checks: Record<string, CheckRecord[]>; alerts: MonitorAlert[]; moments?: Moment[] }) => void;
  addMoment: (m: Moment) => void;
  updateMoment: (id: string, patch: Partial<Moment>) => void;
  removeMoment: (id: string) => void;
  focusMoment: (id: string | null) => void;
  addMonitor: (draft: MonitorDraft) => string;
  updateMonitor: (id: string, patch: Partial<Monitor>) => void;
  removeMonitor: (id: string) => void;
  setMonitorEnabled: (id: string, enabled: boolean) => void;
  setMonitorRunning: (id: string, running: boolean) => void;
  recordCheck: (id: string, record: CheckRecord, alert: MonitorAlert | undefined) => void;
  reviewAlert: (alertId: string, outcome: AlertOutcome, note?: string, learnExpected?: boolean) => void;
  addExpectedWindow: (monitorId: string, w: Omit<ExpectedWindow, "id">) => void;
  removeExpectedWindow: (monitorId: string, windowId: string) => void;
  openMonitorEditor: (id: string | "new" | null, seed?: MonitorDraft | null, mode?: "quick" | "full") => void;
  clearMonitorHistory: (id: string) => void;
  /** Replace always-on monitors' history and alerts with the Worker's, keeping local reviews. */
  mergeCloudResults: (checks: Record<string, CheckRecord[]>, alerts: MonitorAlert[], moments?: Moment[]) => void;
}

export const monitorInitialState = {
  monitors: [] as Monitor[],
  monitorChecks: {} as Record<string, CheckRecord[]>,
  monitorAlerts: [] as MonitorAlert[],
  monitorMoments: [] as Moment[],
  focusedMomentId: null as string | null,
  monitorsRunning: [] as string[],
  monitorEditingId: null as string | "new" | null,
  monitorDraftSeed: null as MonitorDraft | null,
  monitorEditorMode: "full" as "quick" | "full",
};

export const createMonitorSlice: StateCreator<LoomState, [], [], Omit<MonitorState, keyof typeof monitorInitialState>> = (set) => ({
  hydrateMonitors: ({ monitors, checks, alerts, moments }) => set({ monitors, monitorChecks: checks, monitorAlerts: alerts, monitorMoments: moments ?? [] }),
  addMoment: (m) => set((s) => ({ monitorMoments: [m, ...s.monitorMoments.filter((x) => x.id !== m.id)].slice(0, MAX_MOMENTS) })),
  updateMoment: (id, patch) => set((s) => ({ monitorMoments: s.monitorMoments.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  removeMoment: (id) => set((s) => ({ monitorMoments: s.monitorMoments.filter((m) => m.id !== id) })),
  focusMoment: (id) => set({ focusedMomentId: id }),
  addMonitor: (draft) => {
    const id = uid("mon");
    const now = Date.now();
    const m: Monitor = { ...draft, id, createdAt: now, nextRunAt: now };
    set((s) => ({ monitors: [...s.monitors, m] }));
    return id;
  },
  updateMonitor: (id, patch) =>
    set((s) => ({
      monitors: s.monitors.map((m) => {
        if (m.id !== id) return m;
        const next = { ...m, ...patch };
        // A new schedule or rule takes effect on the next tick.
        if (patch.schedule || patch.rule || patch.metric) next.nextRunAt = Date.now();
        return next;
      }),
    })),
  removeMonitor: (id) =>
    set((s) => {
      const checks = { ...s.monitorChecks };
      delete checks[id];
      return {
        monitors: s.monitors.filter((m) => m.id !== id),
        monitorChecks: checks,
        monitorAlerts: s.monitorAlerts.filter((a) => a.monitorId !== id),
      };
    }),
  setMonitorEnabled: (id, enabled) =>
    set((s) => ({ monitors: s.monitors.map((m) => (m.id === id ? { ...m, enabled, nextRunAt: enabled ? Date.now() : m.nextRunAt } : m)) })),
  setMonitorRunning: (id, running) =>
    set((s) => ({
      monitorsRunning: running ? [...new Set([...s.monitorsRunning, id])] : s.monitorsRunning.filter((x) => x !== id),
    })),
  recordCheck: (id, record, alert) =>
    set((s) => {
      const prev = s.monitorChecks[id] ?? [];
      const checks = { ...s.monitorChecks, [id]: [...prev, record].slice(-MAX_HISTORY_PER_MONITOR) };
      let alerts = s.monitorAlerts;
      if (alert) {
        const i = alerts.findIndex((a) => a.id === alert.id);
        alerts = i >= 0 ? alerts.map((a, j) => (j === i ? alert : a)) : [alert, ...alerts];
        alerts = alerts.slice(0, MAX_ALERTS);
      }
      const monitors = s.monitors.map((m) => {
        if (m.id !== id) return m;
        let nextRunAt: number;
        try { nextRunAt = nextRunAfter(m.schedule, record.at); } catch { nextRunAt = record.at + 3_600_000; }
        return { ...m, nextRunAt };
      });
      return { monitorChecks: checks, monitorAlerts: alerts, monitors };
    }),
  reviewAlert: (alertId, outcome, note, learnExpected) =>
    set((s) => {
      const alert = s.monitorAlerts.find((a) => a.id === alertId);
      if (!alert) return s;
      const now = Date.now();
      const reviewed: MonitorAlert = { ...alert, outcome, note: note?.trim() || undefined, acknowledgedAt: alert.acknowledgedAt ?? now };
      const monitors = learnExpected && (outcome === "expected" || outcome === "deliberate")
        ? s.monitors.map((m) => (m.id === alert.monitorId ? { ...m, expected: [...m.expected, windowFromReview(alert, uid("exp"), note)] } : m))
        : s.monitors;
      return { monitorAlerts: s.monitorAlerts.map((a) => (a.id === alertId ? reviewed : a)), monitors };
    }),
  addExpectedWindow: (monitorId, w) =>
    set((s) => ({ monitors: s.monitors.map((m) => (m.id === monitorId ? { ...m, expected: [...m.expected, { ...w, id: uid("exp") }] } : m)) })),
  removeExpectedWindow: (monitorId, windowId) =>
    set((s) => ({ monitors: s.monitors.map((m) => (m.id === monitorId ? { ...m, expected: m.expected.filter((w) => w.id !== windowId) } : m)) })),
  openMonitorEditor: (id, seed = null, mode = "full") => set({ monitorEditingId: id, monitorDraftSeed: seed, monitorEditorMode: mode }),
  clearMonitorHistory: (id) =>
    set((s) => ({ monitorChecks: { ...s.monitorChecks, [id]: [] } })),
  mergeCloudResults: (checks, alerts, moments = []) =>
    set((s) => {
      const cloudIds = new Set(s.monitors.filter((m) => m.cloud).map((m) => m.id));
      if (!cloudIds.size) return s;
      const local = new Map(s.monitorAlerts.map((a) => [a.id, a]));
      const nextChecks = { ...s.monitorChecks };
      for (const id of cloudIds) if (checks[id]) nextChecks[id] = checks[id]!.slice(-MAX_HISTORY_PER_MONITOR);
      const fromCloud = alerts
        .filter((a) => cloudIds.has(a.monitorId))
        .map((a) => {
          const mine = local.get(a.id);
          return mine?.outcome ? { ...a, outcome: mine.outcome, note: mine.note, acknowledgedAt: mine.acknowledgedAt ?? a.acknowledgedAt } : a;
        });
      const ids = new Set(fromCloud.map((a) => a.id));
      const rest = s.monitorAlerts.filter((a) => !ids.has(a.id) && !(cloudIds.has(a.monitorId) && !a.outcome));
      const merged = [...fromCloud, ...rest].sort((a, b) => b.openedAt - a.openedAt).slice(0, MAX_ALERTS);
      const known = new Map(s.monitorMoments.map((m) => [m.id, m]));
      const fresh = moments.filter((m) => cloudIds.has(m.monitorId)).map((m) => ({ ...m, storyUrl: known.get(m.id)?.storyUrl ?? m.storyUrl }));
      const freshIds = new Set(fresh.map((m) => m.id));
      const allMoments = [...fresh, ...s.monitorMoments.filter((m) => !freshIds.has(m.id))].sort((a, b) => b.at - a.at).slice(0, MAX_MOMENTS);
      return { monitorChecks: nextChecks, monitorAlerts: merged, monitorMoments: allMoments };
    }),
});
