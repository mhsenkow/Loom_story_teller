import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { ChartCard } from "../ChartCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("paints the preview with the same mapped emoji as the full scatter renderer", async () => {
  const labels: string[] = [];
  const context = new Proxy(
    {
      measureText: () => ({ width: 10 }),
      fillText: (text: string) => labels.push(text),
    },
    {
      get: (target, prop) => Reflect.get(target, prop) ?? (() => {}),
    },
  ) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext,
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(180);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      disconnect() {}
    },
  );
  render(
    <ChartCard
      previewOnly
      micro
      isActive={false}
      onClick={() => {}}
      rec={{
        id: "weather-emoji",
        kind: "scatter",
        title: "Weather",
        subtitle: "",
        spec: {},
        score: 90,
        xField: "temperature",
        yField: "humidity",
        colorField: "code",
        emojiField: "code",
        emojiMap: { field: "code", values: { 0: "☀️", 95: "⛈️" } },
      }}
      data={{
        columns: ["temperature", "humidity", "code"],
        types: ["DOUBLE", "DOUBLE", "INTEGER"],
        rows: [
          [10, 40, 0],
          [20, 60, 95],
        ],
        total_rows: 2,
      }}
    />,
  );
  await waitFor(() => expect(labels).toEqual(["☀️", "⛈️"]));
});
