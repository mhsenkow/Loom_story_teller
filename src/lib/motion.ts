// =================================================================
// motion — Loom's motion vocabulary for JS / canvas animation
// =================================================================
// Mirrors the `--motion-*` durations and `--ease-*` curves in
// globals.css so WAAPI and requestAnimationFrame motion (chart stage,
// cube pivots, entrance wipes) moves with the same personality as CSS:
// decelerate in, accelerate out, a soft spring on settle.
// Callers pass `reducedMotion` from `useReducedMotion()`; the global
// CSS kill switch does not reach WAAPI or rAF loops.
// =================================================================

export const MOTION_MS = {
  instant: 90,
  quick: 140,
  standard: 220,
  gentle: 320,
  slow: 480,
} as const;

export const EASE = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  enter: "cubic-bezier(0.05, 0.7, 0.1, 1)",
  exit: "cubic-bezier(0.3, 0, 1, 1)",
  spring: "cubic-bezier(0.34, 1.36, 0.64, 1)",
  ambient: "cubic-bezier(0.37, 0, 0.63, 1)",
} as const;

const clamp01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t);

export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

export function easeOutQuint(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u * u * u;
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Stage settle for a new chart: lift from just below, slightly small, into place. */
export const CHART_SWAP_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: "translateY(6px) scale(0.985)" },
  { opacity: 1, offset: 0.55 },
  { opacity: 1, transform: "none" },
];

export const CHART_SWAP_STAGGER_MS = 60;

export type ChartEntranceReveal = "rise" | "flow" | "radial";

/** Marks with no baseline — they open from the middle. */
const RADIAL_KINDS = new Set([
  "pie", "sunburst", "radar", "radialBar", "forceBubble", "arcDiagram",
  "network", "treemap", "waffle", "globe", "scatter3d", "firefly",
]);

/** Bars whose baseline sits on the left once the stage is taller than it is wide. */
const LEFT_BASELINE_KINDS = new Set(["bar", "lollipop", "waterfall", "pareto"]);

/**
 * How an opt-in chart entrance reveals.
 * Rise: up from the baseline (bars, lines, areas).
 * Flow: out from the left baseline (horizontal bars).
 * Radial: a circle opening from the center (pies, maps, networks).
 */
export function chartEntranceReveal(kind: string | undefined, stageWidth: number, stageHeight: number): ChartEntranceReveal {
  if (kind && RADIAL_KINDS.has(kind)) return "radial";
  if (kind && LEFT_BASELINE_KINDS.has(kind) && stageHeight > stageWidth * 1.05) return "flow";
  return "rise";
}

/** Path for the in-progress entrance clip. Progress is already eased, 0–1. */
export function traceEntranceClip(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  progress: number,
  reveal: ChartEntranceReveal,
): void {
  const p = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
  ctx.beginPath();
  if (reveal === "flow") {
    ctx.rect(0, 0, w * p, h);
    return;
  }
  if (reveal === "radial") {
    ctx.arc(w / 2, h / 2, Math.hypot(w, h) * 0.5 * p, 0, Math.PI * 2);
    return;
  }
  const revealed = h * p;
  ctx.rect(0, h - revealed, w, revealed);
}

function cssVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Theme overrides (NES steps, Brutal snaps) win over the JS fallbacks. */
export function cssEasing(varName: string, fallback: string): string {
  return cssVar(varName) || fallback;
}

export function cssDuration(varName: string, fallback: number): number {
  const raw = cssVar(varName);
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return /ms$/i.test(raw) || !/s$/i.test(raw) ? n : n * 1000;
}

/**
 * Settle each layer onto the chart stage, later layers trailing the first
 * (axes land, then marks). No-op under reduced motion or without WAAPI.
 */
export function playChartSwap(layers: (Element | null | undefined)[], reducedMotion: boolean): Animation[] {
  if (reducedMotion) return [];
  const out: Animation[] = [];
  let i = 0;
  for (const el of layers) {
    if (!el || typeof (el as HTMLElement).animate !== "function") continue;
    out.push(
      (el as HTMLElement).animate(CHART_SWAP_KEYFRAMES, {
        duration: cssDuration("--motion-slow", MOTION_MS.slow),
        delay: i * CHART_SWAP_STAGGER_MS,
        easing: cssEasing("--ease-enter", EASE.enter),
        fill: "backwards",
      }),
    );
    i++;
  }
  return out;
}
