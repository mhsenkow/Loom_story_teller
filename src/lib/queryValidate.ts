// =================================================================
// User SQL validation (client-side mirror of Rust sql_policy)
// =================================================================

export interface QueryValidation {
  valid: boolean;
  error?: string;
  warning?: string;
}

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "UPSERT",
  "TRUNCATE",
  "DROP",
  "CREATE",
  "ALTER",
  "ATTACH",
  "DETACH",
  "COPY",
  "EXPORT",
  "IMPORT",
  "INSTALL",
  "LOAD",
  "PRAGMA",
  "VACUUM",
  "CHECKPOINT",
  "EXECUTE",
  "CALL",
  "SET",
  "READ_PARQUET",
  "READ_CSV_AUTO",
  "READ_CSV",
  "READ_JSON_AUTO",
  "READ_JSON",
  "READ_XLSX",
  "PARQUET_SCAN",
  "SQLITE_SCAN",
  "GLOB",
  "HTTPFS",
  "READ_BLOB",
] as const;

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function containsWord(haystackUpper: string, keyword: string): boolean {
  const kb = keyword.toUpperCase();
  for (let i = 0; i <= haystackUpper.length - kb.length; i++) {
    if (haystackUpper.slice(i, i + kb.length) !== kb) continue;
    const beforeOk = i === 0 || !isIdentChar(haystackUpper[i - 1]!);
    const afterIdx = i + kb.length;
    const afterOk = afterIdx >= haystackUpper.length || !isIdentChar(haystackUpper[afterIdx]!);
    if (beforeOk && afterOk) return true;
  }
  return false;
}

function maskStringsAndComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "'") {
      out += " ";
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (i + 1 < sql.length && sql[i + 1] === "'") {
            out += "  ";
            i += 2;
            continue;
          }
          out += " ";
          i++;
          break;
        }
        out += " ";
        i++;
      }
      continue;
    }
    if (ch === '"') {
      out += " ";
      i++;
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (i + 1 < sql.length && sql[i + 1] === '"') {
            out += "  ";
            i += 2;
            continue;
          }
          out += " ";
          i++;
          break;
        }
        out += " ";
        i++;
      }
      continue;
    }
    if (i + 1 < sql.length && sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (i + 1 < sql.length && sql[i] === "/" && sql[i + 1] === "*") {
      out += "  ";
      i += 2;
      while (i + 1 < sql.length) {
        if (sql[i] === "*" && sql[i + 1] === "/") {
          out += "  ";
          i += 2;
          break;
        }
        out += " ";
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const ALLOWED_STATEMENT_PREFIXES = [
  "SELECT",
  "WITH",
  "DESCRIBE",
  "SUMMARIZE",
  "SHOW",
  "EXPLAIN",
  "PIVOT",
] as const;

export function validateQuery(sql: string): QueryValidation {
  const t = sql.trim();
  if (!t) return { valid: false, error: "Query is empty" };

  const masked = maskStringsAndComments(t);
  let open = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(") open++;
    else if (c === ")") {
      open--;
      if (open < 0) return { valid: false, error: "Unmatched ')'" };
    }
  }
  if (open > 0) return { valid: false, error: "Unmatched '('" };
  const core = masked.trim().replace(/;\s*$/, "").trim();
  if (core.includes(";")) {
    return { valid: false, error: "Only one SQL statement is allowed" };
  }

  const start = masked.trim().replace(/^\(+/, "").trim().toUpperCase();
  if (!ALLOWED_STATEMENT_PREFIXES.some((p) => start.startsWith(p))) {
    return { valid: false, error: "Query must be a read-only SELECT-style statement" };
  }

  const upper = masked.toUpperCase();
  for (const kw of FORBIDDEN_KEYWORDS) {
    if (containsWord(upper, kw)) {
      return { valid: false, error: `SQL keyword or function '${kw}' is not allowed in user queries` };
    }
  }

  return { valid: true };
}
