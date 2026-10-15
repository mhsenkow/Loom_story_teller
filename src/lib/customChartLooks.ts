// Small, portable named looks: visual options only, never dataset rows or encodings.
import type { ChartVisualOverrides } from "./chartVisualTypes";
import { sanitizeChartVisualOverrides } from "./chartVisualSanitize";

export const MAX_CUSTOM_CHART_LOOKS = 20;
export interface CustomChartLook {
  id: string;
  name: string;
  overrides: ChartVisualOverrides;
  updatedAt: number;
}

export function parseCustomChartLooks(value: unknown): CustomChartLook[] {
  if (!Array.isArray(value)) return [];
  const names = new Set<string>();
  const ids = new Set<string>();
  const looks: CustomChartLook[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { id, name, overrides, updatedAt } = item;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      id.length > 100 ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 64
    )
      continue;
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
      continue;
    const key = name.trim().toLowerCase();
    if (ids.has(id) || names.has(key)) continue;
    ids.add(id);
    names.add(key);
    looks.push({
      id,
      name: name.trim(),
      overrides: sanitizeChartVisualOverrides(overrides) ?? {},
      updatedAt:
        typeof updatedAt === "number" && Number.isFinite(updatedAt)
          ? updatedAt
          : 0,
    });
    if (looks.length >= MAX_CUSTOM_CHART_LOOKS) break;
  }
  return looks;
}
