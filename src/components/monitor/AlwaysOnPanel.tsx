"use client";

// Where always-on (Worker cron) alerts are delivered: ntfy, Slack, Discord, or a JSON webhook.

import { useState } from "react";
import { useLoomStore } from "@/lib/store";
import {
  CLOUD_MAX_MONITORS,
  loadWebhook,
  saveWebhook,
  syncCloudNow,
  testCloudWebhook,
  webhookKindFor,
  type CloudWebhookKind,
} from "@/lib/monitoring/cloudSync";

const KIND_LABEL: Record<CloudWebhookKind, string> = { ntfy: "ntfy (phone push)", slack: "Slack", discord: "Discord", json: "JSON webhook" };

export function AlwaysOnPanel({ cloudCount }: { cloudCount: number }) {
  const setToast = useLoomStore((s) => s.setToast);
  const saved = loadWebhook();
  const [url, setUrl] = useState(saved?.url ?? "");
  const [busy, setBusy] = useState(false);
  const kind = webhookKindFor(url);

  const save = async () => {
    setBusy(true);
    try {
      saveWebhook(url.trim() ? { kind, url: url.trim() } : null);
      await syncCloudNow(true);
      setToast(url.trim() ? `Always-on alerts will go to ${KIND_LABEL[kind]}` : "Always-on channel removed");
    } catch (e) {
      setToast(`Couldn't save: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    try {
      const ok = await testCloudWebhook({ kind, url: url.trim() });
      setToast(ok ? "Test alert sent. Check your channel." : "The channel didn't accept the test. Check the URL.");
    } catch (e) {
      setToast(`Test failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="border border-loom-border rounded-md p-3 text-xs" open={cloudCount > 0 && !saved}>
      <summary className="cursor-pointer text-sm font-medium text-loom-text">
        Always on <span className="text-loom-muted font-normal">· {cloudCount}/{CLOUD_MAX_MONITORS} monitors · {saved ? KIND_LABEL[saved.kind] : "no channel"}</span>
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-loom-muted">
          Monitors marked Always on are checked by Loom&apos;s server every 5 minutes (each at most every 15 minutes), even when this app is closed.
          Alerts go to one channel. For phone push, install ntfy and paste a topic URL like https://ntfy.sh/your-secret-topic-name.
          Slack and Discord incoming-webhook URLs work too.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <input className="loom-input flex-1 min-w-56" type="url" inputMode="url" placeholder="https://ntfy.sh/… or a Slack / Discord webhook URL" aria-label="Alert channel URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button type="button" className="loom-btn text-xs px-2 py-1 rounded-md" disabled={busy || !url.trim()} onClick={test}>Send test</button>
          <button type="button" className="loom-btn-primary text-xs px-3 py-1 rounded-md" disabled={busy} onClick={save}>Save</button>
        </div>
        {url.trim() && <p className="text-2xs text-loom-muted">Detected: {KIND_LABEL[kind]}. Anyone with an ntfy topic name can read it, so pick a long, random one.</p>}
        <p className="text-2xs text-loom-muted">This device is identified by a random key stored in this browser or app. The server keeps only its hash, the always-on monitors, and their recent results, and forgets them after 45 days of no sync.</p>
      </div>
    </details>
  );
}
