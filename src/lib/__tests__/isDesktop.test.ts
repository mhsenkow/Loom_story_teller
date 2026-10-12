// =================================================================
// isDesktop / isMobileOs — iPad shell uses web data path
// =================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { isDesktop, isMobileOs, isTauri } from "../tauri";

describe("isMobileOs / isDesktop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats iPadOS desktop-class UA as mobile", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      maxTouchPoints: 5,
    });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    expect(isMobileOs()).toBe(true);
    expect(isTauri()).toBe(true);
    expect(isDesktop()).toBe(false);
  });

  it("treats macOS Tauri as desktop", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      maxTouchPoints: 0,
    });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    expect(isMobileOs()).toBe(false);
    expect(isDesktop()).toBe(true);
  });

  it("browser without Tauri is never desktop", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)",
      platform: "iPad",
      maxTouchPoints: 5,
    });
    vi.stubGlobal("window", {});
    expect(isDesktop()).toBe(false);
  });
});
