// Shared numeric-control contracts. Values are UI units, not renderer pixels.
import type { ChartCapabilities } from "./types";
import type { ChartVisualOverrides } from "../chartVisualTypes";
export interface ChartNumberControl {
  readonly key: keyof ChartVisualOverrides;
  readonly label: string;
  readonly capability?: keyof ChartCapabilities;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultValue: number;
  readonly display: "number" | "percent";
  readonly surface?: "renderer";
}
export const CHART_NUMBER_CONTROLS = {
  pointSize: { key: "pointSize", label: "Point size", capability: "pointMarker", min: 2, max: 24, step: 1, defaultValue: 12, display: "number" },
  barCornerRadius: { key: "barCornerRadius", label: "Bar corner radius (px)", capability: "barMarks", min: 0, max: 12, step: 1, defaultValue: 3, display: "number" },
  lineWidth: { key: "lineWidth", label: "Line width", capability: "lineMarks", min: 0.5, max: 6, step: 0.5, defaultValue: 2, display: "number", surface: "renderer" },
  gridOpacity: { key: "gridOpacity", label: "Grid opacity", capability: "grid", min: 0, max: 1, step: 0.1, defaultValue: 0.5, display: "percent" },
  opacity: { key: "opacity", label: "Opacity", min: 0.2, max: 1, step: 0.05, defaultValue: 0.7, display: "percent" },
} as const satisfies Record<string, ChartNumberControl>;
export type ChartNumberControlId = keyof typeof CHART_NUMBER_CONTROLS;
export function chartNumberControls(capabilities: Readonly<ChartCapabilities>): readonly ChartNumberControl[] {
  return Object.values(CHART_NUMBER_CONTROLS).filter((control: ChartNumberControl) => !control.capability || capabilities[control.capability]);
}
