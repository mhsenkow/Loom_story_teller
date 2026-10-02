// =================================================================
// Loom — Geography chart kinds (maps, choropleths, globe, arcs)
// =================================================================
// Canvas-first projected maps and globes. Specs stay encoding-portable;
// pixels use d3-geo + TopoJSON atlases. Capture always uses these drawers.
// =================================================================

import {
  geoEqualEarth,
  geoMercator,
  geoOrthographic,
  geoPath,
  geoGraticule10,
  type GeoProjection,
} from "d3-geo";
import type { ColumnInfo } from "./store";
import type { ChartKind, ChartRecommendation, YAggregateOption } from "./recommendations";
import { VIZ_CATEGORICAL } from "./chartPalettes";
import {
  getAtlas,
  pickAtlasKind,
  findFeatureIndex,
  isGeoRegionField,
  isLatField,
  isLonField,
  getWorldAtlas,
  getUsAtlas,
  type AtlasBundle,
  type AtlasKind,
} from "./geoAtlas";

export const GEO_MAP_KINDS = [
  "geoPoints",
  "geoBubbles",
  "geoHex",
  "globe",
  "globeTrail",
  "arcMap",
] as const;

export type GeoMapKind = (typeof GEO_MAP_KINDS)[number];

/** Includes rewritten choropleth (still classic ChartKind). */
export const GEO_FAMILY_KINDS = ["choropleth", ...GEO_MAP_KINDS] as const;

export const GEO_MAP_KIND_OPTIONS: { value: GeoMapKind; label: string }[] = [
  { value: "geoPoints", label: "Map points" },
  { value: "geoBubbles", label: "Bubble map" },
  { value: "geoHex", label: "Map hexbin" },
  { value: "globe", label: "Globe" },
  { value: "globeTrail", label: "Globe trails" },
  { value: "arcMap", label: "Arc map" },
];

export const GEO_MAP_NON_CARTESIAN = new Set<string>([
  "choropleth",
  "geoPoints",
  "geoBubbles",
  "geoHex",
  "globe",
  "globeTrail",
  "arcMap",
]);

export function isGeoMapKind(kind: string): kind is GeoMapKind {
  return (GEO_MAP_KINDS as readonly string[]).includes(kind);
}

export function isGeoFamilyKind(kind: string): boolean {
  return kind === "choropleth" || isGeoMapKind(kind);
}

/** Live WebGPU sphere points for `globe` only; Canvas remains the capture path. */
export function isWebGpuGlobeKind(kind: string): boolean {
  return kind === "globe";
}

export function geoMapRecommendationReason(kind: GeoMapKind | "choropleth"): string {
  const map: Record<string, string> = {
    choropleth: "Join region codes to world/US polygons — real filled map",
    geoPoints: "Projected lon/lat on coastlines",
    geoBubbles: "Sized markers on a geographic basemap",
    geoHex: "Hex density on a projected map",
    globe: "Orthographic sphere — drag to spin",
    globeTrail: "Paths wrapped on the globe",
    arcMap: "Great-circle arcs between locations",
  };
  return map[kind] ?? "Geographic chart";
}

function isNumCol(c: ColumnInfo): boolean {
  const t = c.data_type.toUpperCase();
  return ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT"].some((n) => t.includes(n));
}

function isNomCol(c: ColumnInfo): boolean {
  const t = c.data_type.toUpperCase();
  return t.includes("VARCHAR") || t.includes("TEXT") || t.includes("BOOL") || t.includes("DATE");
}

export function geoMapDataSupport(
  columns: ColumnInfo[],
  kind: GeoMapKind | "choropleth",
): { ok: boolean; reason: string } {
  const num = columns.filter(isNumCol);
  const lat = columns.find((c) => isLatField(c.name));
  const lon = columns.find((c) => isLonField(c.name));
  const region = columns.find((c) => isGeoRegionField(c.name));
  switch (kind) {
    case "choropleth":
      return region
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a country/state/region column" };
    case "geoPoints":
    case "geoBubbles":
    case "geoHex":
    case "globe":
    case "globeTrail":
      return lat && lon
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need latitude + longitude columns" };
    case "arcMap":
      return lat && lon
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need latitude + longitude for arcs" };
    default:
      return { ok: false, reason: "Unknown geo kind" };
  }
}

export function getGeoMapRandomEncoding(
  columns: ColumnInfo[],
  kind: GeoMapKind | "choropleth",
): { xField: string; yField: string | null; colorField: string | null; sizeField?: string | null } | null {
  const num = columns.filter(isNumCol);
  const nom = columns.filter(isNomCol);
  const lat = columns.find((c) => isLatField(c.name));
  const lon = columns.find((c) => isLonField(c.name));
  const region = columns.find((c) => isGeoRegionField(c.name));
  const pick = <T,>(arr: T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)];

  if (kind === "choropleth") {
    if (!region) return null;
    const y = pick(num.filter((c) => c.name !== region.name)) ?? null;
    return { xField: region.name, yField: y?.name ?? null, colorField: null };
  }
  if (!lat || !lon) {
    if (num.length < 2) return null;
    const shuffled = [...num].sort(() => Math.random() - 0.5);
    return {
      xField: shuffled[0]!.name,
      yField: shuffled[1]!.name,
      colorField: pick(nom)?.name ?? null,
      sizeField: shuffled[2]?.name ?? null,
    };
  }
  return {
    xField: lon.name,
    yField: lat.name,
    colorField: pick(nom.filter((c) => !isLatField(c.name) && !isLonField(c.name)))?.name ?? null,
    sizeField: pick(num.filter((c) => c.name !== lat.name && c.name !== lon.name))?.name ?? null,
  };
}

export function buildGeoMapRec(
  kind: GeoMapKind,
  columns: ColumnInfo[],
  xField: string,
  yField: string | null,
  colorField: string | null,
  opts?: {
    sizeField?: string | null;
    yAggregate?: YAggregateOption | null;
    score?: number;
    title?: string;
    subtitle?: string;
  },
): ChartRecommendation | null {
  if (!geoMapDataSupport(columns, kind).ok) return null;
  if (!columns.some((c) => c.name === xField)) return null;
  const sizeField = opts?.sizeField ?? null;
  const titles: Record<GeoMapKind, { title: string; subtitle: string }> = {
    geoPoints: {
      title: yField ? `${xField} × ${yField} map` : `Map · ${xField}`,
      subtitle: "projected points on coastlines",
    },
    geoBubbles: {
      title: sizeField ? `Bubbles · ${sizeField}` : "Bubble map",
      subtitle: "sized markers on a geographic basemap",
    },
    geoHex: {
      title: "Map hexbin",
      subtitle: "density on a projected map",
    },
    globe: {
      title: "Globe",
      subtitle: "orthographic sphere — drag to spin",
    },
    globeTrail: {
      title: "Globe trails",
      subtitle: "paths wrapped on the sphere",
    },
    arcMap: {
      title: "Arc map",
      subtitle: "great-circle connections",
    },
  };
  const meta = titles[kind];
  return {
    id: `geo-${kind}-${xField}-${yField ?? "n"}-${colorField ?? "n"}`,
    kind: kind as ChartKind,
    title: opts?.title ?? meta.title,
    subtitle: opts?.subtitle ?? meta.subtitle,
    score: opts?.score ?? 90,
    spec: {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      mark: { type: "circle", opacity: 0.8 },
      encoding: {
        longitude: { field: xField, type: "quantitative" },
        latitude: yField ? { field: yField, type: "quantitative" } : undefined,
        ...(colorField ? { color: { field: colorField, type: "nominal", scale: { range: VIZ_CATEGORICAL } } } : {}),
        ...(sizeField ? { size: { field: sizeField, type: "quantitative" } } : {}),
      },
      width: "container",
      height: "container",
    },
    xField,
    yField,
    colorField,
    sizeField: sizeField ?? undefined,
    yAggregate: opts?.yAggregate ?? null,
  };
}

export interface GeoRenderOpts {
  colors: string[];
  opacity: number;
  fontFamily?: string;
  themeText?: string;
  themeMuted?: string;
  themeBorder?: string;
  themeBg?: string;
  pointSize?: number;
  yAggregate?: YAggregateOption | null;
  yaw?: number;
  pitch?: number;
  zoom?: number;
  continuousStops?: string[];
  mini?: boolean;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function agg(vals: number[], how: YAggregateOption): number {
  if (!vals.length) return 0;
  switch (how) {
    case "mean":
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    case "min":
      return Math.min(...vals);
    case "max":
      return Math.max(...vals);
    case "count":
      return vals.length;
    default:
      return vals.reduce((a, b) => a + b, 0);
  }
}

function seqColor(t: number, stops?: string[]): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (stops && stops.length >= 2) {
    const i = clamped * (stops.length - 1);
    const lo = Math.floor(i);
    return stops[Math.min(lo, stops.length - 1)]!;
  }
  const hue = 220 - clamped * 180;
  const sat = 50 + clamped * 30;
  const lit = 18 + clamped * 42;
  return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

function withAlpha(hex: string, a: number): string {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${Math.max(0, Math.min(1, a))})`;
}

function fitProjection(
  projection: GeoProjection,
  atlas: AtlasBundle,
  w: number,
  h: number,
  pad: number,
): GeoProjection {
  // `pad` is sized for the title band; a ~2:1 world map is width-bound on
  // square / portrait / phone stages, so keep the full pad only on top.
  const side = Math.max(8, Math.round(pad * 0.25));
  const bottom = Math.max(12, Math.round(pad * 0.5));
  return projection.fitExtent(
    [
      [side, pad],
      [w - side, h - bottom],
    ],
    { type: "FeatureCollection", features: atlas.features },
  );
}

function drawLandOutline(
  ctx: CanvasRenderingContext2D,
  path: ReturnType<typeof geoPath>,
  atlas: AtlasBundle,
  border: string,
  fill?: string,
) {
  if (fill) {
    ctx.fillStyle = fill;
    for (const f of atlas.features) {
      const p = path(f);
      if (!p) continue;
      const region = new Path2D(p);
      ctx.fill(region);
    }
  }
  ctx.strokeStyle = border;
  ctx.lineWidth = 0.6;
  ctx.globalAlpha = 0.55;
  if (atlas.outline) {
    const p = path(atlas.outline);
    if (p) ctx.stroke(new Path2D(p));
  } else {
    for (const f of atlas.features) {
      const p = path(f);
      if (p) ctx.stroke(new Path2D(p));
    }
  }
  ctx.globalAlpha = 1;
}

function drawLegendBar(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: number,
  minV: number,
  maxV: number,
  muted: string,
  fontFamily: string,
  stops?: string[],
) {
  const legendW = Math.min(120, w - 2 * pad);
  const legendH = 8;
  const lx = w - pad - legendW;
  const ly = h - pad - legendH - 2;
  const grad = ctx.createLinearGradient(lx, 0, lx + legendW, 0);
  if (stops && stops.length >= 2) {
    stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
  } else {
    grad.addColorStop(0, "hsl(220, 50%, 18%)");
    grad.addColorStop(0.5, "hsl(130, 65%, 35%)");
    grad.addColorStop(1, "hsl(40, 80%, 55%)");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(lx, ly, legendW, legendH);
  ctx.font = `8px '${fontFamily}', sans-serif`;
  ctx.fillStyle = muted;
  ctx.textAlign = "left";
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));
  ctx.fillText(fmt(minV), lx, ly - 2);
  ctx.textAlign = "right";
  ctx.fillText(fmt(maxV), lx + legendW, ly - 2);
}

/** Real polygon choropleth. */
export function renderGeoChoropleth(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  columns: string[],
  regionField: string,
  valueField: string | null,
  w: number,
  h: number,
  pad: number,
  opts: GeoRenderOpts,
): void {
  const ri = columns.indexOf(regionField);
  if (ri < 0) return;
  const vi = valueField ? columns.indexOf(valueField) : -1;
  const how: YAggregateOption = vi < 0 ? "count" : (opts.yAggregate ?? "sum");
  const samples = rows.slice(0, 40).map((r) => r[ri]);
  const atlasKind = pickAtlasKind(regionField, samples);
  const atlas = getAtlas(atlasKind);
  const groups = new Map<number, number[]>();
  for (const r of rows) {
    const idx = findFeatureIndex(atlas, r[ri]);
    if (idx < 0) continue;
    const list = groups.get(idx) ?? [];
    list.push(vi >= 0 ? num(r[vi]) : 1);
    groups.set(idx, list);
  }
  const values = new Map<number, number>();
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [idx, vals] of groups) {
    const v = agg(vals.filter((x) => !isNaN(x)), how);
    values.set(idx, v);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  if (!Number.isFinite(minV)) {
    minV = 0;
    maxV = 1;
  }
  const span = maxV - minV || 1;
  const bg = opts.themeBg ?? "#0a0a0c";
  const muted = opts.themeMuted ?? "#6b6b78";
  const border = opts.themeBorder ?? "#2a2a30";
  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const projection = fitProjection(
    atlasKind === "us" ? geoMercator() : geoEqualEarth(),
    atlas,
    w,
    h,
    pad,
  );
  const path = geoPath(projection, undefined);

  for (let i = 0; i < atlas.features.length; i++) {
    const f = atlas.features[i]!;
    const p = path(f);
    if (!p) continue;
    const region = new Path2D(p);
    const v = values.get(i);
    if (v == null) {
      ctx.fillStyle = withAlpha(border, 0.25);
    } else {
      ctx.fillStyle = seqColor((v - minV) / span, opts.continuousStops);
    }
    ctx.globalAlpha = opts.opacity ?? 0.9;
    ctx.fill(region);
    ctx.strokeStyle = border;
    ctx.lineWidth = 0.4;
    ctx.globalAlpha = 0.5;
    ctx.stroke(region);
  }
  ctx.globalAlpha = 1;
  if (!opts.mini && values.size > 0) {
    drawLegendBar(ctx, w, h, pad, minV, maxV, muted, opts.fontFamily ?? "Inter", opts.continuousStops);
  }
  ctx.restore();
}

function resolveLonLat(
  columns: string[],
  xField: string,
  yField: string | null,
): { lonI: number; latI: number } {
  let lonI = columns.indexOf(xField);
  let latI = yField ? columns.indexOf(yField) : -1;
  const latCol = columns.findIndex((c) => isLatField(c));
  const lonCol = columns.findIndex((c) => isLonField(c));
  if (latCol >= 0 && lonCol >= 0) {
    // Prefer explicit lat/lon names when x/y were swapped or generic.
    if (isLatField(xField) && yField && isLonField(yField)) {
      lonI = columns.indexOf(yField);
      latI = columns.indexOf(xField);
    } else if (isLonField(xField) && yField && isLatField(yField)) {
      lonI = columns.indexOf(xField);
      latI = columns.indexOf(yField);
    } else if (!isLonField(xField) || !(yField && isLatField(yField))) {
      lonI = lonCol;
      latI = latCol;
    }
  }
  return { lonI, latI };
}

function collectPoints(
  rows: unknown[][],
  lonI: number,
  latI: number,
  colorI: number,
  sizeI: number,
): { lon: number; lat: number; category: number; size: number }[] {
  const catMap = new Map<string, number>();
  const out: { lon: number; lat: number; category: number; size: number }[] = [];
  for (const r of rows) {
    const lon = num(r[lonI]);
    const lat = num(r[latI]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    let cat = 0;
    if (colorI >= 0) {
      const k = String(r[colorI] ?? "");
      if (!catMap.has(k)) catMap.set(k, catMap.size % 8);
      cat = catMap.get(k)!;
    }
    const size = sizeI >= 0 ? num(r[sizeI]) : 1;
    out.push({ lon, lat, category: cat, size: Number.isFinite(size) ? size : 1 });
  }
  return out;
}

function renderProjectedPoints(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  columns: string[],
  xField: string,
  yField: string | null,
  colorField: string | null,
  sizeField: string | null,
  w: number,
  h: number,
  pad: number,
  opts: GeoRenderOpts,
  mode: "points" | "bubbles" | "hex",
): void {
  const { lonI, latI } = resolveLonLat(columns, xField, yField);
  if (lonI < 0 || latI < 0) return;
  const colorI = colorField ? columns.indexOf(colorField) : -1;
  const sizeI = sizeField ? columns.indexOf(sizeField) : -1;
  const pts = collectPoints(rows, lonI, latI, colorI, sizeI);
  const bg = opts.themeBg ?? "#0a0a0c";
  const border = opts.themeBorder ?? "#2a2a30";
  const muted = opts.themeMuted ?? "#6b6b78";
  const colors = opts.colors.length ? opts.colors : VIZ_CATEGORICAL;
  const atlas = getWorldAtlas();
  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const projection = fitProjection(geoEqualEarth(), atlas, w, h, pad);
  const path = geoPath(projection, undefined);
  drawLandOutline(ctx, path, atlas, border, withAlpha(border, 0.12));

  // Graticule
  ctx.strokeStyle = withAlpha(muted, 0.25);
  ctx.lineWidth = 0.5;
  const g = path(geoGraticule10());
  if (g) ctx.stroke(new Path2D(g));

  if (mode === "hex") {
    const cols = Math.max(12, Math.floor((w - 2 * pad) / 18));
    const rowsN = Math.max(8, Math.floor((h - 2 * pad) / 16));
    const counts = Array.from({ length: rowsN }, () => Array(cols).fill(0));
    let maxC = 1;
    for (const p of pts) {
      const xy = projection([p.lon, p.lat]);
      if (!xy) continue;
      const [px, py] = xy;
      const c = Math.min(cols - 1, Math.max(0, Math.floor(((px - pad) / (w - 2 * pad)) * cols)));
      const r = Math.min(rowsN - 1, Math.max(0, Math.floor(((py - pad) / (h - 2 * pad)) * rowsN)));
      counts[r]![c]! += 1;
      maxC = Math.max(maxC, counts[r]![c]!);
    }
    const hexR = Math.min((w - 2 * pad) / cols, (h - 2 * pad) / rowsN) * 0.45;
    for (let r = 0; r < rowsN; r++) {
      for (let c = 0; c < cols; c++) {
        const n = counts[r]![c]!;
        if (n <= 0) continue;
        const cx = pad + ((c + 0.5) / cols) * (w - 2 * pad);
        const cy = pad + ((r + 0.5) / rowsN) * (h - 2 * pad);
        const t = n / maxC;
        ctx.fillStyle = seqColor(t, opts.continuousStops);
        ctx.globalAlpha = (opts.opacity ?? 0.85) * (0.35 + t * 0.65);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          const x = cx + hexR * Math.cos(a);
          const y = cy + hexR * Math.sin(a);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  } else {
    const sizes = pts.map((p) => p.size);
    const sMin = Math.min(...sizes, 1);
    const sMax = Math.max(...sizes, 1);
    const sSpan = sMax - sMin || 1;
    const base = opts.pointSize ?? (mode === "bubbles" ? 6 : 3.5);
    for (const p of pts) {
      const xy = projection([p.lon, p.lat]);
      if (!xy) continue;
      const [px, py] = xy;
      const r =
        mode === "bubbles"
          ? base * (0.5 + Math.sqrt((p.size - sMin) / sSpan) * 2.2)
          : base * (0.7 + ((p.size - sMin) / sSpan) * 0.8);
      ctx.fillStyle = withAlpha(colors[p.category % colors.length] ?? "#6c5ce7", opts.opacity ?? 0.85);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.2, r), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function lonLatToSphere(
  lon: number,
  lat: number,
  yaw: number,
  pitch: number,
  zoom: number,
  w: number,
  h: number,
  _pad: number,
): { sx: number; sy: number; visible: boolean; depth: number } {
  const lam = ((lon - (yaw * 180) / Math.PI + 540) % 360) - 180;
  const phi = lat;
  const lamR = (lam * Math.PI) / 180;
  const phiR = (phi * Math.PI) / 180;
  const x = Math.cos(phiR) * Math.sin(lamR);
  const y = Math.sin(phiR);
  const z = Math.cos(phiR) * Math.cos(lamR);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = y * cp - z * sp;
  const z2 = y * sp + z * cp;
  const R = Math.min(w, h) * 0.38 * zoom;
  const cx = w / 2;
  const cy = h / 2;
  return {
    sx: cx + x * R,
    sy: cy - y2 * R,
    visible: z2 > -0.05,
    depth: z2,
  };
}

function renderGlobeLike(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  columns: string[],
  xField: string,
  yField: string | null,
  colorField: string | null,
  sizeField: string | null,
  w: number,
  h: number,
  pad: number,
  opts: GeoRenderOpts,
  trails: boolean,
): void {
  const { lonI, latI } = resolveLonLat(columns, xField, yField);
  if (lonI < 0 || latI < 0) return;
  const colorI = colorField ? columns.indexOf(colorField) : -1;
  const sizeI = sizeField ? columns.indexOf(sizeField) : -1;
  const yaw = opts.yaw ?? 0.4;
  const pitch = opts.pitch ?? 0.25;
  const zoom = opts.zoom ?? 1;
  const bg = opts.themeBg ?? "#0a0a0c";
  const border = opts.themeBorder ?? "#2a2a30";
  const muted = opts.themeMuted ?? "#6b6b78";
  const colors = opts.colors.length ? opts.colors : VIZ_CATEGORICAL;
  const atlas = getWorldAtlas();

  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const R = Math.min(w, h) * 0.38 * zoom;
  const cx = w / 2;
  const cy = h / 2;

  // Sphere disc
  const grd = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
  grd.addColorStop(0, withAlpha(border, 0.35));
  grd.addColorStop(1, withAlpha(border, 0.08));
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.stroke();

  const projection = geoOrthographic()
    .rotate([(-yaw * 180) / Math.PI, (-pitch * 180) / Math.PI])
    .translate([cx, cy])
    .scale(R);
  const path = geoPath(projection, undefined);
  ctx.fillStyle = withAlpha(border, 0.2);
  for (const f of atlas.features) {
    const p = path(f);
    if (!p) continue;
    ctx.fill(new Path2D(p));
  }
  ctx.strokeStyle = withAlpha(muted, 0.35);
  ctx.lineWidth = 0.5;
  if (atlas.outline) {
    const land = path(atlas.outline);
    if (land) ctx.stroke(new Path2D(land));
  }

  const pts = collectPoints(rows, lonI, latI, colorI, sizeI);
  const sizes = pts.map((p) => p.size);
  const sMin = Math.min(...sizes, 1);
  const sMax = Math.max(...sizes, 1);
  const sSpan = sMax - sMin || 1;
  const base = opts.pointSize ?? 3.5;

  if (trails && pts.length >= 2) {
    // Unwrap by time order (row order) with antimeridian continuity on sphere as short segments.
    const projected = pts
      .map((p) => ({ ...p, ...lonLatToSphere(p.lon, p.lat, yaw, pitch, zoom, w, h, pad) }))
      .filter((p) => p.visible);
    for (let i = 1; i < projected.length; i++) {
      const a = projected[i - 1]!;
      const b = projected[i]!;
      const fade = 0.2 + 0.8 * (i / (projected.length - 1));
      ctx.strokeStyle = withAlpha(colors[b.category % colors.length] ?? "#6c5ce7", (opts.opacity ?? 0.85) * fade);
      ctx.lineWidth = Math.max(1.5, base * (0.5 + ((b.size - sMin) / sSpan)));
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }
    const tip = projected[projected.length - 1];
    if (tip) {
      ctx.fillStyle = withAlpha(colors[tip.category % colors.length] ?? "#6c5ce7", opts.opacity ?? 0.9);
      ctx.beginPath();
      ctx.arc(tip.sx, tip.sy, base * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const drawn = pts
      .map((p) => ({ ...p, ...lonLatToSphere(p.lon, p.lat, yaw, pitch, zoom, w, h, pad) }))
      .filter((p) => p.visible)
      .sort((a, b) => a.depth - b.depth);
    for (const p of drawn) {
      const r = base * (0.6 + Math.sqrt((p.size - sMin) / sSpan) * 1.6);
      ctx.fillStyle = withAlpha(colors[p.category % colors.length] ?? "#6c5ce7", opts.opacity ?? 0.85);
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, Math.max(1.2, r), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (!opts.mini) {
    ctx.fillStyle = muted;
    ctx.font = `10px '${opts.fontFamily ?? "Inter"}', sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(trails ? "Globe trails · drag to spin" : "Globe · drag to spin", pad, h - 10);
  }
  ctx.restore();
}

function renderArcMap(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  columns: string[],
  xField: string,
  yField: string | null,
  colorField: string | null,
  w: number,
  h: number,
  pad: number,
  opts: GeoRenderOpts,
): void {
  const { lonI, latI } = resolveLonLat(columns, xField, yField);
  if (lonI < 0 || latI < 0) return;
  const colorI = colorField ? columns.indexOf(colorField) : -1;
  const pts = collectPoints(rows, lonI, latI, colorI, -1);
  const bg = opts.themeBg ?? "#0a0a0c";
  const border = opts.themeBorder ?? "#2a2a30";
  const colors = opts.colors.length ? opts.colors : VIZ_CATEGORICAL;
  const atlas = getWorldAtlas();
  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const projection = fitProjection(geoEqualEarth(), atlas, w, h, pad);
  const path = geoPath(projection, undefined);
  drawLandOutline(ctx, path, atlas, border, withAlpha(border, 0.1));

  // Connect consecutive points (or same-category chains) as great-circle approximations.
  const byCat = new Map<number, typeof pts>();
  for (const p of pts) {
    const list = byCat.get(p.category) ?? [];
    list.push(p);
    byCat.set(p.category, list);
  }
  for (const [cat, list] of byCat) {
    if (list.length < 2) continue;
    for (let i = 1; i < Math.min(list.length, 80); i++) {
      const a = list[i - 1]!;
      const b = list[i]!;
      const line = {
        type: "LineString" as const,
        coordinates: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ],
      };
      const p = path(line);
      if (!p) continue;
      ctx.strokeStyle = withAlpha(colors[cat % colors.length] ?? "#6c5ce7", (opts.opacity ?? 0.7) * 0.8);
      ctx.lineWidth = 1.4;
      ctx.stroke(new Path2D(p));
    }
  }
  for (const p of pts.slice(0, 400)) {
    const xy = projection([p.lon, p.lat]);
    if (!xy) continue;
    ctx.fillStyle = withAlpha(colors[p.category % colors.length] ?? "#6c5ce7", opts.opacity ?? 0.85);
    ctx.beginPath();
    ctx.arc(xy[0], xy[1], opts.pointSize ?? 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function renderGeoMapCanvas(
  kind: GeoMapKind | "choropleth",
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  columns: string[],
  encoding: {
    xField: string;
    yField: string | null;
    colorField?: string | null;
    sizeField?: string | null;
  },
  w: number,
  h: number,
  pad: number,
  opts: GeoRenderOpts,
): void {
  const { xField, yField, colorField, sizeField } = encoding;
  if (kind === "choropleth") {
    renderGeoChoropleth(ctx, rows, columns, xField, yField, w, h, pad, opts);
    return;
  }
  if (kind === "globe") {
    renderGlobeLike(ctx, rows, columns, xField, yField, colorField ?? null, sizeField ?? null, w, h, pad, opts, false);
    return;
  }
  if (kind === "globeTrail") {
    renderGlobeLike(ctx, rows, columns, xField, yField, colorField ?? null, sizeField ?? null, w, h, pad, opts, true);
    return;
  }
  if (kind === "arcMap") {
    renderArcMap(ctx, rows, columns, xField, yField, colorField ?? null, w, h, pad, opts);
    return;
  }
  if (kind === "geoHex") {
    renderProjectedPoints(ctx, rows, columns, xField, yField, colorField ?? null, sizeField ?? null, w, h, pad, opts, "hex");
    return;
  }
  if (kind === "geoBubbles") {
    renderProjectedPoints(ctx, rows, columns, xField, yField, colorField ?? null, sizeField ?? null, w, h, pad, opts, "bubbles");
    return;
  }
  renderProjectedPoints(ctx, rows, columns, xField, yField, colorField ?? null, sizeField ?? null, w, h, pad, opts, "points");
}

export { getWorldAtlas, getUsAtlas, pickAtlasKind, type AtlasKind };
