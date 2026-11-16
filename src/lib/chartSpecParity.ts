// Portable export policy comes from the same definition as fields and controls.
import { CHART_DEFINITION_LIST, chartDefinition } from "./chartDefinitions";
import type { ChartKind } from "./recs/types";
import type { ChartSpecParity } from "./chartDefinitions";
export type { ChartSpecParity } from "./chartDefinitions";
export type SpecParityTier = ChartSpecParity["portable"];
export const CHART_SPEC_PARITY: Readonly<Record<ChartKind, ChartSpecParity>> = Object.freeze(Object.fromEntries(CHART_DEFINITION_LIST.map(d => [d.kind, d.exports.svg])) as Record<ChartKind, ChartSpecParity>);
export function chartSpecParity(kind: ChartKind): ChartSpecParity { return chartDefinition(kind).exports.svg; }
export function isNativeVegaKind(kind: ChartKind): boolean { return chartDefinition(kind).exports.svg.portable === "native"; }
