import { describe, it, expect } from "vitest";
import { validateQuery } from "../queryValidate";

describe("validateQuery", () => {
  it("accepts SELECT and WITH", () => {
    expect(validateQuery("SELECT 1").valid).toBe(true);
    expect(validateQuery("WITH cte AS (SELECT 1) SELECT * FROM cte").valid).toBe(true);
  });

  it("rejects writes and policy violations", () => {
    expect(validateQuery("INSERT INTO t VALUES (1)").valid).toBe(false);
    expect(validateQuery("COPY t TO '/tmp/x'").valid).toBe(false);
    expect(validateQuery("SELECT * FROM read_parquet('/x')").valid).toBe(false);
    expect(validateQuery("SELECT 1; SELECT 2").valid).toBe(false);
  });

  it("ignores keywords inside string literals", () => {
    expect(validateQuery("SELECT 'INSERT INTO x' AS lbl FROM loom_active").valid).toBe(true);
  });

  it("ignores parentheses inside string literals", () => {
    expect(validateQuery("SELECT * FROM t WHERE label LIKE '%:)%'").valid).toBe(true);
  });

  it("accepts DESCRIBE and SUMMARIZE", () => {
    expect(validateQuery("DESCRIBE loom_active").valid).toBe(true);
    expect(validateQuery("SUMMARIZE loom_active").valid).toBe(true);
  });
});
