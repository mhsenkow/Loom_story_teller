// Canvas counterpart of on-stage notes, included in PNG captures without editor handles.
import {
  wrapAnnotationLines,
  type CanvasAnnotation,
} from "./canvasArrangement";

export function drawCanvasAnnotations(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  notes: CanvasAnnotation[],
  theme: { bg: string; border: string; text: string },
  frame: { width: number; height: number },
) {
  const cssW = frame.width;
  const cssH = frame.height;
  ctx.save();
  ctx.scale(w / cssW, h / cssH);
  for (const a of notes) {
    const fs = a.fontSize ?? 11;
    const width = (a.width ?? 0.25) * cssW;
    ctx.font = `${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    const lines = wrapAnnotationLines(
      a.text,
      Math.max(1, width - 14),
      (text) => ctx.measureText(text).width,
    );
    const height = lines.length * fs * 1.4 + 10;
    const x = a.x * cssW - width / 2,
      y = a.y * cssH - height / 2;
    ctx.fillStyle = theme.bg;
    ctx.strokeStyle = theme.border;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = theme.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((line, i) => ctx.fillText(line, x + 7, y + 5 + i * fs * 1.4));
  }
  ctx.restore();
}
