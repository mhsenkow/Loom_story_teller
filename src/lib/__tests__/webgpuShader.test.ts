import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("scatter.wgsl source", () => {
  it("contains DPR and palette_size uniforms on disk", () => {
    const code = readFileSync(join(process.cwd(), "src/shaders/scatter.wgsl"), "utf8");
    expect(code).toContain("device_pixel_ratio");
    expect(code).toContain("palette_size");
    expect(code).toContain("compute_positions");
  });
});
