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
import { nextRunAfter, scheduleError } from "../src/lib/monitoring/schedule";
import { isValidTimeZone } from "../src/lib/monitoring/zone";
import type { CheckRecord, Monitor, MonitorAlert } from "../src/lib/monitoring/types";
import { SOURCE_BY_KIND, isSourceKind, sortRowsByOrderBy, type SourceKind } from "../src/lib/sourceRegistry";
import { assertHttpUrlAllowed } from "../src/lib/ssrfGuard";
import type { QueryResult } from "../src/lib/queryTypes";
import { momentFrom, type Moment } from "../src/lib/monitoring/moments";
import { metricSeries } from "../src/lib/monitoring/backfill";
import { sendWebPush, isAllowedPushEndpoint, type PushSubscriptionJSON, type VapidKeys } from "./webPush";

export interface MonitorKv {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number; expiration?: number }): Promise<void>;
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
  /** Browser Web Push subscriptions for this device (≤ 5). */
  push?: PushSubscriptionJSON[];
  checks: Record<string, CheckRecord[]>;
  alerts: MonitorAlert[];
  /** Snapshots of each alert as it opened (newest first). */
  moments?: Moment[];
  /** Public, read-only status page + RSS (`/w/<id>`), when the device opted in. */
  public?: { id: string; title: string };
  updatedAt: number;
  /** Bumped by every device write; the cron re-reads before writing and merges when it moved. */
  rev?: number;
  /** Last device write (ms). The bundle expires 45 days after this, however often the cron runs. */
  syncedAt?: number;
}

/** When a bundle stops existing: 45 days after its device last synced (KV `expiration`, seconds). */
export function bundleExpiry(b: Pick<CloudBundle, "syncedAt" | "updatedAt">): number {
  return Math.floor(((b.syncedAt ?? b.updatedAt) + BUNDLE_TTL_SECS * 1000) / 1000);
}

export const MOMENT_CAP = 30;
export const PUSH_CAP = 5;

/** How one firing check reaches people. */
export type Notifier = (bundle: CloudBundle, m: Monitor, reason: string, moment?: Moment) => Promise<void>;

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
    // Drop schedules that never run, have bad fields, or would make the cron scan forever.
    .filter((m) => scheduleError(m.schedule, isValidTimeZone(m.tz) ? m.tz : undefined) == null)
    .slice(0, CLOUD_MAX_MONITORS)
    .map((m) => {
      const schedule = m.schedule.kind === "interval" ? { ...m.schedule, minutes: Math.max(CLOUD_MIN_INTERVAL_MINUTES, Number(m.schedule.minutes) || 60) } : m.schedule;
      return {
        ...m,
        name: String(m.name).slice(0, 120),
        decision: String(m.decision ?? "").slice(0, 400),
        rationale: undefined,
        tz: isValidTimeZone(m.tz) ? m.tz : undefined,
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
  notify: Notifier = makeNotifier(),
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
    let fire = false;
    let sample: QueryResult | undefined;
    try {
      let p = snaps.get(m.metric.source);
      if (!p) {
        p = fetchSource(m.metric.source).then((body) => sampleFor(m.metric.source, body, parse));
        snaps.set(m.metric.source, p);
      }
      sample = await p;
      const out = runCheck(m, computeMetric(m.metric, sample, now), history, open, now, () => `alr_${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`);
      ({ record, alert, notify: fire } = out);
    } catch (e) {
      record = { monitorId: m.id, at: now, value: null, status: "error", reason: e instanceof Error ? e.message : String(e) };
    }
    bundle.checks[m.id] = [...history, record].slice(-HISTORY_CAP);
    if (alert) {
      const i = bundle.alerts.findIndex((a) => a.id === alert!.id);
      bundle.alerts = (i >= 0 ? bundle.alerts.map((a, j) => (j === i ? alert! : a)) : [alert, ...bundle.alerts]).slice(0, ALERT_CAP);
    }
    let moment: Moment | undefined;
    if (alert && !open && !alert.closedAt) {
      // Our own checks once there are enough of them; before that, replay the feed's rows.
      const own = bundle.checks[m.id]!.filter((c) => c.value != null).map((c) => ({ at: c.at, value: c.value as number }));
      const series = own.length >= 8 || !sample || !m.metric.timeColumn ? own : metricSeries(m.metric, sample);
      moment = momentFrom(m, { id: `mom_${alert.id}`, at: now, value: record.value, reason: record.reason, feedLabel: SOURCE_BY_KIND[m.metric.source]?.label ?? m.metric.source, series, cloud: true });
      bundle.moments = [moment, ...(bundle.moments ?? [])].slice(0, MOMENT_CAP);
    }
    if (fire) await notify(bundle, m, record.reason, moment);
    // Every schedule kind keeps the cloud minimum spacing (a */1 cron still runs at most every 15 min).
    try { m.nextRunAt = Math.max(nextRunAfter(m.schedule, now, m.tz), now + CLOUD_MIN_INTERVAL_MINUTES * 60_000); } catch { m.nextRunAt = now + 3_600_000; }
  }
  if (changed) bundle.updatedAt = now;
  return { bundle, changed };
}

/** Cron entry: walk every device bundle (paged), evaluate, write back what changed. */
export async function runMonitorCron(kv: MonitorKv, now: number, fetchSource: SourceFetch, parse: SourceParse, notify: Notifier = makeNotifier()): Promise<{ devices: number; evaluated: number }> {
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
      if (!bundle) continue;
      // A device that stopped syncing (cleared data, uninstalled) stops being alerted.
      if (now >= bundleExpiry(bundle) * 1000) {
        await kv.delete(name);
        if (bundle.public) await kv.delete(`monpub:${bundle.public.id}`);
        continue;
      }
      if (!bundle.monitors?.length) continue;
      const pushBefore = new Set((bundle.push ?? []).map((p) => p.endpoint));
      const { changed } = await evaluateBundle(bundle, now, cachedFetch, parse, notify);
      if (changed) {
        evaluated++;
        // KV has no compare-and-swap: if the device wrote meanwhile, fold our results into its copy.
        const fresh = (await kv.get(name, "json")) as CloudBundle | null;
        const out = fresh && (fresh.rev ?? 0) !== (bundle.rev ?? 0) ? foldCronResults(fresh, bundle, pushBefore) : bundle;
        if (!fresh) continue; // deleted by the device mid-run
        await kv.put(name, JSON.stringify(out), { expiration: bundleExpiry(out) });
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return { devices, evaluated };
}

/**
 * The device wrote while the cron was evaluating: keep the device's definitions,
 * webhook, push list and public page; carry over only what the cron produced.
 */
export function foldCronResults(fresh: CloudBundle, evaluated: CloudBundle, pushBefore: Set<string>): CloudBundle {
  const ids = new Set(fresh.monitors.map((m) => m.id));
  const ran = new Map(evaluated.monitors.map((m) => [m.id, m]));
  const checks = { ...fresh.checks };
  for (const id of ids) {
    const mine = evaluated.checks[id];
    if (!mine) continue;
    const byAt = new Map((checks[id] ?? []).map((c) => [c.at, c]));
    for (const c of mine) byAt.set(c.at, c);
    checks[id] = [...byAt.values()].sort((a, b) => a.at - b.at).slice(-HISTORY_CAP);
  }
  const alertById = new Map(fresh.alerts.map((a) => [a.id, a]));
  for (const a of evaluated.alerts) {
    if (!ids.has(a.monitorId)) continue;
    const f = alertById.get(a.id);
    alertById.set(a.id, f ? { ...a, acknowledgedAt: f.acknowledgedAt ?? a.acknowledgedAt } : a);
  }
  const momentIds = new Set((fresh.moments ?? []).map((m) => m.id));
  const newMoments = (evaluated.moments ?? []).filter((m) => ids.has(m.monitorId) && !momentIds.has(m.id));
  // Subscriptions the cron dropped as expired stay dropped; ones the device just added stay.
  const goneByCron = [...pushBefore].filter((e) => !(evaluated.push ?? []).some((p) => p.endpoint === e));
  return {
    ...fresh,
    monitors: fresh.monitors.map((m) => {
      const r = ran.get(m.id);
      const same = r && JSON.stringify(r.schedule) === JSON.stringify(m.schedule);
      return same ? { ...m, nextRunAt: r!.nextRunAt } : m;
    }),
    checks,
    alerts: [...alertById.values()].sort((a, b) => b.openedAt - a.openedAt).slice(0, ALERT_CAP),
    moments: [...newMoments, ...(fresh.moments ?? [])].slice(0, MOMENT_CAP),
    push: (fresh.push ?? []).filter((p) => !goneByCron.includes(p.endpoint)),
    updatedAt: Math.max(fresh.updatedAt, evaluated.updatedAt),
  };
}

/** PUT body → stored bundle, keeping existing history for monitors that remain. */
export interface UploadExtras {
  /** This browser's push subscription (added; others kept), or null to remove it. */
  push?: { add?: PushSubscriptionJSON; remove?: string };
  /** Public page title to enable it, null to turn it off, undefined to leave as is. */
  publicTitle?: string | null;
  newPublicId?: () => string;
  /** Local history for monitors the server hasn't seen yet (so going always-on keeps the baseline). */
  seedChecks?: Record<string, CheckRecord[]>;
  /** Moments the person deleted on the device. */
  dropMoments?: string[];
}

export function mergeUpload(prev: CloudBundle | null, monitors: Monitor[], webhook: CloudWebhook | undefined, now: number, acks: string[] = [], extras: UploadExtras = {}): CloudBundle {
  const acked = new Set(acks);
  let push = (prev?.push ?? []).filter((s) => s.endpoint !== extras.push?.remove && s.endpoint !== extras.push?.add?.endpoint);
  if (extras.push?.add) push = [extras.push.add, ...push].slice(0, PUSH_CAP);
  const pub = extras.publicTitle === null
    ? undefined
    : extras.publicTitle !== undefined
      ? { id: prev?.public?.id ?? extras.newPublicId?.() ?? crypto.randomUUID().replace(/-/g, "").slice(0, 16), title: extras.publicTitle.slice(0, 80) || "Loom monitors" }
      : prev?.public;
  const ids = new Set(monitors.map((m) => m.id));
  const prevById = new Map((prev?.monitors ?? []).map((m) => [m.id, m]));
  return {
    monitors: monitors.map((m) => {
      const old = prevById.get(m.id);
      const same = old && JSON.stringify(old.schedule) === JSON.stringify(m.schedule);
      return { ...m, nextRunAt: same ? old!.nextRunAt : now };
    }),
    webhook,
    checks: Object.fromEntries(
      [...ids].map((id) => [id, prev?.checks?.[id] ?? (extras.seedChecks?.[id] ?? []).filter((c) => c && typeof c.at === "number").slice(-HISTORY_CAP)] as const).filter(([, v]) => v.length),
    ),
    alerts: (prev?.alerts ?? [])
      .filter((a) => ids.has(a.monitorId))
      .map((a) => (acked.has(a.id) && !a.acknowledgedAt ? { ...a, acknowledgedAt: now } : a)),
    moments: (prev?.moments ?? []).filter((m) => ids.has(m.monitorId) && !(extras.dropMoments ?? []).includes(m.id)),
    push,
    public: pub,
    updatedAt: now,
    rev: (prev?.rev ?? 0) + 1,
    syncedAt: now,
  };
}

export { BUNDLE_TTL_SECS };

/** Push payload the service worker shows (`public/sw.js`). Kept under the 3.8 KB push limit. */
export function pushPayload(m: Monitor, reason: string, moment?: Moment) {
  const icon = m.severity === "critical" ? "🔴" : m.severity === "warning" ? "🟠" : "🔵";
  return {
    title: `${icon} ${m.name}`.slice(0, 120),
    body: `${reason}${m.decision ? `\n→ ${m.decision}` : ""}`.slice(0, 400),
    tag: m.id,
    url: moment ? `/#moment=${encodeURIComponent(moment.id)}` : "/#view=monitor",
  };
}

/**
 * Default delivery: the device's webhook (ntfy / Slack / Discord / JSON) and its
 * Web Push subscriptions. Expired subscriptions (404 / 410) are dropped.
 */
export function makeNotifier(vapid?: VapidKeys, post: (hook: CloudWebhook, m: Monitor, reason: string) => Promise<boolean> = postWebhook): Notifier {
  return async (bundle, m, reason, moment) => {
    if (bundle.webhook) await post(bundle.webhook, m, reason);
    if (!vapid || !bundle.push?.length) return;
    const keep: PushSubscriptionJSON[] = [];
    for (const sub of bundle.push) {
      try {
        const r = await sendWebPush(sub, pushPayload(m, reason, moment), vapid, { urgency: m.severity === "critical" ? "high" : "normal", ttl: 6 * 3600 });
        if (!r.gone) keep.push(sub);
      } catch {
        keep.push(sub);
      }
    }
    bundle.push = keep;
  };
}

export function validatePushSubscription(v: unknown): PushSubscriptionJSON | null {
  const s = v as PushSubscriptionJSON | undefined;
  if (!s || typeof s.endpoint !== "string" || !s.keys || typeof s.keys.p256dh !== "string" || typeof s.keys.auth !== "string") return null;
  if (!isAllowedPushEndpoint(s.endpoint) || s.keys.p256dh.length > 200 || s.keys.auth.length > 64) return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

/** VAPID keys from Worker secrets, or undefined when push isn't configured. */
export function vapidFromEnv(env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_JWK?: string; VAPID_SUBJECT?: string }): VapidKeys | undefined {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return undefined;
  try {
    return { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey, subject: env.VAPID_SUBJECT || "https://loom.ibm.io" };
  } catch {
    return undefined;
  }
}
