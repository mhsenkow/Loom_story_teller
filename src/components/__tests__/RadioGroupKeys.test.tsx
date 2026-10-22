import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { onRadioGroupKeyDown, radioTabIndex } from "@/lib/radioGroupKeys";

afterEach(cleanup);

const SHAPES = ["Circle", "Square", "Triangle"];

function Group({ initial }: { initial: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <div role="radiogroup" aria-label="Shape" onKeyDown={onRadioGroupKeyDown}>
      {SHAPES.map((s, i) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          aria-label={s}
          tabIndex={radioTabIndex(value === s, i, value !== null)}
          onClick={() => setValue(s)}
        >
          *
        </button>
      ))}
    </div>
  );
}

describe("radio group arrow keys", () => {
  it("moves focus and selection with arrows, wrapping at the ends", () => {
    render(<Group initial="Circle" />);
    const circle = screen.getByRole("radio", { name: "Circle" });
    circle.focus();
    fireEvent.keyDown(circle, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Square" })).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Square" }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("radio", { name: "Triangle" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(screen.getByRole("radio", { name: "Circle" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "Triangle" })).toHaveAttribute("aria-checked", "true");
  });

  it("keeps exactly one Tab stop, even when nothing is checked", () => {
    render(<Group initial={null} />);
    const stops = screen.getAllByRole("radio").filter((r) => r.tabIndex === 0);
    expect(stops.map((r) => r.getAttribute("aria-label"))).toEqual(["Circle"]);
  });
});
