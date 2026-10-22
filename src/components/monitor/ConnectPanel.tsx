"use client";

// Where alerts go — each channel is one step:
//   this screen (banners + system notifications), your phone (ntfy: scan a QR,
//   no account), this browser even when closed (Web Push), Slack / Discord /
//   webhook, and a public status page + RSS feed for always-on monitors.

import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { useLoomStore } from "@/lib/store";
import { isNativeShell } from "@/lib/tauri";
import { publicLoomWebOrigin } from "@/lib/publicOrigin";
import { copyTextToClipboard } from "@/lib/socialExport";
import { notificationPermission, playChime, requestNotificationPermission, type NotifyPermission } from "@/lib/monitoring/notify";
import {
  CLOUD_MAX_MONITORS,
  currentPushSubscription,
  disableWebPush,
  enableWebPush,
  loadWebhook,
  newNtfyTopicUrl,
  pullCloudResults,
  saveWebhook,
  syncCloudNow,
  syncCloudWith,
  testCloudWebhook,
  webhookProblem,
  webPushAvailable,
  webhookKindFor,
  type CloudWebhookKind,
} from "@/lib/monitoring/cloudSync";

const KIND_LABEL: Record<CloudWebhookKind, string> = { ntfy: "ntfy (phone)", slack: "Slack", discord: "Discord", json: "Webhook" };

function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  // Light tile on purpose: QR readers need dark-on-light contrast in every theme.
  return <div className="w-36 h-36 shrink-0 rounded-md bg-white p-1 [&>svg]:w-full [&>svg]:h-full" role="img" aria-label={`QR code for ${text}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Row({ title, status, on, children }: { title: string; status: string; on: boolean; children?: React.ReactNode }) {
  return (
    <div className="border border-loom-border rounded-md p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${on ? "bg-loom-success" : "bg-loom-border"}`} aria-hidden />
        <p className="text-sm font-medium text-loom-text flex-1">{title}</p>
        <p className="text-2xs text-loom-muted">{status}</p>
      </div>
      {children}
    </div>
  );
}

export function ConnectPanel() {
  const monitors = useLoomStore((s) => s.monitors);
  const { setToast, updateMonitor } = useLoomStore.getState();
  const cloudCount = monitors.filter((m) => m.cloud).length;
  const [perm, setPerm] = useState<NotifyPermission>("unsupported");
  const [hook, setHook] = useState(() => loadWebhook());
  const [pasted, setPasted] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [pushOk, setPushOk] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pub, setPub] = useState<{ id: string; title: string } | null>(null);
  const [pubTitle, setPubTitle] = useState("My Loom monitors");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void notificationPermission().then(setPerm);
    void webPushAvailable().then(setPushOk);
    void currentPushSubscription().then((s) => setPushOn(!!s));
    if (cloudCount) void pullCloudResults().then((r) => setPub(r.public ?? null)).catch(() => undefined);
  }, [cloudCount]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { setToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const allAlwaysOn = () => {
    const local = monitors.filter((m) => !m.cloud).slice(0, Math.max(0, CLOUD_MAX_MONITORS - cloudCount));
    for (const m of local) updateMonitor(m.id, { cloud: true });
    setToast(local.length ? `${local.length} monitor${local.length === 1 ? " is" : "s are"} now always on` : "Everything is already always on");
  };

  const setWebhook = async (url: string | null) => {
    const problem = url ? webhookProblem(url) : null;
    if (problem) throw new Error(problem);
    const w = url ? { kind: webhookKindFor(url), url } : null;
    const before = loadWebhook();
    saveWebhook(w);
    try {
      await syncCloudNow(true);
    } catch (e) {
      // The server refused it: don't keep a channel that every later sync would fail on.
      saveWebhook(before);
      throw e;
    }
    setHook(w);
  };

  // Plain target=_blank links: Tauri's shell plugin already opens them in the
  // system browser, so an extra onClick opener would open them twice.
  const origin = publicLoomWebOrigin();
  const pageUrl = pub ? `${origin}/w/${pub.id}` : null;
  const needAlwaysOn = cloudCount === 0 && monitors.length > 0;

  return (
    <section className="space-y-2" aria-labelledby="mon-connect">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="mon-connect" className="text-sm font-medium text-loom-text">Where alerts go</h2>
        <p className="text-2xs text-loom-muted">
          {cloudCount}/{CLOUD_MAX_MONITORS} always on (checked by Loom&apos;s server every 5 min, even when the app is closed)
          {monitors.length > cloudCount && <> · <button type="button" className="underline" onClick={allAlwaysOn}>Make all always on</button></>}
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-2">
        <Row title="This screen" status={perm === "granted" ? "Notifications on" : perm === "denied" ? "Blocked in settings" : perm === "unsupported" ? "Banners only" : "Banners only"} on={perm === "granted"}>
          <p className="text-2xs text-loom-muted">Banners in Loom, plus system notifications while Loom is open.</p>
          <div className="flex flex-wrap gap-1">
            {perm === "default" && <button type="button" className="loom-btn-primary text-xs px-3 py-1 rounded-md" onClick={async () => setPerm(await requestNotificationPermission())}>Turn on notifications</button>}
            <button type="button" className="loom-btn-ghost text-xs px-2 py-1 rounded-md" onClick={() => playChime("warning")}>Hear the chime</button>
          </div>
        </Row>

        <Row title="Your phone" status={hook?.kind === "ntfy" ? "Connected" : "Not set up"} on={hook?.kind === "ntfy"}>
          {hook?.kind === "ntfy" ? (
            <>
              <p className="text-2xs text-loom-muted">Always-on alerts go to the free <a className="underline" href="https://ntfy.sh/" target="_blank" rel="noreferrer">ntfy</a> app. Scan to subscribe on another phone.</p>
              {showQr && <div className="flex items-center gap-3"><Qr text={hook.url} /><p className="text-2xs text-loom-muted break-all">{hook.url}</p></div>}
              <div className="flex flex-wrap gap-1">
                <button type="button" className="loom-btn-ghost text-xs px-2 py-1 rounded-md" onClick={() => setShowQr((x) => !x)}>{showQr ? "Hide QR" : "Show QR"}</button>
                <button type="button" className="loom-btn text-xs px-2 py-1 rounded-md" disabled={!!busy} onClick={() => run("test", async () => { setToast((await testCloudWebhook(hook)) ? "Test sent. Check your phone." : "ntfy didn't accept the test"); })}>Send test</button>
                <button type="button" className="loom-btn-ghost text-xs px-2 py-1 rounded-md" onClick={() => run("rm", () => setWebhook(null))}>Disconnect</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-2xs text-loom-muted">No account: install ntfy (iPhone or Android), then scan one code. Loom makes a private, random topic for you.</p>
              <button type="button" className="loom-btn-primary text-xs px-3 py-1 rounded-md" disabled={!!busy} onClick={() => run("ntfy", async () => { await setWebhook(newNtfyTopicUrl()); setShowQr(true); })}>
                Set up phone alerts
              </button>
            </>
          )}
        </Row>

        {!isNativeShell() && (
          <Row title="This browser, even when closed" status={!pushOk ? "Not available here" : pushOn ? "On" : "Off"} on={pushOn}>
            <p className="text-2xs text-loom-muted">
              {pushOk ? "Real push notifications from Loom's server, for always-on monitors. On iPhone, add Loom to your Home Screen first." : "Needs a browser with push support on loom.ibm.io (and server keys)."}
            </p>
            {pushOk && (
              <button
                type="button"
                className={`${pushOn ? "loom-btn-ghost" : "loom-btn-primary"} text-xs px-3 py-1 rounded-md`}
                disabled={!!busy || (!pushOn && cloudCount === 0)}
                title={cloudCount === 0 ? "Make a monitor always on first" : undefined}
                onClick={() => run("push", async () => {
                  if (pushOn) { await disableWebPush(); setPushOn(false); setToast("Browser push off"); }
                  else { await enableWebPush(); setPushOn(true); setToast("Browser push on. Alerts arrive even with Loom closed."); }
                })}
              >
                {pushOn ? "Turn off" : "Turn on browser push"}
              </button>
            )}
          </Row>
        )}

        <Row title="Slack, Discord, or a webhook" status={hook && hook.kind !== "ntfy" ? KIND_LABEL[hook.kind] : "Not set up"} on={!!hook && hook.kind !== "ntfy"}>
          <p className="text-2xs text-loom-muted">Paste an incoming-webhook URL. One channel at a time: this replaces phone alerts.</p>
          <div className="flex flex-wrap gap-1">
            <input className="loom-input flex-1 min-w-40 text-xs" type="url" inputMode="url" aria-label="Webhook URL" placeholder={hook && hook.kind !== "ntfy" ? hook.url : "https://hooks.slack.com/…"} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <button type="button" className="loom-btn text-xs px-2 py-1 rounded-md" disabled={!!busy || !pasted.trim()} onClick={() => run("hook", async () => { await setWebhook(pasted.trim()); setPasted(""); setToast(`Alerts go to ${KIND_LABEL[webhookKindFor(pasted.trim())]}`); })}>Save</button>
            {hook && hook.kind !== "ntfy" && (
              <>
                <button type="button" className="loom-btn-ghost text-xs px-2 py-1 rounded-md" disabled={!!busy} onClick={() => run("test2", async () => { setToast((await testCloudWebhook(hook)) ? "Test sent" : "The channel didn't accept the test"); })}>Send test</button>
                <button type="button" className="loom-btn-ghost text-xs px-2 py-1 rounded-md" disabled={!!busy} onClick={() => run("rm2", async () => { await setWebhook(null); setToast("Channel disconnected"); })}>Disconnect</button>
              </>
            )}
          </div>
        </Row>

        <Row title="Public page & RSS" status={pub ? "Live" : "Off"} on={!!pub}>
          <p className="text-2xs text-loom-muted">A read-only status page of your always-on monitors and their moments, plus an RSS feed for Slack, Zapier, IFTTT or any reader. Only names, rules, values and moments are shown.</p>
          {pub && pageUrl ? (
            <div className="space-y-1">
              <a className="block text-xs underline break-all text-loom-accent-text" href={pageUrl} target="_blank" rel="noreferrer">{pageUrl}</a>
              <div className="flex flex-wrap gap-1">
                <button type="button" className="loom-btn-ghost text-xs px-2 py-1 rounded-md" onClick={async () => setToast((await copyTextToClipboard(pageUrl)) ? "Page link copied" : pageUrl)}>Copy page link</button>
                <button type="button" className="loom-btn-ghost text-xs px-2 py-1 rounded-md" onClick={async () => setToast((await copyTextToClipboard(`${pageUrl}/feed.xml`)) ? "RSS link copied" : `${pageUrl}/feed.xml`)}>Copy RSS link</button>
                <button type="button" className="loom-btn-ghost text-xs px-2 py-1 rounded-md text-loom-error" disabled={!!busy} onClick={() => run("unpub", async () => { await syncCloudWith({ public: null }); setPub(null); setToast("Public page removed"); })}>Unpublish</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              <input className="loom-input flex-1 min-w-40 text-xs" aria-label="Page title" value={pubTitle} onChange={(e) => setPubTitle(e.target.value)} />
              <button type="button" className="loom-btn text-xs px-2 py-1 rounded-md" disabled={!!busy || cloudCount === 0} title={cloudCount === 0 ? "Make a monitor always on first" : undefined}
                onClick={() => run("pub", async () => { const r = await syncCloudWith({ public: { title: pubTitle.trim() || "My Loom monitors" } }); setPub(r.public); setToast("Public page is live"); })}>
                Publish page
              </button>
            </div>
          )}
        </Row>
      </div>
      {needAlwaysOn && (hook || pushOn) && (
        <p className="text-2xs text-loom-warning-text">Your channel is set, but no monitor is always on yet, so nothing will be sent while Loom is closed. <button type="button" className="underline" onClick={allAlwaysOn}>Make all always on</button></p>
      )}
      <p className="text-2xs text-loom-muted">This device is identified by a random key stored here. The server keeps only its hash, your always-on monitors, recent results and moments, and forgets them after 45 days without a sync.</p>
    </section>
  );
}
