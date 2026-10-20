// =================================================================
// Loom — Always-on monitor sync (app ↔ Worker cron)
// =================================================================
// Monitors marked `cloud` are uploaded with this device's webhook; the
// Worker cron (workers/monitorCron.ts) evaluates them every 5 minutes
// even when Loom is closed. The app pulls their history and alerts back
// while it's open. A random per-device secret is the only identity, and
// the Worker stores just its hash.
// =================================================================

import { apiUrl } from "../openDataCatalog";
import { useLoomStore } from "../store";
import type { Monitor } from "./types";
import type { CheckRecord, MonitorAlert } from "./types";
import type { Moment } from "./moments";

/** One-off extras sent with an upload. */
export interface CloudUploadExtras {
  push?: { add?: PushSubscriptionJSON; remove?: string };
  /** Title enables the public page; null turns it off. */
  public?: { title: string } | null;
}

export interface CloudState {
  public: { id: string; title: string } | null;
  pushDevices: number;
}

interface PushSubscriptionJSON { endpoint: string; keys: { p256dh: string; auth: string } }

const DEVICE_KEY = "loom-monitor-device";
const WEBHOOK_KEY = "loom-monitor-webhook";

export type CloudWebhookKind = "ntfy" | "slack" | "discord" | "json";
export interface CloudWebhookConfig { kind: CloudWebhookKind; url: string }

/** Cloud cron runs interval monitors at most this often. */
export const CLOUD_MIN_INTERVAL_MINUTES = 15;
export const CLOUD_MAX_MONITORS = 20;

function store(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function deviceToken(): string | null {
  const ls = store();
  if (!ls) return null;
  let t = ls.getItem(DEVICE_KEY);
  if (!t || !/^[A-Za-z0-9_-]{32,128}$/.test(t)) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    t = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    try { ls.setItem(DEVICE_KEY, t); } catch { return null; }
  }
  return t;
}

export function loadWebhook(): CloudWebhookConfig | null {
  try {
    const raw = store()?.getItem(WEBHOOK_KEY);
    const w = raw ? (JSON.parse(raw) as CloudWebhookConfig) : null;
    return w && typeof w.url === "string" && typeof w.kind === "string" ? w : null;
  } catch {
    return null;
  }
}

export function saveWebhook(w: CloudWebhookConfig | null) {
  try {
    if (w) store()?.setItem(WEBHOOK_KEY, JSON.stringify(w));
    else store()?.removeItem(WEBHOOK_KEY);
  } catch { /* storage unavailable */ }
}

/** Guess the channel from a pasted URL. */
export function webhookKindFor(url: string): CloudWebhookKind {
  try {
    const h = new URL(url).hostname;
    if (h === "hooks.slack.com") return "slack";
    if (h === "discord.com" || h === "discordapp.com") return "discord";
    if (h === "ntfy.sh" || h.startsWith("ntfy.")) return "ntfy";
  } catch { /* fallthrough */ }
  return "json";
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const token = deviceToken();
  if (!token) throw new Error("Storage is unavailable, so always-on monitors can't be linked to this device");
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const msg = await res.json().then((j: { error?: string }) => j.error).catch(() => null);
    throw new Error(msg || `Always-on service returned ${res.status}`);
  }
  return res;
}

/** Upload all always-on monitors (an empty list removes this device from the cron). */
export async function pushCloudMonitors(monitors: Monitor[], acks: string[], extras: CloudUploadExtras = {}): Promise<CloudState & { monitors: number }> {
  const list = monitors.filter((m) => m.cloud).slice(0, CLOUD_MAX_MONITORS).map(({ nextRunAt: _n, rationale: _r, ...m }) => m);
  const webhook = loadWebhook();
  const res = await call("/api/monitors", { method: "POST", body: JSON.stringify({ monitors: list, webhook, acks, ...extras }) });
  const j = (await res.json()) as { monitors?: number; public?: CloudState["public"]; pushDevices?: number };
  const state = { public: j.public ?? null, pushDevices: j.pushDevices ?? 0 };
  cloudState = state;
  return { ...state, monitors: j.monitors ?? 0 };
}

let cloudState: CloudState = { public: null, pushDevices: 0 };
export function lastCloudState(): CloudState {
  return cloudState;
}

export async function pullCloudResults(): Promise<{ checks: Record<string, CheckRecord[]>; alerts: MonitorAlert[]; moments?: Moment[]; updatedAt: number | null; public?: CloudState["public"]; pushDevices?: number }> {
  const res = await call("/api/monitors");
  return res.json();
}

export async function testCloudWebhook(w: CloudWebhookConfig): Promise<boolean> {
  const res = await call("/api/monitors/test-webhook", { method: "POST", body: JSON.stringify({ webhook: w }) });
  const j = (await res.json()) as { ok?: boolean };
  return !!j.ok;
}

/** Signature of what the Worker needs to know — push only when it changes. */
export function cloudSignature(monitors: Monitor[], acks: string[]): string {
  const list = monitors.filter((m) => m.cloud).map(({ nextRunAt: _n, ...m }) => m);
  return JSON.stringify([list, loadWebhook(), [...acks].sort()]);
}

let lastPushed: string | null = null;

/** Push always-on monitors when they (or reviews of their alerts) change. */
export async function syncCloudNow(force = false): Promise<void> {
  const s = useLoomStore.getState();
  const cloudIds = new Set(s.monitors.filter((m) => m.cloud).map((m) => m.id));
  const acks = s.monitorAlerts.filter((a) => cloudIds.has(a.monitorId) && a.acknowledgedAt).map((a) => a.id);
  const sig = cloudSignature(s.monitors, acks);
  // Nothing always-on and nothing ever pushed from this session: stay offline.
  if (!force && (sig === lastPushed || (!cloudIds.size && lastPushed == null))) return;
  await pushCloudMonitors(s.monitors, acks);
  lastPushed = sig;
}

/** Upload with extras now (push subscription, public page); needs at least one always-on monitor. */
export async function syncCloudWith(extras: CloudUploadExtras): Promise<CloudState & { monitors: number }> {
  const s = useLoomStore.getState();
  const cloudIds = new Set(s.monitors.filter((m) => m.cloud).map((m) => m.id));
  const acks = s.monitorAlerts.filter((a) => cloudIds.has(a.monitorId) && a.acknowledgedAt).map((a) => a.id);
  const out = await pushCloudMonitors(s.monitors, acks, extras);
  lastPushed = cloudSignature(s.monitors, acks);
  return out;
}

// ---- Web Push (browser notifications even when Loom is closed) ----

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Push is possible here: a real browser with a service worker, and the server has keys. */
export async function webPushAvailable(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || typeof PushManager === "undefined") return false;
  try {
    const res = await fetch(apiUrl("/api/monitors/push-key"));
    return res.ok;
  } catch {
    return false;
  }
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Subscribe this browser and register it with the always-on service. */
export async function enableWebPush(): Promise<void> {
  const key = (await (await fetch(apiUrl("/api/monitors/push-key"))).json()) as { publicKey?: string };
  if (!key.publicKey) throw new Error("Browser push isn't set up on the server yet");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this site");
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key.publicKey) }));
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) throw new Error("This browser didn't return a push subscription");
  await syncCloudWith({ push: { add: { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } } } });
}

export async function disableWebPush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await syncCloudWith({ push: { remove: sub.endpoint } }).catch(() => undefined);
  await sub.unsubscribe();
}

// ---- ntfy: phone push with nothing to sign up for ----

/** A long random topic: anyone who knows it can read it, so it must be unguessable. */
export function newNtfyTopicUrl(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const id = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
  return `https://ntfy.sh/loom-${id}`;
}

/** This device has (or had) always-on monitors: the next sync must reach the Worker. */
export function markCloudPushed() {
  lastPushed = "";
}
