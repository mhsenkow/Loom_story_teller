import { describe, expect, it } from "vitest";
import { resolveEffectiveTheme } from "../resolveEffectiveTheme";

describe("resolveEffectiveTheme", () => {
  it("follows OS when system", () => {
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
  });
});
