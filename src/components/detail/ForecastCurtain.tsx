// Method comparison for the forecast curtain. Selecting one redraws the dashed path.
"use client";

import { FORECAST_METHOD_LABEL, type ForecastMethod } from "@/lib/timeSeriesAnalysis";

export const FORECAST_METHOD_ORDER: ForecastMethod[] = ["naive", "line", "holt", "seasonal"];

export const FORECAST_METHOD_COPY: Record<ForecastMethod, { complexity: string; line: string; holds: string; misleads: string; band: string }> = {
  naive: {
    complexity: "Simplest",
    line: "The next points stay where the series just was.",
    holds: "It is the honest guess when recent values wander without a direction. Many fancier forecasts fail to beat it.",
    misleads: "A series that is clearly rising or falling will look flat. The path ignores everything except the last point.",
    band: "The shade widens with the square root of the horizon, using a typical one-step change. It is a random-walk sketch, not a probability guarantee.",
  },
  line: {
    complexity: "Low",
    line: "One slope through every plotted point, then extended.",
    holds: "Use it when the whole history really does lean one way at a steady rate. This is the method on a new forecast.",
    misleads: "A turn near the end, or a repeating season, gets averaged into that single slope. Old points count as much as new ones.",
    band: "The shade is an approximate 95% prediction interval. It assumes the misses are steady and independent. Seasonality, abrupt shifts, and uneven spacing can make it misleading.",
  },
  holt: {
    complexity: "Medium",
    line: "A level and a slope that newer points move more than older ones.",
    holds: "Use it when the direction changed and the early history should matter less. The weights are fixed at 0.4 for the level and 0.2 for the slope, written in the code rather than fit in secret.",
    misleads: "It still cannot see a yearly cycle. A short noisy stretch can tilt the recent slope.",
    band: "The shade grows from recent one-step misses. It is an approximation, not a formal Holt interval.",
  },
  seasonal: {
    complexity: "Higher",
    line: "The last cycle is copied forward.",
    holds: "Use it when a rhythm is real: 12 points for months, 7 for days of the week, 4 for quarters. The series needs more than one full cycle.",
    misleads: "A wrong length invents a rhythm. A trend on top of the cycle is left behind, because only the last season is repeated.",
    band: "The shade grows each time a full cycle is repeated, from how much one season missed the season before it.",
  },
};

export function ForecastMethodList({ method, season, code, onMethod, onSeason }: {
  method: ForecastMethod;
  season: number;
  code: string;
  onMethod: (method: ForecastMethod) => void;
  onSeason: (season: number) => void;
}) {
  const selected = FORECAST_METHOD_COPY[method];
  return <div className="space-y-5">
    <p className="text-sm text-loom-text">None of these is the best forecast for every series. A straight line is the default because it is easy to see through. When a forecast is on the chart, choosing another method redraws the dashed line and its shade.</p>
    <ul className="space-y-2">
      {FORECAST_METHOD_ORDER.map(id => {
        const copy = FORECAST_METHOD_COPY[id];
        const pressed = id === method;
        return <li key={id}>
          <button type="button" aria-pressed={pressed} className={`w-full rounded border px-3 py-3 text-left ${pressed ? "border-loom-accent bg-loom-surface" : "border-loom-border"}`} onClick={() => onMethod(id)}>
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-loom-text">{FORECAST_METHOD_LABEL[id]}</span>
              <span className="text-2xs uppercase tracking-wider text-loom-muted">{copy.complexity}</span>
            </span>
            <span className="mt-1 block text-xs text-loom-muted">{copy.line}</span>
          </button>
        </li>;
      })}
    </ul>
    <div className="space-y-3 text-sm">
      <h3 className="font-semibold">{FORECAST_METHOD_LABEL[method]}</h3>
      <p><span className="text-loom-muted">When it holds. </span>{selected.holds}</p>
      <p><span className="text-loom-muted">When it misleads. </span>{selected.misleads}</p>
      <p><span className="text-loom-muted">The shade. </span>{selected.band}</p>
    </div>
    {method === "seasonal" && <label className="block text-xs text-loom-muted">Points in one cycle
      <input aria-label="Season length" className="loom-input mt-1 w-full" type="number" min={2} max={24} value={season} onChange={event => onSeason(Math.max(2, Math.min(24, Math.round(Number(event.target.value) || 12))))} />
    </label>}
    <p className="text-xs text-loom-muted">Every method needs 8 plotted points, a horizon from 1 to 50, and an X axis that moves forward. The horizon counts plotted intervals, not necessarily days. Empty values are skipped. The result describes the loaded data, not unseen rows.</p>
    <details><summary className="cursor-pointer text-sm text-loom-text">Full calculation code · TypeScript</summary><pre className="mt-2 overflow-auto max-h-72 whitespace-pre text-2xs" tabIndex={0}><code>{code}</code></pre></details>
  </div>;
}
