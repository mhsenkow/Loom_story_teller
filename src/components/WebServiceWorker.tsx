"use client";

import { useEffect } from "react";
import { isNativeShell } from "@/lib/tauri";

/** Register `public/sw.js` on web builds only (LOOM-457 / LOOM-459). */
export function WebServiceWorker() {
  useEffect(() => {
    // Capacitor/Tauri WKWebView: skip SW — stale caches break hashed chunks on IPA updates.
    if (isNativeShell()) return;
    if (!("serviceWorker" in navigator)) return;
    void (async () => {
      try {
        if (process.env.NODE_ENV === "development") {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg?.active?.scriptURL === new URL("/sw.js", window.location.origin).href) {
            await reg.unregister();
          }
          return;
        }
        const reg = await navigator.serviceWorker.register("/sw.js");
        await reg.update();
      } catch {
        /* unsupported or blocked */
      }
    })();
  }, []);
  return null;
}
