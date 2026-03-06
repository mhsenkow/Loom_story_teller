// =================================================================
// Loom — Browser Mock Data
// =================================================================
// When running outside Tauri (plain browser via `make thread`),
// provides synthetic data so the full UI is functional for
// development and demos without the Rust backend.
// =================================================================

import type { FileEntry, ColumnInfo, QueryResult } from "./store";

function gaussian(mean: number, std: number): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

const CATEGORIES = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
const CITIES = ["San Francisco", "New York", "London", "Tokyo", "Berlin", "Paris", "Sydney", "Toronto"];

function generateScatterData(n: number): { columns: string[]; types: string[]; rows: (string | number | null)[][] } {
  const centers = [
    [20, 30], [-15, 25], [10, -20], [-30, -10],
    [35, -15], [-5, 40], [25, 5], [-20, 35],
  ];
  const rows: (string | number | null)[][] = [];
  for (let i = 0; i < n; i++) {
    const [cx, cy] = centers[i % centers.length];
    const x = Math.round((cx + gaussian(0, 8)) * 1000) / 1000;
    const y = Math.round((cy + gaussian(0, 8)) * 1000) / 1000;
    const mag = Math.round(Math.sqrt(x * x + y * y) * 100) / 100;
    rows.push([x, y, CATEGORIES[i % CATEGORIES.length], mag, `pt_${i}`]);
  }
  return {
    columns: ["x", "y", "cluster", "magnitude", "label"],
    types: ["DOUBLE", "DOUBLE", "VARCHAR", "DOUBLE", "VARCHAR"],
    rows,
  };
}

function generateSalesData(n: number): { columns: string[]; types: string[]; rows: (string | number | null)[][] } {
  const products = ["Widget A", "Widget B", "Gadget Pro", "Sensor V1", "Module X", "Board Rev3"];
  const rows: (string | number | null)[][] = [];
  const base = new Date("2023-01-01").getTime();
  for (let i = 0; i < n; i++) {
    const date = new Date(base + Math.random() * 63072000000).toISOString().split("T")[0];
    const city = CITIES[Math.floor(Math.random() * CITIES.length)];
    const product = products[Math.floor(Math.random() * products.length)];
    const units = Math.floor(Math.random() * 500) + 1;
    const revenue = Math.round(units * (Math.random() * 200 + 10) * 100) / 100;
    rows.push([date, city, product, units, revenue]);
  }
  return {
    columns: ["date", "city", "product", "units", "revenue"],
    types: ["DATE", "VARCHAR", "VARCHAR", "INTEGER", "DOUBLE"],
    rows,
  };
}

const scatterData = generateScatterData(2000);
const salesData = generateSalesData(1000);

const MOCK_FILES: FileEntry[] = [
  { path: "mock://scatter.csv", name: "scatter_demo.csv", extension: "csv", row_count: 2000, size_bytes: 98000 },
  { path: "mock://sales.csv", name: "sales_demo.csv", extension: "csv", row_count: 1000, size_bytes: 52000 },
];

const MOCK_DATA: Record<string, { columns: string[]; types: string[]; rows: (string | number | null)[][] }> = {
  "mock://scatter.csv": scatterData,
  "mock://sales.csv": salesData,
};

function statsFromData(data: typeof scatterData): ColumnInfo[] {
  return data.columns.map((name, i) => {
    const type = data.types[i];
    const values = data.rows.map(r => r[i]);
    const nonNull = values.filter(v => v !== null);
    const distinct = new Set(nonNull.map(String)).size;
    const isNum = ["DOUBLE", "INTEGER", "BIGINT", "FLOAT"].includes(type);
    const nums = isNum ? nonNull.map(Number).filter(n => !isNaN(n)) : [];

    return {
      name,
      data_type: type,
      null_count: values.length - nonNull.length,
      distinct_count: distinct,
      min_value: isNum && nums.length > 0 ? String(Math.min(...nums)) : nonNull.length > 0 ? String(nonNull[0]) : null,
      max_value: isNum && nums.length > 0 ? String(Math.max(...nums)) : nonNull.length > 0 ? String(nonNull[nonNull.length - 1]) : null,
    };
  });
}

export const mockFiles = MOCK_FILES;

export function mockInspect(filePath: string): { stats: ColumnInfo[]; sample: QueryResult } {
  const data = MOCK_DATA[filePath] ?? scatterData;
  const stats = statsFromData(data);
  const sample: QueryResult = {
    columns: data.columns,
    types: data.types,
    rows: data.rows.slice(0, 100),
    total_rows: data.rows.length,
  };
  return { stats, sample };
}

export function mockQuery(filePath: string, limit: number): QueryResult {
  const data = MOCK_DATA[filePath] ?? scatterData;
  return {
    columns: data.columns,
    types: data.types,
    rows: data.rows.slice(0, limit),
    total_rows: Math.min(limit, data.rows.length),
  };
}

/** Parse CSV text (with header) into columns and rows. Used for web file loading. */
export function parseCsvToInspectResult(
  _name: string,
  text: string,
  maxRows = 2000,
): { stats: ColumnInfo[]; sample: QueryResult } {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return { stats: [], sample: { columns: [], types: [], rows: [], total_rows: 0 } };
  }
  const header = lines[0];
  const columns = header.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const rows: (string | number | null)[][] = [];
  for (let i = 1; i < Math.min(lines.length, maxRows + 1); i++) {
    const line = lines[i];
    const values = parseCsvLine(line);
    const row: (string | number | null)[] = [];
    for (let c = 0; c < columns.length; c++) {
      const v = values[c] ?? "";
      const num = Number(v);
      row.push(v === "" || v === "null" ? null : Number.isNaN(num) ? v : num);
    }
    rows.push(row);
  }
  const types = columns.map((_, i) => {
    const nums = rows.map((r) => r[i]).filter((v): v is number => typeof v === "number");
    return nums.length > rows.length * 0.5 ? "DOUBLE" : "VARCHAR";
  });
  const data = { columns, types, rows };
  const stats = statsFromData(data);
  const sample: QueryResult = {
    columns,
    types,
    rows: rows.slice(0, 500),
    total_rows: lines.length - 1,
  };
  return { stats, sample };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if ((ch === "," && !inQuotes) || ch === "\n" || ch === "\r") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}
