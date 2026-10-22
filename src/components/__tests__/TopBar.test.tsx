import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TopBar } from "../TopBar";
import { useLoomStore } from "@/lib/store";

beforeEach(() => useLoomStore.getState().reset());
afterEach(cleanup);

it("keeps shortcuts and theme off the phone top bar so Share fits", () => {
  render(<TopBar onOpenShortcuts={() => {}} />);
  const shortcuts = screen.getByRole("button", { name: "Keyboard shortcuts" });
  expect(shortcuts.className).toContain("hidden sm:flex");
  const theme = screen.getByTestId("topbar-theme");
  expect(theme.className).toContain("hidden sm:flex");
  expect(theme.querySelector("button")).not.toBeNull();
  expect(document.querySelector("header")?.className).toContain("overflow-hidden");
});
