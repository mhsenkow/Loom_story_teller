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
import { CHART_KIND_OPTIONS } from "@/lib/recommendations";

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

describe("full chart catalog inspector", () => {
  it.each(CHART_KIND_OPTIONS)("$label opens every editor section", ({ value: kind }) => {
    useLoomStore.setState(s => ({
      chartPanelSection: "encoding",
      activeChart: { ...s.activeChart!, id: kind, kind },
    }));
    render(<ChartPanelTab />);
    for (const name of ["Fields", "Visual", "Analyze", "Overlays"]) {
      const tab = screen.getByRole("tab", { name });
      fireEvent.click(tab);
      expect(tab).toHaveAttribute("aria-selected", "true");
      expect(document.getElementById(tab.getAttribute("aria-controls")!)).toBeVisible();
    }
  });
});

it("dropping a heat measure switches from counts to its average as one undoable edit", () => {
  useLoomStore.setState(s => ({
    chartPanelSection: "encoding",
    activeChart: { ...s.activeChart!, kind: "heatmap", xField: "city", yField: "city", colorField: null, yAggregate: "count" },
  }));
  render(<ChartPanelTab />);
  const heat = document.getElementById("loom-chrome-color")!;
  expect(heat).toBeTruthy();
  fireEvent.drop(heat, { dataTransfer: { getData: () => "revenue" } });
  expect(useLoomStore.getState().activeChart).toMatchObject({ colorField: "revenue", yAggregate: "mean" });
  act(() => useLoomStore.getState().undoChartEdit());
  expect(useLoomStore.getState().activeChart).toMatchObject({ colorField: null, yAggregate: "count" });
});

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

  it("previews the current title, weight, italic, size, and selected bundled font", () => {
    render(<ChartPanelTab />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    fireEvent.click(screen.getByRole("button", { name: "Typography" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Font family" }));
    fireEvent.click(screen.getByRole("option", { name: /Lora/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Chart text size" }), { target: { value: "16" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Title weight" }), { target: { value: "700" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Title italic" }));
    act(() => useLoomStore.setState({ chartTitleOverrides: { bar: "Revenue by region" } }));
    const sample = screen.getByRole("group", { name: "Chart typography sample" });
    expect(sample).toHaveStyle({ fontFamily: '"Lora", Georgia, "Times New Roman", serif', fontSize: "16px" });
    expect(screen.getByTitle("Revenue by region")).toHaveStyle({ fontWeight: "700", fontStyle: "italic", fontSize: "22px" });
    expect(useLoomStore.getState().chartVisualOverrides.fontFamily).toBe("Lora");
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
    expect(screen.getByText(/No palettes match/)).toBeInTheDocument();
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
  fireEvent.change(screen.getByRole("combobox", { name: "Browse palettes" }), { target: { value: "sequential" } });
  expect(useLoomStore.getState().chartVisualOverrides).toEqual({});
  const explicit = screen.getByRole("button", { name: /Sequential Blue/ });
  fireEvent.click(explicit);
  expect(explicit.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText(/Applied · Sequential Blue/)).toBeTruthy();
  act(() => useLoomStore.getState().undoChartEdit());
  expect(screen.getByText(/Applied · Okabe–Ito/)).toBeTruthy();

});

it("chunks color from Fields → Group into", () => {
  useLoomStore.setState({
    chartPanelSection: "encoding",
    activeChart: {
      id: "swarm",
      kind: "beeswarm",
      title: "Swarm",
      subtitle: "",
      score: 80,
      xField: "city",
      yField: "revenue",
      colorField: "sku",
      spec: {},
    },
    columnStats: [
      { name: "city", data_type: "VARCHAR", null_count: 0, distinct_count: 4, min_value: null, max_value: null },
      { name: "revenue", data_type: "DOUBLE", null_count: 0, distinct_count: 20, min_value: "1", max_value: "20" },
      { name: "sku", data_type: "VARCHAR", null_count: 0, distinct_count: 140, min_value: null, max_value: null },
    ],
  });
  render(<ChartPanelTab />);
  expect(screen.getByText("sku has 140 values")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: /Group into/ }), { target: { value: "10" } });
  expect(useLoomStore.getState().activeChart?.groupInto).toBe(10);
  expect(useLoomStore.getState().activeChart?.colorField).toBe("sku");
});

it("keeps Analyze and Overlays in the chart section navigation with icons and keyboard access", async () => {
  render(<ChartPanelTab />);
  for (const name of ["Fields", "Visual", "Analyze", "Overlays"]) {
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


it("edits individual colors, validates hex, restores presets and undoes the change", () => {
  render(<ChartPanelTab />);
  fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
  fireEvent.click(screen.getByRole("button", { name: "Customize colors" }));
  expect(useLoomStore.getState().chartVisualOverrides.customColors?.split(",")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Color 1"), { target: { value: "#123456" } });
  expect(useLoomStore.getState().chartVisualOverrides.customColors).toBe("#123456");
  const hex = screen.getByRole("textbox", { name: "Color 1 hex" });
  fireEvent.change(hex, { target: { value: "oops" } });
  fireEvent.blur(hex);
  expect(hex).toHaveAttribute("aria-invalid", "true");
  expect(useLoomStore.getState().chartVisualOverrides.customColors).toBe("#123456");
  fireEvent.change(hex, { target: { value: "abc" } });
  fireEvent.blur(hex);
  expect(useLoomStore.getState().chartVisualOverrides.customColors).toBe("#aabbcc");
  fireEvent.click(screen.getByRole("button", { name: "Restore preset colors" }));
  expect(useLoomStore.getState().chartVisualOverrides.customColors).toBeUndefined();
  act(() => useLoomStore.getState().undoChartEdit());
  expect(useLoomStore.getState().chartVisualOverrides.customColors).toBe("#aabbcc");
});

it("fits a categorical palette to the selected field without hiding other presets", () => {
  useLoomStore.setState((s) => ({ activeChart: { ...s.activeChart!, colorField: "city" } }));
  render(<ChartPanelTab />);
  fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
  fireEvent.click(screen.getByRole("button", { name: "Use 3 colors for city" }));
  expect(useLoomStore.getState().chartVisualOverrides.customColors?.split(",")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: /Viridis/ }));
  expect(useLoomStore.getState().chartVisualOverrides.customColors).toBeUndefined();
  expect(screen.getByRole("button", { name: /Okabe–Ito/ })).toBeInTheDocument();
});

describe("typography editing journeys", () => {
  it("searches without editing, commits from the keyboard, and resets only typography in one undo step", () => {
    act(() => useLoomStore.setState({ chartVisualOverrides: { colorPalette: "warm", wordCloudGap: 10 } }));
    render(<ChartPanelTab />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    fireEvent.click(screen.getByRole("button", { name: "Typography" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Font family" }));
    const search = screen.getByRole("combobox", { name: "Search font family" });
    fireEvent.change(search, { target: { value: "fraunces" } });
    expect(useLoomStore.getState().chartVisualOverrides.fontFamily).toBeUndefined();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(useLoomStore.getState().chartVisualOverrides.fontFamily).toBe("Fraunces");
    expect(screen.queryByRole("listbox", { name: "Font family" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Font family" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Editorial" }));
    expect(useLoomStore.getState().chartVisualOverrides).toMatchObject({ fontFamily: "Source Serif 4", axisFontSize: 12 });
    act(() => useLoomStore.getState().undoChartEdit());
    expect(useLoomStore.getState().chartVisualOverrides.fontFamily).toBe("Fraunces");
    fireEvent.click(screen.getByRole("button", { name: "Reset typography" }));
    expect(useLoomStore.getState().chartVisualOverrides).toMatchObject({ colorPalette: "warm", wordCloudGap: 10 });
    expect(useLoomStore.getState().chartVisualOverrides.fontFamily).toBeUndefined();
    act(() => useLoomStore.getState().undoChartEdit());
    expect(useLoomStore.getState().chartVisualOverrides.fontFamily).toBe("Fraunces");
  });

  it("edits word-cloud appearance separately and preserves those settings through undo", () => {
    act(() => useLoomStore.setState({ activeChart: { ...useLoomStore.getState().activeChart!, kind: "wordCloud" }, chartVisualOverrides: { fontFamily: "Lora" } }));
    render(<ChartPanelTab />);
    fireEvent.change(screen.getByLabelText("Size contrast"), { target: { value: "log" } });
    fireEvent.change(screen.getByLabelText(/Word spacing/), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Word font" }));
    fireEvent.click(screen.getByRole("option", { name: /Manrope/ }));
    expect(useLoomStore.getState().chartVisualOverrides).toMatchObject({ fontFamily: "Lora", wordCloudFont: "Manrope", wordCloudGap: 12, wordCloudSizing: "log" });
    fireEvent.click(screen.getByRole("button", { name: "Reset word appearance" }));
    expect(useLoomStore.getState().chartVisualOverrides.fontFamily).toBe("Lora");
    expect(useLoomStore.getState().chartVisualOverrides.wordCloudGap).toBeUndefined();
    act(() => useLoomStore.getState().undoChartEdit());
    expect(useLoomStore.getState().chartVisualOverrides.wordCloudFont).toBe("Manrope");
  });
});
