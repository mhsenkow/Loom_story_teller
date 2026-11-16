"use client";

import type { Dispatch, SetStateAction } from "react";
import { DEFAULT_ORBIT_CAMERA, ORBIT_ZOOM_MAX, ORBIT_ZOOM_MIN, orbitZoom, type OrbitCamera } from "@/lib/orbitCamera";

const views = [
  { id: "perspective", label: "Perspective", yaw: 0.55, pitch: 0.35 },
  { id: "front", label: "Front", yaw: 0, pitch: 0 },
  { id: "side", label: "Side", yaw: Math.PI / 2, pitch: 0 },
  { id: "above", label: "Above", yaw: 0, pitch: 1.1 },
];

/** Outside the plotting canvas, so controls never hide data or enter exports. */
export function SceneCameraControls({ camera, onChange }: {
  camera: OrbitCamera;
  onChange: Dispatch<SetStateAction<OrbitCamera>>;
}) {
  const selected = views.find(view => Math.abs(view.yaw - camera.yaw) < 0.001 && Math.abs(view.pitch - camera.pitch) < 0.001)?.id ?? "custom";
  const button = "min-h-9 min-w-9 rounded border border-loom-border bg-loom-surface text-loom-text hover:bg-loom-elevated disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loom-accent";
  return (
    <div role="group" aria-label="3D camera" className="flex shrink-0 flex-wrap items-center justify-between gap-1.5 border-b border-loom-border px-2 py-1.5 text-2xs">
      <div className="flex items-center gap-1.5">
        <select aria-label="Camera view" value={selected} className={`${button} max-w-32 px-1.5`} onChange={event => {
          const view = views.find(item => item.id === event.target.value);
          if (view) onChange({ yaw: view.yaw, pitch: view.pitch, zoom: 1 });
        }}>
          <option value="custom" disabled>Custom view</option>
          {views.map(view => <option key={view.id} value={view.id}>{view.label}</option>)}
        </select>
        <span className="hidden xl:inline text-loom-muted">Drag to rotate · Shift + arrows</span>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Zoom out in 3D" title="Zoom out (−)" disabled={camera.zoom <= ORBIT_ZOOM_MIN} className={button} onClick={() => onChange(value => ({ ...value, zoom: orbitZoom(value.zoom / 1.2) }))}>−</button>
        <output aria-label="Camera zoom" className="min-w-10 text-center tabular-nums text-loom-label">{Math.round(camera.zoom * 100)}%</output>
        <button type="button" aria-label="Zoom in 3D" title="Zoom in (+)" disabled={camera.zoom >= ORBIT_ZOOM_MAX} className={button} onClick={() => onChange(value => ({ ...value, zoom: orbitZoom(value.zoom * 1.2) }))}>+</button>
        <button type="button" aria-label="Reset 3D camera" title="Reset rotation and zoom (0)" className={`${button} px-2`} onClick={() => onChange({ ...DEFAULT_ORBIT_CAMERA })}>Reset</button>
      </div>
    </div>
  );
}
