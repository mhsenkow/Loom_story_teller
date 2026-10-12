// =================================================================
// Loom — Query result shapes (IPC + recommendations + MCP)
// =================================================================
// Kept free of Zustand/DOM so Workers and MCP can type-check shared logic.
// =================================================================

export interface ColumnInfo {
  name: string;
  data_type: string;
  null_count: number;
  distinct_count: number;
  min_value: string | null;
  max_value: string | null;
}

export interface QueryResult {
  columns: string[];
  types: string[];
  rows: (string | number | boolean | null)[][];
  total_rows: number;
  /** Maps each row to an index in the loaded sample (time window / subsample). */
  rowSourceIndices?: number[];
}
