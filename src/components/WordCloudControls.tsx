"use client";

// Word-cloud appearance stays separate from chart titles and from data aggregation.
import { useId } from "react";
import { FontPicker } from "./FontPicker";
import type { ChartVisualOverrides } from "@/lib/chartVisualTypes";

export function WordCloudControls({
  value,
  chartFamily,
  wordField,
  sizeLabel,
  mode,
  limit,
  onLimit,
  onEdit,
}: {
  value: ChartVisualOverrides;
  chartFamily: string;
  wordField: string;
  sizeLabel: string;
  mode: string;
  limit: number;
  onLimit: (limit: number) => void;
  onEdit: (patch: Partial<ChartVisualOverrides>, coalesceKey?: string) => void;
}) {
  const id = useId();
  return (
    <div className="loom-typography-controls">
      <p className="loom-control-hint">
        Each word is a {wordField} category, sized by {sizeLabel}.{" "}
        {mode !== "cloud" ? "Groups share one size scale. " : ""}Hover or focus
        a word for its exact value and rank.
      </p>
      <FontPicker
        label="Word font"
        value={value.wordCloudFont}
        inheritedFamily={chartFamily}
        onChange={(wordCloudFont) => onEdit({ wordCloudFont })}
      />
      <p className="loom-control-hint">
        Changes the words only. Titles and source notes keep the chart font.
      </p>
      <div>
        <label className="loom-control-label" htmlFor={`${id}-arrange`}>
          Arrangement
        </label>
        <select
          id={`${id}-arrange`}
          className="loom-input loom-panel-select"
          value={value.wordCloudArrange ?? "spiral"}
          onChange={(event) =>
            onEdit({
              wordCloudArrange: event.target
                .value as ChartVisualOverrides["wordCloudArrange"],
            })
          }
        >
          <option value="spiral">Cloud · centered spiral</option>
          <option value="rows">Rows · read across</option>
          <option value="columns">Columns · read down</option>
        </select>
      </div>
      <div>
        <label className="loom-control-label" htmlFor={`${id}-contrast`}>
          Size contrast
        </label>
        <select
          id={`${id}-contrast`}
          className="loom-input loom-panel-select"
          value={value.wordCloudSizing ?? "sqrt"}
          onChange={(event) =>
            onEdit({
              wordCloudSizing: event.target
                .value as ChartVisualOverrides["wordCloudSizing"],
            })
          }
        >
          <option value="sqrt">Balanced · square root</option>
          <option value="linear">Strong · proportional size</option>
          <option value="log">Gentle · logarithmic</option>
        </select>
        <p className="loom-control-hint">
          Gentle brings smaller values into view. Size shows relative
          prominence; word length also changes the area you see.
        </p>
      </div>
      <div>
        <label className="loom-control-label" htmlFor={`${id}-weight`}>
          Word weight
        </label>
        <select
          id={`${id}-weight`}
          className="loom-input loom-panel-select"
          value={value.wordCloudWeight ?? "ranked"}
          onChange={(event) =>
            onEdit({
              wordCloudWeight: event.target
                .value as ChartVisualOverrides["wordCloudWeight"],
            })
          }
        >
          <option value="ranked">Ranked · top words bolder</option>
          <option value="even">Even · all medium</option>
          <option value="heavy">Heavy · all bold</option>
        </select>
      </div>
      <div className="loom-cloud-range">
        <div>
          <label htmlFor={`${id}-size`}>Word size</label>
          <output htmlFor={`${id}-size`}>
            {Math.round((value.wordCloudScale ?? 1) * 100)}%
          </output>
        </div>
        <input
          id={`${id}-size`}
          aria-label="Word size"
          type="range"
          min={60}
          max={160}
          step={5}
          value={Math.round((value.wordCloudScale ?? 1) * 100)}
          onChange={(event) =>
            onEdit(
              { wordCloudScale: Number(event.target.value) / 100 },
              "wordCloudScale",
            )
          }
        />
      </div>
      <div className="loom-cloud-range">
        <div>
          <label htmlFor={`${id}-gap`}>Word spacing</label>
          <output htmlFor={`${id}-gap`}>{value.wordCloudGap ?? 4} px</output>
        </div>
        <input
          id={`${id}-gap`}
          aria-label="Word spacing"
          type="range"
          min={0}
          max={16}
          step={1}
          value={value.wordCloudGap ?? 4}
          onChange={(event) =>
            onEdit({ wordCloudGap: Number(event.target.value) }, "wordCloudGap")
          }
        />
      </div>
      <div>
        <label htmlFor={`${id}-limit`} className="loom-control-label">
          Word limit{mode !== "cloud" ? " per group" : ""}
        </label>
        <select
          id={`${id}-limit`}
          className="loom-input loom-panel-select"
          value={limit}
          onChange={(event) => onLimit(Number(event.target.value))}
        >
          {[...new Set([20, 40, 60, 80, 120, 150, limit])]
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={n}>
                Up to {n} words
              </option>
            ))}
        </select>
        <p className="loom-control-hint">
          Largest values come first. The chart reports how many words fit. Long
          words fit using one shared size adjustment. More space or a smaller
          word size can reveal more.
        </p>
      </div>
      <button
        type="button"
        className="loom-type-reset"
        onClick={() =>
          onEdit({
            wordCloudFont: undefined,
            wordCloudArrange: undefined,
            wordCloudScale: undefined,
            wordCloudWeight: undefined,
            wordCloudGap: undefined,
            wordCloudSizing: undefined,
          })
        }
      >
        Reset word appearance
      </button>
    </div>
  );
}
