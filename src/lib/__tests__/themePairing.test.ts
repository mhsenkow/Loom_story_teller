import { beforeEach, describe, expect, it } from "vitest";
import { useLoomStore } from "../store";
import { THEMES } from "../lookSystem";
import { THEME_PAIRINGS } from "../themePairing";
import { FONT_CHOICES, resolveChartFontFamily } from "../fontCatalog";

beforeEach(() => useLoomStore.getState().reset());
describe("coordinated looks", () => {
  it("keeps manual combinations until pairing is requested", () => {
    useLoomStore.getState().setAppSettings((s) => ({ ...s, theme: "paper", font: "fira-code", uiChrome: "ikea" }));
    expect(useLoomStore.getState().appSettings).toMatchObject({ font: "fira-code", uiChrome: "ikea" });
  });
  it("pairs every theme without changing downloads, accessibility, or chart overrides", () => {
    useLoomStore.getState().setChartVisualOverrides({ fontFamily: "Lora", lineWidth: 4 });
    useLoomStore.getState().setAppSettings((s) => ({ ...s, themePairing: true, faces: "local", colorblindCharts: true }));
    for (const theme of THEMES) {
      useLoomStore.getState().setAppSettings((s) => ({ ...s, theme }));
      const settings = useLoomStore.getState().appSettings;
      expect(settings).toMatchObject({ font: THEME_PAIRINGS[theme].font, uiChrome: THEME_PAIRINGS[theme].uiChrome, themePairing: true, faces: "local", colorblindCharts: true });
      expect(resolveChartFontFamily(undefined, settings.font, "web")).toBe(FONT_CHOICES[settings.font].family);
      expect(useLoomStore.getState().chartVisualOverrides).toEqual({ fontFamily: "Lora", lineWidth: 4 });
    }
  });
  it("releases pairing on a manual font change and can rejoin", () => {
    useLoomStore.getState().setAppSettings((s) => ({ ...s, theme: "paper", themePairing: true }));
    useLoomStore.getState().setAppSettings((s) => ({ ...s, font: "geist" }));
    expect(useLoomStore.getState().appSettings.themePairing).toBe(false);
    useLoomStore.getState().setAppSettings((s) => ({ ...s, theme: "tank" }));
    expect(useLoomStore.getState().appSettings.font).toBe("geist");
    useLoomStore.getState().setAppSettings((s) => ({ ...s, themePairing: true }));
    expect(useLoomStore.getState().appSettings.font).toBe("ibm-plex-mono");
  });
});
