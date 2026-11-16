import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it } from "vitest";
import ChartAnalysisCard from "../detail/ChartAnalysisCard";
import { CHART_DEFINITION_LIST } from "@/lib/chartDefinitions";
import { useLoomStore } from "@/lib/store";
import type { ChartKind } from "@/lib/recommendations";

function setup(kind: ChartKind = "bar") {
  useLoomStore.setState({
    activeChart: { id: "test", kind, title: "Values", subtitle: "", score: 1, spec: {}, xField: kind === "bar" ? "category" : "x", yField: "y", zField: "z", colorField: null },
    sampleRows: { columns: ["category", "x", "y", "z", "date"], types: ["VARCHAR", "DOUBLE", "DOUBLE", "DOUBLE", "DATE"], total_rows: 12, rows: Array.from({ length: 12 }, (_, i) => [`C${i}`, i, i === 11 ? 100 : 10, i === 11 ? 200 : 5, new Date(Date.UTC(2026, 0, i + 1)).toISOString()]) },
  });
}
beforeEach(() => { useLoomStore.getState().reset(); setup(); });
afterEach(cleanup);

it("runs, hides, restores and removes detection; filters by original sample row", () => {
  useLoomStore.setState({ tableFilterRowIndices: [1, 3, 5, 7, 9, 11] });
  render(<ChartAnalysisCard />);
  fireEvent.click(screen.getByRole("button", { name: "Find chart anomalies" }));
  expect(screen.getByText(/1 unusual observations among 6/)).toBeTruthy();
  expect(screen.getByText("C11")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hide detection" }));
  expect(screen.getByText("Detection hidden.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show detection" }));
  fireEvent.click(screen.getByRole("button", { name: "Filter table to contributing rows" }));
  expect(useLoomStore.getState().tableFilterRowIndices).toEqual([11]);
  fireEvent.click(screen.getByRole("button", { name: "Clear row selection filter" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove detection" }));
  expect(useLoomStore.getState().smartResults?.chartAnomaly).toBeNull();
});
it("shows a dated forecast from a 3D chart and responds to every preview parameter", () => {
  setup("scatter3d"); render(<ChartAnalysisCard />);
  fireEvent.change(screen.getByLabelText("Forecast order"), { target: { value: "date" } });
  fireEvent.change(screen.getByLabelText("Forecast preview intervals"), { target: { value: "3" } });
  fireEvent.blur(screen.getByLabelText("Forecast preview intervals"));
  fireEvent.click(screen.getByRole("button", { name: "Preview extrapolation" }));
  const forecast = screen.getByRole("region", { name: "Forecast source data" });
  expect(within(forecast).getAllByRole("row")).toHaveLength(4);
  expect(within(forecast).getByText("2026-01-13T00:00:00.000Z")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Forecast preview method"), { target: { value: "seasonal" } });
  expect(within(forecast).getByRole("status")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Forecast cycle length"), { target: { value: "4" } });
  fireEvent.blur(screen.getByLabelText("Forecast cycle length"));
  expect(within(forecast).getAllByRole("row")).toHaveLength(4);
  fireEvent.change(screen.getByLabelText("Forecast aggregate"), { target: { value: "count" } });
  expect(within(forecast).getAllByRole("row")[1].textContent).toContain("1");
});
it("does not offer category positions as forecast order or leak another chart's flags", () => {
  render(<ChartAnalysisCard />);
  expect((screen.getByRole("button", { name: "Preview extrapolation" }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(screen.getByLabelText("Forecast order")).queryByRole("option", { name: "category" })).toBeNull();
  useLoomStore.setState({ smartResults: { chartAnomaly: { scope: "other", enabled: true, method: "mad", threshold: 1, window: 5 } } });
  expect(screen.queryByRole("button", { name: "Hide detection" })).toBeNull();
});
it.each(CHART_DEFINITION_LIST)("$kind exposes working analysis through its catalog policy", ({ kind }) => {
  setup(kind); render(<ChartAnalysisCard />);
  fireEvent.change(screen.getByLabelText("Analysis observations"), { target: { value: "y" } });
  fireEvent.click(screen.getByRole("button", { name: "Find chart anomalies" }));
  expect(useLoomStore.getState().smartResults?.chartAnomaly?.field).toBe("y");
  expect(screen.getByText(/1 unusual observations among 12/)).toBeTruthy();
  expect(screen.getByText(/Evidence below; no mark overlay/)).toBeTruthy();
});
