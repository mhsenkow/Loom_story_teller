/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { render } from "@testing-library/react";
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
});
