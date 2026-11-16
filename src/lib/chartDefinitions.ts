// Public chart contract API. Do not import renderers, React or Zustand here.
import { CHART_DEFINITIONS } from "./chartDefinitions/catalog";
import type { ChartKind } from "./recs/types";
import type { ColumnInfo } from "./queryTypes";
import { inferType } from "./recs/columns";
import type { ChartChannelId, ChartDefinition } from "./chartDefinitions/types";
export { CHART_DEFINITIONS };
export * from "./chartDefinitions/types";

export const CHART_DEFINITION_LIST: readonly ChartDefinition[] = Object.freeze(Object.values(CHART_DEFINITIONS));
export function chartDefinition(kind: ChartKind): ChartDefinition {
  const definition = findChartDefinition(kind);
  if (!definition) throw new Error(`Unregistered chart kind: ${kind}`);
  return definition;
}
export function findChartDefinition(kind: string): ChartDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(CHART_DEFINITIONS, kind) ? CHART_DEFINITIONS[kind as ChartKind] : undefined;
}

/** Field type policy shared by menus, drag/drop and callers validating authored fields. */
export function chartFieldAllowed(kind: ChartKind, slot: ChartChannelId, col: ColumnInfo | undefined): { ok: true } | { ok: false; reason: string } {
  if (!col) return { ok: false, reason: "Column not found in this table." };
  const channel = chartDefinition(kind).channels[slot];
  if (!channel.enabled) return { ok: false, reason: `${channel.label} is not used by this chart.` };
  const type = inferType(col.data_type, col.name, col.min_value, col.max_value);
  if (channel.accepts.includes(type)) return { ok: true };
  const expected = channel.accepts.map(t => t === "quantitative" ? "numeric" : t === "temporal" ? "date" : "category").join(" or ");
  return { ok: false, reason: `${channel.label} needs a ${expected} column — “${col.name}” is ${type}.` };
}
