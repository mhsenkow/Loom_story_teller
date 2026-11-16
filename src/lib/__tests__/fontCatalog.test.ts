import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_FONTS } from "../lookSystem";
import { FONT_CHOICES, FONT_GROUPS, chartFontStack, resolveChartFontFamily, ensureChartFontLoaded } from "../fontCatalog";
import { chartFont } from "../chartType";

describe("bundled chart and app fonts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads a selected face once, including italic canvas weights, and retries failures", async () => {
    const load = vi.fn().mockResolvedValue([{}]);
    vi.stubGlobal("document", { fonts: { load } });
    const first = ensureChartFontLoaded("Lora", "local");
    expect(ensureChartFontLoaded("Lora", "web")).toBe(first);
    expect(await first).toBe(true);
    expect(load).toHaveBeenCalledWith('600 12px "Lora"');
    expect(load).toHaveBeenCalledWith('italic 700 12px "Lora"');
    load.mockRejectedValueOnce(new Error("offline"));
    expect(await ensureChartFontLoaded("Geist")).toBe(false);
    expect(await ensureChartFontLoaded("Geist")).toBe(true);
  });

  it("ships every font, license, and CSS source in a clean checkout", () => {
    const css = readFileSync(new URL("../../styles/fonts.css", import.meta.url), "utf8");
    const globals = readFileSync(new URL("../../styles/globals.css", import.meta.url), "utf8");
    const manifest = JSON.parse(readFileSync(new URL("../../../public/fonts/manifest.json", import.meta.url), "utf8")) as { id: string; family: string; files: string[]; integrity: string }[];
    expect(manifest).toHaveLength(APP_FONTS.length);
    for (const entry of manifest) {
      expect(Object.values(FONT_CHOICES).some((font) => font.family === entry.family)).toBe(true);
      expect(css).toContain(`font-family: '${entry.family}'`);
      expect(entry.integrity).toMatch(/^sha512-/);
      expect(readFileSync(new URL(`../../../public/fonts/${entry.id}/LICENSE`, import.meta.url), "utf8")).toContain("SIL OPEN FONT LICENSE");
      for (const file of entry.files) {
        expect(css).toContain(`/fonts/${entry.id}/${file}`);
        expect(readFileSync(new URL(`../../../public/fonts/${entry.id}/${file}`, import.meta.url)).subarray(0, 4).toString()).toBe("wOF2");
      }
    }
    for (const id of APP_FONTS) expect(globals).toContain(`html[data-font="${id}"]`);
    expect(css).not.toContain("https://");
  });

  it("offers every face once and preserves exact selections in all legacy source modes", () => {
    expect(FONT_GROUPS.flatMap((group) => group.fonts).sort()).toEqual([...APP_FONTS].sort());
    for (const id of APP_FONTS) for (const faces of ["local", "auto", "web"] as const) {
      expect(resolveChartFontFamily(undefined, id, faces)).toBe(FONT_CHOICES[id].family);
      expect(resolveChartFontFamily(FONT_CHOICES[id].family, "inter", faces)).toBe(FONT_CHOICES[id].family);
    }
    expect(resolveChartFontFamily(" inherit ", "lora", "local")).toBe("Lora");
    expect(resolveChartFontFamily("Georgia", "inter", "local")).toBe("Georgia");
  });

  it("keeps category-correct fallbacks and safe canvas font syntax", () => {
    expect(chartFontStack("Lora")).toContain('Georgia, "Times New Roman", serif');
    expect(chartFontStack("Fira Code")).toContain("Menlo, Consolas, monospace");
    expect(chartFont(12, "ui-monospace")).toContain("12px ui-monospace,");
    expect(chartFont(12, "system-ui")).toContain("12px system-ui");
    expect(chartFont(12, 'A "quoted" font')).toContain('"A \\"quoted\\" font"');
  });
});
