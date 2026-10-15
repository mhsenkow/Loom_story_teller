// =================================================================
// Column field picker — filter by query + type chip
// =================================================================

import { inferColumnType, type ColumnSemanticType } from "./columnClassify";

export type ColumnFieldSearchOption = {
  value: string;
  label: string;
  type?: string;
  disabled?: boolean;
};

export type ColumnTypeFilter = "all" | ColumnSemanticType;

export function columnOptionKind(o: ColumnFieldSearchOption): ColumnSemanticType {
  return inferColumnType(o.type ?? "", o.value);
}

export function filterColumnFieldOptions(
  options: ColumnFieldSearchOption[],
  query: string,
  typeFilter: ColumnTypeFilter = "all",
): ColumnFieldSearchOption[] {
  const q = query.trim().toLowerCase();
  return options.filter((o) => {
    if (o.value !== "" && typeFilter !== "all" && columnOptionKind(o) !== typeFilter) return false;
    if (!q) return true;
    return (
      o.value.toLowerCase().includes(q) ||
      o.label.toLowerCase().includes(q) ||
      (o.type ?? "").toLowerCase().includes(q)
    );
  });
}
