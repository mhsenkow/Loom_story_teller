// =================================================================
// Scatter plot rectangle — shared Canvas / WebGPU contract (LOOM-012)
// =================================================================
// Canvas scatter and scatter.wgsl must map domain endpoints to the same
// CSS pixels. GPU uniforms use device pixels; helpers convert via DPR.
// =================================================================

import type { ChartKind } from "./recommendations";
import { resolveChartMargins, resolveChartPad, type ChartMargins } from "./chartLayout";

export type GpuScatterPads = {
  /** CSS uniform pad (symmetric plotOf inset). */
  padCss: number;
  /** Device-pixel insets passed to scatter.wgsl (symmetric per axis). */
  padXDevice: number;
  padYDevice: number;
  margins: ChartMargins;
};

export function resolveGpuScatterPads(args: {
  kind: ChartKind;
  cssWidth: number;
  cssHeight: number;
  basePad: number;
  dpr: number;
  titleLayout?: string;
  tickRotation?: number;
  chartFrame?: string;
  isCompact?: boolean;
  legendPosition?: string | null;
  axisFontSize?: number;
  sourceFootnote?: boolean;
}): GpuScatterPads {
  const layoutArgs = {
    ...args,
    width: args.cssWidth,
    height: args.cssHeight,
  };
  const padCss = resolveChartPad(layoutArgs);
  const margins = resolveChartMargins(layoutArgs);
  const dpr = Math.max(1, args.dpr);
  // Canvas scatter uses symmetric padCss; GPU shader uses the same inset on both sides per axis.
  const padXDevice = Math.round(padCss * dpr);
  const padYDevice = Math.round(padCss * dpr);
  return { padCss, padXDevice, padYDevice, margins };
}

/** Canvas scatter X scale (CSS pixels). */
export function scatterCssX(
  v: number,
  xMin: number,
  xMax: number,
  cssWidth: number,
  padCss: number,
): number {
  return padCss + ((v - xMin) / (xMax - xMin || 1)) * (cssWidth - 2 * padCss);
}

/** Canvas scatter Y scale (CSS pixels, y up in data). */
export function scatterCssY(
  v: number,
  yMin: number,
  yMax: number,
  cssHeight: number,
  padCss: number,
): number {
  return cssHeight - padCss - ((v - yMin) / (yMax - yMin || 1)) * (cssHeight - 2 * padCss);
}

/** Same mapping as scatter.wgsl compute_positions (normalized tx, ty in [0,1]). */
export function scatterGpuNdc(tx: number, ty: number, deviceWidth: number, deviceHeight: number, padXDevice: number, padYDevice: number): { nx: number; ny: number } {
  const vw = Math.max(deviceWidth, 1);
  const vh = Math.max(deviceHeight, 1);
  const padNx = (2 * padXDevice) / vw;
  const padNy = (2 * padYDevice) / vh;
  const nx = -1 + padNx + tx * (2 - 2 * padNx);
  const ny = -1 + padNy + ty * (2 - 2 * padNy);
  return { nx, ny };
}

/** NDC (−1…1) → CSS pixel (top-left origin). */
export function ndcToCss(nx: number, ny: number, cssWidth: number, cssHeight: number): { x: number; y: number } {
  return {
    x: ((nx + 1) / 2) * cssWidth,
    y: ((1 - ny) / 2) * cssHeight,
  };
}

/** Domain endpoint alignment check: GPU NDC path vs Canvas formula. */
export function scatterEndpointCss(args: {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  padCss: number;
  padXDevice: number;
  padYDevice: number;
  axis: "x" | "y";
  atMax: boolean;
}): { canvas: number; gpu: number } {
  const { cssWidth, cssHeight, dpr, padCss, padXDevice, padYDevice, axis, atMax } = args;
  const t = atMax ? 1 : 0;
  if (axis === "x") {
    const canvas = atMax ? cssWidth - padCss : padCss;
    const { nx } = scatterGpuNdc(t, 0.5, cssWidth * dpr, cssHeight * dpr, padXDevice, padYDevice);
    const gpu = ndcToCss(nx, 0, cssWidth, cssHeight).x;
    return { canvas, gpu };
  }
  const canvas = atMax ? padCss : cssHeight - padCss;
  const { ny } = scatterGpuNdc(0.5, t, cssWidth * dpr, cssHeight * dpr, padXDevice, padYDevice);
  const gpu = ndcToCss(0, ny, cssWidth, cssHeight).y;
  return { canvas, gpu };
}
