"use client";

// A shared, single-click theme control; settings remain owned by Zustand.
import { useChartTheme } from "@/components/useChartTheme";
import { useLoomStore } from "@/lib/store";
import { THEMES, THEME_LABEL } from "@/lib/lookSystem";

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
      <span className="discover-theme-swatch" aria-hidden><i /><i /><i /><i /></span>
    </button>
  );
}
