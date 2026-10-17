// =================================================================
// Loom — shared geometric and emoji chart markers.
// =================================================================

export const MARK_SHAPE_IDS = [
  "circle",
  "pill-vertical",
  "dash",
  "triangle",
  "rounded-square",
  "pentagon",
  "ring",
  "x",
  "diamond",
  "pin",
  "square",
  "cross",
  "star",
  "hexagon",
] as const;

export type MarkShapeId = (typeof MARK_SHAPE_IDS)[number];

export const CATEGORY_MARK_SHAPES: readonly MarkShapeId[] = [
  "circle",
  "triangle",
  "rounded-square",
  "diamond",
  "pentagon",
  "x",
  "ring",
  "pin",
];

export const MARK_SHAPE_OPTIONS: readonly { value: MarkShapeId; label: string }[] = [
  { value: "circle", label: "Circle" },
  { value: "pill-vertical", label: "Pill" },
  { value: "dash", label: "Dash" },
  { value: "triangle", label: "Triangle" },
  { value: "rounded-square", label: "Rounded square" },
  { value: "pentagon", label: "Pentagon" },
  { value: "ring", label: "Ring" },
  { value: "x", label: "X" },
  { value: "diamond", label: "Diamond" },
  { value: "pin", label: "Pin" },
  { value: "square", label: "Square" },
  { value: "cross", label: "Plus" },
  { value: "star", label: "Star" },
  { value: "hexagon", label: "Hexagon" },
];

export const CURATED_MARK_EMOJIS = [
  "😀", "😍", "😮", "😢", "😡", "👍", "👎", "❤️",
  "⭐", "🔥", "✨", "⚠️", "✅", "❌", "📍", "🌍",
  "☀️", "🌧️", "🌱", "🚀", "🏠", "🚗", "💡", "💬",
] as const;

const MARK_SHAPE_SET = new Set<string>(MARK_SHAPE_IDS);

export function isMarkShapeId(value: unknown): value is MarkShapeId {
  return typeof value === "string" && MARK_SHAPE_SET.has(value);
}

export function categoryShape(index: number): MarkShapeId {
  return CATEGORY_MARK_SHAPES[Math.abs(Math.trunc(index)) % CATEGORY_MARK_SHAPES.length]!;
}

export function drawMarkerPath(
  ctx: CanvasRenderingContext2D,
  shape: MarkShapeId | string,
  cx: number,
  cy: number,
  r: number,
): void {
  switch (shape) {
    case "pill-vertical": {
      const halfW = r * 0.38;
      const halfH = r * 1.15;
      ctx.moveTo(cx - halfW, cy - halfH + halfW);
      ctx.arcTo(cx - halfW, cy - halfH, cx, cy - halfH, halfW);
      ctx.arcTo(cx + halfW, cy - halfH, cx + halfW, cy, halfW);
      ctx.arcTo(cx + halfW, cy + halfH, cx, cy + halfH, halfW);
      ctx.arcTo(cx - halfW, cy + halfH, cx - halfW, cy, halfW);
      ctx.closePath();
      break;
    }
    case "dash": {
      const halfH = r * 0.3;
      ctx.moveTo(cx - r, cy - halfH);
      ctx.arcTo(cx - r, cy - halfH, cx - r + halfH, cy - halfH, halfH);
      ctx.lineTo(cx + r - halfH, cy - halfH);
      ctx.arcTo(cx + r, cy - halfH, cx + r, cy, halfH);
      ctx.arcTo(cx + r, cy + halfH, cx + r - halfH, cy + halfH, halfH);
      ctx.lineTo(cx - r + halfH, cy + halfH);
      ctx.arcTo(cx - r, cy + halfH, cx - r, cy, halfH);
      ctx.closePath();
      break;
    }
    case "rounded-square": {
      const q = r * 0.28;
      ctx.moveTo(cx - r + q, cy - r);
      ctx.lineTo(cx + r - q, cy - r);
      ctx.quadraticCurveTo(cx + r, cy - r, cx + r, cy - r + q);
      ctx.lineTo(cx + r, cy + r - q);
      ctx.quadraticCurveTo(cx + r, cy + r, cx + r - q, cy + r);
      ctx.lineTo(cx - r + q, cy + r);
      ctx.quadraticCurveTo(cx - r, cy + r, cx - r, cy + r - q);
      ctx.lineTo(cx - r, cy - r + q);
      ctx.quadraticCurveTo(cx - r, cy - r, cx - r + q, cy - r);
      ctx.closePath();
      break;
    }
    case "square":
      ctx.rect(cx - r, cy - r, r * 2, r * 2);
      break;
    case "diamond":
      ctx.moveTo(cx, cy - r * 1.3);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r * 1.3);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      break;
    case "triangle":
      ctx.moveTo(cx, cy - r * 1.2);
      ctx.lineTo(cx + r * 1.1, cy + r * 0.8);
      ctx.lineTo(cx - r * 1.1, cy + r * 0.8);
      ctx.closePath();
      break;
    case "cross": {
      const a = r * 0.35;
      ctx.moveTo(cx - a, cy - r); ctx.lineTo(cx + a, cy - r);
      ctx.lineTo(cx + a, cy - a); ctx.lineTo(cx + r, cy - a);
      ctx.lineTo(cx + r, cy + a); ctx.lineTo(cx + a, cy + a);
      ctx.lineTo(cx + a, cy + r); ctx.lineTo(cx - a, cy + r);
      ctx.lineTo(cx - a, cy + a); ctx.lineTo(cx - r, cy + a);
      ctx.lineTo(cx - r, cy - a); ctx.lineTo(cx - a, cy - a);
      ctx.closePath();
      break;
    }
    case "x": {
      const a = r * 0.32;
      ctx.moveTo(cx - r, cy - r + a);
      ctx.lineTo(cx - r + a, cy - r);
      ctx.lineTo(cx, cy - a);
      ctx.lineTo(cx + r - a, cy - r);
      ctx.lineTo(cx + r, cy - r + a);
      ctx.lineTo(cx + a, cy);
      ctx.lineTo(cx + r, cy + r - a);
      ctx.lineTo(cx + r - a, cy + r);
      ctx.lineTo(cx, cy + a);
      ctx.lineTo(cx - r + a, cy + r);
      ctx.lineTo(cx - r, cy + r - a);
      ctx.lineTo(cx - a, cy);
      ctx.closePath();
      break;
    }
    case "star": {
      for (let i = 0; i < 10; i++) {
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? r * 1.2 : r * 0.5;
        const px = cx + Math.cos(angle) * rad;
        const py = cy + Math.sin(angle) * rad;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case "pentagon":
    case "hexagon": {
      const sides = shape === "pentagon" ? 5 : 6;
      for (let i = 0; i < sides; i++) {
        const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case "pin":
      ctx.moveTo(cx, cy + r * 1.3);
      ctx.bezierCurveTo(cx - r * 0.25, cy + r * 0.75, cx - r, cy + r * 0.25, cx - r, cy - r * 0.25);
      ctx.arc(cx, cy - r * 0.25, r, Math.PI, 0);
      ctx.bezierCurveTo(cx + r, cy + r * 0.25, cx + r * 0.25, cy + r * 0.75, cx, cy + r * 1.3);
      ctx.closePath();
      break;
    case "ring":
    case "circle":
    default:
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
  }
}
