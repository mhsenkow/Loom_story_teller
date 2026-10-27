// Reset scatter view on chart change; aim globe camera at data (LOOM-141).
// @ts-nocheck
import { useEffect } from "react";
import { globeCameraForData } from "@/lib/geoMaps";
import { useLoomStore } from "@/lib/store";

export function useChartScatterGlobeEffects(args: {
  activeChart: { id: string; kind: string; xField?: string; yField?: string } | null;
  sampleRows: unknown;
  setScatterView: (v: { scale: number; panX: number; panY: number }) => void;
  setSceneOrbit: (o: { yaw: number; pitch: number; zoom: number }) => void;
}) {
  const { activeChart, sampleRows, setScatterView, setSceneOrbit } = args;

  useEffect(() => {
    if (activeChart?.kind === "scatter") setScatterView({ scale: 1, panX: 0, panY: 0 });
  }, [activeChart?.id, activeChart?.kind, setScatterView]);

  useEffect(() => {
    if (activeChart?.kind !== "globe" && activeChart?.kind !== "globeTrail") return;
    const sr = useLoomStore.getState().sampleRows;
    if (!sr) return;
    const cam = globeCameraForData(sr.rows, sr.columns, activeChart.xField, activeChart.yField);
    if (cam) setSceneOrbit({ yaw: cam.yaw, pitch: cam.pitch, zoom: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- LOOM-617: reset camera only when the chart identity or backing sample changes
  }, [activeChart?.id, sampleRows, setSceneOrbit]);
}
