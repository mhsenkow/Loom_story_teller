// =================================================================
// ThemeApplicator — Applies app settings to the document
// =================================================================
// Reads appSettings from store and sets theme class, font scale,
// and reduced-motion on <html>. Must run in a client component.
// =================================================================

"use client";

import { useEffect } from "react";
import { useLoomStore } from "@/lib/store";
import type { AppTheme, FontScale } from "@/lib/store";

export function ThemeApplicator() {
  const { appSettings } = useLoomStore();
  const { theme, fontScale, reducedMotion } = appSettings;

  useEffect(() => {
    const root = document.documentElement;

    // Single theme class: dark | light | high-contrast | colorblind
    root.classList.remove("dark", "light", "high-contrast", "colorblind");
    root.classList.add(theme);

    root.style.setProperty("--app-font-scale", String(fontScale));
    root.style.colorScheme = theme === "light" ? "light" : "dark";

    if (reducedMotion) {
      root.classList.add("reduced-motion");
    } else {
      root.classList.remove("reduced-motion");
    }
  }, [theme, fontScale, reducedMotion]);

  return null;
}
