// =================================================================
// Loom Worker — always-on monitors (Cron Trigger + KV)
// =================================================================
// A device opts monitors into "always on". The app PUTs their
// definitions plus where to send alerts; every 5 minutes the cron
// evaluates due monitors with the same engine the app uses, keeps the
// history in KV, and POSTs firing alerts to the device's webhook
// (ntfy topic, Slack, Discord, or any HTTPS JSON endpoint).
//
//   PUT    /api/monitors   { monitors, webhook }   X-Loom-Device: <secret>
//   GET    /api/monitors   → { checks, alerts, updatedAt }
//   DELETE /api/monitors
//   POST   /api/monitors/test-webhook
//
// The device secret is never stored: KV keys use its SHA-256.
// =================================================================

import { computeMetric, runCheck } from "../src/lib/monitoring/engine";
import { nextRunAfter } from "../src/lib/monitoring/schedule";
import type { CheckRecord, Monitor, MonitorAlert } from "../src/lib/monitoring/types";
import { SOURCE_BY_KIND, isSourceKind, sortRowsByOrderBy, type SourceKind } from "../src/lib/sourceRegistry";
import { assertHttpUrlAllowed } from "../src/lib/ssrfGuard";
import type { QueryResult } from "../src/lib/queryTypes";

export interface MonitorKv {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

export const CLOUD_MAX_MONITORS = 20;
export const CLOUD_MIN_INTERVAL_MINUTES = 15;
const HISTORY_CAP = 200;
const ALERT_CAP = 100;
/** Bundles untouched by their device for this long expire (KV TTL). */
const BUNDLE_TTL_SECS = 60 * 60 * 24 * 45;
const PREFIX = "mon:";

export interface CloudWebhook {
  kind: "ntfy" | "slack" | "discord" | "json";
  url: string;
}

export interface CloudBundle {
  monitors: Monitor[];
  webhook?: CloudWebhook;
  checks: Record<string, CheckRecord[]>;
  alerts: MonitorAlert[];
  updatedAt: number;
}

/** Raw `/api/source/<kind>` body for one feed. */
export type SourceFetch = (kind: SourceKind) => Promise<unknown>;
/** Upstream body → rows in registry column order (sourceParsers' parseSourceRows). */
export type SourceParse = (kind: SourceKind, body: unknown) => unknown[][];

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function deviceKey(secret: string | null): Promise<string | null> {
  if (!secret || !/^[A-Za-z0-9_-]{32,128}$/.test(secret)) return null;
  return `${PREFIX}${await sha256(secret)}`;
}

const WEBHOOK_HOSTS: Record<CloudWebhook["kind"], (h: string) => boolean> = {
  ntfy: () => true,
  slack: (h) => h === "hooks.slack.com",
  discord: (h) => h === "discord.com" || h === "discordapp.com",
  json: () => true,
};

export function validateWebhook(w: unknown): CloudWebhook | null {
  const hook = w as CloudWebhook | undefined;
  if (!hook || typeof hook.url !== "string" || !(hook.kind in WEBHOOK_HOSTS)) return null;
  try {
    const u = new URL(hook.url);
    if (u.protocol !== "https:") return null;
    assertHttpUrlAllowed(u);
    if (!WEBHOOK_HOSTS[hook.kind](u.hostname)) return null;
    return { kind: hook.kind, url: u.toString() };
  } catch {
    return null;
  }
}

/** Clamp what a device may ask the cron to do. */
export function sanitizeCloudMonitors(list: unknown): Monitor[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m): m is Monitor => !!m && typeof (m as Monitor).id === "string" && isSourceKind(String((m as Monitor).metric?.source)) && !!(m as Monitor).rule && !!(m as Monitor).schedule)
    .slice(0, CLOUD_MAX_MONITORS)
    .map((m) => {
      const schedule = m.schedule.kind === "interval" ? { ...m.schedule, minutes: Math.max(CLOUD_MIN_INTERVAL_MINUTES, Number(m.schedule.minutes) || 60) } : m.schedule;
      return {
        ...m,
        name: String(m.name).slice(0, 120),
        decision: String(m.decision ?? "").slice(0, 400),
        rationale: undefined,
        schedule,
        expected: Array.isArray(m.expected) ? m.expected.slice(0, 50) : [],
        metric: { ...m.metric, filters: (m.metric.filters ?? []).slice(0, 8) },
      };
    });
}

export function sampleFor(kind: SourceKind, body: unknown, parse: SourceParse): QueryResult {
  const def = SOURCE_BY_KIND[kind];
  const rows = sortRowsByOrderBy(parse(kind, body), def.columns, def.orderBy) as QueryResult["rows"];
  return { columns: def.columns, types: def.types, rows, total_rows: rows.length };
}

const SEVERITY_ICON = { info: "🔵", warning: "🟠", critical: "🔴" } as const;

export function webhookRequest(hook: CloudWebhook, m: Pick<Monitor, "name" | "decision" | "severity">, reason: string): RequestInit {
  const title = `${SEVERITY_ICON[m.severity]} ${m.name}`;
  const text = `${reason}\n→ ${m.decision}`;
  switch (hook.kind) {
    case "ntfy":
      return { method: "POST", headers: { Title: /^[\x20-\x7e]*$/.test(m.name) ? m.name : "Loom alert", Priority: m.severity === "critical" ? "5" : m.severity === "warning" ? "4" : "3", Tags: "loom" }, body: `${m.name}: ${text}` };
    case "slack":
      return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `*${title}*\n${text}` }) };
    case "discord":
      return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `**${title}**\n${text}`.slice(0, 1900) }) };
    case "json":
      return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "loom", monitor: m.name, severity: m.severity, reason, decision: m.decision }) };
  }
}

async function postWebhook(hook: CloudWebhook, m: Monitor, reason: string): Promise<boolean> {
  try {
    const res = await fetch(hook.url, { ...webhookRequest(hook, m, reason), redirect: "manual", signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Evaluate one device's due monitors. Mutates and returns the bundle;
 * `changed` is false when nothing was due (skip the KV write).
 */
export async function evaluateBundle(
  bundle: CloudBundle,
  now: number,
  fetchSource: SourceFetch,
  parse: SourceParse,
  send: (hook: CloudWebhook, m: Monitor, reason: string) => Promise<boolean> = postWebhook,
): Promise<{ bundle: CloudBundle; changed: boolean }> {
  const snaps = new Map<SourceKind, Promise<QueryResult>>();
  let changed = false;
  for (const m of bundle.monitors) {
    if (!m.enabled || (m.nextRunAt ?? 0) > now) continue;
    changed = true;
    const history = bundle.checks[m.id] ?? [];
    const open = bundle.alerts.find((a) => a.monitorId === m.id && !a.closedAt);
    let record: CheckRecord;
    let alert: MonitorAlert | undefined;
    let notify = false;
    try {
      let p = snaps.get(m.metric.source);
      if (!p) {
        p = fetchSource(m.metric.source).then((body) => sampleFor(m.metric.source, body, parse));
        snaps.set(m.metric.source, p);
      }
      const out = runCheck(m, computeMetric(m.metric, await p, now), history, open, now, () => `alr_${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`);
      ({ record, alert, notify } = out);
    } catch (e) {
      record = { monitorId: m.id, at: now, value: null, status: "error", reason: e instanceof Error ? e.message : String(e) };
    }
    bundle.checks[m.id] = [...history, record].slice(-HISTORY_CAP);
    if (alert) {
      const i = bundle.alerts.findIndex((a) => a.id === alert!.id);
      bundle.alerts = (i >= 0 ? bundle.alerts.map((a, j) => (j === i ? alert! : a)) : [alert, ...bundle.alerts]).slice(0, ALERT_CAP);
    }
    if (notify && bundle.webhook) await send(bundle.webhook, m, record.reason);
    try { m.nextRunAt = nextRunAfter(m.schedule, now); } catch { m.nextRunAt = now + 3_600_000; }
  }
  if (changed) bundle.updatedAt = now;
  return { bundle, changed };
}

/** Cron entry: walk every device bundle (paged), evaluate, write back what changed. */
export async function runMonitorCron(kv: MonitorKv, now: number, fetchSource: SourceFetch, parse: SourceParse): Promise<{ devices: number; evaluated: number }> {
  let cursor: string | undefined;
  let devices = 0;
  let evaluated = 0;
  // Each device's monitors share upstream snapshots within one cron run.
  const shared = new Map<SourceKind, Promise<unknown>>();
  const cachedFetch: SourceFetch = (kind) => {
    let p = shared.get(kind);
    if (!p) { p = fetchSource(kind); shared.set(kind, p); }
    return p;
  };
  do {
    const page = await kv.list({ prefix: PREFIX, cursor, limit: 500 });
    for (const { name } of page.keys) {
      devices++;
      const bundle = (await kv.get(name, "json")) as CloudBundle | null;
      if (!bundle?.monitors?.length) continue;
      const { changed } = await evaluateBundle(bundle, now, cachedFetch, parse);
      if (changed) {
        evaluated++;
        await kv.put(name, JSON.stringify(bundle), { expirationTtl: BUNDLE_TTL_SECS });
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return { devices, evaluated };
}

/** PUT body → stored bundle, keeping existing history for monitors that remain. */
export function mergeUpload(prev: CloudBundle | null, monitors: Monitor[], webhook: CloudWebhook | undefined, now: number, acks: string[] = []): CloudBundle {
  const acked = new Set(acks);
  const ids = new Set(monitors.map((m) => m.id));
  const prevById = new Map((prev?.monitors ?? []).map((m) => [m.id, m]));
  return {
    monitors: monitors.map((m) => {
      const old = prevById.get(m.id);
      const same = old && JSON.stringify(old.schedule) === JSON.stringify(m.schedule);
      return { ...m, nextRunAt: same ? old!.nextRunAt : now };
    }),
    webhook,
    checks: Object.fromEntries(Object.entries(prev?.checks ?? {}).filter(([id]) => ids.has(id))),
    alerts: (prev?.alerts ?? [])
      .filter((a) => ids.has(a.monitorId))
      .map((a) => (acked.has(a.id) && !a.acknowledgedAt ? { ...a, acknowledgedAt: now } : a)),
    updatedAt: now,
  };
}

export { BUNDLE_TTL_SECS };
