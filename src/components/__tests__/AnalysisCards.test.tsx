import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, expect, it } from "vitest";
import AnalysisCards from "../detail/AnalysisCards";
import OverlaysTab from "../detail/OverlaysTab";
import { useLoomStore } from "@/lib/store";

beforeEach(() => {
  useLoomStore.getState().reset();
  useLoomStore.setState({
    activeChart: { id: "series", kind: "line", title: "Sales", subtitle: "", score: 1, spec: {}, xField: "date", yField: "sales", colorField: null },
    sampleRows: { columns: ["date", "sales"], types: ["DATE", "DOUBLE"], total_rows: 20, rows: Array.from({ length: 20 }, (_, i) => [new Date(Date.UTC(2026, 0, i + 1)).toISOString(), 10 + i]) },
  });
});
afterEach(cleanup);

it("applies, hides, removes and explains a forecast without removing anomalies", () => {
  render(<AnalysisCards />);
  fireEvent.click(screen.getByRole("button", { name: "Add forecast" }));
  fireEvent.click(screen.getByRole("button", { name: "Find anomalies" }));
  expect(useLoomStore.getState().smartResults?.analysis?.forecast?.horizon).toBe(7);
  fireEvent.click(screen.getByRole("button", { name: "Hide forecast" }));
  expect(useLoomStore.getState().smartResults?.analysis?.forecast?.enabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "About forecast" }));
  expect(screen.getByText("Full calculation code · TypeScript")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove forecast" }));
  expect(useLoomStore.getState().smartResults?.analysis?.forecast).toBeUndefined();
  expect(useLoomStore.getState().smartResults?.analysis?.anomaly?.enabled).toBe(true);
});

it("prevents analysis with too little filtered history or incompatible charts", () => {
  useLoomStore.setState({ tableFilterRowIndices: [0, 1, 2] });
  const { rerender } = render(<AnalysisCards />);
  expect((screen.getByRole("button", { name: "Add forecast" }) as HTMLButtonElement).disabled).toBe(true);
  useLoomStore.setState({ activeChart: { ...useLoomStore.getState().activeChart!, kind: "bar" } });
  rerender(<AnalysisCards />);
  expect(screen.getByText(/Choose a line chart/)).toBeTruthy();
});

it("validates event ranges and supports visibility and removal", () => {
  render(<OverlaysTab />);
  fireEvent.change(screen.getByLabelText("Event label"), { target: { value: "Launch" } });
  fireEvent.change(screen.getByLabelText("Start date / time"), { target: { value: "2026-01-10" } });
  fireEvent.change(screen.getByLabelText("End · optional"), { target: { value: "2026-01-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to chart" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("End · optional"), { target: { value: "2026-01-12" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to chart" }));
  expect(useLoomStore.getState().smartResults?.analysis?.events).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Hide" }));
  expect(useLoomStore.getState().smartResults?.analysis?.events?.[0].visible).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Remove Launch" }));
  expect(useLoomStore.getState().smartResults?.analysis?.events).toEqual([]);
});
