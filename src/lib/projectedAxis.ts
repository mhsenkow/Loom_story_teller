import { fitTextEllipsis } from "./chartLayout";
import { chartFont, chartTypeRamp } from "./chartType";

type Point = { x: number; y: number };
export type AxisLabelBox = { x: number; y: number; w: number; h: number };

/** Label an isometric floor edge on its outside, thinning by actual screen-space collisions. */
export function drawProjectedAxis(
  ctx: CanvasRenderingContext2D,
  args: {
    start: Point; end: Point; center: Point;
    ticks: number[]; pointOf: (value: number) => Point; format: (value: number) => string;
    title: string; width: number; height: number;
    text: string; muted: string; rule: string; fontFamily: string; axisFontSize?: number;
    occupied: AxisLabelBox[];
  },
): void {
  const { start, end, center, occupied } = args;
  const type = chartTypeRamp(args.axisFontSize);
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return;
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const sign = (-dy * (mid.x - center.x) + dx * (mid.y - center.y)) >= 0 ? 1 : -1;
  const nx = -dy / length * sign, ny = dx / length * sign;
  const place = (text: string, p: Point, offset: number, height: number) => {
    const w = ctx.measureText(text).width;
    const x = Math.max(4, Math.min(args.width - w - 4, p.x + nx * offset - w / 2));
    const y = Math.max(4, Math.min(args.height - height - 4, p.y + ny * offset - height / 2));
    return { x, y, w, h: height };
  };
  const overlaps = (a: AxisLabelBox, b: AxisLabelBox) => a.x < b.x + b.w + 5 && a.x + a.w + 5 > b.x && a.y < b.y + b.h + 4 && a.y + a.h + 4 > b.y;
  ctx.save();
  ctx.strokeStyle = args.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = chartFont(type.tick, args.fontFamily, 600);
  const title = fitTextEllipsis(ctx, args.title, Math.min(length, args.width / 2 - 16));
  const titleBox = place(title, mid, type.tick * 2 + 13, type.tick);
  if (title && !occupied.some(b => overlaps(titleBox, b))) {
    ctx.fillStyle = args.text;
    ctx.fillText(title, titleBox.x + titleBox.w / 2, titleBox.y + titleBox.h / 2);
    occupied.push(titleBox);
  }
  ctx.font = chartFont(type.tick, args.fontFamily);
  ctx.fillStyle = args.muted;
  // Keep both ends when they fit, then admit intermediate labels in order.
  const ticks = [...new Set([args.ticks[0], args.ticks.at(-1), ...args.ticks].filter((v): v is number => v != null))];
  for (const value of ticks) {
    const p = args.pointOf(value);
    const text = args.format(value);
    const box = place(text, p, type.tick / 2 + 9, type.tick);
    if (!text || occupied.some(b => overlaps(box, b))) continue;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + nx * 5, p.y + ny * 5);
    ctx.stroke();
    ctx.fillText(text, box.x + box.w / 2, box.y + box.h / 2);
    occupied.push(box);
  }
  ctx.restore();
}
