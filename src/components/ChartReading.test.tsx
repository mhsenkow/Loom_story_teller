import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChartReading } from "./ChartReading";
import type { ChartReading as Reading } from "@/lib/chartReading";
afterEach(cleanup);
const reading: Reading = {
  headline: "West is highest at 420.", context: "Average sales · 2 categories shown.", guide: "Compare the ends of the bars.",
  facts: [{ title: "Highest", label: "West", value: "420", hit: { shape: "circle", cx: 1, cy: 1, r: 3, match: [[0, "West"]] } }],
};
describe("ChartReading", () => {
  it("exposes the pinned state and removal action", () => {
    const { container } = render(<ChartReading reading={reading} onShow={vi.fn()} onTable={vi.fn()} isPinned={() => true} />);
    container.querySelector("details")!.open = true;
    expect(screen.getByRole("button", { name: "Unpin highest: West, 420" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Pinned · tap to remove")).toBeTruthy();
  });
  it("starts compact with a native keyboard-operable disclosure", () => {
    const { container } = render(<ChartReading reading={reading} onShow={vi.fn()} onTable={vi.fn()} />);
    expect(container.querySelector("details")!.open).toBe(false);
    expect(container.querySelector("summary")!.textContent).toContain("West is highest at 420.");
  });
  it("pins the exact drawn mark and opens the data table", () => {
    const onShow = vi.fn(), onTable = vi.fn();
    const { container } = render(<ChartReading reading={reading} onShow={onShow} onTable={onTable} />);
    container.querySelector("details")!.open = true;
    fireEvent.click(screen.getByRole("button", { name: "Pin highest: West, 420" }));
    expect(onShow).toHaveBeenCalledWith(reading.facts[0].hit);
    fireEvent.click(screen.getByRole("button", { name: "See the numbers" }));
    expect(onTable).toHaveBeenCalledOnce();
  });
});
