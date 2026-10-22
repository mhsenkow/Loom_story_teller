"use client";

// Color editing stays in visual overrides, so undo, saved looks and links share one source.
import { useMemo, useState } from "react";
import { ChartColorInput } from "./ChartColorInput";
import {
  COLOR_PALETTES,
  discretizeContinuous,
  getPaletteById,
  resolveChartColors,
  sampleCategorical,
  type ResolvedChartColors,
} from "@/lib/chartPalettes";
import { MAX_CUSTOM_COLORS, parseCustomColors } from "@/lib/chartCustomColors";
import { chartCapabilities } from "@/lib/chartSupport";
import { isNumericType } from "@/lib/canvasCharts/shared";
import type { ChartRecommendation } from "@/lib/recommendations";
import type {
  ChartVisualOverrides,
  ColumnInfo,
  QueryResult,
} from "@/lib/store";

function Swatches({
  colors,
  continuous,
}: {
  colors: string[];
  continuous: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className="flex h-3 rounded overflow-hidden"
      style={
        continuous
          ? {
              background: `linear-gradient(to right, ${colors.length === 1 ? [colors[0], colors[0]].join(",") : colors.join(",")})`,
            }
          : undefined
      }
    >
      {!continuous &&
        colors.map((color, i) => (
          <span key={i} className="flex-1" style={{ background: color }} />
        ))}
    </div>
  );
}

export function ChartColorControls({
  chart,
  columns,
  rows,
  visual,
  theme,
  colorblind,
  onChange,
}: {
  chart: ChartRecommendation | null;
  columns: ColumnInfo[];
  rows: QueryResult | null;
  visual: ChartVisualOverrides;
  theme: string;
  colorblind: boolean;
  onChange: (patch: Partial<ChartVisualOverrides>, groupKey?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const field =
    chart?.kind === "pie"
      ? chart.xField
      : chart && chartCapabilities(chart.kind).colorChannel
        ? chart.colorField
        : null;
  const column = columns.find((c) => c.name === field);
  const colorColumn =
    chart && chartCapabilities(chart.kind).colorChannel
      ? columns.find((c) => c.name === chart.colorField)
      : undefined;
  const options = {
    theme,
    colorblind,
    chartKind: chart?.kind,
    colorFieldType: colorColumn
      ? isNumericType(colorColumn.data_type)
        ? "quantitative"
        : "nominal"
      : null,
    reverse: !!visual.colorPaletteReverse !== !!chart?.channelInvert?.color,
  };
  const applied = resolveChartColors({
    ...options,
    paletteId: visual.colorPalette,
    scaleKind: visual.colorScaleKind,
    customColors: visual.customColors,
  });
  const automatic = resolveChartColors(options);
  const custom = parseCustomColors(visual.customColors);
  const count = useMemo(() => {
    if (!field) return null;
    const index = rows?.columns.indexOf(field) ?? -1;
    if (index < 0 || !rows?.rows.length) return column?.distinct_count ?? null;
    const values = new Set<string>();
    for (const row of rows.rows) values.add(String(row[index]));
    return values.size;
  }, [field, column?.distinct_count, rows]);
  const single =
    !field &&
    chart &&
    [
      "bar",
      "histogram",
      "scatter",
      "bubble",
      "line",
      "area",
      "lollipop",
      "funnel",
    ].includes(chart.kind) &&
    !chart.y2Field &&
    !chart.shapeField &&
    !chart.emojiField;
  const targetCount = single ? 1 : count;
  const name = custom
    ? "Custom colors"
    : (getPaletteById(applied.paletteId)?.name ?? applied.paletteId);
  const original = resolveChartColors({
    ...options,
    paletteId: visual.colorPalette,
    scaleKind: visual.colorScaleKind,
    reverse: false,
  });
  const editable = custom ?? original.colors;
  const writeColors = (colors: string[], groupKey?: string) =>
    onChange({ customColors: colors.join(",") }, groupKey);
  const fitColors = (n: number) =>
    writeColors(
      applied.continuous
        ? discretizeContinuous(editable, n)
        : sampleCategorical(editable, n),
    );
  const preview = (resolved: ResolvedChartColors) =>
    !resolved.continuous && targetCount && targetCount <= MAX_CUSTOM_COLORS
      ? sampleCategorical(resolved.colors, targetCount)
      : resolved.colors;
  const selectPalette = (id: string) =>
    onChange({
      colorPalette: id,
      colorScaleKind: id === "auto" ? "auto" : getPaletteById(id)!.kind,
      customColors: undefined,
    });
  const palettes = COLOR_PALETTES.filter(
    (p) =>
      p.id !== "auto" &&
      (filter === "all" || p.kind === filter) &&
      `${p.name} ${p.kind} ${p.blurb ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const recommendedId =
    !automatic.continuous && (count ?? 0) > 8 && !colorblind
      ? "categorical"
      : automatic.paletteId;
  return (
    <div className="space-y-3">
      <p className="text-2xs text-loom-muted leading-relaxed">
        {field
          ? `${count ?? "…"} distinct loaded values in ${field} (before grouping). `
          : single
            ? "One mark color. "
            : "Colors follow this chart’s groups or values. "}
        {applied.continuous
          ? "A gradient blends between stops for values and density; series use samples from it."
          : "Swatches color categories in chart order; colors repeat when there are more groups than swatches."}
      </p>
      <div className="rounded border border-loom-border bg-loom-elevated/40 p-2 space-y-2">
        <p className="text-xs font-medium text-loom-text">
          Applied · {name}
          {!custom && (!visual.colorPalette || visual.colorPalette === "auto")
            ? " · automatic"
            : ""}
        </p>
        <Swatches colors={preview(applied)} continuous={applied.continuous} />
        <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer min-h-9">
          <input
            type="checkbox"
            aria-label="Reverse scale"
            checked={!!visual.colorPaletteReverse}
            onChange={(e) =>
              onChange({ colorPaletteReverse: e.target.checked })
            }
            className="accent-loom-accent"
          />{" "}
          Reverse scale
        </label>
        {chart?.channelInvert?.color && (
          <p className="text-2xs text-loom-muted">
            Encoding → Color is also inverted. The preview includes both
            directions.
          </p>
        )}
        {!custom && (
          <button
            type="button"
            className="loom-btn-ghost text-xs min-h-9 w-full"
            onClick={() =>
              fitColors(
                !applied.continuous && targetCount
                  ? Math.min(targetCount, MAX_CUSTOM_COLORS, editable.length)
                  : Math.min(editable.length, MAX_CUSTOM_COLORS),
              )
            }
          >
            Customize colors
          </button>
        )}
        {custom && (
          <div className="space-y-2">
            <p className="text-2xs text-loom-muted">
              {applied.continuous
                ? "Edit gradient stops from start to end."
                : "Edit palette slots. Assignments follow the chart’s category order."}{" "}
              Reverse changes their display order.
            </p>
            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {custom.map((color, index) => (
                <div key={index} className="space-y-1">
                  <p className="text-2xs text-loom-muted">
                    {applied.continuous
                      ? `Stop ${index + 1}`
                      : `Color ${index + 1}`}
                  </p>
                  <div className="flex items-center gap-1">
                    <ChartColorInput
                      label={`${applied.continuous ? "Stop" : "Color"} ${index + 1}`}
                      value={color}
                      onChange={(next) =>
                        writeColors(
                          custom.map((c, i) => (i === index ? next : c)),
                          `color-${index}`,
                        )
                      }
                    />
                    <button
                      type="button"
                      aria-label={`Remove color ${index + 1}`}
                      disabled={custom.length === 1}
                      onClick={() =>
                        writeColors(custom.filter((_, i) => i !== index))
                      }
                      className="loom-btn-ghost min-w-9 min-h-9 disabled:opacity-40"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={custom.length >= MAX_CUSTOM_COLORS}
                className="loom-btn-ghost text-2xs min-h-9 disabled:opacity-40"
                onClick={() =>
                  writeColors([
                    ...custom,
                    original.colors[custom.length % original.colors.length]!,
                  ])
                }
              >
                Add color
              </button>
              <button
                type="button"
                className="loom-btn-ghost text-2xs min-h-9"
                onClick={() => onChange({ customColors: undefined })}
              >
                Restore preset colors
              </button>
            </div>
          </div>
        )}
        {targetCount != null &&
          targetCount > 0 &&
          targetCount <= MAX_CUSTOM_COLORS && (
            <button
              type="button"
              className="loom-btn-ghost text-2xs min-h-9 w-full"
              onClick={() => fitColors(targetCount)}
            >
              Use {targetCount}{" "}
              {applied.continuous
                ? targetCount === 1
                  ? "stop"
                  : "stops"
                : targetCount === 1
                  ? "color"
                  : "colors"}
              {field ? ` for ${field}` : ""}
            </button>
          )}
        {!applied.continuous && (count ?? 0) > new Set(applied.colors).size && (
          <p role="status" className="text-2xs text-loom-label">
            {new Set(applied.colors).size} distinct colors for {count} values.
            Some colors repeat; try a larger categorical preset or split the
            chart into facets.
          </p>
        )}
      </div>
      <button
        type="button"
        aria-pressed={
          !custom && (!visual.colorPalette || visual.colorPalette === "auto")
        }
        onClick={() => selectPalette("auto")}
        className="w-full rounded border border-loom-border hover:border-loom-accent text-left p-2 space-y-1"
      >
        <span className="block text-xs font-medium text-loom-text">Auto</span>
        <span className="block text-2xs text-loom-muted">
          Follow chart, theme, and accessibility settings
        </span>
        <Swatches
          colors={preview(automatic)}
          continuous={automatic.continuous}
        />
      </button>
      {colorblind && (
        <p className="text-2xs text-loom-muted">
          Colorblind defaults are on. Custom colors and explicit palettes keep
          your choices.
        </p>
      )}
      <input
        type="search"
        aria-label="Search color palettes"
        placeholder="Search palettes…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="loom-input w-full text-xs min-h-9 px-2"
      />
      <label className="block text-2xs text-loom-muted">
        Browse palettes
        <select
          aria-label="Browse palettes"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="loom-input w-full mt-1 min-h-9"
        >
          <option value="all">All palettes</option>
          <option value="categorical">Categories</option>
          <option value="sequential">Sequential gradients</option>
          <option value="diverging">Diverging gradients</option>
          <option value="semantic">Semantic</option>
          <option value="reference">Reference</option>
          <option value="spectrum">Spectrum</option>
        </select>
      </label>
      {!palettes.length && (
        <p role="status" className="text-2xs text-loom-muted">
          No palettes match this search. Clear the search or choose All
          palettes.
        </p>
      )}
      <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
        {[...palettes]
          .sort(
            (a, b) =>
              Number(b.id === recommendedId) - Number(a.id === recommendedId),
          )
          .map((p) => {
            const resolved = resolveChartColors({
              ...options,
              paletteId: p.id,
            });
            const selected = !custom && visual.colorPalette === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={selected}
                onClick={() => selectPalette(p.id)}
                className={`w-full text-left rounded border p-2 space-y-1 ${selected ? "border-loom-accent bg-loom-accent/10" : "border-loom-border hover:border-loom-accent/40"}`}
              >
                <span className="flex justify-between gap-2 text-2xs">
                  <span className="font-medium text-loom-text">{p.name}</span>
                  <span className="text-loom-muted">
                    {p.id === recommendedId ? "Suggested" : p.kind}
                  </span>
                </span>
                <Swatches
                  colors={preview(resolved)}
                  continuous={resolved.continuous}
                />
                <span className="block text-2xs text-loom-muted">
                  {resolved.continuous
                    ? "Continuous gradient"
                    : `${new Set(resolved.colors).size} distinct colors`}
                  {resolved.paletteId !== p.id
                    ? ` · uses ${getPaletteById(resolved.paletteId)?.name} for this chart`
                    : ""}
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}
