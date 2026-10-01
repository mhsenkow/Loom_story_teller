"use client";

// =================================================================
// Loom — Data cube pivot controls + linked pivot table
// =================================================================
// Overlay for the `dataCube` chart:
//  • Axis chips (Rows / Columns / Depth): drag a chip onto another (or
//    click two) to pivot; drop a Schema column on a chip to replace it.
//  • Slice stepper: focus one depth layer or roll up across all depth.
//  • Pivot table: rows × columns for the slice, with totals; hover is
//    linked to voxels in the cube.
// =================================================================

import { useState, type DragEvent } from "react";
import { sampleContinuous } from "@/lib/chartPalettes";
import { formatCubeNumber, type DataCube, type PivotTable } from "@/lib/dataCube";

export type CubeAxisSlot = "x" | "y" | "z";

const DRAG_TYPE_AXIS = "application/x-loom-cube-axis";
const DRAG_TYPE_COLUMN = "application/x-loom-column";

const SLOT_LABEL: Record<CubeAxisSlot, string> = { x: "Rows", y: "Columns", z: "Depth" };

export interface CubeHoverCell {
  xi: number;
  yi: number;
  zi: number | null;
}

/** Stops orbit drag / wheel zoom from hijacking clicks and scrolls inside the overlay. */
const shield = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onPointerUp: (e: React.PointerEvent) => e.stopPropagation(),
  onWheel: (e: React.WheelEvent) => e.stopPropagation(),
  onMouseMove: (e: React.MouseEvent) => e.stopPropagation(),
};

export function DataCubePivotBar({
  cube,
  ramp,
  showLegend,
  slice,
  tableOpen,
  onSlice,
  onToggleTable,
  onSwap,
  onRotate,
  onReplace,
}: {
  cube: DataCube;
  ramp: string[];
  showLegend: boolean;
  slice: number | null;
  tableOpen: boolean;
  onSlice: (slice: number | null) => void;
  onToggleTable: () => void;
  onSwap: (a: CubeAxisSlot, b: CubeAxisSlot) => void;
  onRotate: () => void;
  onReplace: (slot: CubeAxisSlot, column: string) => void;
}) {
  const [picked, setPicked] = useState<CubeAxisSlot | null>(null);
  const [dropOn, setDropOn] = useState<CubeAxisSlot | null>(null);
  const axes: Record<CubeAxisSlot, DataCube["x"]> = { x: cube.x, y: cube.y, z: cube.z };
  const nz = cube.z.labels.length;

  const onChipClick = (slot: CubeAxisSlot) => {
    if (picked == null) setPicked(slot);
    else {
      if (picked !== slot) onSwap(picked, slot);
      setPicked(null);
    }
  };

  const onDrop = (slot: CubeAxisSlot) => (e: DragEvent) => {
    e.preventDefault();
    setDropOn(null);
    const from = e.dataTransfer.getData(DRAG_TYPE_AXIS) as CubeAxisSlot | "";
    if (from) {
      if (from !== slot) onSwap(from, slot);
      return;
    }
    const col = e.dataTransfer.getData(DRAG_TYPE_COLUMN) || e.dataTransfer.getData("text/plain");
    if (col) onReplace(slot, col);
  };

  const step = (dir: 1 | -1) => {
    if (slice == null) onSlice(dir === 1 ? 0 : nz - 1);
    else {
      const next = slice + dir;
      onSlice(next < 0 || next >= nz ? null : next);
    }
  };

  return (
    <div
      className="absolute top-2 left-2 z-[7] flex flex-col gap-1.5 items-start max-w-[calc(100%-1rem)] pointer-events-none"
      {...shield}
    >
      <div className="flex flex-wrap items-center gap-1 pointer-events-auto" role="group" aria-label="Pivot axes">
        {(["x", "y", "z"] as const).map((slot) => (
          <button
            key={slot}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE_AXIS, slot);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dropOn !== slot) setDropOn(slot);
            }}
            onDragLeave={() => setDropOn((d) => (d === slot ? null : d))}
            onDrop={onDrop(slot)}
            onClick={() => onChipClick(slot)}
            title={
              picked && picked !== slot
                ? `Swap ${SLOT_LABEL[picked]} ↔ ${SLOT_LABEL[slot]}`
                : "Drag onto another axis (or click two) to pivot · drop a column here to replace"
            }
            className={`flex items-center gap-1 max-w-[11rem] px-2 py-1 rounded-md border text-2xs backdrop-blur-sm cursor-grab active:cursor-grabbing transition-colors ${
              dropOn === slot || picked === slot
                ? "border-loom-accent bg-loom-accent/20 text-loom-text"
                : "border-loom-border bg-loom-surface/85 text-loom-text hover:border-loom-accent/60"
            }`}
          >
            <span className="text-loom-muted shrink-0">{SLOT_LABEL[slot]}</span>
            <span className="truncate font-medium">{axes[slot].field}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={onRotate}
          title="Rotate axes: rows → columns → depth → rows"
          aria-label="Rotate axes"
          className="px-2 py-1 rounded-md border border-loom-border bg-loom-surface/85 text-2xs text-loom-muted hover:text-loom-text hover:border-loom-accent/60 backdrop-blur-sm"
        >
          ↻ Pivot
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 pointer-events-auto">
        <div className="flex items-center rounded-md border border-loom-border bg-loom-surface/85 backdrop-blur-sm text-2xs">
          <button type="button" onClick={() => step(-1)} className="px-1.5 py-1 text-loom-muted hover:text-loom-text" aria-label="Previous slice" title="Previous slice ( [ )">
            ◀
          </button>
          <button
            type="button"
            onClick={() => onSlice(null)}
            className="px-1.5 py-1 min-w-[6.5rem] max-w-[12rem] truncate text-center text-loom-text"
            title={slice == null ? `All ${cube.z.field} rolled up — step to slice` : "Show all layers (Esc)"}
          >
            <span className="text-loom-muted">{cube.z.field}: </span>
            {slice == null ? "All" : cube.z.labels[slice]}
          </button>
          <button type="button" onClick={() => step(1)} className="px-1.5 py-1 text-loom-muted hover:text-loom-text" aria-label="Next slice" title="Next slice ( ] )">
            ▶
          </button>
        </div>
        <button
          type="button"
          onClick={onToggleTable}
          aria-pressed={tableOpen}
          className={`px-2 py-1 rounded-md border text-2xs backdrop-blur-sm ${
            tableOpen
              ? "border-loom-accent bg-loom-accent/20 text-loom-text"
              : "border-loom-border bg-loom-surface/85 text-loom-muted hover:text-loom-text hover:border-loom-accent/60"
          }`}
          title="Show the pivot table for this slice"
        >
          ▦ Table
        </button>
        {showLegend && (
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-loom-border bg-loom-surface/85 backdrop-blur-sm text-2xs font-mono text-loom-muted"
            title={`Voxel color + size = ${cube.valueLabel}`}
          >
            <span className="font-sans text-loom-text truncate max-w-[9rem]">{cube.valueLabel}</span>
            <span>{formatCubeNumber(cube.vMin)}</span>
            <span
              className="w-14 h-1.5 rounded-sm"
              style={{
                background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1]
                  .map((t) => sampleContinuous(ramp.length ? ramp : ["#c6dbef", "#08519c"], 0.15 + 0.85 * t))
                  .join(", ")})`,
              }}
              aria-hidden
            />
            <span>{formatCubeNumber(cube.vMax)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function DataCubePivotTable({
  table,
  ramp,
  hover,
  onHover,
}: {
  table: PivotTable;
  ramp: string[];
  hover: CubeHoverCell | null;
  onHover: (cell: CubeHoverCell | null) => void;
}) {
  const span = table.vMax - table.vMin;
  const tint = (v: number | null) => {
    if (v == null) return undefined;
    const t = span > 0 ? (v - table.vMin) / span : 1;
    const hex = sampleContinuous(ramp.length ? ramp : ["#c6dbef", "#08519c"], 0.15 + 0.85 * t);
    return { background: `color-mix(in srgb, ${hex} ${Math.round(18 + 52 * t)}%, transparent)` };
  };
  const hx = hover?.xi ?? -1;
  const hy = hover?.yi ?? -1;

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-[7] h-[44%] flex flex-col border-t border-loom-border bg-loom-surface/95 backdrop-blur-sm"
      {...shield}
      onMouseLeave={() => onHover(null)}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-2xs text-loom-muted border-b border-loom-border">
        <span className="truncate">
          <span className="text-loom-text font-medium">{table.valueLabel}</span> ·{" "}
          {table.sliceLabel != null ? `${table.depthField} = ${table.sliceLabel}` : `all ${table.depthField}`}
        </span>
        <span className="shrink-0 font-mono">Σ {formatCubeNumber(table.grand ?? NaN)}</span>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="text-2xs font-mono border-collapse min-w-full">
          <thead className="sticky top-0 z-[1] bg-loom-surface">
            <tr>
              <th className="sticky left-0 z-[2] bg-loom-surface px-2 py-1 text-left font-medium text-loom-muted whitespace-nowrap border-b border-r border-loom-border">
                {table.rowField} ╲ {table.colField}
              </th>
              {table.cols.map((c, j) => (
                <th
                  key={c}
                  className={`px-2 py-1 text-right font-medium whitespace-nowrap border-b border-loom-border ${j === hy ? "text-loom-text" : "text-loom-muted"}`}
                >
                  {c}
                </th>
              ))}
              <th className="px-2 py-1 text-right font-medium text-loom-text whitespace-nowrap border-b border-l border-loom-border">Total</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={r}>
                <th
                  className={`sticky left-0 z-[1] bg-loom-surface px-2 py-1 text-left font-medium whitespace-nowrap border-r border-loom-border ${i === hx ? "text-loom-text" : "text-loom-muted"}`}
                >
                  {r}
                </th>
                {table.cols.map((c, j) => {
                  const v = table.values[i]![j]!;
                  const on = i === hx && j === hy;
                  return (
                    <td
                      key={c}
                      onMouseEnter={() => (v == null ? onHover(null) : onHover({ xi: i, yi: j, zi: null }))}
                      style={tint(v)}
                      className={`px-2 py-1 text-right whitespace-nowrap tabular-nums ${v == null ? "text-loom-muted/50" : "text-loom-text"} ${on ? "outline outline-1 outline-[var(--loom-text)] -outline-offset-1" : ""}`}
                    >
                      {v == null ? "·" : formatCubeNumber(v)}
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-right whitespace-nowrap tabular-nums text-loom-text border-l border-loom-border">
                  {formatCubeNumber(table.rowTotals[i] ?? NaN)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th className="sticky left-0 bg-loom-surface px-2 py-1 text-left font-medium text-loom-text border-t border-r border-loom-border">Total</th>
              {table.colTotals.map((v, j) => (
                <td key={j} className="px-2 py-1 text-right whitespace-nowrap tabular-nums text-loom-text border-t border-loom-border">
                  {formatCubeNumber(v ?? NaN)}
                </td>
              ))}
              <td className="px-2 py-1 text-right whitespace-nowrap tabular-nums font-semibold text-loom-text border-t border-l border-loom-border">
                {formatCubeNumber(table.grand ?? NaN)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
