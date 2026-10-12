import { describe, it, expect } from "vitest";
import { resolveGpuScatterPads, scatterEndpointCss } from "../chartPlotRect";

const DPRS = [1, 1.5, 2, 3] as const;

describe("chartPlotRect (LOOM-012)", () => {
  for (const dpr of DPRS) {
    it(`GPU and Canvas scatter endpoints match at DPR ${dpr}`, () => {
      const cssW = dpr === 3 ? 360 : 1200;
      const cssH = Math.round(cssW * 0.62);
      const pads = resolveGpuScatterPads({
        kind: "scatter",
        cssWidth: cssW,
        cssHeight: cssH,
        basePad: dpr === 3 ? 36 : 56,
        dpr,
        titleLayout: "pair",
        isCompact: cssW < 400,
        axisFontSize: cssW < 400 ? 10 : 11,
      });
      for (const axis of ["x", "y"] as const) {
        for (const atMax of [false, true]) {
          const { canvas, gpu } = scatterEndpointCss({
            cssWidth: cssW,
            cssHeight: cssH,
            dpr,
            padCss: pads.padCss,
            padXDevice: pads.padXDevice,
            padYDevice: pads.padYDevice,
            axis,
            atMax,
          });
          expect(Math.abs(canvas - gpu)).toBeLessThan(0.51);
        }
      }
    });
  }
});
