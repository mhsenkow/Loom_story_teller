// =================================================================
// Channel direction — high values can draw as the low end
// =================================================================
// Size, color, opacity, glow, outline, and depth each map a number
// onto a visual. Invert flips that map without changing the field.
// =================================================================

export type ChannelInvertKey = "size" | "color" | "opacity" | "glow" | "outline" | "z";

export interface ChannelInvert {
  size?: boolean;
  color?: boolean;
  opacity?: boolean;
  glow?: boolean;
  outline?: boolean;
  z?: boolean;
}

/** Clamp a 0–1 encoding and optionally send the high end to the low end. */
export function directedUnit(t: number, invert: boolean | undefined): number {
  if (!Number.isFinite(t)) return 0;
  const c = Math.max(0, Math.min(1, t));
  return invert ? 1 - c : c;
}

const LETTERS: [ChannelInvertKey, string][] = [
  ["size", "s"],
  ["color", "c"],
  ["opacity", "o"],
  ["glow", "g"],
  ["outline", "l"],
  ["z", "z"],
];

/** Compact chart-link token. Empty when nothing is inverted. */
export function packChannelInvert(v: ChannelInvert | null | undefined): string | undefined {
  if (!v) return undefined;
  const s = LETTERS.filter(([k]) => v[k]).map(([, letter]) => letter).join("");
  return s || undefined;
}

export function unpackChannelInvert(raw: string | null | undefined): ChannelInvert | undefined {
  if (!raw) return undefined;
  const byLetter = new Map(LETTERS.map(([k, letter]) => [letter, k]));
  const out: ChannelInvert = {};
  for (const ch of raw) {
    const key = byLetter.get(ch);
    if (key) out[key] = true;
  }
  return Object.keys(out).length ? out : undefined;
}
