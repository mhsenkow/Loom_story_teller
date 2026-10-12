// =================================================================
// Shared column typing for recommendations + viz preferences
// =================================================================

import type { ColumnInfo } from "./queryTypes";

export type ColumnSemanticType = "quantitative" | "nominal" | "temporal";

const INTEGER_TYPES =
  /INTEGER|BIGINT|TINYINT|SMALLINT|HUGEINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT/;

export function columnNameTokens(name: string): string[] {
  const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced
    .split(/[_\s./-]+/)
    .map((t) => t.toUpperCase())
    .filter(Boolean);
}

function isYearLikeIntegerColumn(
  colName: string,
  dt: string,
  minVal: string | null,
  maxVal: string | null,
): boolean {
  const tokens = columnNameTokens(colName);
  if (!tokens.some((t) => t === "YEAR" || t === "YR" || t === "FYEAR" || t === "FISCAL_YEAR")) return false;
  if (!INTEGER_TYPES.test(dt.toUpperCase())) return false;
  const min = Number(minVal);
  const max = Number(maxVal);
  return Number.isFinite(min) && Number.isFinite(max) && min >= 1000 && max <= 2100;
}

/** Classify a column for chart encodings (single implementation for reco + prefs). */
export function inferColumnType(
  dt: string,
  colName?: string,
  minVal?: string | null,
  maxVal?: string | null,
): ColumnSemanticType {
  const t = dt.toUpperCase();
  const name = colName ?? "";
  if (isYearLikeIntegerColumn(name, dt, minVal ?? null, maxVal ?? null)) return "temporal";
  if (
    [
      "INTEGER",
      "BIGINT",
      "FLOAT",
      "DOUBLE",
      "DECIMAL",
      "REAL",
      "HUGEINT",
      "TINYINT",
      "SMALLINT",
      "UBIGINT",
      "UINTEGER",
      "USMALLINT",
      "UTINYINT",
    ].some((n) => t.includes(n))
  ) {
    return "quantitative";
  }
  if (["DATE", "TIMESTAMP", "TIME", "INTERVAL"].some((n) => t.includes(n))) return "temporal";
  const tokens = columnNameTokens(name);
  const temporalTokens = new Set([
    "DATE",
    "TIME",
    "TIMESTAMP",
    "YEAR",
    "MONTH",
    "DAY",
    "WEEK",
    "CREATED",
    "UPDATED",
    "INCIDENT",
  ]);
  if (tokens.some((tok) => temporalTokens.has(tok))) return "temporal";
  if (/^(CREATED_AT|UPDATED_AT|INCIDENT_DATE)$/i.test(name.replace(/\s/g, "_"))) return "temporal";
  return "nominal";
}

export interface ClassifiedColumns {
  quantitative: ColumnInfo[];
  nominal: ColumnInfo[];
  temporal: ColumnInfo[];
  typeOf: (c: ColumnInfo) => ColumnSemanticType;
}

const classifyCache = new WeakMap<ColumnInfo[], ClassifiedColumns>();

export function classifyColumns(columns: ColumnInfo[]): ClassifiedColumns {
  const hit = classifyCache.get(columns);
  if (hit) return hit;
  const typeOf = (c: ColumnInfo) =>
    inferColumnType(c.data_type, c.name, c.min_value, c.max_value);
  const quantitative: ColumnInfo[] = [];
  const nominal: ColumnInfo[] = [];
  const temporal: ColumnInfo[] = [];
  for (const c of columns) {
    const t = typeOf(c);
    if (t === "quantitative") quantitative.push(c);
    else if (t === "temporal") temporal.push(c);
    else nominal.push(c);
  }
  const out: ClassifiedColumns = { quantitative, nominal, temporal, typeOf };
  classifyCache.set(columns, out);
  return out;
}
