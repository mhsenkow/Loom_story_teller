// =================================================================
// lookSettingsDefaults — reset app look + visual overrides (LOOM-265, LOOM-275)
// =================================================================

import type { AppSettings } from "./store";
import type { ChartVisualOverrides } from "./chartVisualTypes";
import {
  DEFAULT_FACES,
  DEFAULT_FONT,
  DEFAULT_THEME,
  DEFAULT_UI,
} from "./lookSystem";

export function defaultAppLookSettings(current: AppSettings): AppSettings {
  return {
    ...current,
    theme: DEFAULT_THEME,
    uiChrome: DEFAULT_UI,
    font: DEFAULT_FONT,
    faces: DEFAULT_FACES,
    fontScale: 1,
    colorblindCharts: false,
  };
}

export function emptyChartVisualOverrides(): ChartVisualOverrides {
  return {};
}
