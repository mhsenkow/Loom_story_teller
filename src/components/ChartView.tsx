// ChartView — thin composer (LOOM-141)
"use client";
import { StartHere } from "@/components/StartHere";
import { useChartViewCore } from "@/components/chartView/useChartViewCore";

export type { ChartRenderOpts } from "@/lib/chartRenderTypes";

export function ChartView() {
  const body = useChartViewCore();
  if (body === null) return <StartHere />;
  return body;
}
