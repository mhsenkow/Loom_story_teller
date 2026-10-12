// =================================================================
// User SQL capability policy (read-only SELECT / WITH)
// =================================================================
// Enforced on every user-facing DuckDB query path (file, stream, source).
// Ingestion and internal maintenance SQL bypass this module.
// =================================================================

const FORBIDDEN_KEYWORDS: &[&str] = &[
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
];

/// Validate a user-supplied SQL string before it reaches DuckDB.
pub fn validate_user_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    check_balanced_parens(trimmed)?;
    check_single_statement(trimmed)?;
    check_starts_with_select_or_with(trimmed)?;
    check_forbidden_keywords(trimmed)?;
    Ok(())
}

fn check_balanced_parens(sql: &str) -> Result<(), String> {
    let mut depth = 0i32;
    for ch in sql.chars() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth < 0 {
                    return Err("Unmatched ')' in query".into());
                }
            }
            _ => {}
        }
    }
    if depth != 0 {
        return Err("Unmatched '(' in query".into());
    }
    Ok(())
}

fn check_single_statement(sql: &str) -> Result<(), String> {
    let masked = mask_strings_and_comments(sql);
    let core = masked.trim().trim_end_matches(';').trim();
    if core.contains(';') {
        return Err("Only one SQL statement is allowed".into());
    }
    Ok(())
}

fn check_starts_with_select_or_with(sql: &str) -> Result<(), String> {
    let masked = mask_strings_and_comments(sql);
    let upper = masked.trim().trim_start_matches('(').trim().to_uppercase();
    if upper.starts_with("SELECT") || upper.starts_with("WITH") {
        return Ok(());
    }
    Err("Query must be a SELECT or WITH statement".into())
}

fn check_forbidden_keywords(sql: &str) -> Result<(), String> {
    let masked = mask_strings_and_comments(sql);
    let upper = masked.to_uppercase();
    for kw in FORBIDDEN_KEYWORDS {
        if contains_word(&upper, kw) {
            return Err(format!(
                "SQL keyword or function '{}' is not allowed in user queries",
                kw
            ));
        }
    }
    Ok(())
}

fn is_ident_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn contains_word(haystack_upper: &str, keyword: &str) -> bool {
    let kb = keyword.as_bytes();
    let hb = haystack_upper.as_bytes();
    if kb.is_empty() || kb.len() > hb.len() {
        return false;
    }
    for i in 0..=(hb.len() - kb.len()) {
        if &hb[i..i + kb.len()] != kb {
            continue;
        }
        let before_ok = i == 0 || !is_ident_char(hb[i - 1]);
        let after_idx = i + kb.len();
        let after_ok = after_idx >= hb.len() || !is_ident_char(hb[after_idx]);
        if before_ok && after_ok {
            return true;
        }
    }
    false
}

/// Mask string literals and comments so keyword scans cannot be bypassed.
pub(crate) fn mask_strings_and_comments(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let bytes = sql.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'\'' {
            out.push(' ');
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\'' {
                    if i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
                        out.push(' ');
                        out.push(' ');
                        i += 2;
                        continue;
                    }
                    out.push(' ');
                    i += 1;
                    break;
                }
                out.push(' ');
                i += 1;
            }
            continue;
        }
        if b == b'"' {
            out.push(' ');
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'"' {
                    if i + 1 < bytes.len() && bytes[i + 1] == b'"' {
                        out.push(' ');
                        out.push(' ');
                        i += 2;
                        continue;
                    }
                    out.push(' ');
                    i += 1;
                    break;
                }
                out.push(' ');
                i += 1;
            }
            continue;
        }
        if i + 1 < bytes.len() && bytes[i] == b'-' && bytes[i + 1] == b'-' {
            while i < bytes.len() && bytes[i] != b'\n' {
                out.push(' ');
                i += 1;
            }
            continue;
        }
        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            out.push(' ');
            out.push(' ');
            i += 2;
            while i + 1 < bytes.len() {
                if bytes[i] == b'*' && bytes[i + 1] == b'/' {
                    out.push(' ');
                    out.push(' ');
                    i += 2;
                    break;
                }
                out.push(' ');
                i += 1;
            }
            continue;
        }
        out.push(char::from(b));
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_select_and_with() {
        validate_user_sql("SELECT 1").unwrap();
        validate_user_sql("WITH cte AS (SELECT 1 AS x) SELECT * FROM cte").unwrap();
        validate_user_sql("  select * from loom_active ").unwrap();
    }

    #[test]
    fn rejects_empty_non_whitespace_policy_via_caller() {
        assert!(validate_user_sql("   ").is_ok());
    }

    #[test]
    fn rejects_writes_and_ddl() {
        for sql in [
            "INSERT INTO loom_active VALUES (1)",
            "UPDATE loom_active SET x = 1",
            "DELETE FROM loom_active",
            "DROP TABLE loom_active",
            "CREATE TABLE evil(x INT)",
            "ATTACH '/etc/passwd' AS leak",
            "COPY loom_active TO '/tmp/x.csv'",
            "INSTALL httpfs",
            "PRAGMA database_list",
            "SET enable_external_access = true",
        ] {
            let err = validate_user_sql(sql).unwrap_err();
            assert!(!err.is_empty(), "expected error for {sql}, got ok");
        }
    }

    #[test]
    fn rejects_file_table_functions() {
        for sql in [
            "SELECT * FROM read_parquet('/etc/passwd')",
            "SELECT * FROM read_csv_auto('/secret.csv')",
        ] {
            validate_user_sql(sql).unwrap_err();
        }
    }

    #[test]
    fn rejects_multiple_statements() {
        validate_user_sql("SELECT 1; SELECT 2").unwrap_err();
    }

    #[test]
    fn allows_trailing_semicolon() {
        validate_user_sql("SELECT 1;").unwrap();
    }

    #[test]
    fn keywords_inside_strings_are_ignored() {
        validate_user_sql("SELECT 'INSERT INTO x' AS label FROM loom_active").unwrap();
    }

    #[test]
    fn rejects_unbalanced_parens() {
        validate_user_sql("SELECT (1").unwrap_err();
        validate_user_sql("SELECT 1)").unwrap_err();
    }
}
