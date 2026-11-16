// Hover tooltip and crosshair readout cards (LOOM-141).
"use client";
import type { ReactNode } from "react";
import { ChartTooltipCard } from "@/components/ChartTooltipCard";
import type { ChartTooltipPresentation } from "@/lib/chartTooltipMode";
import { formatAxisValue } from "@/lib/chartAxes";
import type { HitTarget } from "@/lib/chartTooltip";
import type { MarkRef } from "@/lib/markFocus";
import { sameMark } from "@/lib/markFocus";

export type HoverTooltipTip = {
  clientX: number;
  clientY: number;
  rowIndex: number;
  row: (string | number | boolean | null)[];
  columns: string[];
};

export type ChartHoverTooltipProps = {
  visible: boolean;
  tip: HoverTooltipTip;
  presentation: ChartTooltipPresentation;
  fontFamily: string;
  axisFontSize: number;
  tooltipLink: { field: string; value: string } | null;
  hoverMark: HitTarget | null;
  hoverRef: MarkRef | null;
  activeChartId: string | undefined;
  pinnedTooltips: { chartId: string; ref: MarkRef }[];
  stickyTooltip: boolean;
  stageRect: DOMRect | null;
  onPin: () => void;
  onDismiss?: () => void;
};

export function ChartHoverTooltip(props: ChartHoverTooltipProps): ReactNode {
  const {
    visible,
    tip,
    presentation,
    fontFamily,
    axisFontSize,
    tooltipLink,
    hoverMark,
    hoverRef,
    activeChartId,
    pinnedTooltips,
    stickyTooltip,
    stageRect,
    onPin,
    onDismiss,
  } = props;

  if (!visible) return null;

  const markPinned =
    !!hoverRef && pinnedTooltips.some((t) => t.chartId === activeChartId && sameMark(t.ref, hoverRef));

  return (
    <ChartTooltipCard
      fontFamily={fontFamily}
      axisFontSize={axisFontSize}
      tip={tip}
      presentation={presentation}
      link={tooltipLink}
      announce={false}
      onPin={hoverMark ? onPin : undefined}
      markPinned={markPinned}
      stageRect={stageRect}
      onDismiss={stickyTooltip ? onDismiss : undefined}
    />
  );
}

export type CrosshairTooltipProps = {
  crosshairPos: { dataX: number; dataY: number; screenX: number; screenY: number };
  sx: number;
  sy: number;
  xField: string | undefined;
  yField: string | undefined;
  xTypeHint: string;
  fontFamily: string;
  axisFontSize: number;
};

export function CrosshairTooltip(props: CrosshairTooltipProps): ReactNode {
  const { crosshairPos, sx, sy, xField, yField, xTypeHint, fontFamily, axisFontSize } = props;
  const xValue =
    xTypeHint.includes("timestamp") || xTypeHint.includes("date") || crosshairPos.dataX > 1e11
      ? new Date(crosshairPos.dataX).toISOString().replace("T", " ").slice(0, 19)
      : formatAxisValue(crosshairPos.dataX);

  return (
    <>
      <div className="absolute pointer-events-none bg-loom-accent/30 z-[5]" style={{ left: sx, top: 0, width: 1, height: "100%" }} />
      <div className="absolute pointer-events-none bg-loom-accent/30 z-[5]" style={{ left: 0, top: sy, width: "100%", height: 1 }} />
      <ChartTooltipCard
        tip={{
          clientX: crosshairPos.screenX,
          clientY: crosshairPos.screenY,
          rowIndex: -1,
          columns: [xField ?? "x", yField ?? "y"],
          row: [xValue, formatAxisValue(crosshairPos.dataY)],
        }}
        presentation="compact"
        fontFamily={fontFamily}
        axisFontSize={axisFontSize}
        announce={false}
      />
    </>
  );
}
