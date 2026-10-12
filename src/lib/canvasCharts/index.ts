// =================================================================
// Canvas chart renderers — extraction from ChartView (LOOM-142)
// =================================================================

import { renderFullSunburst } from "./sunburst";
export { renderFullSunburst };
export {
  aggregateValues,
  pushHit,
  fieldLabel,
  valueTitle,
  setLegend,
  plotOf,
} from "./plumbing";

/** Dispatcher for extracted renderers; ChartView still inlines most kinds. */
export type CanvasChartKind = "sunburst";

import type { ChartRenderOpts } from "../chartRenderTypes";
import { renderFullSunburst as paintSunburst } from "./sunburst";

export function renderExtractedCanvasChart(
  kind: CanvasChartKind,
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
): void {
  if (kind === "sunburst") paintSunburst(ctx, rows, xi, yi, ci, w, h, pad, opts);
}
