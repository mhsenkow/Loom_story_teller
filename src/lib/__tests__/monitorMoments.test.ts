import { describe, expect, it } from "vitest";
import { momentFrom, momentSvg, momentText, MAX_MOMENT_POINTS } from "../monitoring/moments";
import type { Monitor } from "../monitoring/types";

const mon: Monitor = {
  id: "m1", name: "Heat <script>", decision: "Tell crews", metric: { source: "meteo", agg: "latest", column: "temperature", unit: "°C" },
  rule: { kind: "threshold", above: 30 }, confirmChecks: 1, severity: "critical", schedule: { kind: "interval", minutes: 15 },
  notify: { inApp: true, system: false, cooldownMinutes: 0 }, expected: [], enabled: true, createdAt: 0, chart: { link: "chart=abc", title: "T" },
};

describe("moments", () => {
  it("keeps history up to the moment and appends the value", () => {
    const series = Array.from({ length: 100 }, (_, i) => ({ at: i * 1000, value: i }));
    const mo = momentFrom(mon, { id: "x", at: 200_000, value: 31, reason: "31 °C is above 30 °C", feedLabel: "World weather", series });
    expect(mo.series.length).toBe(MAX_MOMENT_POINTS + 1);
    expect(mo.series.at(-1)).toEqual({ at: 200_000, value: 31 });
    expect(mo.chartLink).toBe("chart=abc");
    expect(momentText(mo)).toContain("Heat");
  });
  it("draws an escaped SVG with the limit and the moment marked", () => {
    const mo = momentFrom(mon, { id: "x", at: 5000, value: 31, reason: "a <b> & c", feedLabel: "W", series: [{ at: 1000, value: 20 }, { at: 3000, value: 25 }] });
    const svg = momentSvg(mo);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("Heat &lt;script&gt;");
    expect(svg).toContain("a &lt;b&gt; &amp; c");
    expect(svg).toMatch(/stroke-dasharray/);
    expect(momentSvg(mo, { compact: true })).toContain('viewBox="0 0 600 220"');
  });
});
