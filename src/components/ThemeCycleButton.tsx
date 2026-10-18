"use client";

// A shared, single-click theme control; settings remain owned by Zustand.
import { useChartTheme } from "@/components/useChartTheme";
import { useLoomStore } from "@/lib/store";
import { THEMES, THEME_LABEL, type LookTheme } from "@/lib/lookSystem";

const THEME_ICONS: Record<LookTheme, string> = {
  light: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5",
  dark: "M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z",
  contrast: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0v18M8 5v14M5 8v8",
  paper: "M5 3h10l4 4v14H5ZM15 3v5h4M8 12h8M8 16h6",
  glass: "M5 4h14l-2 16H7ZM8 8h8M9 8l-1 7",
  frost: "M12 2v20M3 7l18 10M3 17 21 7M9 4l3 3 3-3M9 20l3-3 3 3",
  brutal: "M3 3h14v14H3ZM7 17v4h14V7h-4",
  loom: "M5 3v18M12 3v18M19 3v18M3 5h18M3 12h18M3 19h18",
  tank: "M4 4h16v16H4ZM12 7v10M7 12h10M1 12h3m16 0h3M12 1v3m0 16v3",
  nes: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
};

export function ThemeCycleButton() {
  const theme = useChartTheme();
  const setAppSettings = useLoomStore((s) => s.setAppSettings);
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
  return (
    <button
      type="button"
      className="discover-icon-button discover-theme-cycle"
      aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}`}
      title={`${THEME_LABEL[theme]} · Click for ${THEME_LABEL[next]}`}
      onClick={() => setAppSettings((settings) => ({ ...settings, theme: next }))}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden data-theme-icon={theme}><path d={THEME_ICONS[theme]} /></svg>
    </button>
  );
}
