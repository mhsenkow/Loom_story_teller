import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataCubePivotBar, DataCubePivotTable } from "../DataCubePivot";
import { ChartTooltipCard } from "../ChartTooltipCard";
import { SuiteMenu } from "../SuiteMenu";
import { useLoomStore } from "@/lib/store";
import { contrastRatio } from "@/lib/wcagColor";
import { buildDataCube, type PivotTable } from "@/lib/dataCube";

vi.mock("@/lib/useMediaQuery", () => ({ useIsMobile: () => true }));
vi.mock("../CommandPalette", () => ({ CommandPalette: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="Commands" /> : null }));

afterEach(() => { cleanup(); useLoomStore.getState().reset(); });

describe("chart readout typography", () => {
  it("keeps pivoting and slice selection available behind compact phone controls", () => {
    const cube = buildDataCube([["East", "Apples", "2026"], ["West", "Pears", "2025"]], ["region", "product", "year"], { xField: "region", yField: "product", zField: "year" })!;
    const swap = vi.fn(), slice = vi.fn();
    render(<DataCubePivotBar cube={cube} ramp={[]} showLegend slice={null} tableOpen={false} onSlice={slice} onToggleTable={() => {}} onSwap={swap} onRotate={() => {}} onReplace={() => {}} fontFamily="Lora" axisFontSize={16} />);
    const toggle = screen.getByRole("button", { name: "Pivot controls" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Rows: region" }));
    fireEvent.click(screen.getByRole("button", { name: "Depth: year" }));
    expect(swap).toHaveBeenCalledWith("x", "z");
    fireEvent.click(screen.getByRole("button", { name: "Next slice" }));
    expect(slice).toHaveBeenCalledWith(0);
  });

  it("preserves long cube headers, selected type, missing values, and contrast on shaded cells", () => {
    const table: PivotTable = {
      rowField: "Long region name", colField: "Reporting period", depthField: "Category", sliceLabel: null,
      rows: ["North America — extended region"], cols: ["Annual reporting period 2026", "No observations"], values: [[100, null]],
      rowTotals: [100], colTotals: [100, null], grand: 100, vMin: 0, vMax: 100, valueLabel: "Revenue",
    };
    const hover = vi.fn();
    render(<DataCubePivotTable table={table} ramp={["#888888", "#ffcc00"]} hover={null} onHover={hover} themeBg="#101014" themeText="#ececf1" fontFamily="Lora" axisFontSize={16} />);
    const grid = screen.getByRole("table", { name: "Revenue by Long region name and Reporting period" });
    expect(grid.closest(".loom-cube-type")).toHaveStyle({ fontSize: "16px", fontFamily: '"Lora", Georgia, "Times New Roman", serif' });
    expect(screen.getByRole("columnheader", { name: table.cols[0] })).toHaveAttribute("scope", "col");
    expect(screen.getByRole("rowheader", { name: table.rows[0] })).toHaveAttribute("scope", "row");
    const filled = screen.getByTitle(`${table.rows[0]} · ${table.cols[0]}: 100`);
    expect(contrastRatio(filled.style.color, filled.style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    fireEvent.mouseEnter(filled);
    expect(hover).toHaveBeenLastCalledWith({ xi: 0, yi: 0, zi: null });
    const empty = screen.getByTitle(`${table.rows[0]} · ${table.cols[1]}: No value`);
    expect(empty).toHaveTextContent("—");
    fireEvent.mouseEnter(empty);
    expect(hover).toHaveBeenLastCalledWith(null);
  });

  it("makes pinned values readable in the chart face and dismissible by keyboard", () => {
    const dismiss = vi.fn();
    render(<ChartTooltipCard tip={{ clientX: 3000, clientY: 3000, rowIndex: 0, row: ["Long value with 👩🏽‍🔬 and accents é", 12345.67], columns: ["A detailed category name", "Measurement"] }} presentation="hover" pinned fontFamily="Lora" axisFontSize={16} onDismiss={dismiss} />);
    const readout = screen.getByRole("group", { name: "Pinned chart values" });
    expect(readout).toHaveStyle({ fontSize: "16px", fontFamily: '"Lora", Georgia, "Times New Roman", serif' });
    expect(screen.getByText("Long value with 👩🏽‍🔬 and accents é")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "Dismiss pinned tooltip" }), { key: "Escape" });
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("keeps commands available while removing the floating tools from the phone editor", () => {
    useLoomStore.setState({ panelOpen: true });
    render(<SuiteMenu />);
    expect(screen.queryByRole("navigation", { name: "ibm.io tools" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Commands" })).toBeInTheDocument();
    act(() => useLoomStore.setState({ panelOpen: false }));
    expect(screen.getByRole("button", { name: "Search and commands" })).toBeInTheDocument();
  });
});
