import { describe, expect, it, vi } from "vitest";
import {
  CLOUD_MIN_INTERVAL_MINUTES,
  deviceKey,
  evaluateBundle,
  mergeUpload,
  runMonitorCron,
  sanitizeCloudMonitors,
  validateWebhook,
  webhookRequest,
  type CloudBundle,
  type MonitorKv,
} from "../monitorCron";
import type { Monitor } from "../../src/lib/monitoring/types";

const NOW = Date.parse("2026-10-20T12:00:00Z");

function mon(patch: Partial<Monitor> = {}): Monitor {
  return {
    id: "c1",
    name: "Quake",
    decision: "Call the team",
    metric: { source: "usgs", agg: "max", column: "magnitude" },
    rule: { kind: "threshold", above: 5 },
    confirmChecks: 1,
    severity: "critical",
    schedule: { kind: "interval", minutes: 15 },
    notify: { inApp: true, system: false, cooldownMinutes: 60 },
    expected: [],
    enabled: true,
    cloud: true,
    createdAt: 0,
    nextRunAt: 0,
    ...patch,
  };
}

// usgs columns: id, magnitude, place, ts, …
const parse = (_k: string, body: unknown) => (body as { mags: number[] }).mags.map((m, i) => [String(i), m, "x", "2026-10-20 11:59:00"]);

describe("monitorCron", () => {
  it("evaluates due monitors, shares one fetch per feed, and posts once", async () => {
    const fetchSource = vi.fn(async () => ({ mags: [4.2, 6.1] }));
    const send = vi.fn(async () => {});
    const bundle: CloudBundle = {
      monitors: [mon(), mon({ id: "c2", rule: { kind: "threshold", above: 7 } }), mon({ id: "c3", nextRunAt: NOW + 3_600_000 })],
      webhook: { kind: "ntfy", url: "https://ntfy.sh/loom-test" },
      checks: {},
      alerts: [],
      updatedAt: 0,
    };
    const { changed } = await evaluateBundle(bundle, NOW, fetchSource, parse, send);
    expect(changed).toBe(true);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(bundle.checks.c1?.[0]?.status).toBe("firing");
    expect(bundle.checks.c2?.[0]?.status).toBe("ok");
    expect(bundle.checks.c3).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(bundle.monitors[0]!.nextRunAt).toBe(NOW + 15 * 60_000);

    // Next run within cooldown: still firing, no second post.
    bundle.monitors[0]!.nextRunAt = 0;
    await evaluateBundle(bundle, NOW + 5 * 60_000, fetchSource, parse, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(bundle.alerts).toHaveLength(1);
  });

  it("records upstream failures as errors without alerting", async () => {
    const bundle: CloudBundle = { monitors: [mon()], checks: {}, alerts: [], updatedAt: 0 };
    await evaluateBundle(bundle, NOW, async () => { throw new Error("down"); }, parse, async () => {});
    expect(bundle.checks.c1?.[0]).toMatchObject({ status: "error", reason: "down" });
    expect(bundle.alerts).toHaveLength(0);
  });

  it("walks KV and writes back only changed bundles", async () => {
    const store = new Map<string, string>([
      ["mon:a", JSON.stringify({ monitors: [mon()], checks: {}, alerts: [], updatedAt: 0, syncedAt: NOW })],
      ["mon:b", JSON.stringify({ monitors: [mon({ nextRunAt: NOW + 1 })], checks: {}, alerts: [], updatedAt: 0, syncedAt: NOW })],
    ]);
    const puts: string[] = [];
    const kv: MonitorKv = {
      get: async (k) => JSON.parse(store.get(k) ?? "null"),
      put: async (k, v) => { puts.push(k); store.set(k, v); },
      delete: async (k) => { store.delete(k); },
      list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
    };
    const r = await runMonitorCron(kv, NOW, async () => ({ mags: [6] }), parse);
    expect(r).toEqual({ devices: 2, evaluated: 1 });
    expect(puts).toEqual(["mon:a"]);
  });

  it("clamps uploads and validates webhooks", () => {
    const list = sanitizeCloudMonitors([mon({ schedule: { kind: "interval", minutes: 1 } }), { id: "x", metric: { source: "nope" } }, ...Array.from({ length: 30 }, (_, i) => mon({ id: `m${i}` }))]);
    expect(list).toHaveLength(20);
    expect(list[0]!.schedule).toEqual({ kind: "interval", minutes: CLOUD_MIN_INTERVAL_MINUTES });
    expect(validateWebhook({ kind: "slack", url: "https://hooks.slack.com/services/a/b/c" })).not.toBeNull();
    expect(validateWebhook({ kind: "slack", url: "https://evil.example/hook" })).toBeNull();
    expect(validateWebhook({ kind: "json", url: "http://example.com/hook" })).toBeNull();
    expect(validateWebhook({ kind: "json", url: "https://127.0.0.1/hook" })).toBeNull();
    expect(validateWebhook({ kind: "json", url: "https://169.254.169.254/latest" })).toBeNull();
  });

  it("keeps history on re-upload, resets schedule changes, and applies acks", () => {
    const prev: CloudBundle = {
      monitors: [mon({ nextRunAt: NOW + 9 }), mon({ id: "gone" })],
      checks: { c1: [{ monitorId: "c1", at: 1, value: 1, status: "ok", reason: "" }], gone: [] },
      alerts: [{ id: "a1", monitorId: "c1", openedAt: 1, lastAt: 1, peakValue: 6, reason: "", severity: "critical" }],
      updatedAt: 0,
    };
    const next = mergeUpload(prev, [mon()], undefined, NOW, ["a1"]);
    expect(next.monitors[0]!.nextRunAt).toBe(NOW + 9);
    expect(Object.keys(next.checks)).toEqual(["c1"]);
    expect(next.alerts[0]!.acknowledgedAt).toBe(NOW);
    const rescheduled = mergeUpload(prev, [mon({ schedule: { kind: "daily", hour: 7, minute: 0 } })], undefined, NOW);
    expect(rescheduled.monitors[0]!.nextRunAt).toBe(NOW);
  });

  it("formats channel payloads and hashes device tokens", async () => {
    const slack = webhookRequest({ kind: "slack", url: "https://hooks.slack.com/x" }, mon(), "6.1 is above 5");
    expect(JSON.parse(String(slack.body)).text).toContain("Call the team");
    const ntfy = webhookRequest({ kind: "ntfy", url: "https://ntfy.sh/t" }, mon({ name: "Héat ☀" }), "r");
    expect((ntfy.headers as Record<string, string>).Title).toBe("Loom alert");
    expect(await deviceKey("short")).toBeNull();
    const k = await deviceKey("a".repeat(40));
    expect(k).toMatch(/^mon:[0-9a-f]{64}$/);
    expect(k).not.toContain("aaaa");
  });
});

import { pushPayload, validatePushSubscription } from "../monitorCron";
import { publicFeedXml, publicMomentSvg, publicPageHtml } from "../monitorPublic";

describe("moments, push, and public pages", () => {
  it("records a moment when an alert opens and notifies with it", async () => {
    const seen: (string | undefined)[] = [];
    const bundle: CloudBundle = { monitors: [mon()], checks: {}, alerts: [], updatedAt: 0, webhook: { kind: "json", url: "https://example.com/h" }, push: [] };
    await evaluateBundle(bundle, NOW, async () => ({ mags: [6.5] }), parse, async (_b, _m, _r, mo) => { seen.push(mo?.id); });
    expect(bundle.moments).toHaveLength(1);
    expect(bundle.moments![0]).toMatchObject({ monitorId: "c1", value: 6.5, cloud: true });
    expect(seen[0]).toBe(bundle.moments![0]!.id);
    expect(pushPayload(bundle.monitors[0]!, "6.5 is above 5", bundle.moments![0]).url).toContain("#moment=");
  });

  it("adds / removes push subscriptions and publishes a page", () => {
    const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "x".repeat(87), auth: "y".repeat(22) } };
    expect(validatePushSubscription(sub)).not.toBeNull();
    expect(validatePushSubscription({ ...sub, endpoint: "https://evil.example/push" })).toBeNull();
    const a = mergeUpload(null, [mon()], undefined, NOW, [], { push: { add: sub }, publicTitle: "My page", newPublicId: () => "0123456789abcdef" });
    expect(a.push).toHaveLength(1);
    expect(a.public).toEqual({ id: "0123456789abcdef", title: "My page" });
    const b = mergeUpload(a, [mon()], undefined, NOW, [], { push: { remove: sub.endpoint } });
    expect(b.push).toHaveLength(0);
    expect(b.public?.id).toBe("0123456789abcdef");
    expect(mergeUpload(b, [mon()], undefined, NOW, [], { publicTitle: null }).public).toBeUndefined();
  });

  it("renders public HTML / RSS / SVG without secrets", async () => {
    const bundle: CloudBundle = {
      monitors: [mon({ name: "Quake <b>" })], checks: {}, alerts: [], updatedAt: NOW,
      webhook: { kind: "slack", url: "https://hooks.slack.com/services/SECRET" },
      push: [{ endpoint: "https://fcm.googleapis.com/fcm/send/SECRETPUSH", keys: { p256dh: "k", auth: "a" } }],
      public: { id: "0123456789abcdef", title: "Status & <stuff>" },
    };
    await evaluateBundle(bundle, NOW, async () => ({ mags: [6.5] }), parse, async () => {});
    const html = publicPageHtml(bundle, "0123456789abcdef", "https://loom.ibm.io");
    expect(html).toContain("Status &amp; &lt;stuff&gt;");
    expect(html).toContain("Quake &lt;b&gt;");
    expect(html).not.toMatch(/SECRET/);
    expect(html).toContain("1 alert right now");
    const xml = publicFeedXml(bundle, "0123456789abcdef", "https://loom.ibm.io");
    expect(xml).toContain("<item><title>");
    expect(xml).not.toMatch(/SECRET/);
    expect(publicMomentSvg(bundle, bundle.moments![0]!.id)).toMatch(/^<svg/);
    expect(publicMomentSvg(bundle, "nope")).toBeNull();
  });
});

import { bundleExpiry, foldCronResults } from "../monitorCron";

describe("cron safety", () => {
  it("folds cron results into a newer device write without reverting it", async () => {
    const before: CloudBundle = { monitors: [mon()], checks: {}, alerts: [], updatedAt: 0, rev: 1, syncedAt: NOW, webhook: { kind: "json", url: "https://example.com/a" }, push: [] };
    const evaluated: CloudBundle = structuredClone(before);
    await evaluateBundle(evaluated, NOW, async () => ({ mags: [6] }), parse, async () => {});
    const deviceWrite: CloudBundle = { ...structuredClone(before), rev: 2, webhook: undefined, public: undefined };
    const out = foldCronResults(deviceWrite, evaluated, new Set());
    expect(out.webhook).toBeUndefined();
    expect(out.rev).toBe(2);
    expect(out.checks.c1).toHaveLength(1);
    expect(out.alerts).toHaveLength(1);
    expect(out.moments).toHaveLength(1);
  });
  it("expires 45 days after the last device sync, not the last cron run", async () => {
    const stale: CloudBundle = { monitors: [mon()], checks: {}, alerts: [], updatedAt: NOW, syncedAt: NOW - 46 * 86_400_000 };
    const store = new Map<string, string>([["mon:x", JSON.stringify(stale)]]);
    const kv: MonitorKv = {
      get: async (k) => JSON.parse(store.get(k) ?? "null"),
      put: async (k, v) => { store.set(k, v); },
      delete: async (k) => { store.delete(k); },
      list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
    };
    await runMonitorCron(kv, NOW, async () => ({ mags: [6] }), parse, async () => {});
    expect(store.has("mon:x")).toBe(false);
    expect(bundleExpiry({ syncedAt: NOW, updatedAt: NOW + 999 })).toBe(Math.floor((NOW + 45 * 86_400_000) / 1000));
  });
  it("seeds history for monitors new to the cloud and drops dismissed / orphaned moments", () => {
    const seed = { c1: [{ monitorId: "c1", at: 1, value: 3, status: "ok" as const, reason: "" }] };
    const a = mergeUpload(null, [mon()], undefined, NOW, [], { seedChecks: seed });
    expect(a.checks.c1).toHaveLength(1);
    expect(a.rev).toBe(1);
    const withMoments = { ...a, moments: [{ id: "m1", monitorId: "c1" }, { id: "m2", monitorId: "gone" }, { id: "m3", monitorId: "c1" }] } as unknown as CloudBundle;
    const b = mergeUpload(withMoments, [mon()], undefined, NOW, [], { dropMoments: ["m3"] });
    expect(b.moments!.map((m) => m.id)).toEqual(["m1"]);
    expect(b.rev).toBe(2);
  });
});
