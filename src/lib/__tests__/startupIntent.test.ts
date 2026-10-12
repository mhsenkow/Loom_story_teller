import { describe, it, expect } from "vitest";
import { resolveStartupIntent, shouldOpenOnboarding } from "../startupIntent";

describe("startupIntent", () => {
  it("prefers shared story over onboarding", () => {
    const intent = resolveStartupIntent({
      hash: "#story=abc12345",
      hasDiscoverSeen: false,
      hasLastSession: false,
    });
    expect(intent.suppressOnboarding).toBe(true);
    expect(shouldOpenOnboarding(intent)).toBe(false);
  });

  it("opens onboarding when discover not seen", () => {
    const intent = resolveStartupIntent({
      hash: "",
      hasDiscoverSeen: false,
      hasLastSession: false,
    });
    expect(shouldOpenOnboarding(intent)).toBe(true);
  });
});
