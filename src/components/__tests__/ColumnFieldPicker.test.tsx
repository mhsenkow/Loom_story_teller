import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ColumnFieldPicker } from "../ColumnFieldPicker";

afterEach(cleanup);

const options = [
  { value: "blocked", label: "blocked", type: "VARCHAR", disabled: true },
  { value: "sales", label: "sales", type: "DOUBLE" },
  { value: "empty", label: "empty", type: "DOUBLE" },
  { value: "region", label: "region", type: "VARCHAR" },
];

describe("ColumnFieldPicker", () => {
  it("shows an inline type badge inside the trigger", () => {
    render(
      <ColumnFieldPicker
        value="sales"
        options={options}
        onChange={vi.fn()}
        ariaLabel="X field"
        typeBadge="#"
        typeBadgeTitle="DOUBLE"
      />,
    );
    const trigger = screen.getByRole("button", { name: "X field" });
    expect(trigger).toHaveTextContent("#");
    expect(trigger.querySelector('[title="DOUBLE"]')).toBeTruthy();
  });

  it("keeps a mobile popup inside its dialog for screen readers and the focus trap", () => {
    const outerEscape = vi.fn();
    render(
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit chart"
        onKeyDown={outerEscape}
      >
        <ColumnFieldPicker
          value="sales"
          options={options}
          onChange={vi.fn()}
          ariaLabel="X field"
        />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "X field" }));
    expect(screen.getByRole("dialog")).toContainElement(
      screen.getByRole("combobox"),
    );
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(outerEscape).not.toHaveBeenCalled();
  });
  it("keeps arrow navigation stable with None enabled and skips incompatible fields", () => {
    const onChange = vi.fn();
    render(
      <ColumnFieldPicker
        value=""
        options={options}
        onChange={onChange}
        allowEmpty
        ariaLabel="Y field"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Y field" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const input = screen.getByRole("combobox", {
      name: "Search Y field columns",
    });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: /sales/ }).id,
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("sales");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("distinguishes keyboard focus from the selected field and uses unique option IDs", () => {
    render(
      <ColumnFieldPicker
        value="sales"
        options={options}
        onChange={vi.fn()}
        allowEmpty
        ariaLabel="X field"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "X field" }));
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "End" });
    expect(screen.getByRole("option", { name: /sales/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: /region/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    const ids = screen.getAllByRole("option").map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    fireEvent.keyDown(input, { key: "Home" });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: "None" }).id,
    );
  });

  it("allows tabbing to filters, returns to search on filter click, and dismisses on outside focus", () => {
    render(
      <>
        <ColumnFieldPicker
          value="sales"
          options={options}
          onChange={vi.fn()}
          ariaLabel="X field"
        />
        <button>Next control</button>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "X field" }));
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Tab" });
    const filter = screen.getByRole("button", { name: "#" });
    act(() => filter.focus());
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.click(filter);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(input).toHaveFocus();
    act(() => screen.getByRole("button", { name: "Next control" }).focus());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not pick a disabled or missing search result", () => {
    const onChange = vi.fn();
    render(
      <ColumnFieldPicker
        value="sales"
        options={options}
        onChange={onChange}
        ariaLabel="X field"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "X field" }));
    const input = screen.getByRole("combobox");
    for (const query of ["blocked", "missing"]) {
      fireEvent.change(input, { target: { value: query } });
      expect(input).not.toHaveAttribute("aria-activedescendant");
      fireEvent.keyDown(input, { key: "Enter" });
    }
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
