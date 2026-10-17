import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChartTheme } from "../useChartTheme";
import { useLoomStore } from "@/lib/store";

beforeEach(() => useLoomStore.getState().reset());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function ThemeReadout() { return <output data-testid="theme">{useChartTheme()}</output>; }

it("repaints System charts when the OS palette changes, and honors a named theme", () => {
  let dark = false;
  const listeners = new Set<() => void>();
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({
    get matches() { return dark; },
    media: "(prefers-color-scheme: dark)", onchange: null,
    addEventListener: (_: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener as () => void),
    removeEventListener: (_: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener as () => void),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => true,
  }));
  useLoomStore.getState().setAppSettings((s) => ({ ...s, theme: "system" }));
  render(<ThemeReadout />);
  expect(screen.getByTestId("theme")).toHaveTextContent("light");
  act(() => { dark = true; listeners.forEach((listener) => listener()); });
  expect(screen.getByTestId("theme")).toHaveTextContent("dark");
  act(() => useLoomStore.getState().setAppSettings((s) => ({ ...s, theme: "paper" })));
  expect(screen.getByTestId("theme")).toHaveTextContent("paper");
});
