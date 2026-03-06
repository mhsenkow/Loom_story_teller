// =================================================================
// DetailPanel — Stats / Chart (Vega & visual)
// =================================================================
// Right panel: Stats and Chart tabs. Schema lives in the footer.
// Chart tab: encoding drop zones + dropdowns; drag from footer Schema
// or pick columns from dropdowns.
// =================================================================

"use client";

import { useState, useCallback } from "react";
import { useLoomStore, type PanelTab, type ChartVisualOverrides } from "@/lib/store";
import { formatNumber } from "@/lib/format";
import { COLOR_PALETTES } from "@/lib/chartPalettes";
import { createChartRec, CHART_KIND_OPTIONS, getRecommendationReason, getRandomChartAndEncoding, type ChartKind } from "@/lib/recommendations";

const TABS: { key: PanelTab; label: string }[] = [
  { key: "stats", label: "Stats" },
  { key: "chart", label: "Chart" },
];

export function DetailPanel() {
  const { panelOpen, panelTab, setPanelTab, selectedFile } = useLoomStore();

  if (!panelOpen) return null;

  return (
    <aside className="flex flex-col h-full w-[var(--panel-width)] border-l border-loom-border bg-loom-surface flex-shrink-0">
      {/* Tab Bar */}
      <div className="flex items-center gap-0.5 px-2 h-[var(--topbar-height)] border-b border-loom-border flex-wrap">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setPanelTab(tab.key)}
            className={`
              px-3 py-1 text-xs font-medium rounded transition-all duration-100
              ${panelTab === tab.key
                ? "bg-loom-elevated text-loom-text"
                : "text-loom-muted hover:text-loom-text"
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!selectedFile ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-loom-muted">Select a file to inspect</p>
          </div>
        ) : panelTab === "stats" ? (
          <StatsView />
        ) : (
          <ChartPanelView />
        )}
      </div>
    </aside>
  );
}

const DRAG_TYPE_COLUMN = "application/x-loom-column";

function DropZone({
  label,
  value,
  isActive,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  label: string;
  value: string;
  isActive: boolean;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragEnter(e);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        onDragOver(e);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragLeave();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDrop(e);
      }}
      className={`
        min-h-[36px] rounded border-2 border-dashed px-2 py-2 text-xs font-mono transition-colors flex items-center
        ${isActive ? "border-loom-accent bg-loom-accent/10" : "border-loom-border bg-loom-elevated/50"}
      `}
    >
      <span className="text-loom-muted mr-2">{label}:</span>
      <span className="text-loom-text truncate">{value}</span>
    </div>
  );
}

function StatsView() {
  const { columnStats } = useLoomStore();

  return (
    <div className="p-3 space-y-2">
      {columnStats.map((col) => (
        <div key={col.name} className="loom-card space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-medium text-loom-text">{col.name}</span>
            <span className="loom-badge">{col.data_type}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs font-mono">
            <StatRow label="Distinct" value={formatNumber(col.distinct_count)} />
            <StatRow label="Nulls" value={formatNumber(col.null_count)} />
            <StatRow label="Min" value={col.min_value ?? "—"} />
            <StatRow label="Max" value={col.max_value ?? "—"} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-loom-muted">{label}</span>
      <span className="text-loom-text">{value}</span>
    </div>
  );
}

// --- Chart tab: Vega spec + visual overrides ---

function ChartPanelView() {
  const {
    activeChart,
    vegaSpec,
    sampleRows,
    columnStats,
    chartVisualOverrides,
    setChartVisualOverrides,
    setActiveChart,
    selectedFile,
    aiSuggestionReason,
  } = useLoomStore();
  const [specExpanded, setSpecExpanded] = useState(true);
  const [specCopyOk, setSpecCopyOk] = useState(false);
  const [dragOverSlot, setDragOverSlot] = useState<"x" | "y" | "color" | null>(null);

  const tableName = selectedFile?.name?.replace(/\.\w+$/, "") ?? "";

  const handleDrop = useCallback(
    (slot: "x" | "y" | "color") => (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverSlot(null);
      const colName = e.dataTransfer.getData(DRAG_TYPE_COLUMN) || e.dataTransfer.getData("text/plain");
      if (!colName || !activeChart || columnStats.length === 0) return;
      const newX = slot === "x" ? colName : activeChart.xField;
      const newY = slot === "y" ? colName : activeChart.yField;
      const newColor = slot === "color" ? colName : activeChart.colorField;
      const extra = { sizeField: activeChart.sizeField ?? null, rowField: activeChart.rowField ?? null };
      const rec = createChartRec(activeChart.kind, columnStats, newX, newY, newColor, tableName, extra);
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart],
  );

  const handleDragEnter = useCallback((slot: "x" | "y" | "color") => () => setDragOverSlot(slot), []);
  const handleDragOver = useCallback((slot: "x" | "y" | "color") => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverSlot(slot);
  }, []);
  const handleDragLeave = useCallback(() => setDragOverSlot(null), []);

  const updateOverride = useCallback(
    (key: keyof ChartVisualOverrides, value: number | string | boolean | undefined) => {
      setChartVisualOverrides((prev) => ({ ...prev, [key]: value }));
    },
    [setChartVisualOverrides],
  );

  const handleCopySpec = useCallback(() => {
    if (!vegaSpec) return;
    const json = JSON.stringify(vegaSpec, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setSpecCopyOk(true);
      setTimeout(() => setSpecCopyOk(false), 1500);
    });
  }, [vegaSpec]);

  const extraFromChart = useCallback(
    () => ({ sizeField: activeChart?.sizeField ?? null, rowField: activeChart?.rowField ?? null }),
    [activeChart?.sizeField, activeChart?.rowField],
  );

  const applyEncoding = useCallback(
    (slot: "x" | "y" | "color", colName: string) => {
      if (!activeChart || columnStats.length === 0) return;
      const newX = slot === "x" ? colName : activeChart.xField;
      const newY = slot === "y" ? (colName === "" ? null : colName) : activeChart.yField;
      const newColor = slot === "color" ? (colName === "__none__" || colName === "" ? null : colName) : activeChart.colorField;
      const rec = createChartRec(activeChart.kind, columnStats, newX, newY, newColor, tableName, extraFromChart());
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyEncodingExtra = useCallback(
    (slot: "size" | "row", colName: string) => {
      if (!activeChart || columnStats.length === 0) return;
      const sizeField = slot === "size" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.sizeField ?? null);
      const rowField = slot === "row" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.rowField ?? null);
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        { sizeField, rowField },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart],
  );

  const applyChartType = useCallback(
    (kind: ChartKind) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        extraFromChart(),
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const handleRandomize = useCallback(() => {
    if (columnStats.length === 0) return;
    const random = getRandomChartAndEncoding(columnStats);
    if (!random) return;
    const rec = createChartRec(
      random.kind,
      columnStats,
      random.xField,
      random.yField,
      random.colorField,
      tableName,
    );
    if (rec) setActiveChart(rec);
  }, [columnStats, tableName, setActiveChart]);

  if (!activeChart) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-sm text-loom-muted">No chart selected</p>
        <p className="text-2xs text-loom-muted mt-1">Pick a suggestion from the Chart view</p>
      </div>
    );
  }

  const specJson = vegaSpec ? JSON.stringify(vegaSpec, null, 2) : "{}";
  const rowCount = sampleRows?.rows.length ?? 0;
  const showY = activeChart.kind !== "histogram";
  const showColor = !["histogram", "pie"].includes(activeChart.kind);
  const showSize = activeChart.kind === "scatter" || activeChart.kind === "strip";
  const showRow = ["bar", "line", "area"].includes(activeChart.kind);
  const numericCols = columnStats.filter(
    (c) => ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL"].some((t) => (c.data_type ?? "").toUpperCase().includes(t)),
  );
  const nominalForRow = columnStats.filter(
    (c) => !numericCols.some((n) => n.name === c.name) && (c.distinct_count ?? 0) >= 2 && (c.distinct_count ?? 0) <= 30,
  );

  return (
    <div className="flex flex-col gap-4 p-3">
      {/* Encoding: chart type + drag from footer Schema or dropdowns */}
      <div className="loom-card space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-loom-text">Encoding</span>
          <button
            type="button"
            onClick={handleRandomize}
            className="text-2xs py-1 px-2 rounded border border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-text transition-colors"
            title="Random chart type and column combo"
          >
            Randomize
          </button>
        </div>
        <div>
          <label className="block text-2xs text-loom-muted mb-1">Chart type</label>
          <select
            value={activeChart.kind}
            onChange={(e) => applyChartType(e.target.value as ChartKind)}
            className="loom-input w-full text-xs py-1.5 font-mono"
          >
            {CHART_KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <p className="text-2xs text-loom-muted">Drag columns from footer Schema tab, or choose below.</p>
        <div className="space-y-2">
          <div className="flex flex-col gap-1">
            <DropZone
              label="X"
              value={activeChart.xField}
              isActive={dragOverSlot === "x"}
              onDragEnter={handleDragEnter("x")}
              onDragOver={handleDragOver("x")}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop("x")}
            />
            <select
              value={activeChart.xField}
              onChange={(e) => applyEncoding("x", e.target.value)}
              className="loom-input w-full text-xs py-1.5 font-mono"
            >
              {columnStats.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
          {showY && (
            <div className="flex flex-col gap-1">
              <DropZone
                label="Y"
                value={activeChart.yField ?? "—"}
                isActive={dragOverSlot === "y"}
                onDragEnter={handleDragEnter("y")}
                onDragOver={handleDragOver("y")}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop("y")}
              />
              <select
                value={activeChart.yField ?? ""}
                onChange={(e) => applyEncoding("y", e.target.value)}
                className="loom-input w-full text-xs py-1.5 font-mono"
              >
                <option value="">—</option>
                {columnStats.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          {showColor && (
            <div className="flex flex-col gap-1">
              <DropZone
                label="Color"
                value={activeChart.colorField ?? "None"}
                isActive={dragOverSlot === "color"}
                onDragEnter={handleDragEnter("color")}
                onDragOver={handleDragOver("color")}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop("color")}
              />
              <select
                value={activeChart.colorField ?? "__none__"}
                onChange={(e) => applyEncoding("color", e.target.value)}
                className="loom-input w-full text-xs py-1.5 font-mono"
              >
                <option value="__none__">None</option>
                {columnStats.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          {showSize && (
            <div className="flex flex-col gap-1">
              <label className="text-2xs text-loom-muted">Size</label>
              <select
                value={activeChart.sizeField ?? "__none__"}
                onChange={(e) => applyEncodingExtra("size", e.target.value)}
                className="loom-input w-full text-xs py-1.5 font-mono"
              >
                <option value="__none__">None</option>
                {numericCols.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          {showRow && (
            <div className="flex flex-col gap-1">
              <label className="text-2xs text-loom-muted">Row (facet)</label>
              <select
                value={activeChart.rowField ?? "__none__"}
                onChange={(e) => applyEncodingExtra("row", e.target.value)}
                className="loom-input w-full text-xs py-1.5 font-mono"
              >
                <option value="__none__">None</option>
                {nominalForRow.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Chart info */}
      <div className="loom-card space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-loom-text">Active chart</span>
          <span className="loom-badge">{activeChart.kind}</span>
        </div>
        <p className="text-2xs text-loom-muted">
          <span className="cursor-help border-b border-dotted border-loom-muted/50" title={aiSuggestionReason ?? getRecommendationReason(activeChart)}>
            Why?
          </span>
        </p>
        <div className="text-2xs font-mono text-loom-muted space-y-0.5">
          <p>X: {activeChart.xField}</p>
          {activeChart.yField && <p>Y: {activeChart.yField}</p>}
          {activeChart.colorField && <p>Color: {activeChart.colorField}</p>}
          {activeChart.sizeField && <p>Size: {activeChart.sizeField}</p>}
          {activeChart.rowField && <p>Row: {activeChart.rowField}</p>}
          <p>{rowCount.toLocaleString()} rows (preview)</p>
        </div>
      </div>

      {/* Visual overrides */}
      <div className="loom-card space-y-3">
        <div className="text-xs font-semibold text-loom-text">Visual</div>
        <div className="space-y-3">
          {(activeChart.kind === "scatter" || activeChart.kind === "strip") && (
            <>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Point size</label>
                <input
                  type="range"
                  min={2}
                  max={24}
                  value={chartVisualOverrides.pointSize ?? 12}
                  onChange={(e) => updateOverride("pointSize", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                />
                <span className="text-2xs font-mono text-loom-muted ml-2">
                  {chartVisualOverrides.pointSize ?? 12}
                </span>
              </div>
            </>
          )}
          <div>
            <label className="block text-2xs text-loom-muted mb-1">Opacity</label>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={chartVisualOverrides.opacity ?? 0.7}
              onChange={(e) => updateOverride("opacity", Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
            />
            <span className="text-2xs font-mono text-loom-muted ml-2">
              {((chartVisualOverrides.opacity ?? 0.7) * 100).toFixed(0)}%
            </span>
          </div>
          <div>
            <label className="block text-2xs text-loom-muted mb-1">Color palette</label>
            <select
              value={chartVisualOverrides.colorPalette ?? "loom"}
              onChange={(e) => updateOverride("colorPalette", e.target.value)}
              className="loom-input w-full text-xs py-1.5"
            >
              {COLOR_PALETTES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-2xs text-loom-muted mb-1">Axis font size</label>
            <input
              type="number"
              min={8}
              max={16}
              value={chartVisualOverrides.axisFontSize ?? 10}
              onChange={(e) => updateOverride("axisFontSize", Number(e.target.value) || undefined)}
              className="loom-input w-full text-xs py-1"
            />
          </div>
          <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
            <input
              type="checkbox"
              checked={chartVisualOverrides.showGrid ?? true}
              onChange={(e) => updateOverride("showGrid", e.target.checked)}
              className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
            />
            Show grid
          </label>
        </div>
      </div>

      {/* Vega-Lite spec */}
      <div className="loom-card space-y-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSpecExpanded(!specExpanded)}
            className="text-xs font-semibold text-loom-text hover:text-loom-accent transition-colors"
          >
            {specExpanded ? "▼" : "▶"} Vega-Lite spec
          </button>
          <button
            type="button"
            onClick={handleCopySpec}
            className="text-2xs px-2 py-1 rounded border border-loom-border hover:border-loom-accent text-loom-muted hover:text-loom-text transition-colors"
          >
            {specCopyOk ? "Copied" : "Copy JSON"}
          </button>
        </div>
        {specExpanded && (
          <pre className="text-2xs font-mono text-loom-muted bg-loom-bg rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
            {specJson}
          </pre>
        )}
      </div>
    </div>
  );
}
