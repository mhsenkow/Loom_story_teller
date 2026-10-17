import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { THEME_BOOTSTRAP_SCRIPT } from "../themeBootstrap";
import { THEMES } from "../lookSystem";

function boot(settings: unknown, dark = false) {
  const attrs: Record<string, string> = {};
  const classes = new Set(["dark"]);
  const style: Record<string, string> = {};
  runInNewContext(THEME_BOOTSTRAP_SCRIPT, {
    localStorage: { getItem: () => JSON.stringify(settings) },
    window: { matchMedia: () => ({ matches: dark }) },
    document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; }, style, classList: { add: (v: string) => classes.add(v), remove: (v: string) => classes.delete(v) } } },
  });
  return { attrs, classes, style };
}
describe("first-paint look", () => {
  it.each(THEMES)("applies %s before hydration", (theme) => {
    const result = boot({ theme, font: "source-serif", uiChrome: "nyt", faces: "local" });
    expect(result.attrs).toEqual({ "data-theme": theme, "data-font": "source-serif", "data-ui": "nyt", "data-faces": "local" });
    expect(result.classes.size).toBe(1);
  });
  it("reads the versioned storage envelope used by current saves", () => {
    const result = boot({ v: 1, data: { theme: "paper", font: "source-serif", uiChrome: "nyt", faces: "local", colorblindCharts: true } });
    expect(result.attrs["data-theme"]).toBe("paper");
    expect(result.attrs["data-font"]).toBe("source-serif");
    expect(result.attrs["data-a11y"]).toBe("colorblind");
  });
  it("resolves system and legacy preferences", () => {
    expect(boot({ theme: "system" }).attrs["data-theme"]).toBe("light");
    expect(boot({ theme: "system" }, true).attrs["data-theme"]).toBe("dark");
    expect(boot({ theme: "electric" }).attrs["data-theme"]).toBe("frost");
    expect(boot({ theme: "unknown", font: "unknown" }).attrs).toEqual({ "data-theme": "dark" });
  });
});
