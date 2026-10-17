// =================================================================
// Vega-Lite config from Loom look themes (axis/title/legend ink)
// =================================================================

import { getThemeUiColors, type ThemeUiColors } from "./chartPalettes";
import { chartFontStack } from "./fontCatalog";
import { chartTypeRamp } from "./chartType";
import { ensureContrast } from "./wcagColor";

type Typography = { fontFamily?: string; axisFontSize?: number; titleFontWeight?: number; titleItalic?: boolean };

export function vegaConfigFromUi(ui: ThemeUiColors, typography: Typography = {}) {
  const type = chartTypeRamp(typography.axisFontSize);
  const font = chartFontStack(typography.fontFamily);
  return {
    font,
    background: "transparent",
    axis: {
      labelColor: ensureContrast(ui.label, ui.bg),
      titleColor: ui.text,
      gridColor: ui.border,
      domainColor: ui.border,
      tickColor: ui.border,
      labelLimit: 180,
      labelFont: font,
      titleFont: font,
      labelFontSize: type.tick,
      titleFontSize: type.axisField,
    },
    title: {
      color: ui.text,
      fontSize: type.title,
      subtitleFontSize: type.subtitle,
      fontWeight: typography.titleFontWeight ?? 600,
      fontStyle: typography.titleItalic ? "italic" : "normal",
      font,
      subtitleFont: font,
    },
    legend: {
      labelColor: ui.label,
      titleColor: ui.text,
      labelFont: font,
      titleFont: font,
      labelFontSize: type.legend,
      titleFontSize: type.legendTitle,
    },
    view: { stroke: null },
  };
}

/** Portable spec defaults (in-app); matches dark look tokens — not hard-coded one-offs. */
export function vegaBaseConfigForTheme(theme?: string | null) {
  return vegaConfigFromUi(getThemeUiColors(theme ?? "dark"));
}

/** Opaque background + merged axis/title for SVG/file export. */
export function vegaExportConfigForTheme(theme?: string | null, typography?: Typography) {
  const ui = getThemeUiColors(theme ?? "dark");
  const base = vegaConfigFromUi(ui, typography);
  return {
    ...base,
    background: ui.bg,
    axis: { ...base.axis, titleColor: ui.text },
    title: { ...base.title, subtitleColor: ui.muted },
    legend: { ...base.legend, labelColor: ui.text, titleColor: ui.text, labelLimit: 180 },
  };
}
