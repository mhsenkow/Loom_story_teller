// =================================================================
// Loom — Ollama integration for local AI chart recommendations
// =================================================================
// Requires Ollama running locally (e.g. `ollama serve`). Uses the
// generate API to ask a local model for a chart suggestion.
//
// Env (optional):
//   NEXT_PUBLIC_OLLAMA_URL  — default http://localhost:11434
//   NEXT_PUBLIC_OLLAMA_MODEL — default first available or "llama3.2"
// =================================================================

import type { ColumnInfo } from "./store";
import type { ChartKind } from "./recommendations";

const CHART_KINDS: ChartKind[] = [
  "scatter", "bar", "histogram", "line", "heatmap", "strip", "box", "area", "pie",
];

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_OLLAMA_URL ?? "http://localhost:11434";
}

/** GET /api/tags — list available models. */
export async function listOllamaModels(): Promise<{ name: string }[]> {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/tags`, { method: "GET" });
  if (!res.ok) throw new Error(`Ollama tags failed: ${res.status}`);
  const data = (await res.json()) as { models?: { name: string }[] };
  const models = data.models ?? [];
  return models.map((m) => ({ name: m.name.split(":")[0] ?? m.name }));
}

/** Pick model: env > first available > default. */
export async function getDefaultModel(): Promise<string> {
  const envModel = process.env.NEXT_PUBLIC_OLLAMA_MODEL;
  if (envModel) return envModel;
  try {
    const models = await listOllamaModels();
    if (models.length > 0) return models[0].name;
  } catch {
    // ignore
  }
  return "llama3.2";
}

export interface OllamaChartSuggestion {
  chartKind: ChartKind;
  xField: string;
  yField: string | null;
  colorField: string | null;
  reason: string;
}

/** Current chart context so the AI can suggest something different. */
export interface CurrentChartContext {
  chartKind: ChartKind;
  xField: string;
  yField: string | null;
  colorField: string | null;
}

function buildPrompt(
  columns: ColumnInfo[],
  tableName: string,
  currentChart: CurrentChartContext | null,
): string {
  const colList = columns
    .map((c) => `  - ${c.name} (${c.data_type}, ${c.distinct_count} distinct)`)
    .join("\n");

  const currentBlurb = currentChart
    ? `The user is already viewing: chart type "${currentChart.chartKind}", X=${currentChart.xField}, Y=${currentChart.yField ?? "none"}, Color=${currentChart.colorField ?? "none"}. Suggest a DIFFERENT encoding (different columns) and/or a DIFFERENT chart type that would be interesting—e.g. try bar, area, pie, heatmap, box, or scatter instead of always line/scatter.`
    : "Suggest a standout chart—not necessarily the most obvious. Consider different chart types (bar, area, pie, heatmap, box, strip, scatter, line) and encodings that reveal something interesting.";

  return `You are a data visualization expert. Given a table "${tableName}" with these columns:

${colList}

${currentBlurb}

Reply with ONLY a valid JSON object, no markdown or code fences. Use this exact shape:
{"chartKind":"<kind>","xField":"<column name>","yField":"<column name or null>","colorField":"<column name or null>","reason":"<one short sentence explaining why this combo is good>"}

chartKind must be one of: ${CHART_KINDS.join(", ")}.
xField and yField must be column names from the list above; use null for yField for count-based charts (e.g. bar count, histogram). colorField is optional (use null if not needed).`;
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function parseSuggestion(jsonStr: string, columns: ColumnInfo[]): OllamaChartSuggestion | null {
  try {
    const raw = JSON.parse(jsonStr) as Record<string, unknown>;
    const chartKind = String(raw.chartKind ?? "").toLowerCase();
    if (!CHART_KINDS.includes(chartKind as ChartKind)) return null;
    const xField = String(raw.xField ?? "").trim();
    const yField = raw.yField == null || raw.yField === "" ? null : String(raw.yField).trim();
    const colorField = raw.colorField == null || raw.colorField === "" ? null : String(raw.colorField).trim();
    const reason = String(raw.reason ?? "Suggested by local model.").trim();

    const names = new Set(columns.map((c) => c.name));
    if (!xField || !names.has(xField)) return null;
    if (yField !== null && !names.has(yField)) return null;
    if (colorField !== null && !names.has(colorField)) return null;

    return {
      chartKind: chartKind as ChartKind,
      xField,
      yField: yField || null,
      colorField: colorField || null,
      reason: reason || "Suggested by local model.",
    };
  } catch {
    return null;
  }
}

/**
 * Ask Ollama for a chart recommendation. Pass currentChart so the AI suggests
 * something different (encoding and/or type). Returns null if Ollama is
 * unavailable or the response is invalid.
 */
export async function suggestChartFromOllama(
  columns: ColumnInfo[],
  tableName: string,
  options?: { model?: string; currentChart?: CurrentChartContext | null },
): Promise<OllamaChartSuggestion | null> {
  if (columns.length === 0) return null;
  const base = getBaseUrl();
  const useModel = options?.model ?? (await getDefaultModel());
  const prompt = buildPrompt(columns, tableName, options?.currentChart ?? null);

  try {
    const res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: useModel,
        prompt,
        stream: false,
        options: {
          temperature: 0.85,
          top_p: 0.9,
        },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    const responseText = data.response ?? "";
    const jsonStr = extractJson(responseText);
    return parseSuggestion(jsonStr, columns);
  } catch {
    return null;
  }
}
