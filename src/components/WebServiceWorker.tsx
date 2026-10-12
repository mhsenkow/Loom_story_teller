"use client";

import { useEffect } from "react";
import { isTauri } from "@/lib/tauri";

/** Register `public/sw.js` on web builds only (LOOM-457 / LOOM-459). */
export function WebServiceWorker() {
  useEffect(() => {
    if (isTauri()) return;
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /* unsupported or blocked */
    });
  }, []);
  return null;
}
