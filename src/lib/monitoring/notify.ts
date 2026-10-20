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

export async function sendSystemNotification(title: string, body: string, tag?: string): Promise<boolean> {
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
      note.close();
    };
    return true;
  } catch {
    return false;
  }
}
