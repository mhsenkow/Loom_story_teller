import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExplorerView } from "../ExplorerView";
import { DiveView } from "../DiveView";
import { useLoomStore } from "@/lib/store";
import { defaultDiveQuery, profileDiveColumns } from "@/lib/dive";

vi.mock("@/lib/useMediaQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/useMediaQuery")>()),
  useIsMobile: () => true,
}));

const sample = {
  columns: ["city", "revenue"],
  types: ["VARCHAR", "DOUBLE"],
  rows: [
    ["Paris", 12],
    ["London", 20],
  ],
  total_rows: 2,
};

beforeEach(() => {
  useLoomStore.getState().reset();
  useLoomStore.setState({
    selectedFile: {
      path: "web://cities.csv",
      name: "cities.csv",
      extension: "csv",
      size_bytes: 20,
      row_count: 2,
    },
    sampleRows: sample,
    columnStats: [
      {
        name: "city",
        data_type: "VARCHAR",
        null_count: 0,
        distinct_count: 2,
        min_value: null,
        max_value: null,
      },
      {
        name: "revenue",
        data_type: "DOUBLE",
        null_count: 0,
        distinct_count: 2,
        min_value: "12",
        max_value: "20",
      },
    ],
  });
});
afterEach(cleanup);

describe("reconciled Claude mobile work", () => {
  it("reorders columns with touch controls and keeps table undo", () => {
    render(<ExplorerView />);
    fireEvent.click(
      screen.getByRole("button", { name: "Choose which columns to show" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Move city right" }));
    expect(useLoomStore.getState().tablePrefs.columnOrder).toEqual([
      "revenue",
      "city",
    ]);
    act(() => useLoomStore.getState().undoTable());
    expect(useLoomStore.getState().tablePrefs.columnOrder).toBeNull();
  });
  it("lets phone users exclude a sample value without an Alt key", async () => {
    const query = defaultDiveQuery(profileDiveColumns(sample));
    useLoomStore.setState({
      diveQuery: {
        src: "web://cities.csv",
        query: { ...query, view: "samples", range: "all" },
      },
    });
    render(<DiveView />);
    const exclude = await screen.findByRole("button", {
      name: "Exclude",
    });
    fireEvent.click(exclude);
    fireEvent.click(screen.getByRole("button", { name: "Paris" }));
    expect(useLoomStore.getState().diveQuery?.query.filters).toContainEqual({
      column: "city",
      op: "!=",
      values: ["Paris"],
    });
  });
});
