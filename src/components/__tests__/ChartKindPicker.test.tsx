import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
});
