// =================================================================
// extractScatterCacheKey — memo key for scatter packing (LOOM-289)
// =================================================================

export function extractScatterCacheKey(args: {
  chartId: string | undefined;
  path: string | undefined;
  xField: string;
  yField: string | null;
  rowCount: number;
  densityBucket: number;
}): string {
  return [
    args.chartId ?? "",
    args.path ?? "",
    args.xField,
    args.yField ?? "",
    String(args.rowCount),
    String(args.densityBucket),
  ].join("\u0001");
}
