// =================================================================
// Basic query validation / lint (client-side only)
// =================================================================

export interface QueryValidation {
  valid: boolean;
  error?: string;
  warning?: string;
}

export function validateQuery(sql: string): QueryValidation {
  const t = sql.trim();
  if (!t) return { valid: false, error: "Query is empty" };

  let open = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "(") open++;
    else if (c === ")") {
      open--;
      if (open < 0) return { valid: false, error: "Unmatched ')'" };
    }
  }
  if (open > 0) return { valid: false, error: "Unmatched '('" };

  const upper = t.toUpperCase();
  if (!upper.includes("SELECT") && !upper.includes("WITH")) return { valid: false, error: "Query should start with SELECT or WITH" };

  return { valid: true };
}
