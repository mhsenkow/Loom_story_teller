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
  it("changes space use and restores automatic sizing as one undoable edit", () => {
    useLoomStore.setState({ chartVisualOverrides: { canvasWidth: .6, plotX: .2, plotY: .2, plotWidth: .5, plotHeight: .5, titleItalic: true } });
    render(<ChartPanelTab />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    fireEvent.click(screen.getByRole("button", { name: "Layout" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Space use" }), { target: { value: "fill" } });
    expect(useLoomStore.getState().chartVisualOverrides.spaceUse).toBe("fill");
    expect(useLoomStore.getState().chartVisualOverrides.canvasWidth).toBe(.6);
    fireEvent.click(screen.getByRole("button", { name: "Restore automatic sizing" }));
    expect(useLoomStore.getState().chartVisualOverrides.canvasWidth).toBeUndefined();
    expect(useLoomStore.getState().chartVisualOverrides.plotWidth).toBeUndefined();
    expect(useLoomStore.getState().chartVisualOverrides.titleItalic).toBe(true);
    act(() => useLoomStore.getState().undoChartEdit());
    expect(useLoomStore.getState().chartVisualOverrides.canvasWidth).toBe(.6);
    expect(useLoomStore.getState().chartVisualOverrides.spaceUse).toBe("fill");
  });

  it("previews the current title, weight, italic, size, and effective device font", () => {
    render(<ChartPanelTab />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    fireEvent.click(screen.getByRole("button", { name: "Typography" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Font family" }), { target: { value: "Lora" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Chart text size" }), { target: { value: "16" } });
    fireEvent.click(screen.getByRole("radio", { name: "Bold" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Title italic" }));
    act(() => useLoomStore.setState({ chartTitleOverrides: { bar: "Revenue by region" } }));
    const sample = screen.getByRole("group", { name: "Chart typography sample" });
    expect(sample).toHaveStyle({ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: "16px" });
    expect(screen.getByTitle("Revenue by region")).toHaveStyle({ fontWeight: "700", fontStyle: "italic", fontSize: "22px" });
    expect(screen.getByText(/Device typeface: Georgia/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Font settings" }));
    expect(useLoomStore.getState().panelTab).toBe("settings");
  });

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


it("keeps accessible Auto and explicit palette selection connected to undo", () => {
  useLoomStore.getState().setAppSettings((s) => ({ ...s, colorblindCharts: true }));
  render(<ChartPanelTab />);
  fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
  fireEvent.click(screen.getByRole("button", { name: "Sequential" }));
  expect(screen.getByText(/Applied · cividis/)).toBeTruthy();
  expect(useLoomStore.getState().chartVisualOverrides).toMatchObject({ colorPalette: "auto", colorScaleKind: "sequential" });
  const explicit = screen.getByRole("button", { name: "Sequential Blue Sequential" });
  fireEvent.click(explicit);
  expect(explicit.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText(/Applied · seq-blue/)).toBeTruthy();
  act(() => useLoomStore.getState().undoChartEdit());
  expect(screen.getByText(/Applied · cividis/)).toBeTruthy();
});

it("keeps Analyze and Overlays in the chart section navigation with icons and keyboard access", async () => {
  render(<ChartPanelTab />);
  for (const name of ["Encoding", "Visual", "Analyze", "Overlays"]) {
    expect(screen.getByRole("tab", { name }).querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  }
  fireEvent.click(screen.getByRole("tab", { name: "Analyze" }));
  expect(await screen.findByRole("heading", { name: "Go beyond the line" })).toBeInTheDocument();
  expect(useLoomStore.getState().panelTab).toBe("chart");
  fireEvent.keyDown(screen.getByRole("tab", { name: "Analyze" }), { key: "ArrowRight" });
  expect(await screen.findByRole("heading", { name: "What else was happening?" })).toBeInTheDocument();
  expect(useLoomStore.getState().chartPanelSection).toBe("overlays");
  fireEvent.keyDown(screen.getByRole("tab", { name: "Overlays" }), { key: "Home" });
  expect(useLoomStore.getState().chartPanelSection).toBe("encoding");
});
