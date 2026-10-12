// =================================================================
// Loom — Geography chart recommendations (no Canvas render)
// =================================================================

import type { ColumnInfo } from "./queryTypes";
import type { ChartKind, ChartRecommendation, YAggregateOption } from "./recommendations";
import { VIZ_CATEGORICAL } from "./chartPalettes";
import {
  isGeoRegionField,
  isLatField,
  isLonField,
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
