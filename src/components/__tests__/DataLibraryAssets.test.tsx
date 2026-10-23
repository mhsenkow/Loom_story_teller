import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useLoomStore } from "@/lib/store";
import { DataLibraryAssets } from "../DataLibraryAssets";
import { emptyDataLibrary, assetForFile } from "@/lib/dataLibrary";
import { emptySourcePreferences } from "@/lib/sourcePreferences";
import { DataCombinationBuilder } from "../DataCombinationBuilder";
import { loadLibraryAsset } from "@/lib/dataLibraryRuntime";
vi.mock("@/lib/dataLibraryRuntime", () => ({
  loadLibraryAsset: vi.fn(),
  openCombination: vi.fn(),
}));
const file = {
  path: "web://file/observations.csv",
  name: "observations.csv",
  extension: "csv",
  row_count: 3,
  size_bytes: 20,
};
const lookup = { ...file, path: "web://file/lookup.csv", name: "lookup.csv" };
beforeEach(() => {
  useLoomStore.setState({
    files: [file, lookup],
    recentFiles: [],
    selectedFile: null,
    dataLibrary: emptyDataLibrary(),
    sourcePrefs: emptySourcePreferences(),
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("Data library journey", () => {
  it("collects an upload into a temporary collection and can remove it", () => {
    const view = render(<DataLibraryAssets section="mine" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Collect observations.csv" }),
    );
    expect(useLoomStore.getState().dataLibrary.assets[0].file?.path).toBe(
      file.path,
    );
    expect(useLoomStore.getState().dataLibrary.collections[0]).toMatchObject({
      intent: "observations.csv",
      span: 3,
    });
    view.rerender(<DataLibraryAssets section="saved" />);
    expect(screen.getByRole("heading", { name: "observations.csv" })).toBeInTheDocument();
    expect(screen.queryByText("lookup.csv")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove collection" }));
    expect(screen.getByText("A collection is a reason")).toBeInTheDocument();
  });
  it("searches locally and enables combine only for two selected datasets", () => {
    render(<DataLibraryAssets section="mine" />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "lookup" },
    });
    expect(
      screen.queryByRole("button", { name: "observations.csv" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(
      screen.getByLabelText("Select observations.csv to combine"),
    );
    expect(
      screen.getByRole("button", { name: "Combine 1 selected" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Select lookup.csv to combine"));
    fireEvent.click(screen.getByRole("button", { name: "Combine 2 selected" }));
    expect(
      screen.getByRole("heading", { name: "Bring two sources together" }),
    ).toHaveFocus();
  });
  it("requires a validated preview and name before saving a source-connected recipe", async () => {
    vi.mocked(loadLibraryAsset).mockImplementation(async (a) => ({
      stats: [],
      sample: {
        columns: ["id"],
        types: ["VARCHAR"],
        rows: a.name === file.name ? [["A"], ["B"]] : [["A"]],
        total_rows: a.name === file.name ? 2 : 1,
      },
    }));
    const onClose = vi.fn();
    render(
      <DataCombinationBuilder
        assets={[assetForFile(file), assetForFile(lookup)]}
        initialRefs={[assetForFile(file).ref, assetForFile(lookup).ref]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load fields" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Preview match" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview match" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 matched · 1 unmatched · 2 result rows",
    );
    expect(
      screen.getByRole("button", { name: "Save combination" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Combination name"), {
      target: { value: "Regional observations" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save combination" }));
    expect(useLoomStore.getState().dataLibrary.combinations[0]).toMatchObject({
      name: "Regional observations",
      left: { ref: assetForFile(file).ref },
      right: { ref: assetForFile(lookup).ref },
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
