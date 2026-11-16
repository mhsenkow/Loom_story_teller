"use client";

// Typography edits use the chart's existing undo history, including presets and reset.
import { useId } from "react";
import { FontPicker } from "./FontPicker";
import { chartFontStack, fontChoiceForFamily } from "@/lib/fontCatalog";
import { chartTypeRamp, resolveChartAxisFontSize } from "@/lib/chartType";
import type { ChartVisualOverrides } from "@/lib/chartVisualTypes";

export function ChartTypographyControls({
  value,
  appFamily,
  family,
  title,
  subtitle,
  inheritedWeight = 600,
  onEdit,
}: {
  value: ChartVisualOverrides;
  appFamily: string;
  family: string;
  title: string;
  subtitle: string;
  inheritedWeight?: number;
  onEdit: (patch: Partial<ChartVisualOverrides>, coalesceKey?: string) => void;
}) {
  const id = useId();
  const ramp = chartTypeRamp(value.axisFontSize);
  const choice = fontChoiceForFamily(family);
  const weight = value.titleFontWeight ?? inheritedWeight;
  const weights = [
    ...new Set([...(choice?.weights ?? [300, 400, 500, 600, 700]), weight]),
  ].sort((a, b) => a - b);
  const names: Record<number, string> = {
    100: "Thin",
    200: "Extra light",
    300: "Light",
    400: "Regular",
    500: "Medium",
    600: "Semibold",
    700: "Bold",
    800: "Extra bold",
    900: "Black",
    1000: "Extra black",
  };
  return (
    <div className="loom-typography-controls">
      <FontPicker
        label="Font family"
        value={value.fontFamily}
        inheritedFamily={appFamily}
        inheritLabel="App typeface"
        onChange={(fontFamily) => onEdit({ fontFamily })}
      />
      <div
        className="loom-type-presets"
        role="group"
        aria-label="Typography presets"
      >
        {[
          { name: "Clear", family: "Atkinson Hyperlegible Next", weight: 600 },
          { name: "Editorial", family: "Source Serif 4", weight: 600 },
          { name: "Technical", family: "IBM Plex Mono", weight: 500 },
        ].map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() =>
              onEdit({
                fontFamily: preset.family,
                titleFontWeight: preset.weight,
                axisFontSize: 12,
                titleItalic: false,
              })
            }
            title={`${preset.family} · 12 px`}
          >
            <span>{preset.name}</span>
          </button>
        ))}
      </div>
      <div>
        <label htmlFor={`${id}-size`} className="loom-control-label">
          Chart text size
        </label>
        <div className="loom-type-size">
          <button
            type="button"
            aria-label="Decrease chart text size"
            disabled={ramp.base <= 11}
            onClick={() =>
              onEdit({ axisFontSize: Math.max(11, ramp.base - 1) })
            }
          >
            A−
          </button>
          <select
            id={`${id}-size`}
            aria-label="Chart text size"
            className="loom-input loom-panel-select"
            value={resolveChartAxisFontSize(value.axisFontSize)}
            onChange={(event) =>
              onEdit({ axisFontSize: Number(event.target.value) })
            }
          >
            {[
              "Compact",
              "Balanced",
              "Comfortable",
              "Large",
              "Larger",
              "Presentation",
            ].map((name, index) => (
              <option key={name} value={index + 11}>
                {index + 11} px · {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Increase chart text size"
            disabled={ramp.base >= 16}
            onClick={() =>
              onEdit({ axisFontSize: Math.min(16, ramp.base + 1) })
            }
          >
            A+
          </button>
        </div>
        <p className="loom-control-hint">
          Scales titles, labels, legends, and source notes together. Crowded
          labels are spaced or skipped.
        </p>
      </div>
      <div
        className="loom-type-preview"
        role="group"
        aria-label="Chart typography sample"
        style={{ fontFamily: chartFontStack(family), fontSize: ramp.tick }}
      >
        <span
          className="line-clamp-3"
          title={title}
          style={{
            fontSize: ramp.title,
            fontWeight: weight,
            fontStyle: value.titleItalic ? "italic" : "normal",
            lineHeight: 1.3,
          }}
        >
          {title}
        </span>
        <span>{subtitle}</span>
        <span className="tabular-nums">12,345.67 · −8.2%</span>
      </div>
      <div className="loom-type-weight-row">
        <div>
          <label htmlFor={`${id}-weight`} className="loom-control-label">
            Title weight
          </label>
          <select
            id={`${id}-weight`}
            aria-label="Title weight"
            className="loom-input loom-panel-select"
            value={weight}
            onChange={(event) =>
              onEdit({ titleFontWeight: Number(event.target.value) })
            }
          >
            {weights.map((w) => (
              <option key={w} value={w}>
                {names[w] ?? "Custom"} · {w}
                {choice && !choice.weights.includes(w)
                  ? " (nearest available)"
                  : ""}
              </option>
            ))}
          </select>
        </div>
        <label className="loom-type-italic">
          <input
            type="checkbox"
            aria-label="Title italic"
            checked={value.titleItalic ?? false}
            onChange={(event) => onEdit({ titleItalic: event.target.checked })}
          />{" "}
          <span>Title italic</span>
        </label>
      </div>
      {value.titleItalic && choice && !choice.italic && (
        <p className="loom-control-hint">
          This family has no drawn italic; Loom uses a slanted version.
        </p>
      )}
      <button
        type="button"
        className="loom-type-reset"
        onClick={() =>
          onEdit({
            fontFamily: undefined,
            axisFontSize: undefined,
            titleFontWeight: undefined,
            titleItalic: undefined,
          })
        }
      >
        Reset typography
      </button>
    </div>
  );
}
