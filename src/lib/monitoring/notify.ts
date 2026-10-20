// =================================================================
// Loom — Monitor notifications
// =================================================================
// System notifications: Tauri notification plugin on desktop / iOS,
// the Web Notifications API in browsers. In-app toasts and the Monitor
// inbox are handled by the runner; this module only talks to the OS.
// =================================================================

import { isTauri } from "../tauri";

export type NotifyPermission = "granted" | "denied" | "default" | "unsupported";

async function tauriNotification() {
  return import("@tauri-apps/plugin-notification");
}

export async function notificationPermission(): Promise<NotifyPermission> {
  if (isTauri()) {
    try {
      const n = await tauriNotification();
      return (await n.isPermissionGranted()) ? "granted" : "default";
    } catch {
      return "unsupported";
    }
  }
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission as NotifyPermission;
}

/** Ask once, from a user gesture (Settings / first system-notify monitor). */
export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (isTauri()) {
    try {
      const n = await tauriNotification();
      if (await n.isPermissionGranted()) return "granted";
      const r = await n.requestPermission();
      return r === "granted" ? "granted" : r === "denied" ? "denied" : "default";
    } catch {
      return "unsupported";
    }
  }
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission as NotifyPermission;
  return (await Notification.requestPermission()) as NotifyPermission;
}

export async function sendSystemNotification(title: string, body: string, tag?: string, onClick?: () => void): Promise<boolean> {
  if (isTauri()) {
    try {
      const n = await tauriNotification();
      if (!(await n.isPermissionGranted())) return false;
      n.sendNotification({ title, body });
      return true;
    } catch {
      return false;
    }
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    const note = new Notification(title, { body, tag, icon: "/icon-192.png" });
    note.onclick = () => {
      window.focus();
      onClick?.();
      note.close();
    };
    return true;
  } catch {
    return false;
  }
}

let audio: AudioContext | null = null;

/** Two soft notes; louder and lower for critical. Silently does nothing without WebAudio. */
export function playChime(severity: "info" | "warning" | "critical" = "warning"): void {
  try {
    const Ctx = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const notes = severity === "critical" ? [440, 330] : severity === "warning" ? [660, 880] : [880, 1175];
    notes.forEach((f, i) => {
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      const t = audio!.currentTime + i * 0.16;
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(severity === "critical" ? 0.25 : 0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(audio!.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  } catch {
    /* audio blocked until a user gesture — fine */
  }
}
