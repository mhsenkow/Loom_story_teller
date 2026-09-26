// =================================================================
// ThemeApplicator — Applies look system to the document
// =================================================================
// Sets data-theme / data-ui / data-font / data-faces / data-a11y on
// <html>, font scale, reduced-motion, and syncs ibm.tools.shared.
// =================================================================

"use client";

import { useLayoutEffect } from "react";
import { useLoomStore } from "@/lib/store";
import {
  normalizeFaces,
  normalizeFont,
  normalizeTheme,
  normalizeUi,
  writeIbmToolsShared,
} from "@/lib/lookSystem";

export function ThemeApplicator() {
  const { appSettings, setAppSettings } = useLoomStore();
  const { theme, uiChrome, font, faces, fontScale, reducedMotion, colorblindCharts } = appSettings;

  // Honor OS preference once when the user hasn't chosen yet (saved false is intentional).
  useLayoutEffect(() => {
    try {
      const raw = localStorage.getItem("loom-app-settings");
      if (raw) {
        const parsed = JSON.parse(raw) as { reducedMotion?: boolean };
        if (typeof parsed.reducedMotion === "boolean") return;
      }
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAppSettings((prev) => (prev.reducedMotion ? prev : { ...prev, reducedMotion: true }));
    }
  }, [setAppSettings]);

  // useLayoutEffect so data-theme lands before paint — shell + chart stay in sync
  useLayoutEffect(() => {
    const root = document.documentElement;
    const t = normalizeTheme(theme);
    const ui = normalizeUi(uiChrome);
    const f = normalizeFont(font);
    const face = normalizeFaces(faces);

    root.setAttribute("data-theme", t);
    root.setAttribute("data-ui", ui);
    root.setAttribute("data-font", f);
    root.setAttribute("data-faces", face);
    if (colorblindCharts) root.setAttribute("data-a11y", "colorblind");
    else root.removeAttribute("data-a11y");

    // Legacy classes for any leftover selectors
    root.classList.remove(
      "dark",
      "light",
      "high-contrast",
      "colorblind",
      "theme-high-contrast",
      "theme-colorblind",
    );
    if (t === "dark" || t === "contrast" || t === "frost" || t === "loom" || t === "tank") {
      root.classList.add("dark");
    } else {
      root.classList.add("light");
    }
    if (t === "contrast") root.classList.add("high-contrast");
    if (colorblindCharts) root.classList.add("colorblind");

    root.style.setProperty("--app-font-scale", String(fontScale));
    const lightThemes = new Set(["light", "paper", "glass", "brutal", "nes"]);
    root.style.colorScheme = lightThemes.has(t) ? "light" : "dark";

    if (reducedMotion) root.classList.add("reduced-motion");
    else root.classList.remove("reduced-motion");

    writeIbmToolsShared({ theme: t, ui, font: f, faces: face });
  }, [theme, uiChrome, font, faces, fontScale, reducedMotion, colorblindCharts]);

  return null;
}
