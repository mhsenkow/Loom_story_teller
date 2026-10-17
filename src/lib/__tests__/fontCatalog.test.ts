import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_FONTS } from "../lookSystem";
import {
  FONT_CHOICES,
  FONT_GROUPS,
  chartFontStack,
  resolveChartFontFamily,
  ensureChartFontLoaded,
  ensureLookFontLoaded,
} from "../fontCatalog";
import { chartFont } from "../chartType";

describe("chart and app font catalog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads an explicitly chosen chart face once, requests canvas weights, and can retry a failed stylesheet", () => {
    type Link = { rel?: string; href?: string; onload?: () => void; onerror?: () => void; remove: ReturnType<typeof vi.fn> };
    const links: Link[] = [];
    const load = vi.fn().mockResolvedValue([]);
    vi.stubGlobal("document", {
      createElement: () => ({ remove: vi.fn() }),
      head: { appendChild: (link: Link) => links.push(link) },
      fonts: { load },
    });
    ensureLookFontLoaded("geist", "local");
    expect(links).toHaveLength(0);
    ensureChartFontLoaded("Lora", "web");
    ensureChartFontLoaded("Lora", "web");
    ensureLookFontLoaded("geist", "web");
    expect(links).toHaveLength(2);
    expect(links[0].href).toContain("family=Lora:");
    expect(links[1].href).toContain("family=Geist:");
    links[0].onload?.();
    expect(load).toHaveBeenCalledWith('600 12px "Lora"');
    links[1].onerror?.();
    expect(links[1].remove).toHaveBeenCalled();
    ensureLookFontLoaded("geist", "web");
    expect(links).toHaveLength(3);
  });
  it("provides CSS and matching device/download faces for every catalog entry", () => {
    const css = readFileSync(new URL("../../styles/globals.css", import.meta.url), "utf8");
    for (const id of APP_FONTS) {
      expect(css).toContain(`html[data-font="${id}"]`);
      expect(css).toContain(`html[data-faces="web"][data-font="${id}"]`);
      expect(resolveChartFontFamily(undefined, id, "local")).toBe(FONT_CHOICES[id].local);
      expect(resolveChartFontFamily(undefined, id, "web")).toBe(FONT_CHOICES[id].family);
    }
  });
  it("offers each supported font once in a readable category", () => {
    const grouped = FONT_GROUPS.flatMap((group) => group.fonts);
    expect([...grouped].sort()).toEqual([...APP_FONTS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const id of APP_FONTS) {
      expect(FONT_CHOICES[id].description.length).toBeGreaterThan(20);
      expect(FONT_CHOICES[id].query).toContain(
        `family=${FONT_CHOICES[id].family.replaceAll(" ", "+")}`,
      );
    }
  });

  it("inherits the app face unless the chart has its own choice", () => {
    expect(resolveChartFontFamily(undefined, "lora", "web")).toBe("Lora");
    expect(resolveChartFontFamily(undefined, "lora", "local")).toBe("Georgia");
    expect(resolveChartFontFamily("inherit", "jetbrains-mono", "auto")).toBe(
      "ui-monospace",
    );
    expect(resolveChartFontFamily("IBM Plex Sans", "lora", "web")).toBe(
      "IBM Plex Sans",
    );
  });

  it("keeps serif and mono fallbacks in the same family when offline", () => {
    expect(chartFontStack("Lora")).toContain(
      'Georgia, "Times New Roman", serif',
    );
    expect(chartFontStack("Fira Code")).toContain("Menlo, Consolas, monospace");
    expect(chartFont(12, "ui-monospace")).toContain("12px ui-monospace,");
    expect(chartFont(12, "system-ui")).toContain("12px system-ui");
    expect(chartFont(12, 'A "quoted" font')).toContain('"A \\"quoted\\" font"');
  });

  it("uses device faces even when an explicit chart font was previously downloaded", () => {
    expect(resolveChartFontFamily("Lora", "inter", "web")).toBe("Lora");
    expect(resolveChartFontFamily("Lora", "inter", "local")).toBe("Georgia");
    expect(resolveChartFontFamily("Fira Code", "lora", "auto")).toBe("ui-monospace");
    expect(resolveChartFontFamily(" inherit ", "lora", "local")).toBe("Georgia");
    expect(chartFontStack(resolveChartFontFamily("Lora", "inter", "local"))).toBe('Georgia, "Times New Roman", serif');
    expect(chartFontStack("system-ui")).toContain('"Segoe UI"');
  });
});
