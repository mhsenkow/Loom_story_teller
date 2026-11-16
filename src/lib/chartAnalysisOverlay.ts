// Statistical emphasis reuses the renderer's own hit geometry and row provenance.
import type { HitTarget } from "./chartTooltip";
import { drawMarkFocus } from "./markFocus";

export function anomalyHitTargets(hits: HitTarget[], rows: unknown[][], flagged: ReadonlySet<number>, sourceIndices?: number[], sourceRowIds = false, seriesKeys?: ReadonlySet<string>): HitTarget[] {
  const matched = new Map<string, Set<string>>();
  return hits.filter(hit => {
    if (hit.auxiliary) return false;
    if (seriesKeys) return !!hit.analysisKey && seriesKeys.has(hit.analysisKey);
    if (hit.rowIndex != null) return flagged.has(sourceRowIds ? hit.rowIndex : sourceIndices?.[hit.rowIndex] ?? hit.rowIndex);
    if (!hit.match.length) return false;
    const fields = hit.match.map(([i]) => i), signature = JSON.stringify(fields);
    let keys = matched.get(signature);
    if (!keys) {
      keys = new Set();
      rows.forEach((row, i) => { if (flagged.has(sourceIndices?.[i] ?? i)) keys!.add(JSON.stringify(fields.map(f => String(row[f])))); });
      matched.set(signature, keys);
    }
    return keys.has(JSON.stringify(hit.match.map(([, value]) => value)));
  });
}
export function drawChartAnomalies(ctx: CanvasRenderingContext2D, hits: HitTarget[], rows: unknown[][], flagged: ReadonlySet<number>, sourceIndices: number[] | undefined, accent: string, bg: string, sourceRowIds = false, seriesKeys?: ReadonlySet<string>) {
  for (const hit of anomalyHitTargets(hits, rows, flagged, sourceIndices, sourceRowIds, seriesKeys)) drawMarkFocus(ctx, hit, hit.shape === "rect" ? "bar" : "point", { accent, bg, text: accent, muted: accent, border: accent });
}
