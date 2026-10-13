// =================================================================
// saveChartView — capture PNG + persist a named chart view
// =================================================================
// Shared by the Chart cell rail and the Encoding panel Save control.
// =================================================================

import type { ChartVisualOverrides } from "./chartVisualTypes";
import type { ChartRecommendation } from "./recommendations";
import type { QueryResult } from "./queryTypes";
import { useLoomStore } from "./store";

export type SaveChartViewArgs = {
  name: string;
  filePath: string;
  fileName: string;
  chart: ChartRecommendation;
  visualOverrides: ChartVisualOverrides;
  querySql?: string | null;
  sampleRows?: QueryResult | null;
};

/** Snapshot the stage (when available) and add a chart view. Returns the new id. */
export async function saveChartView(args: SaveChartViewArgs): Promise<string | null> {
  const name = args.name.trim();
  if (!name) return null;
  let snapshotImageDataUrl: string | null = null;
  const png = useLoomStore.getState().pngExportHandler;
  if (png) {
    try {
      const blob = await png();
      if (blob) {
        snapshotImageDataUrl = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.onerror = rej;
          r.readAsDataURL(blob);
        });
      }
    } catch {
      /* ignore capture failures — view still saves */
    }
  }
  const sample = args.sampleRows
    ? {
        columns: args.sampleRows.columns,
        types: args.sampleRows.types ?? [],
        rows: args.sampleRows.rows,
        total_rows: args.sampleRows.total_rows,
      }
    : undefined;
  return useLoomStore.getState().addChartView(
    name,
    args.filePath,
    args.fileName,
    args.chart,
    { ...args.visualOverrides },
    args.querySql,
    sample,
    snapshotImageDataUrl,
  );
}

/** Open Dashboards so the user can place the view they just saved. */
export function goToDashboardsAfterSave(): void {
  const s = useLoomStore.getState();
  s.setPanelTab("dashboards");
  s.setPanelOpen(true);
  s.setDashboardsExpanded(true);
}
