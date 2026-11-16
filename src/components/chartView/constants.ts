// ChartView stage constants (LOOM-141)
import { stagePixelRatio } from "@/lib/chartStagePixels";
import { useLoomStore } from "@/lib/store";

export const GPU_GLOBE_ENABLED = false;

/** x/y charts that share the L-frame + axis titles drawn by the dispatch. */
export const FRAMED_KINDS = new Set<string>([
  "scatter", "bar", "pareto", "histogram", "line", "area", "box", "bubble", "violin", "waterfall", "hexbin", "corrMatrix",
]);
/** Charts with a category-label gutter: they draw their own frame; dispatch still titles the axes. */
export const OWN_FRAME_KINDS = new Set<string>(["strip", "lollipop", "dumbbell", "ridgeline", "heatmap"]);
/** Series kinds split by the Shape / Emoji column when Color is empty. */
export const SYMBOL_SERIES_KINDS = new Set<string>(["line", "radar", "bump"]);


/**
 * Backing-store scale for the chart stage. Platform captures pin it (so a
 * 1080px export lays out identically on every device); otherwise screen DPR
 * capped for phone / Retina buffer size. Canvas sizing and every draw pass
 * must agree on this value.
 */
export function stageDpr(): number {
  return stagePixelRatio(useLoomStore.getState().socialExportTarget?.pixelRatio);
}
