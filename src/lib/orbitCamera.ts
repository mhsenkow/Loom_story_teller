/** Camera limits shared by mouse, touch, keyboard, and the visible controls. */
export type OrbitCamera = { yaw: number; pitch: number; zoom: number };
export const DEFAULT_ORBIT_CAMERA: OrbitCamera = { yaw: 0.55, pitch: 0.35, zoom: 1 };
export const ORBIT_ZOOM_MIN = 0.4;
export const ORBIT_ZOOM_MAX = 3;

export function orbitZoom(zoom: number): number {
  return Math.max(ORBIT_ZOOM_MIN, Math.min(ORBIT_ZOOM_MAX, zoom));
}

export function orbitRotation(yaw: number, pitch: number): Pick<OrbitCamera, "yaw" | "pitch"> {
  const turn = Math.PI * 2;
  return { yaw: ((yaw + Math.PI) % turn + turn) % turn - Math.PI, pitch: Math.max(-1.2, Math.min(1.2, pitch)) };
}

/** Plain arrows inspect marks; Shift+arrows rotate without stealing that path. */
export function orbitCameraKey(camera: OrbitCamera, key: string, shift: boolean): OrbitCamera | null {
  if (key === "0") return { ...DEFAULT_ORBIT_CAMERA };
  if (["+", "=", "-", "_"].includes(key)) {
    return { ...camera, zoom: orbitZoom(camera.zoom * (key === "-" || key === "_" ? 1 / 1.2 : 1.2)) };
  }
  if (!shift || !key.startsWith("Arrow")) return null;
  const yaw = camera.yaw + (key === "ArrowLeft" ? -0.15 : key === "ArrowRight" ? 0.15 : 0);
  const pitch = camera.pitch + (key === "ArrowUp" ? -0.15 : key === "ArrowDown" ? 0.15 : 0);
  return { ...camera, ...orbitRotation(yaw, pitch) };
}
