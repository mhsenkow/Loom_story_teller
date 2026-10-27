// Data cube build, pivot table, axis swaps, and depth keyboard (LOOM-141).
// @ts-nocheck
import { useCallback, useEffect, useMemo } from "react";
import type { CubeAxisSlot } from "@/components/DataCubePivot";
import { buildDataCube, buildPivotTable, cubeCellCenter, cubeCellKey, type DataCube } from "@/lib/dataCube";
import { createChartRec } from "@/lib/recommendations";

export type UseDataCubeStageArgs = {
  activeChart: {
    kind: string;
    xField?: string;
    yField?: string;
    zField?: string;
    sizeField?: string | null;
    yAggregate?: string | null;
    channelInvert?: { size?: boolean };
    tooltipFields?: string[];
    tooltipKeyField?: string | null;
  } | null;
  chartSampleRows: { rows: unknown[][]; columns: string[] } | null | undefined;
  sampleRows: { columns: string[] } | null | undefined;
  columnStats: { name: string }[];
  selectedFile: { name?: string } | null;
  setActiveChart: (rec: unknown) => void;
  cubeSlice: number | null;
  setCubeSlice: React.Dispatch<React.SetStateAction<number | null>>;
  cubeTableOpen: boolean;
  reducedMotion: boolean;
  prevCubeRef: React.MutableRefObject<DataCube | null>;
  cubeTransitionRef: React.MutableRefObject<{ cube: DataCube; from: Map<string, [number, number, number]> } | null>;
  setCubeAnim: React.Dispatch<React.SetStateAction<number>>;
};

export function useDataCubeStage(args: UseDataCubeStageArgs) {
  const {
    activeChart,
    chartSampleRows,
    sampleRows,
    columnStats,
    selectedFile,
    setActiveChart,
    cubeSlice,
    setCubeSlice,
    cubeTableOpen,
    reducedMotion,
    prevCubeRef,
    cubeTransitionRef,
    setCubeAnim,
  } = args;

  const dataCube = useMemo(() => {
    if (activeChart?.kind !== "dataCube" || !chartSampleRows?.rows?.length) return null;
    return buildDataCube(chartSampleRows.rows, chartSampleRows.columns, {
      xField: activeChart.xField,
      yField: activeChart.yField,
      zField: activeChart.zField,
      valueField: activeChart.sizeField,
      aggregate: activeChart.yAggregate,
      invertSize: !!activeChart.channelInvert?.size,
    });
  }, [
    activeChart?.kind,
    activeChart?.xField,
    activeChart?.yField,
    activeChart?.zField,
    activeChart?.sizeField,
    activeChart?.yAggregate,
    activeChart?.channelInvert?.size,
    chartSampleRows,
  ]);

  const pivotTable = useMemo(() => {
    if (!cubeTableOpen || activeChart?.kind !== "dataCube" || !chartSampleRows?.rows?.length) return null;
    return buildPivotTable(
      chartSampleRows.rows,
      chartSampleRows.columns,
      {
        xField: activeChart.xField,
        yField: activeChart.yField,
        zField: activeChart.zField,
        valueField: activeChart.sizeField,
        aggregate: activeChart.yAggregate,
      },
      cubeSlice,
    );
  }, [
    cubeTableOpen,
    cubeSlice,
    activeChart?.kind,
    activeChart?.xField,
    activeChart?.yField,
    activeChart?.zField,
    activeChart?.sizeField,
    activeChart?.yAggregate,
    chartSampleRows,
  ]);

  useEffect(() => {
    setCubeSlice(null);
  }, [activeChart?.zField, activeChart?.kind, setCubeSlice]);

  useEffect(() => {
    if (dataCube && cubeSlice != null && cubeSlice >= dataCube.z.labels.length) setCubeSlice(null);
  }, [dataCube, cubeSlice, setCubeSlice]);

  useEffect(() => {
    const prev = prevCubeRef.current;
    prevCubeRef.current = dataCube;
    if (!prev || !dataCube || prev === dataCube) return;
    const fields = (c: DataCube) => [c.x.field, c.y.field, c.z.field];
    const same = [...fields(prev)].sort().join("\u0001") === [...fields(dataCube)].sort().join("\u0001");
    if (!same || fields(prev).join("\u0001") === fields(dataCube).join("\u0001")) return;
    if (reducedMotion) return;
    const from = new Map<string, [number, number, number]>();
    for (const cell of prev.cells) from.set(cubeCellKey(prev, cell), cubeCellCenter(prev, cell.xi, cell.yi, cell.zi));
    cubeTransitionRef.current = { cube: dataCube, from };
    const start = performance.now();
    const DURATION = 650;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      setCubeAnim(t);
      if (t < 1) raf = requestAnimationFrame(tick);
      else cubeTransitionRef.current = null;
    };
    setCubeAnim(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dataCube, reducedMotion, prevCubeRef, cubeTransitionRef, setCubeAnim]);

  const applyCubeAxes = useCallback(
    (next: Record<CubeAxisSlot, string>) => {
      if (!activeChart || activeChart.kind !== "dataCube" || columnStats.length === 0) return;
      const table = selectedFile?.name?.replace(/\.\w+$/, "") ?? "";
      const rec = createChartRec("dataCube", columnStats, next.x, next.y, null, table, {
        zField: next.z,
        sizeField: activeChart.sizeField ?? null,
        yAggregate: activeChart.yAggregate ?? null,
        tooltipFields: activeChart.tooltipFields,
        tooltipKeyField: activeChart.tooltipKeyField ?? null,
      });
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, selectedFile?.name, setActiveChart],
  );

  const cubeAxes = useCallback(
    (): Record<CubeAxisSlot, string> => ({
      x: activeChart?.xField ?? "",
      y: activeChart?.yField ?? "",
      z: activeChart?.zField ?? "",
    }),
    [activeChart?.xField, activeChart?.yField, activeChart?.zField],
  );

  const swapCubeAxes = useCallback(
    (a: CubeAxisSlot, b: CubeAxisSlot) => {
      const cur = cubeAxes();
      applyCubeAxes({ ...cur, [a]: cur[b], [b]: cur[a] });
    },
    [cubeAxes, applyCubeAxes],
  );

  const rotateCubeAxes = useCallback(() => {
    const cur = cubeAxes();
    applyCubeAxes({ x: cur.z, y: cur.x, z: cur.y });
  }, [cubeAxes, applyCubeAxes]);

  const replaceCubeAxis = useCallback(
    (slot: CubeAxisSlot, column: string) => {
      if (!sampleRows?.columns.includes(column)) return;
      const cur = cubeAxes();
      const other = (Object.keys(cur) as CubeAxisSlot[]).find((k) => cur[k] === column);
      if (other) {
        if (other !== slot) swapCubeAxes(other, slot);
        return;
      }
      applyCubeAxes({ ...cur, [slot]: column });
    },
    [cubeAxes, applyCubeAxes, swapCubeAxes, sampleRows?.columns],
  );

  useEffect(() => {
    if (activeChart?.kind !== "dataCube" || !dataCube) return;
    const nz = dataCube.z.labels.length;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "]") {
        e.preventDefault();
        setCubeSlice((s) => (s == null ? 0 : s + 1 >= nz ? null : s + 1));
      } else if (e.key === "[") {
        e.preventDefault();
        setCubeSlice((s) => (s == null ? nz - 1 : s - 1 < 0 ? null : s - 1));
      } else if (e.key === "Escape") {
        setCubeSlice((s) => (s == null ? s : null));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeChart?.kind, dataCube, setCubeSlice]);

  return { dataCube, pivotTable, swapCubeAxes, rotateCubeAxes, replaceCubeAxis };
}
