import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChartLookLibrary } from "../ChartLookLibrary";
import { ChartEditToolbar } from "../ChartEditToolbar";
import { useLoomStore } from "@/lib/store";

beforeEach(() => useLoomStore.getState().reset());
afterEach(cleanup);

describe("personal look workflow", () => {
  it("saves and applies a named look, then offers Undo and Redo", () => {
    useLoomStore.getState().setChartVisualOverrides({ opacity: 0.4 });
    render(
      <>
        <ChartLookLibrary />
        <ChartEditToolbar />
      </>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Look name" }), {
      target: { value: "Soft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save look" }));
    expect(screen.getByRole("textbox", { name: "Look name" })).toHaveValue("");
    act(() =>
      useLoomStore.getState().setChartVisualOverrides({ opacity: 0.9 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Soft" }));
    expect(useLoomStore.getState().chartVisualOverrides.opacity).toBe(0.4);
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    expect(useLoomStore.getState().chartVisualOverrides.opacity).toBe(0.9);
    fireEvent.click(screen.getByRole("button", { name: /Redo/ }));
    expect(useLoomStore.getState().chartVisualOverrides.opacity).toBe(0.4);
    fireEvent.change(screen.getByRole("textbox", { name: "Look name" }), {
      target: { value: "soft" },
    });
    expect(
      screen.getByRole("button", { name: "Update look" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("replaces");
    fireEvent.click(screen.getByRole("button", { name: "Remove Soft look" }));
    expect(useLoomStore.getState().customChartLooks).toEqual([]);
  });
});
