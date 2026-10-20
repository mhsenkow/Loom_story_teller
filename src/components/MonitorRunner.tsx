"use client";

// Loads saved monitors, keeps them saved, runs the in-app scheduler, and
// syncs always-on monitors with the Worker cron.

import { useEffect } from "react";
import { useLoomStore } from "@/lib/store";
import { loadMonitors, saveMonitors } from "@/lib/monitoring/storage";
import { startMonitorScheduler, tickMonitors } from "@/lib/monitoring/runner";
import { markCloudPushed, pullCloudResults, syncCloudNow } from "@/lib/monitoring/cloudSync";

const PULL_MS = 60_000;

export function MonitorRunner() {
  useEffect(() => {
    const st0 = useLoomStore.getState();
    st0.hydrateMonitors(loadMonitors());
    let pending: ReturnType<typeof setTimeout> | null = null;
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    const hadCloud = useLoomStore.getState().monitors.some((m) => m.cloud);
    if (hadCloud) markCloudPushed();

    const unsub = useLoomStore.subscribe((s, prev) => {
      if (s.monitors === prev.monitors && s.monitorChecks === prev.monitorChecks && s.monitorAlerts === prev.monitorAlerts) return;
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        const st = useLoomStore.getState();
        saveMonitors({ monitors: st.monitors, checks: st.monitorChecks, alerts: st.monitorAlerts });
      }, 500);
      // New / resumed / re-scheduled monitors run right away instead of on the next 20s tick.
      if (s.monitors !== prev.monitors && s.monitors.some((m) => m.enabled && !m.cloud && (m.nextRunAt ?? 0) <= Date.now())) {
        setTimeout(() => void tickMonitors(), 250);
      }
      if (s.monitors !== prev.monitors || s.monitorAlerts !== prev.monitorAlerts) {
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(() => {
          syncCloudNow().catch((e) => useLoomStore.getState().setToast(`Always-on sync failed: ${e instanceof Error ? e.message : e}`));
        }, 2_000);
      }
    });

    const pull = async () => {
      if (document.hidden || !useLoomStore.getState().monitors.some((m) => m.cloud)) return;
      try {
        const r = await pullCloudResults();
        useLoomStore.getState().mergeCloudResults(r.checks, r.alerts);
      } catch { /* offline — next pull retries */ }
    };
    const pullTimer = setInterval(() => void pull(), PULL_MS);
    if (hadCloud) void syncCloudNow(true).then(pull).catch(() => void pull());

    const stop = startMonitorScheduler();
    return () => {
      unsub();
      stop();
      clearInterval(pullTimer);
      if (pending) clearTimeout(pending);
      if (pushTimer) clearTimeout(pushTimer);
    };
  }, []);
  return null;
}
