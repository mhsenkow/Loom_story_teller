// =================================================================
// Loom — Geography chart kinds (maps, choropleths, globe, arcs)
// =================================================================
// Canvas-first projected maps and globes. Specs stay encoding-portable;
// pixels use d3-geo + TopoJSON atlases. Capture always uses these drawers.
// =================================================================

import {
  geoAlbersUsa,
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
import {
  resolveChartInk,
  inkTint,
  withAlpha,
  rampColor,
  sequentialStops,
  drawEmptyMessage,
  drawRampKey,
  rampKeyHeight,
  drawSizeKey,
  categoryIndex,
  radiusFromPointSize,
  type ChartInk,
} from "./chartInk";

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
  /** Opaque bg is painted; transparent / omitted lets the host surface show through. */
  themeBg?: string;
  /** Visual → Point size (UI units, 12 = default) or a literal radius for thumbnails. */
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

const AGG_WORD: Record<YAggregateOption, string> = { sum: "Sum", mean: "Avg", count: "Count", min: "Min", max: "Max" };

/** Theme-derived basemap colors that separate from the background in light and dark themes. */
type MapInk = ChartInk & { land: string; landEdge: string; graticule: string; ocean: string; halo: string };

function mapInk(opts: GeoRenderOpts): MapInk {
  const ink = resolveChartInk(opts);
  return {
    ...ink,
    land: inkTint(ink, ink.light ? 0.1 : 0.15),
    landEdge: inkTint(ink, ink.light ? 0.34 : 0.36),
    graticule: inkTint(ink, ink.light ? 0.08 : 0.09),
    ocean: inkTint(ink, ink.light ? 0.03 : 0.05),
    halo: ink.bg,
  };
}

function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, ink: MapInk) {
  if (!ink.paintBg) return;
  ctx.fillStyle = ink.bg;
  ctx.fillRect(0, 0, w, h);
}

/** Insets that keep the map clear of the title band (top) and an optional key strip (bottom). */
function mapInsets(pad: number, reserveBottom = 0): { side: number; top: number; bottom: number } {
  // `pad` is sized for the title band; a ~2:1 world map is width-bound on
  // square / portrait / phone stages, so keep the full pad only on top.
  const side = Math.max(8, Math.round(pad * 0.25));
  const bottom = Math.max(12, Math.round(pad * 0.5)) + reserveBottom;
  return { side, top: pad, bottom };
}

function fitProjection(
  projection: GeoProjection,
  atlas: AtlasBundle,
  w: number,
  h: number,
  pad: number,
  reserveBottom = 0,
): GeoProjection {
  const { side, top, bottom } = mapInsets(pad, reserveBottom);
  return projection.fitExtent(
    [
      [side, top],
      [w - side, Math.max(top + 20, h - bottom)],
    ],
    { type: "FeatureCollection", features: atlas.features },
  );
}

/** Lon/lat bounding box of points, or null when they span too much of the globe to zoom in. */
function regionalBounds(pts: { lon: number; lat: number }[]): [[number, number], [number, number]] | null {
  if (!pts.length) return null;
  // Fit to the 2nd–98th percentile on each axis (when there are enough points) so a
  // few mis-geocoded rows — a 311 ticket at 0°, 0° — can't zoom a city out to a hemisphere.
  const lons = pts.map((p) => p.lon).sort((a, b) => a - b);
  const lats = pts.map((p) => p.lat).sort((a, b) => a - b);
  const trim = pts.length >= 25 ? Math.floor(pts.length * 0.02) : 0;
  const lo0 = lons[trim]!, lo1 = lons[lons.length - 1 - trim]!;
  const la0 = lats[trim]!, la1 = lats[lats.length - 1 - trim]!;
  // Wide spreads (or antimeridian-straddling sets) read best on the whole world.
  if (lo1 - lo0 > 100 || la1 - la0 > 60) return null;
  // Pad 15% each side with a minimum ~0.4° (~40 km) window: a city's docks fill the frame,
  // and a single point still shows its surroundings.
  const minSpan = 0.4;
  const padLon = Math.max((lo1 - lo0) * 0.15, (minSpan - (lo1 - lo0)) / 2, 0.02);
  const padLat = Math.max((la1 - la0) * 0.15, (minSpan - (la1 - la0)) / 2, 0.02);
  return [
    [Math.max(-180, lo0 - padLon), Math.max(-85, la0 - padLat)],
    [Math.min(180, lo1 + padLon), Math.min(85, la1 + padLat)],
  ];
}

/**
 * Projection for point layers: whole-world Equal Earth when the data is
 * global, else Mercator fitted to the points' (padded) extent so a
 * city-scale dataset isn't two dots on a world map.
 */
function fitPointsProjection(
  pts: { lon: number; lat: number }[],
  atlas: AtlasBundle,
  w: number,
  h: number,
  pad: number,
  reserveBottom = 0,
): { projection: GeoProjection; regional: [[number, number], [number, number]] | null } {
  const bounds = regionalBounds(pts);
  if (!bounds) return { projection: fitProjection(geoEqualEarth(), atlas, w, h, pad, reserveBottom), regional: null };
  const { side, top, bottom } = mapInsets(pad, reserveBottom);
  const [[x0, y0], [x1, y1]] = bounds;
  const projection = geoMercator().fitExtent(
    [
      [side, top],
      [w - side, Math.max(top + 20, h - bottom)],
    ],
    {
      type: "Feature",
      properties: {},
      geometry: { type: "MultiPoint", coordinates: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] },
    },
  );
  return { projection, regional: bounds };
}

/** US state borders add context when a regional view sits inside the lower 48 / AK / HI. */
function drawRegionalDetail(
  ctx: CanvasRenderingContext2D,
  path: ReturnType<typeof geoPath>,
  bounds: [[number, number], [number, number]],
  ink: MapInk,
) {
  const [[x0, y0], [x1, y1]] = bounds;
  if (x1 < -170 || x0 > -60 || y1 < 15 || y0 > 72) return;
  const us = getUsAtlas();
  ctx.save();
  ctx.strokeStyle = ink.landEdge;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 0.6;
  ctx.setLineDash([3, 2]);
  for (const f of us.features) {
    const p = path(f);
    if (p) ctx.stroke(new Path2D(p));
  }
  ctx.restore();
}

function drawBasemap(
  ctx: CanvasRenderingContext2D,
  path: ReturnType<typeof geoPath>,
  atlas: AtlasBundle,
  ink: MapInk,
  graticule: boolean,
) {
  ctx.save();
  if (graticule) {
    ctx.strokeStyle = ink.graticule;
    ctx.lineWidth = 0.5;
    const g = path(geoGraticule10());
    if (g) ctx.stroke(new Path2D(g));
  }
  ctx.fillStyle = ink.land;
  for (const f of atlas.features) {
    const p = path(f);
    if (p) ctx.fill(new Path2D(p));
  }
  ctx.strokeStyle = ink.landEdge;
  ctx.lineWidth = 0.6;
  if (atlas.outline) {
    const p = path(atlas.outline);
    if (p) ctx.stroke(new Path2D(p));
  } else {
    for (const f of atlas.features) {
      const p = path(f);
      if (p) ctx.stroke(new Path2D(p));
    }
  }
  ctx.restore();
}

/** Key strip height reserved under the map when a ramp / size key is shown. */
const MAP_KEY_H = rampKeyHeight(true) + 6;

function keyOrigin(w: number, h: number, pad: number): { x: number; y: number; width: number } {
  const { side, bottom } = mapInsets(pad);
  return { x: side, y: h - bottom - MAP_KEY_H + 4, width: Math.max(80, Math.min(180, w * 0.36)) };
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
  const ink = mapInk(opts);
  const font = opts.fontFamily ?? "Inter";
  const mini = !!opts.mini;
  ctx.save();
  paintBackground(ctx, w, h, ink);
  const ri = columns.indexOf(regionField);
  if (ri < 0) {
    drawEmptyMessage(ctx, w, h, "Choose a country / state column", ink, font, mini);
    ctx.restore();
    return;
  }
  const vi = valueField ? columns.indexOf(valueField) : -1;
  const how: YAggregateOption = vi < 0 ? "count" : (opts.yAggregate ?? "sum");
  const codesOk = /(fips|iso|code|_num|numeric)/i.test(regionField);
  const isNumberish = (v: unknown) => typeof v === "number" || (typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v));
  const samples = rows.slice(0, 40).map((r) => r[ri]).filter((v) => codesOk || !isNumberish(v));
  const atlasKind = pickAtlasKind(regionField, samples);
  const atlas = getAtlas(atlasKind);
  const groups = new Map<number, number[]>();
  // Numbers only join as region codes from a code-like column (fips, iso_num, country_code);
  // otherwise 4 would match Afghanistan and 28.8 Mississippi.
  for (const r of rows) {
    const raw = r[ri];
    if (!codesOk && isNumberish(raw)) continue;
    const idx = findFeatureIndex(atlas, raw);
    if (idx < 0) continue;
    const list = groups.get(idx) ?? [];
    list.push(vi >= 0 ? num(r[vi]) : 1);
    groups.set(idx, list);
  }
  const values = new Map<number, number>();
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [idx, vals] of groups) {
    const finite = vals.filter((x) => !isNaN(x));
    if (!finite.length && how !== "count") continue;
    const v = agg(finite, how);
    values.set(idx, v);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const showKey = !mini && values.size > 0;
  const projection = fitProjection(
    // Albers USA insets Alaska / Hawaii so the lower 48 fill the frame
    atlasKind === "us" ? geoAlbersUsa() : geoEqualEarth(),
    atlas,
    w,
    h,
    pad,
    showKey ? MAP_KEY_H : 0,
  );
  const path = geoPath(projection, undefined);
  const stops = sequentialStops(ink, opts.continuousStops);
  // Keep the lowest value off the background tone so small regions still read.
  const colorAt = (t: number) => rampColor(stops, 0.12 + 0.88 * t);
  const span = maxV - minV;
  // Heavily skewed positive values (population, cases) on a linear ramp paint one or two
  // regions light and everything else the same — use a log ramp instead.
  const useLog = minV > 0 && maxV / minV > 50;
  const position = (v: number) =>
    useLog ? Math.log(v / minV) / Math.log(maxV / minV) : span > 0 ? (v - minV) / span : 1;

  for (let i = 0; i < atlas.features.length; i++) {
    const f = atlas.features[i]!;
    const p = path(f);
    if (!p) continue;
    const region = new Path2D(p);
    const v = values.get(i);
    ctx.globalAlpha = 1;
    if (v == null) {
      ctx.fillStyle = ink.land;
    } else {
      ctx.fillStyle = colorAt(position(v));
      ctx.globalAlpha = Math.max(0.6, opts.opacity ?? 0.9);
    }
    ctx.fill(region);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = v == null ? ink.landEdge : withAlpha(ink.bg, 0.85);
    ctx.lineWidth = mini ? 0.35 : 0.5;
    ctx.stroke(region);
  }
  ctx.globalAlpha = 1;
  if (values.size === 0) {
    drawEmptyMessage(ctx, w, h, `No ${regionField} values matched map regions`, ink, font, mini);
  } else if (showKey) {
    const k = keyOrigin(w, h, pad);
    drawRampKey(ctx, {
      ...k,
      min: minV,
      max: maxV,
      colorAt,
      title: (valueField && vi >= 0 ? `${AGG_WORD[how]} of ${valueField}` : "Rows") + (useLog ? " (log scale)" : ""),
      log: useLog,
      ink,
      fontFamily: font,
    });
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

type GeoPoint = { lon: number; lat: number; category: number; size: number };

function collectPoints(
  rows: unknown[][],
  lonI: number,
  latI: number,
  colorI: number,
  sizeI: number,
): GeoPoint[] {
  // Category ids follow first appearance across all rows so they line up with the shared legend.
  const catMap = categoryIndex(rows, colorI);
  const out: GeoPoint[] = [];
  for (const r of rows) {
    const lon = num(r[lonI]);
    const lat = num(r[latI]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    // "Null island": missing coordinates stored as 0, 0 — never a real reading in practice
    if (lat === 0 && lon === 0) continue;
    const cat = colorI >= 0 ? (catMap.get(String(r[colorI])) ?? 0) : 0;
    const size = sizeI >= 0 ? num(r[sizeI]) : NaN;
    out.push({ lon, lat, category: cat, size });
  }
  return out;
}

/** Area-true radius scale for a size field (null when there is no usable size data). */
function sizeScale(
  pts: GeoPoint[],
  rMin: number,
  rMax: number,
): { radiusOf: (v: number) => number; min: number; max: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p.size)) continue;
    if (p.size < lo) lo = p.size;
    if (p.size > hi) hi = p.size;
  }
  if (!Number.isFinite(lo) || !(hi > lo)) return null;
  // Non-negative data: radius ∝ √value so area reads true; otherwise √ of the min-max position.
  const zeroBased = lo >= 0;
  const radiusOf = (v: number) => {
    if (!Number.isFinite(v)) return rMin;
    const t = zeroBased ? Math.max(0, v) / hi : (v - lo) / (hi - lo);
    return Math.max(rMin, rMax * Math.sqrt(Math.max(0, Math.min(1, t))));
  };
  return { radiusOf, min: lo, max: hi };
}

function pointColor(colors: string[], p: GeoPoint): string {
  return colors[p.category % colors.length] ?? colors[0] ?? "#6c5ce7";
}

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, alpha: number, halo: string, haloW: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(fill, alpha);
  ctx.fill();
  if (haloW > 0) {
    ctx.strokeStyle = withAlpha(halo, 0.85);
    ctx.lineWidth = haloW;
    ctx.stroke();
  }
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
  const ink = mapInk(opts);
  const font = opts.fontFamily ?? "Inter";
  const mini = !!opts.mini;
  ctx.save();
  paintBackground(ctx, w, h, ink);
  const { lonI, latI } = resolveLonLat(columns, xField, yField);
  const atlas = getWorldAtlas();
  if (lonI < 0 || latI < 0) {
    drawEmptyMessage(ctx, w, h, "Need latitude + longitude columns", ink, font, mini);
    ctx.restore();
    return;
  }
  const colorI = colorField ? columns.indexOf(colorField) : -1;
  const sizeI = sizeField ? columns.indexOf(sizeField) : -1;
  const pts = collectPoints(rows, lonI, latI, colorI, sizeI);
  const colors = opts.colors.length ? opts.colors : VIZ_CATEGORICAL;
  const sized = mode !== "hex" && sizeI >= 0;
  const showKey = !mini && pts.length > 0 && (mode === "hex" || sized);

  const { projection, regional } = fitPointsProjection(pts, atlas, w, h, pad, showKey ? MAP_KEY_H : 0);
  const path = geoPath(projection, undefined);
  drawBasemap(ctx, path, atlas, ink, !mini && !regional);
  if (regional) drawRegionalDetail(ctx, path, regional, ink);

  if (pts.length === 0) {
    drawEmptyMessage(ctx, w, h, "No rows have valid latitude / longitude", ink, font, mini);
    ctx.restore();
    return;
  }

  const alpha = opts.opacity ?? 0.85;
  if (mode === "hex") {
    const { side, top, bottom } = mapInsets(pad, showKey ? MAP_KEY_H : 0);
    const plotW = w - 2 * side;
    const plotH = h - top - bottom;
    const hr = mini
      ? Math.max(3.5, Math.min(7, Math.min(w, h) / 26))
      : Math.max(6, Math.min(16, Math.min(plotW, plotH) / 28));
    const hw = Math.sqrt(3) * hr;
    const rowH = 1.5 * hr;
    const bins = new Map<string, { cx: number; cy: number; n: number }>();
    let maxC = 0;
    for (const p of pts) {
      const xy = projection([p.lon, p.lat]);
      if (!xy) continue;
      const row = Math.round((xy[1] - top) / rowH);
      const off = row & 1 ? hw / 2 : 0;
      const col = Math.round((xy[0] - side - off) / hw);
      const key = `${row}:${col}`;
      let b = bins.get(key);
      if (!b) {
        b = { cx: side + col * hw + off, cy: top + row * rowH, n: 0 };
        bins.set(key, b);
      }
      b.n += 1;
      if (b.n > maxC) maxC = b.n;
    }
    const stops = sequentialStops(ink, opts.continuousStops);
    const colorAt = (t: number) => rampColor(stops, 0.15 + 0.85 * t);
    const minC = 1;
    for (const b of bins.values()) {
      const t = maxC > minC ? (b.n - minC) / (maxC - minC) : 1;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const x = b.cx + hr * Math.cos(a);
        const y = b.cy + hr * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.globalAlpha = Math.max(0.75, alpha);
      ctx.fillStyle = colorAt(t);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = withAlpha(ink.bg, 0.7);
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    if (showKey) {
      drawRampKey(ctx, { ...keyOrigin(w, h, pad), min: minC, max: Math.max(minC, maxC), colorAt, title: "Rows per hex", ink, fontFamily: font });
    }
    ctx.restore();
    return;
  }

  const n = pts.length;
  const density = n > 4000 ? 0.6 : n > 1500 ? 0.75 : 1;
  const base = radiusFromPointSize(opts.pointSize, mode === "bubbles" ? 5 : 3.2) * density;
  const rMin = Math.max(mini ? 1.6 : 2.2, mode === "bubbles" ? base * 0.6 : base * 0.7);
  const rMax = mode === "bubbles"
    ? Math.max(rMin * 2, Math.min(mini ? 9 : 26, Math.min(w, h) * (mini ? 0.06 : 0.045)))
    : Math.max(rMin * 2, base * 2.2);
  const scale = sized ? sizeScale(pts, rMin, rMax) : null;
  const radius = (p: GeoPoint) => (scale ? scale.radiusOf(p.size) : Math.max(rMin, base));
  // Largest first so small markers stay visible on top.
  const drawn = scale ? [...pts].sort((a, b) => (Number.isFinite(b.size) ? b.size : -Infinity) - (Number.isFinite(a.size) ? a.size : -Infinity)) : pts;
  const markAlpha = mode === "bubbles" ? Math.min(alpha, 0.75) : alpha * (n > 1500 ? 0.8 : 1);
  const haloW = n > 4000 ? 0 : mode === "bubbles" ? 1 : 0.75;
  for (const p of drawn) {
    const xy = projection([p.lon, p.lat]);
    if (!xy) continue;
    drawDot(ctx, xy[0], xy[1], radius(p), pointColor(colors, p), markAlpha, ink.halo, haloW);
  }
  if (showKey && scale) {
    const { side, bottom } = mapInsets(pad);
    drawSizeKey(ctx, {
      x: side,
      bottom: h - bottom + 2,
      min: scale.min,
      max: scale.max,
      radiusOf: scale.radiusOf,
      title: sizeField ?? undefined,
      ink,
      fontFamily: font,
      fill: colorI >= 0 ? ink.muted : colors[0],
      maxWidth: w - 2 * side,
    });
  }
  ctx.restore();
}

/** Mean direction of points on the sphere → [lon, lat] degrees. */
function sphericalCentroid(pts: { lon: number; lat: number }[]): [number, number] {
  let x = 0, y = 0, z = 0;
  for (const p of pts) {
    const l = (p.lon * Math.PI) / 180;
    const f = (p.lat * Math.PI) / 180;
    x += Math.cos(f) * Math.cos(l);
    y += Math.cos(f) * Math.sin(l);
    z += Math.sin(f);
  }
  const lon = (Math.atan2(y, x) * 180) / Math.PI;
  const lat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
  return [Number.isFinite(lon) ? lon : 0, Number.isFinite(lat) ? lat : 0];
}

/** Globe camera that faces the data's spherical centroid (radians), or null without lat/lon. */
export function globeCameraForData(
  rows: unknown[][],
  columns: string[],
  xField: string,
  yField: string | null,
): { yaw: number; pitch: number } | null {
  const { lonI, latI } = resolveLonLat(columns, xField, yField);
  if (lonI < 0 || latI < 0) return null;
  const pts = collectPoints(rows, lonI, latI, -1, -1);
  if (!pts.length) return null;
  const [lon, lat] = sphericalCentroid(pts);
  return { yaw: (lon * Math.PI) / 180, pitch: (Math.max(-60, Math.min(60, lat)) * Math.PI) / 180 };
}

type SphereFrame = { cx: number; cy: number; R: number };

/** Globe disc that sits under the title band and inside the side / bottom insets. */
function globeFrame(w: number, h: number, pad: number, zoom: number, reserveBottom: number): SphereFrame {
  const { side, top, bottom } = mapInsets(pad, reserveBottom);
  const availW = Math.max(20, w - 2 * side);
  const availH = Math.max(20, h - top - bottom);
  return { cx: w / 2, cy: top + availH / 2, R: (Math.min(availW, availH) / 2) * 0.96 * zoom };
}

function lonLatToSphere(
  lon: number,
  lat: number,
  yaw: number,
  pitch: number,
  frame: SphereFrame,
): { sx: number; sy: number; visible: boolean; depth: number } {
  const lam = ((lon - (yaw * 180) / Math.PI + 540) % 360) - 180;
  const lamR = (lam * Math.PI) / 180;
  const phiR = (lat * Math.PI) / 180;
  const x = Math.cos(phiR) * Math.sin(lamR);
  const y = Math.sin(phiR);
  const z = Math.cos(phiR) * Math.cos(lamR);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = y * cp - z * sp;
  const z2 = y * sp + z * cp;
  return {
    sx: frame.cx + x * frame.R,
    sy: frame.cy - y2 * frame.R,
    visible: z2 > 0,
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
  const ink = mapInk(opts);
  const font = opts.fontFamily ?? "Inter";
  const mini = !!opts.mini;
  ctx.save();
  paintBackground(ctx, w, h, ink);
  const { lonI, latI } = resolveLonLat(columns, xField, yField);
  if (lonI < 0 || latI < 0) {
    drawEmptyMessage(ctx, w, h, "Need latitude + longitude columns", ink, font, mini);
    ctx.restore();
    return;
  }
  const colorI = colorField ? columns.indexOf(colorField) : -1;
  const sizeI = sizeField ? columns.indexOf(sizeField) : -1;
  const colors = opts.colors.length ? opts.colors : VIZ_CATEGORICAL;
  const atlas = getWorldAtlas();
  const pts = collectPoints(rows, lonI, latI, colorI, sizeI);
  // Without an orbit camera (thumbnails), face the data instead of a fixed meridian.
  const centroid = opts.yaw == null && pts.length ? sphericalCentroid(pts) : null;
  const yaw = opts.yaw ?? (centroid ? (centroid[0] * Math.PI) / 180 : 0.4);
  const pitch = opts.pitch ?? (centroid ? (Math.max(-60, Math.min(60, centroid[1])) * Math.PI) / 180 : 0.25);
  const zoom = opts.zoom ?? 1;

  const base = radiusFromPointSize(opts.pointSize, 3.2);
  const rMin = Math.max(mini ? 1.6 : 2.2, base * 0.7);
  const scale = sizeI >= 0 ? sizeScale(pts, rMin, Math.max(rMin * 2, base * 2.6)) : null;
  const showKey = !mini && !!scale;
  const frame = globeFrame(w, h, pad, zoom, showKey ? MAP_KEY_H : 0);
  const { cx, cy, R } = frame;

  // Ocean disc + rim
  ctx.fillStyle = ink.ocean;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ink.landEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  const projection = geoOrthographic()
    .rotate([(-yaw * 180) / Math.PI, (-pitch * 180) / Math.PI])
    .translate([cx, cy])
    .scale(R);
  const path = geoPath(projection, undefined);
  drawBasemap(ctx, path, atlas, ink, !mini);

  const radius = (p: GeoPoint) => (scale ? scale.radiusOf(p.size) : Math.max(rMin, base));
  const alpha = opts.opacity ?? 0.85;

  if (pts.length === 0) {
    drawEmptyMessage(ctx, w, h, "No rows have valid latitude / longitude", ink, font, mini);
  } else if (trails && pts.length >= 2) {
    const projected = pts.map((p) => ({ ...p, ...lonLatToSphere(p.lon, p.lat, yaw, pitch, frame) }));
    // Each color group is its own path in row order (time order upstream).
    const byCat = new Map<number, typeof projected>();
    for (const p of projected) {
      const list = byCat.get(p.category) ?? [];
      list.push(p);
      byCat.set(p.category, list);
    }
    ctx.lineCap = "round";
    for (const [cat, list] of byCat) {
      const col = colors[cat % colors.length] ?? colors[0]!;
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1]!;
        const b = list[i]!;
        if (!a.visible || !b.visible) continue;
        const fade = 0.25 + 0.75 * (i / (list.length - 1));
        ctx.strokeStyle = withAlpha(col, alpha * fade);
        ctx.lineWidth = Math.max(1.5, radius(b) * 0.8);
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
      const tip = list[list.length - 1];
      if (tip?.visible) drawDot(ctx, tip.sx, tip.sy, Math.max(rMin, radius(tip) * 1.3), col, Math.min(1, alpha + 0.1), ink.halo, 1);
    }
  } else {
    const drawn = pts
      .map((p) => ({ ...p, ...lonLatToSphere(p.lon, p.lat, yaw, pitch, frame) }))
      .filter((p) => p.visible)
      .sort((a, b) => a.depth - b.depth);
    const haloW = drawn.length > 4000 ? 0 : 0.75;
    for (const p of drawn) {
      drawDot(ctx, p.sx, p.sy, radius(p), pointColor(colors, p), alpha * (0.55 + 0.45 * p.depth), ink.halo, haloW);
    }
  }

  if (showKey && scale) {
    const { side, bottom } = mapInsets(pad);
    drawSizeKey(ctx, {
      x: side,
      bottom: h - bottom + 2,
      min: scale.min,
      max: scale.max,
      radiusOf: scale.radiusOf,
      title: sizeField ?? undefined,
      ink,
      fontFamily: font,
      fill: colorI >= 0 ? ink.muted : colors[0],
      maxWidth: w - 2 * side,
    });
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
  const ink = mapInk(opts);
  const font = opts.fontFamily ?? "Inter";
  const mini = !!opts.mini;
  ctx.save();
  paintBackground(ctx, w, h, ink);
  const { lonI, latI } = resolveLonLat(columns, xField, yField);
  if (lonI < 0 || latI < 0) {
    drawEmptyMessage(ctx, w, h, "Need latitude + longitude columns", ink, font, mini);
    ctx.restore();
    return;
  }
  const colorI = colorField ? columns.indexOf(colorField) : -1;
  const pts = collectPoints(rows, lonI, latI, colorI, -1);
  const colors = opts.colors.length ? opts.colors : VIZ_CATEGORICAL;
  const atlas = getWorldAtlas();
  const { projection, regional } = fitPointsProjection(pts, atlas, w, h, pad);
  const path = geoPath(projection, undefined);
  drawBasemap(ctx, path, atlas, ink, !mini && !regional);
  if (regional) drawRegionalDetail(ctx, path, regional, ink);
  if (pts.length === 0) {
    drawEmptyMessage(ctx, w, h, "No rows have valid latitude / longitude", ink, font, mini);
    ctx.restore();
    return;
  }
  const alpha = opts.opacity ?? 0.8;

  // Consecutive rows within a color group become great-circle arcs.
  const byCat = new Map<number, GeoPoint[]>();
  for (const p of pts) {
    const list = byCat.get(p.category) ?? [];
    list.push(p);
    byCat.set(p.category, list);
  }
  ctx.lineCap = "round";
  for (const [cat, list] of byCat) {
    if (list.length < 2) continue;
    const col = colors[cat % colors.length] ?? colors[0]!;
    for (let i = 1; i < Math.min(list.length, 120); i++) {
      const a = list[i - 1]!;
      const b = list[i]!;
      const p = path({ type: "LineString", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] });
      if (!p) continue;
      ctx.strokeStyle = withAlpha(col, alpha * 0.75);
      ctx.lineWidth = mini ? 1 : 1.6;
      ctx.stroke(new Path2D(p));
    }
  }
  const r = Math.max(mini ? 1.6 : 2.4, radiusFromPointSize(opts.pointSize, 2.8));
  for (const p of pts.slice(0, 600)) {
    const xy = projection([p.lon, p.lat]);
    if (!xy) continue;
    drawDot(ctx, xy[0], xy[1], r, pointColor(colors, p), Math.min(1, alpha + 0.1), ink.halo, 0.75);
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
