import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import AnalysisNumberInput from "../AnalysisNumberInput";
import ChartAnalysisCard from "../detail/ChartAnalysisCard";
import { useLoomStore } from "@/lib/store";
import { trapTabKey } from "@/lib/focusTrap";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => useLoomStore.getState().reset());
function NumberHarness() {
  const [value, setValue] = useState(7);
  return <><AnalysisNumberInput label="Intervals" value={value} min={1} max={50} onCommit={setValue} /><output>{value}</output><button>Next</button></>;
}
it("keeps blank and multi-digit drafts, commits bounds on blur and restores an empty edit", () => {
  render(<NumberHarness />); const input = screen.getByLabelText("Intervals");
  fireEvent.change(input, { target: { value: "" } }); expect(input).toHaveValue(null);
  expect(screen.getByRole("status")).toHaveTextContent("7");
  fireEvent.change(input, { target: { value: "24" } }); fireEvent.blur(input);
  expect(screen.getByRole("status")).toHaveTextContent("24");
  fireEvent.change(input, { target: { value: "100" } }); fireEvent.blur(input); expect(input).toHaveValue(50);
  fireEvent.change(input, { target: { value: "" } }); fireEvent.blur(input); expect(input).toHaveValue(50);
});
it("ignores Tab in another modal, leaving the explanation in control", () => {
  const parent = document.createElement("aside"), child = document.createElement("aside"), button = document.createElement("button");
  parent.setAttribute("role", "dialog"); child.setAttribute("role", "dialog"); child.append(button); document.body.append(parent, child);
  const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  button.dispatchEvent(event);
  expect(trapTabKey(parent, event)).toBe(false); expect(event.defaultPrevented).toBe(false);
  parent.remove(); child.remove();
});
it("offers a working reset when filters hide every row", () => {
  useLoomStore.setState({ activeChart: { id: "a", kind: "bar", xField: "x", yField: "y", title: "", subtitle: "", score: 1, spec: {}, colorField: null },
    sampleRows: { columns: ["x", "y"], types: ["VARCHAR", "DOUBLE"], rows: [["A", 10]], total_rows: 1 }, tableColumnFilters: { x: "not here" } });
  render(<ChartAnalysisCard />);
  expect(screen.getByRole("heading", { name: "No rows in this view" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Find chart anomalies" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reset view filters" }));
  expect(useLoomStore.getState().tableColumnFilters).toEqual({});
  expect(screen.getByRole("button", { name: "Find chart anomalies" })).toBeInTheDocument();
  act(() => useLoomStore.setState({ sampleRows: { columns: ["x", "y"], types: ["VARCHAR", "DOUBLE"], rows: [], total_rows: 0 } }));
  expect(screen.getByRole("heading", { name: "No data to analyze yet" })).toBeInTheDocument();
});
