import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRafCoalescer } from "../rafCoalesce";

describe("rafCoalesce", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("runs once per burst", () => {
    const fn = vi.fn();
    const c = createRafCoalescer(fn);
    c.schedule();
    c.schedule();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
