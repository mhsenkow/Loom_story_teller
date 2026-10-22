/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryView } from "../QueryView";
import { useLoomStore } from "@/lib/store";

vi.mock("@/components/SqlEditor", () => ({
  SqlEditor: ({
    value,
    onChange,
    onRun,
  }: {
    value: string;
    onChange: (v: string) => void;
    onRun?: () => void;
  }) => (
    <textarea
      aria-label="SQL query"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.metaKey) onRun?.();
      }}
    />
  ),
}));

vi.mock("@/components/StartHere", () => ({ StartHere: () => null }));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return {
    ...actual,
    queryFile: vi.fn(),
    streamQuery: vi.fn(),
    sourceQuery: vi.fn(),
  };
});

describe("QueryView", () => {
  beforeEach(() => {
    useLoomStore.setState({
      selectedFile: {
        path: "web://uploads/a.csv",
        name: "a.csv",
        extension: "csv",
        row_count: 10,
        size_bytes: 100,
      },
      columnStats: [{ name: "trip_distance", data_type: "DOUBLE", null_count: 0, distinct_count: 10, min_value: null, max_value: null }],
      querySql: "",
      queryResult: null,
      queryError: null,
      isQuerying: false,
      queryHistory: [],
      querySnippets: [],
      querySnapshots: [],
      nlQueryInput: "",
    } as Partial<ReturnType<typeof useLoomStore.getState>>);
  });

  it("resets SQL when dataset path changes (LOOM-210)", () => {
    const { rerender } = render(<QueryView />);
    const ta = document.querySelector('[aria-label="SQL query"]') as HTMLTextAreaElement;
    act(() => {
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        ta,
        "SELECT * FROM wiki_stream",
      );
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      useLoomStore.setState({
        selectedFile: {
          path: "stream://usgs",
          name: "USGS",
          extension: "stream",
          row_count: 0,
          size_bytes: 0,
        },
      });
    });
    rerender(<QueryView />);
    const next = document.querySelector('[aria-label="SQL query"]') as HTMLTextAreaElement;
    expect(next.value.toLowerCase()).toMatch(/usgs/);
  });

  it("keeps SQL handed off before mount (saved views, Dive → Query)", () => {
    useLoomStore.setState({ querySql: "SELECT 1" });
    render(<QueryView />);
    const ta = document.querySelector('[aria-label="SQL query"]') as HTMLTextAreaElement;
    expect(ta.value).toBe("SELECT 1");
    expect(useLoomStore.getState().querySql).toBe("SELECT 1");
  });

  it("loads SQL handed off while the editor is already open", () => {
    render(<QueryView />);
    act(() => useLoomStore.setState({ querySql: "SELECT 2" }));
    const ta = document.querySelector('[aria-label="SQL query"]') as HTMLTextAreaElement;
    expect(ta.value).toBe("SELECT 2");
  });

  it("copies the displayed row after sorting", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    useLoomStore.setState({
      queryResult: { columns: ["name", "n"], types: ["VARCHAR", "BIGINT"], rows: [["b", 2], ["a", 1]], total_rows: 2 },
    } as Partial<ReturnType<typeof useLoomStore.getState>>);
    render(<QueryView />);
    fireEvent.click(document.querySelector("th button")!); // sort by name: a, b
    fireEvent.contextMenu(screen.getAllByText("a").find((el) => el.tagName === "TD")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy row" }));
    expect(writeText).toHaveBeenCalledWith("a\t1");
  });
});
