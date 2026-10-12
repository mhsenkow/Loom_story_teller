// =================================================================
// Chart tooltip presentation modes
// =================================================================
// Encoding picks how readouts appear: hover float, frosted glass,
// docked strip, compact pill, or off. Auto = hover on desktop,
// glass sheet on touch / narrow viewports (finger doesn't cover it).
// =================================================================

export type ChartTooltipMode = "auto" | "hover" | "glass" | "dock" | "compact" | "off";

/** Resolved presentation after Auto is expanded for the device. */
export type ChartTooltipPresentation = "hover" | "glass" | "dock" | "compact" | "off";

export const CHART_TOOLTIP_MODES: {
  value: ChartTooltipMode;
  label: string;
  title: string;
}[] = [
  { value: "auto", label: "Auto", title: "Hover on desktop · glass sheet on phone" },
  { value: "hover", label: "Hover", title: "Float near the pointer" },
  { value: "glass", label: "Glass", title: "Frosted card over the chart" },
  { value: "dock", label: "Dock", title: "Fixed strip under the chart" },
  { value: "compact", label: "Pill", title: "Tight one-line readout" },
  { value: "off", label: "Off", title: "Hide tooltips" },
];

const MODE_SET = new Set<string>(CHART_TOOLTIP_MODES.map((m) => m.value));

export function parseChartTooltipMode(v: unknown): ChartTooltipMode | undefined {
  return typeof v === "string" && MODE_SET.has(v) ? (v as ChartTooltipMode) : undefined;
}

/** Expand Auto for the current device; everything else passes through. */
export function resolveTooltipPresentation(
  mode: ChartTooltipMode | null | undefined,
  isMobile: boolean,
): ChartTooltipPresentation {
  const m = mode && MODE_SET.has(mode) ? mode : "auto";
  if (m === "off") return "off";
  if (m === "auto") return isMobile ? "glass" : "hover";
  return m;
}

/** Tooltips are on unless explicitly Off (Auto still counts as on). */
export function tooltipModeIsOn(mode: ChartTooltipMode | null | undefined): boolean {
  return resolveTooltipPresentation(mode, false) !== "off" && mode !== "off";
}
