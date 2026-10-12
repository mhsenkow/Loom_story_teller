// =================================================================
// gpuPalette — theme palette packing for WebGPU scatter/scene shaders
// =================================================================
// Supports up to 32 RGB stops; categories beyond distinct slots fold to
// the last stop ("Other"). LOOM-108.
// =================================================================

import { parseColorToRgb } from "./webgpuColor";

export const MAX_GPU_PALETTE = 32;
export const GPU_OTHER_INDEX = MAX_GPU_PALETTE - 1;

const DEFAULT_RGB: [number, number, number][] = [
  [0.424, 0.361, 0.906], [0, 0.839, 0.561], [1, 0.42, 0.42], [1, 0.851, 0.239],
  [0, 0.706, 0.847], [0.906, 0.486, 0.361], [0.635, 0.608, 0.996], [0.455, 0.725, 1],
];

/** Assign sequential category ids; fold overflow into GPU_OTHER_INDEX. */
export function gpuCategoryIndex(rawId: number, distinctCount: number): number {
  if (distinctCount <= MAX_GPU_PALETTE) return rawId;
  if (rawId < GPU_OTHER_INDEX) return rawId;
  return GPU_OTHER_INDEX;
}

/** Pack hex/rgb colors into a GPU palette buffer (3 floats per stop). */
export function packGpuPalette(colors: string[] | undefined, fallback: [number, number, number][] = DEFAULT_RGB): {
  floats: Float32Array;
  size: number;
} {
  const src =
    colors && colors.length > 0
      ? colors.slice(0, MAX_GPU_PALETTE).map((c) => parseColorToRgb(c))
      : fallback.slice(0, MAX_GPU_PALETTE);
  while (src.length < MAX_GPU_PALETTE) {
    src.push(src[src.length - 1] ?? fallback[0]!);
  }
  const floats = new Float32Array(MAX_GPU_PALETTE * 3);
  for (let i = 0; i < MAX_GPU_PALETTE; i++) {
    const [r, g, b] = src[i] ?? fallback[0]!;
    floats[i * 3 + 0] = r;
    floats[i * 3 + 1] = g;
    floats[i * 3 + 2] = b;
  }
  const size = Math.min(Math.max(colors?.length ?? fallback.length, 1), MAX_GPU_PALETTE);
  return { floats, size };
}
