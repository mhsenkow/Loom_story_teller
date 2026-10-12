// =================================================================
// Loom — Field-name heuristics for chart encoding (pure, no DOM)
// =================================================================

/**
 * Heuristic: measure names where “lower is the story” (rank #1, losses, latency).
 * Used to suggest Direction ↓ so zero sits at the top.
 */
export function measureSuggestsGrowDown(fieldName: string | null | undefined): boolean {
  if (!fieldName) return false;
  const n = fieldName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const tokens = n.split("_").filter(Boolean);
  const NEG = new Set([
    "rank",
    "ranking",
    "position",
    "place",
    "loss",
    "losses",
    "deficit",
    "debt",
    "unemployment",
    "mortality",
    "death",
    "deaths",
    "error",
    "errors",
    "latency",
    "delay",
    "delays",
    "penalty",
    "risk",
    "churn",
    "bounce",
    "failure",
    "failures",
    "negative",
    "complaint",
    "complaints",
    "casualty",
    "casualties",
    "poverty",
    "inflation",
    "volatility",
    "drawdown",
    "vacancy",
    "downtime",
  ]);
  if (tokens.some((t) => NEG.has(t))) return true;
  return /(?:^|_)(rank|loss|deficit|debt|unemploy|mortal|latency|penalty|churn|drawdown|downtime)(?:$|_)/.test(n);
}
