import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { _resetAppActivityForTests, subscribeAppActivity } from "../appActivity";

describe("webStreams visibility (LOOM-081)", () => {
  beforeEach(() => {
    _resetAppActivityForTests();
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("notifies subscribers of initial active state", () => {
    const fn = vi.fn();
    subscribeAppActivity(fn);
    expect(fn).toHaveBeenCalledWith(true);
  });
});
