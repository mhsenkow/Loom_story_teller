// Portable canvas geometry. Coordinates are fractions of the frame, independent of device pixels.
import type { ChartVisualOverrides } from "./chartVisualTypes";
import type { ChartChromeRect } from "./chartChromeLink";

export const ARRANGEMENT_KEYS = [
  "canvasWidth",
  "canvasHeight",
  "plotX",
  "plotY",
  "plotWidth",
  "plotHeight",
  "titleX",
  "titleY",
  "titleWidth",
  "titleScale",
  "legendWidth",
  "legendHeight",
  "legendOffsetX",
  "legendOffsetY",
] as const;
export const ARRANGE_PLOT_KINDS = new Set([
  "scatter",
  "bubble",
  "bar",
  "histogram",
  "line",
  "area",
]);
export const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));
export type ResizeHandle = "move" | "e" | "s" | "se";
export type CanvasAnnotation = {
  id: string;
  text: string;
  x: number;
  y: number;
  width?: number;
  fontSize?: number;
};

export function constrainRect(
  rect: ChartChromeRect,
  bounds: ChartChromeRect,
  minW = 40,
  minH = 24,
): ChartChromeRect {
  const w = clamp(rect.w, Math.min(minW, bounds.w), bounds.w);
  const h = clamp(rect.h, Math.min(minH, bounds.h), bounds.h);
  return {
    x: clamp(rect.x, bounds.x, bounds.x + bounds.w - w),
    y: clamp(rect.y, bounds.y, bounds.y + bounds.h - h),
    w,
    h,
  };
}

export function manipulateRect(
  start: ChartChromeRect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  bounds: ChartChromeRect,
  snap = true,
  minW = 40,
  minH = 24,
): ChartChromeRect {
  const r = { ...start };
  if (handle === "move") {
    r.x += dx;
    r.y += dy;
  } else {
    if (handle !== "s")
      r.w = clamp(
        start.w + dx,
        Math.min(minW, bounds.w),
        bounds.x + bounds.w - start.x,
      );
    if (handle !== "e")
      r.h = clamp(
        start.h + dy,
        Math.min(minH, bounds.h),
        bounds.y + bounds.h - start.y,
      );
  }
  if (snap && handle === "move") {
    for (const axis of ["x", "y"] as const) {
      const size = axis === "x" ? "w" : "h";
      const guides = [
        bounds[axis],
        bounds[axis] + bounds[size] / 2 - r[size] / 2,
        bounds[axis] + bounds[size] - r[size],
      ];
      const nearest = guides.reduce((a, b) =>
        Math.abs(b - r[axis]) < Math.abs(a - r[axis]) ? b : a,
      );
      if (Math.abs(nearest - r[axis]) <= 6) r[axis] = nearest;
    }
  }
  return constrainRect(r, bounds, minW, minH);
}

export function arrangementPlot(w: number, h: number, v: ChartVisualOverrides) {
  if (
    v.plotX == null ||
    v.plotY == null ||
    v.plotWidth == null ||
    v.plotHeight == null
  )
    return undefined;
  const r = constrainRect(
    { x: v.plotX * w, y: v.plotY * h, w: v.plotWidth * w, h: v.plotHeight * h },
    {
      x: Math.min(52, w * 0.16),
      y: 32,
      w: Math.max(40, w - Math.min(52, w * 0.16) - 16),
      h: Math.max(40, h - 80),
    },
    Math.min(120, w * 0.4),
    Math.min(100, h * 0.4),
  );
  return { left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h };
}

export function titleArrangementRect(
  w: number,
  h: number,
  pad: number,
  v: Pick<
    ChartVisualOverrides,
    "titleScale" | "titleWidth" | "titleX" | "titleY"
  >,
): ChartChromeRect {
  const scale = v.titleScale ?? 1;
  const width =
    v.titleWidth == null ? Math.max(40, w - 2 * pad) : v.titleWidth * w;
  return constrainRect(
    {
      x: v.titleX == null ? pad : v.titleX * w,
      y: v.titleY == null ? 4 : v.titleY * h,
      w: width,
      h: 58 * scale,
    },
    { x: 4, y: 4, w: Math.max(40, w - 8), h: Math.max(24, h - 8) },
  );
}

/** GPU chrome has a fixed layout; authored composition uses the matching Canvas paint/export path. */
export function hasCanvasArrangement(v: ChartVisualOverrides): boolean {
  return [
    v.plotX,
    v.titleX,
    v.titleY,
    v.titleWidth,
    v.titleScale,
    v.legendOffsetX,
    v.legendOffsetY,
    v.legendWidth,
    v.legendHeight,
  ].some((n) => n != null);
}

/** Word wrap shared by note bounds and PNG, including unbroken URLs. */
export function wrapAnnotationLines(
  text: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (let word of paragraph.split(" ")) {
      if (line && measure(`${line} ${word}`) > width) {
        lines.push(line);
        line = "";
      }
      while (word && measure(word) > width) {
        let end = 1;
        while (end < word.length && measure(word.slice(0, end + 1)) <= width)
          end++;
        lines.push(word.slice(0, end));
        word = word.slice(end);
      }
      line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

export function annotationRect(
  a: CanvasAnnotation,
  width: number,
  height: number,
): ChartChromeRect {
  const w = (a.width ?? 0.25) * width;
  const fs = a.fontSize ?? 11;
  const lines = wrapAnnotationLines(
    a.text,
    Math.max(1, w - 14),
    (text) => text.length * fs * 0.6,
  );
  const h = lines.length * fs * 1.4 + 10;
  return { x: a.x * width - w / 2, y: a.y * height - h / 2, w, h };
}

/** Match the visible frame and drag preview, including locked social aspects. */
export function arrangedFrameSize(
  base: { width: number; height: number; aspectLocked: boolean },
  visual: Pick<ChartVisualOverrides, "canvasWidth" | "canvasHeight">,
) {
  const x = clamp(visual.canvasWidth ?? 1, 0.35, 1),
    y = clamp(visual.canvasHeight ?? 1, 0.35, 1);
  const minimum = Math.max(
    Math.min(1, 240 / base.width),
    Math.min(1, 200 / base.height),
  );
  const sx = base.aspectLocked ? Math.max(minimum, Math.min(x, y)) : x;
  const sy = base.aspectLocked ? Math.max(minimum, Math.min(x, y)) : y;
  return {
    ...base,
    width: Math.round(Math.max(Math.min(240, base.width), base.width * sx)),
    height: Math.round(Math.max(Math.min(200, base.height), base.height * sy)),
  };
}
