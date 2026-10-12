import { describe, it, expect } from "vitest";
import { gpuCategoryIndex, packGpuPalette, MAX_GPU_PALETTE } from "../gpuPalette";

describe("gpuPalette", () => {
  it("packs up to 32 colors", () => {
    const colors = Array.from({ length: 12 }, (_, i) => `#${(i + 1).toString(16).padStart(6, "0")}`);
    const { floats, size } = packGpuPalette(colors);
    expect(floats.length).toBe(MAX_GPU_PALETTE * 3);
    expect(size).toBe(12);
  });

  it("folds overflow categories to Other index", () => {
    expect(gpuCategoryIndex(10, 40)).toBe(10);
    expect(gpuCategoryIndex(35, 40)).toBe(MAX_GPU_PALETTE - 1);
  });
});
