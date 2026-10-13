// =================================================================
// idleCallback — Safari / WebKit fallback
// =================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelScheduledIdleCallback, scheduleIdleCallback } from "../idleCallback";

describe("idleCallback", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("falls back to setTimeout when requestIdleCallback is missing", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("cancelIdleCallback", undefined);
    vi.useFakeTimers();
    const cb = vi.fn();
    const id = scheduleIdleCallback(cb, { timeout: 120 });
    expect(cb).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(cb).toHaveBeenCalledOnce();
    cancelScheduledIdleCallback(id);
  });

  it("uses native requestIdleCallback when present", () => {
    const cancel = vi.fn();
    const request = vi.fn((_cb: unknown, _opts?: unknown) => 42);
    vi.stubGlobal("requestIdleCallback", request);
    vi.stubGlobal("cancelIdleCallback", cancel);
    const cb = vi.fn();
    expect(scheduleIdleCallback(cb, { timeout: 50 })).toBe(42);
    expect(request).toHaveBeenCalledOnce();
    cancelScheduledIdleCallback(42);
    expect(cancel).toHaveBeenCalledWith(42);
  });
});
