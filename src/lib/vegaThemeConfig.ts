// =================================================================
// Vega-Lite config from Loom look themes (axis/title/legend ink)
// =================================================================

import { getThemeUiColors, type ThemeUiColors } from "./chartPalettes";

export function vegaConfigFromUi(ui: ThemeUiColors) {
  return {
    background: "transparent",
    axis: {
      labelColor: ui.label,
      titleColor: ui.text,
      gridColor: ui.border,
      domainColor: ui.border,
      tickColor: ui.border,
      labelLimit: 180,
      labelFont: "Inter, system-ui, sans-serif",
      labelFontSize: 11,
      titleFontSize: 12,
    },
    title: {
      color: ui.text,
      fontSize: 14,
      fontWeight: 600,
      font: "Inter, system-ui, sans-serif",
    },
    legend: {
      labelColor: ui.label,
      titleColor: ui.text,
      labelFont: "Inter, system-ui, sans-serif",
      labelFontSize: 11,
    },
    view: { stroke: null },
  };
}

/** Portable spec defaults (in-app); matches dark look tokens — not hard-coded one-offs. */
export function vegaBaseConfigForTheme(theme?: string | null) {
  return vegaConfigFromUi(getThemeUiColors(theme ?? "dark"));
}

/** Opaque background + merged axis/title for SVG/file export. */
export function vegaExportConfigForTheme(theme?: string | null) {
  const ui = getThemeUiColors(theme ?? "dark");
  const base = vegaConfigFromUi(ui);
  return {
    ...base,
    background: ui.bg,
    axis: { ...base.axis, labelColor: ui.muted, titleColor: ui.text },
    title: { ...base.title, subtitleColor: ui.muted },
    legend: { ...base.legend, labelColor: ui.text, titleColor: ui.text, labelLimit: 180 },
  };
}
