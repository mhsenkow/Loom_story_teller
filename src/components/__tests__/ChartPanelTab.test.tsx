import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ChartPanelTab from "../detail/ChartPanelTab";
import { useLoomStore } from "@/lib/store";

beforeEach(() => {
  useLoomStore.getState().reset();
  useLoomStore.setState({
    chartPanelSection: "visual",
    activeChart: {
      id: "bar",
      kind: "bar",
      title: "Revenue",
      subtitle: "",
      score: 80,
      xField: "city",
      yField: "revenue",
      colorField: null,
      spec: { mark: "bar" },
    },
    columnStats: [
      {
        name: "city",
        data_type: "VARCHAR",
        null_count: 0,
        distinct_count: 3,
        min_value: null,
        max_value: null,
      },
      {
        name: "revenue",
        data_type: "DOUBLE",
        null_count: 0,
        distinct_count: 3,
        min_value: "12",
        max_value: "30",
      },
    ],
    sampleRows: {
      columns: ["city", "revenue"],
      types: ["VARCHAR", "DOUBLE"],
      rows: [
        ["Paris", 12],
        ["London", 30],
        ["Tokyo", 22],
      ],
      total_rows: 3,
    },
  });
});
afterEach(cleanup);

describe("Visual inspector", () => {
  it("collapses and expands all sections and applies a palette as one undoable edit", () => {
    render(<ChartPanelTab />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(
      screen.queryByRole("searchbox", { name: "Search color palettes" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    const search = screen.getByRole("searchbox", {
      name: "Search color palettes",
    });
    fireEvent.change(search, { target: { value: "viridis" } });
    const palette = screen.getByRole("button", { name: /viridis/i });
    fireEvent.click(palette);
    expect(useLoomStore.getState().chartVisualOverrides).toMatchObject({
      colorPalette: "viridis",
      colorScaleKind: "sequential",
    });
    expect(useLoomStore.getState().chartEditUndoStack).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    expect(useLoomStore.getState().chartVisualOverrides).toEqual({});
    fireEvent.change(search, { target: { value: "no matching color" } });
    expect(screen.getByRole("status")).toHaveTextContent("No palettes match");
  });

  it("opens a collapsed section when the chart directs focus to its grid controls", () => {
    render(<ChartPanelTab />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    act(() =>
      useLoomStore
        .getState()
        .setChartChromeFocus({
          section: "visual",
          target: "grid",
          source: "chart",
        }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Show grid" }),
    ).toBeInTheDocument();
  });
});
