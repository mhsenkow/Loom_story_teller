/** Records effective paint operations, not unused option assignments, for parameter audits. */
import { createHash } from "node:crypto";

export function recordChartPaint() {
  const hash = createHash("sha256");
  let state: Record<string, unknown> = {
    font: "12px sans-serif", fillStyle: "#000000", strokeStyle: "#000000",
    globalAlpha: 1, globalCompositeOperation: "source-over", lineWidth: 1,
    lineCap: "butt", lineJoin: "miter", miterLimit: 10, dash: [], lineDashOffset: 0,
    textAlign: "start", textBaseline: "alphabetic", shadowBlur: 0,
    shadowColor: "rgba(0, 0, 0, 0)", shadowOffsetX: 0, shadowOffsetY: 0,
    transforms: [], clips: [],
  };
  const stack: Record<string, unknown>[] = [];
  const path: unknown[] = [];
  const record = (...values: unknown[]) => hash.update(JSON.stringify(values));
  const ctx = new Proxy({}, {
    get(_, key: string) {
      if (key in state) return state[key];
      if (key === "measureText") return (s: string) => {
        const size = Number(String(state.font).match(/([\d.]+)px/)?.[1]) || 12;
        const width = String(s).length * size * .55;
        return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: size * .8, actualBoundingBoxDescent: size * .2 };
      };
      if (key === "save") return () => stack.push({ ...state });
      if (key === "restore") return () => { state = stack.pop() ?? {}; };
      if (key === "beginPath") return () => { path.length = 0; };
      if (key === "getLineDash") return () => state.dash ?? [];
      if (key === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (key === "setLineDash") return (dash: number[]) => { state.dash = dash; };
      if (key === "createLinearGradient" || key === "createRadialGradient") return (...args: unknown[]) => {
        const stops: unknown[] = [];
        return { kind: key, args, stops, addColorStop: (...stop: unknown[]) => stops.push(stop) };
      };
      return (...args: unknown[]) => {
        if (["translate", "rotate", "scale", "transform", "setTransform"].includes(key)) {
          state.transforms = [...(key === "setTransform" ? [] : state.transforms as unknown[]), [key, args]];
        } else if (key === "clip") state.clips = [...state.clips as unknown[], [...path]];
        else if (["fill", "stroke", "fillRect", "strokeRect", "fillText", "strokeText", "drawImage"].includes(key)) {
          const properties = ["globalAlpha", "globalCompositeOperation", "shadowBlur", "shadowColor", "shadowOffsetX", "shadowOffsetY", "transforms", "clips"];
          if (key.startsWith("stroke")) properties.push("strokeStyle", "lineWidth", "lineCap", "lineJoin", "miterLimit", "dash", "lineDashOffset");
          else properties.push("fillStyle");
          if (key.endsWith("Text")) properties.push("font", "textAlign", "textBaseline");
          record(key, args, Object.fromEntries(properties.map(p => [p, state[p]])), key === "fill" || key === "stroke" ? path : []);
        } else path.push([key, args, state.transforms]);
      };
    },
    set(_, key: string, value) { state[key] = value; return true; },
  }) as CanvasRenderingContext2D;
  return { ctx, digest: () => hash.digest("hex") };
}
