import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChartKindPicker } from "../ChartKindPicker";
import type { ChartKind } from "@/lib/recommendations";

const support = (kind: ChartKind) =>
  kind === "histogram" ? { ok: false, reason: "Needs numeric Y" } : { ok: true, reason: "" };

describe("ChartKindPicker (LOOM-673)", () => {
  it("supports type-to-search, arrow skip, Enter, and Esc", () => {
    const onChange = vi.fn();
    render(<ChartKindPicker value="scatter" onChange={onChange} support={support} />);
    const trigger = screen.getByRole("button", { name: /Chart type/i });
    fireEvent.keyDown(trigger, { key: "b" });
    const input = screen.getByRole("combobox");
    expect(input).toHaveValue("b");
    fireEvent.change(input, { target: { value: "bar" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("opens the gallery on desktop and hands back the previewed chart", () => {
    cleanup();
    const real = globalThis.matchMedia;
    globalThis.matchMedia = ((query: string) => ({
      matches: query.includes("min-width: 1024px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof globalThis.matchMedia;
    try {
      const onChange = vi.fn();
      const previewed = { id: "p", kind: "bar", title: "", subtitle: "", score: 1, spec: {}, xField: "a", yField: null, colorField: null } as const;
      render(<ChartKindPicker value="scatter" onChange={onChange} support={support} previewFor={() => ({ ...previewed })} previewData={null} />);
      fireEvent.click(screen.getByRole("button", { name: /Chart type/i }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeTruthy();
      expect(screen.queryByRole("combobox")).toBeNull();
      // Unsupported kinds stay visible with their reason.
      expect(screen.getByRole("option", { name: /Histogram/ })).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(screen.getByRole("option", { name: /^Bar/ }));
      expect(onChange).toHaveBeenCalledWith("bar", expect.objectContaining({ id: "p", kind: "bar" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      globalThis.matchMedia = real;
    }
  });
});
