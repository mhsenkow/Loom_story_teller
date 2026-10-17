import type { ChartTooltipPresentation } from "./chartTooltipMode";

/** Keep readouts in the viewport after their text has wrapped at the chosen font size. */
export function chartTooltipLayout({ presentation, x, y, viewportWidth, viewportHeight, height, stage }: {
  presentation: ChartTooltipPresentation;
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  height: number;
  stage?: Pick<DOMRect, "left" | "top" | "width" | "height" | "bottom"> | null;
}) {
  const gutter = 8;
  const availableWidth = Math.max(1, viewportWidth - gutter * 2);
  const maxHeight = Math.max(1, Math.min(viewportHeight - gutter * 2, presentation === "glass" || presentation === "dock" ? viewportHeight * 0.65 : Infinity));
  const width = Math.min(availableWidth, presentation === "dock" ? Math.max(160, (stage?.width ?? 496) - 16) : presentation === "glass" ? 320 : presentation === "compact" ? 240 : 280);
  const h = Math.min(maxHeight, Math.max(0, height));
  const clampX = (left: number) => Math.max(gutter, Math.min(left, viewportWidth - width - gutter));
  const clampY = (top: number) => Math.max(gutter, Math.min(top, viewportHeight - h - gutter));
  if (presentation === "dock") return { left: clampX((stage?.left ?? 0) + gutter), top: clampY((stage?.bottom ?? viewportHeight) - h - gutter), width, maxHeight };
  if (presentation === "glass") return { left: clampX((stage ? stage.left + stage.width / 2 : x) - width / 2), top: clampY((stage ? stage.top + stage.height * 0.62 : y) - h / 2), width, maxHeight };
  return {
    left: clampX(x + width + 20 > viewportWidth ? x - width - 12 : x + 12),
    top: clampY(y + h + 20 > viewportHeight ? y - h - 8 : y + 12),
    width,
    maxHeight,
  };
}
