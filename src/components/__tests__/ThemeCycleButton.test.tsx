import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ThemeCycleButton } from "../ThemeCycleButton";
import { useLoomStore } from "@/lib/store";
import { THEMES, THEME_LABEL } from "@/lib/lookSystem";

beforeEach(() => useLoomStore.getState().reset());
afterEach(cleanup);

it("cycles every theme without changing chart edits or other settings", () => {
  const store = useLoomStore.getState();
  store.setAppSettings((s) => ({ ...s, theme: "light", colorblindCharts: true }));
  store.setChartVisualOverrides({ colorPalette: "viridis", lineWidth: 4 });
  render(<ThemeCycleButton />);
  for (const [index, theme] of THEMES.entries()) {
    const next = THEMES[(index + 1) % THEMES.length]!;
    fireEvent.click(screen.getByRole("button", { name: `Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}` }));
    expect(useLoomStore.getState().appSettings.theme).toBe(next);
    expect(useLoomStore.getState().appSettings.colorblindCharts).toBe(true);
    expect(useLoomStore.getState().chartVisualOverrides).toEqual({ colorPalette: "viridis", lineWidth: 4 });
  }
});
