// =================================================================
// Loom — Monitor runner (in-app scheduler)
// =================================================================
// While Loom is open, a 20s tick checks every enabled monitor whose
// `nextRunAt` has passed: make sure its feed is connected, take a
// snapshot, compute the metric, run the rule, record the check, and
// notify. Several monitors on one feed share one snapshot per tick.
// Always-on checks (app closed) are the Worker cron's job (cloudSync.ts).
// =================================================================

import { useLoomStore } from "../store";
import { sourceSnapshot, sourceStart, sourceStatus } from "../tauri";
import { SOURCE_BY_KIND, SOURCE_EXPLORE_ROWS, type SourceKind } from "../sourceRegistry";
import type { InspectResult } from "../tauri";
import { computeMetric, describeRule, fmtValue, runCheck } from "./engine";
import { playChime, sendSystemNotification } from "./notify";
import { metricSeries } from "./backfill";
import { momentFrom, type Moment } from "./moments";
import type { Monitor } from "./types";

const TICK_MS = 20_000;
const WARMUP_WAIT_MS = 12_000;

const uid = () => `alr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Connect the feed if needed and wait briefly for its first rows. */
async function feedSnapshot(kind: SourceKind): Promise<InspectResult> {
  let status = await sourceStatus(kind);
  if (!status.running) {
    await sourceStart(kind);
    status = await sourceStatus(kind);
    useLoomStore.getState().setSourceStatus(kind, status);
  }
  const deadline = Date.now() + WARMUP_WAIT_MS;
  while (status.buffer_rows === 0 && Date.now() < deadline) {
    await sleep(1_000);
    status = await sourceStatus(kind);
  }
  return sourceSnapshot(kind, SOURCE_EXPLORE_ROWS);
}

export async function runMonitorNow(monitorId: string, cache?: Map<SourceKind, Promise<InspectResult>>): Promise<void> {
  const store = useLoomStore.getState();
  const m = store.monitors.find((x) => x.id === monitorId);
  if (!m || store.monitorsRunning.includes(m.id)) return;
  store.setMonitorRunning(m.id, true);
  const at = Date.now();
  try {
    let snapPromise = cache?.get(m.metric.source);
    if (!snapPromise) {
      snapPromise = feedSnapshot(m.metric.source);
      cache?.set(m.metric.source, snapPromise);
    }
    const snap = await snapPromise;
    const metric = computeMetric(m.metric, snap.sample, at);
    const s = useLoomStore.getState();
    const history = s.monitorChecks[m.id] ?? [];
    const open = s.monitorAlerts.find((a) => a.monitorId === m.id && !a.closedAt);
    const out = runCheck(m, metric, history, open, at, uid);
    s.recordCheck(m.id, out.record, out.alert);
    let moment: Moment | undefined;
    if (out.alert && !open && !out.alert.closedAt) {
      moment = momentFrom(m, {
        id: `mom_${out.alert.id}`,
        at,
        value: out.record.value,
        reason: out.record.reason,
        feedLabel: SOURCE_BY_KIND[m.metric.source]?.label ?? m.metric.source,
        series: m.metric.timeColumn ? metricSeries(m.metric, snap.sample) : [],
      });
      useLoomStore.getState().addMoment(moment);
      if (m.onFire?.shareMoment) {
        const mo = moment;
        void import("./shareMoment").then(({ publishMoment }) => publishMoment(mo)).catch(() => undefined);
      }
    }
    if (out.notify) deliver(m, out.record.reason, out.record.value, moment?.id);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    useLoomStore.getState().recordCheck(m.id, { monitorId: m.id, at, value: null, status: "error", reason }, undefined);
  } finally {
    useLoomStore.getState().setMonitorRunning(m.id, false);
  }
}

function deliver(m: Monitor, reason: string, value: number | null, momentId?: string) {
  const s = useLoomStore.getState();
  const icon = m.severity === "critical" ? "🔴" : m.severity === "warning" ? "🟠" : "🔵";
  if (m.notify.inApp) s.setToast(`${icon} ${m.name}: ${reason}`);
  if (m.notify.system) {
    const feed = SOURCE_BY_KIND[m.metric.source]?.label ?? m.metric.source;
    const body = `${reason}\n→ ${m.decision}`;
    void sendSystemNotification(`${icon} ${m.name}`, body || `${feed}: ${fmtValue(value, m.metric.unit)}`, m.id, () => {
      const st = useLoomStore.getState();
      st.setViewMode("monitor");
      if (momentId) st.focusMoment(momentId);
    });
  }
  if (m.onFire?.chime) playChime(m.severity);
}

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

export async function tickMonitors(now = Date.now()): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const { monitors, monitorsRunning } = useLoomStore.getState();
    // Always-on monitors are run by the Worker cron; the app only pulls their results.
    const due = monitors.filter((m) => m.enabled && !m.cloud && (m.nextRunAt ?? 0) <= now && !monitorsRunning.includes(m.id));
    if (!due.length) return;
    const cache = new Map<SourceKind, Promise<InspectResult>>();
    await Promise.all(due.map((m) => runMonitorNow(m.id, cache)));
  } finally {
    ticking = false;
  }
}

export function startMonitorScheduler(): () => void {
  if (timer) return stopMonitorScheduler;
  void tickMonitors();
  timer = setInterval(() => void tickMonitors(), TICK_MS);
  return stopMonitorScheduler;
}

export function stopMonitorScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Line used on cards / notifications: "Kp at storm level — Alert when above 4.99". */
export function monitorSummary(m: Monitor): string {
  return `${SOURCE_BY_KIND[m.metric.source]?.label ?? m.metric.source} · ${describeRule(m.rule, m.metric.unit)}`;
}
