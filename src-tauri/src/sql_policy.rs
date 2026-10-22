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
    "READ_TEXT",
    "QUERY_TABLE",
    "SNIFF_CSV",
    "PARQUET_METADATA",
    "PARQUET_SCHEMA",
    "PARQUET_FILE_METADATA",
    "PARQUET_KV_METADATA",
    "READ_NDJSON",
    "READ_NDJSON_AUTO",
    "READ_NDJSON_OBJECTS",
    "READ_JSON_OBJECTS",
    "READ_JSON_OBJECTS_AUTO",
];

/// Names that are only dangerous as a call (`query('…')` runs nested SQL that
/// this check never sees). Plain uses stay legal so a column can be named `query`.
const FORBIDDEN_CALLS: &[&str] = &["QUERY"];

/// Words after which a table reference follows. A quoted string or identifier
/// there is a DuckDB replacement scan (`FROM 'file.csv'`), i.e. a file read.
const TABLE_REF_WORDS: &[&str] = &[
    "FROM",
    "JOIN",
    "LATERAL",
    "TABLE",
    "PIVOT",
    "UNPIVOT",
    "SUMMARIZE",
    "DESCRIBE",
    "SHOW",
];

/// Words that end a FROM list at the current paren depth.
const FROM_LIST_END_WORDS: &[&str] = &[
    "WHERE",
    "GROUP",
    "ORDER",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "QUALIFY",
    "WINDOW",
    "SELECT",
    "UNION",
    "INTERSECT",
    "EXCEPT",
];

/// SQL-standard functions whose argument list uses FROM without naming a table
/// (`EXTRACT(YEAR FROM "date")`, `TRIM(BOTH 'x' FROM name)`).
const FROM_ARG_FUNCTIONS: &[&str] = &["EXTRACT", "TRIM", "SUBSTRING", "OVERLAY", "POSITION"];

/// Validate a user-supplied SQL string before it reaches DuckDB.
pub fn validate_user_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    check_balanced_parens(trimmed)?;
    check_lexical_ambiguity(trimmed)?;
    check_single_statement(trimmed)?;
    check_starts_with_select_or_with(trimmed)?;
    check_forbidden_keywords(trimmed)?;
    check_quoted_table_refs(trimmed)?;
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
    let bytes = upper.as_bytes();
    for name in FORBIDDEN_CALLS {
        let mut from = 0usize;
        while let Some(pos) = upper[from..].find(name) {
            let i = from + pos;
            from = i + name.len();
            let before_ok = i == 0 || !is_ident_char(bytes[i - 1]);
            let after_ok = from >= bytes.len() || !is_ident_char(bytes[from]);
            if before_ok && after_ok && upper[from..].trim_start().starts_with('(') {
                return Err(format!(
                    "SQL function '{}' is not allowed in user queries",
                    name
                ));
            }
        }
    }
    Ok(())
}

#[derive(Debug, PartialEq)]
enum Token {
    Word(String),
    /// A '…' string or "…" identifier (contents dropped).
    Quoted,
    Punct(u8),
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum SpanKind {
    Code,
    Quoted,
    Comment,
}

/// Index just past a quoted span that opens at `i` with quote byte `q` ('' / "" escape).
fn skip_quoted(bytes: &[u8], mut i: usize, q: u8) -> usize {
    i += 1;
    while i < bytes.len() {
        if bytes[i] == q {
            if bytes.get(i + 1) == Some(&q) {
                i += 2;
                continue;
            }
            return i + 1;
        }
        i += 1;
    }
    i
}

/// Split SQL into code, quoted and comment byte ranges the way DuckDB's
/// Postgres-derived scanner does: `--` comments end at \n or \r, block comments
/// nest, and '' / "" escape a quote. Every check reads SQL through this one
/// lexer; `check_lexical_ambiguity` rejects what it doesn't model ($ quoting,
/// E'…' backslash escapes), so its spans match DuckDB's for any accepted query.
fn lex(sql: &str) -> Vec<(SpanKind, std::ops::Range<usize>)> {
    let bytes = sql.as_bytes();
    let mut spans = Vec::new();
    let mut code_start = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        let (kind, end) = if b == b'-' && bytes.get(i + 1) == Some(&b'-') {
            let mut j = i + 2;
            while j < bytes.len() && bytes[j] != b'\n' && bytes[j] != b'\r' {
                j += 1;
            }
            (SpanKind::Comment, j)
        } else if b == b'/' && bytes.get(i + 1) == Some(&b'*') {
            let mut j = i + 2;
            let mut depth = 0u32;
            while j < bytes.len() {
                if bytes[j] == b'*' && bytes.get(j + 1) == Some(&b'/') {
                    j += 2;
                    if depth == 0 {
                        break;
                    }
                    depth -= 1;
                } else if bytes[j] == b'/' && bytes.get(j + 1) == Some(&b'*') {
                    depth += 1;
                    j += 2;
                } else {
                    j += 1;
                }
            }
            (SpanKind::Comment, j.min(bytes.len()))
        } else if b == b'\'' || b == b'"' {
            (SpanKind::Quoted, skip_quoted(bytes, i, b))
        } else {
            i += 1;
            continue;
        };
        if code_start < i {
            spans.push((SpanKind::Code, code_start..i));
        }
        spans.push((kind, i..end));
        i = end;
        code_start = end;
    }
    if code_start < bytes.len() {
        spans.push((SpanKind::Code, code_start..bytes.len()));
    }
    spans
}

/// Reject syntax DuckDB lexes differently from `lex`, since it could hide SQL
/// from every later check: `$` outside quotes ($$…$$ / $tag$…$tag$ strings,
/// `a$b` identifiers) and E'…' strings, whose backslash escapes move the end quote.
fn check_lexical_ambiguity(sql: &str) -> Result<(), String> {
    let bytes = sql.as_bytes();
    for (kind, range) in lex(sql) {
        match kind {
            SpanKind::Code if bytes[range.clone()].contains(&b'$') => {
                return Err("'$' is only allowed inside quoted strings".into());
            }
            SpanKind::Quoted if bytes[range.start] == b'\'' && range.start > 0 => {
                if !matches!(bytes[range.start - 1], b'e' | b'E') {
                    continue;
                }
                // `nameE'x'` is an identifier then a plain string; anything else
                // (start, punctuation, a digit as in `1e'x'`) makes it an E'…' string.
                let part_of_name = range.start >= 2 && {
                    let c = bytes[range.start - 2];
                    c.is_ascii_alphabetic() || c == b'_' || c >= 0x80
                };
                if !part_of_name {
                    return Err(
                        "E'…' escape strings aren't supported; use a plain '…' string".into(),
                    );
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// Split SQL into words, quoted spans and punctuation; comments are skipped.
fn tokenize(sql: &str) -> Vec<Token> {
    let bytes = sql.as_bytes();
    let mut out = Vec::new();
    for (kind, range) in lex(sql) {
        match kind {
            SpanKind::Comment => {}
            SpanKind::Quoted => out.push(Token::Quoted),
            SpanKind::Code => {
                let mut i = range.start;
                while i < range.end {
                    let b = bytes[i];
                    if b.is_ascii_whitespace() {
                        i += 1;
                    } else if is_ident_char(b) || b >= 0x80 {
                        let start = i;
                        while i < range.end && (is_ident_char(bytes[i]) || bytes[i] >= 0x80) {
                            i += 1;
                        }
                        // X'…' / B'…' / N'…' prefixed literals: the letter belongs to the string.
                        if i - start == 1 && bytes.get(i) == Some(&b'\'') {
                            continue;
                        }
                        out.push(Token::Word(sql[start..i].to_ascii_uppercase()));
                    } else {
                        out.push(Token::Punct(b));
                        i += 1;
                    }
                }
            }
        }
    }
    out
}

/// Stopgap for file reads the keyword list can't see: DuckDB replacement scans
/// (`FROM 'x.csv'`, `FROM t, "x.csv"`) and quoted function names (`"read_csv"(…)`).
/// A full fix would walk `json_serialize_sql` output against a table allowlist.
fn check_quoted_table_refs(sql: &str) -> Result<(), String> {
    const MSG: &str = "Queries can't read files directly. Query loom_active instead.";
    let tokens = tokenize(sql);
    // One frame per open paren: (inside a FROM list, inside EXTRACT/TRIM-style args).
    let mut stack: Vec<(bool, bool)> = vec![(false, false)];
    for (idx, tok) in tokens.iter().enumerate() {
        let prev = idx.checked_sub(1).map(|p| &tokens[p]);
        let (in_from, fn_args) = stack.last().copied().unwrap_or((false, false));
        // FROM inside EXTRACT(…)/TRIM(…) is an argument keyword, not a table clause.
        let after_table_word = matches!(
            prev,
            Some(Token::Word(w)) if TABLE_REF_WORDS.contains(&w.as_str()) && !(w == "FROM" && fn_args)
        );
        match tok {
            Token::Quoted => {
                let called = tokens.get(idx + 1) == Some(&Token::Punct(b'('));
                let after_from_comma = in_from && prev == Some(&Token::Punct(b','));
                if called || after_table_word || after_from_comma {
                    return Err(MSG.into());
                }
            }
            Token::Punct(b'(') => {
                let fn_args = matches!(
                    prev,
                    Some(Token::Word(w)) if FROM_ARG_FUNCTIONS.contains(&w.as_str())
                );
                stack.push((false, fn_args));
            }
            Token::Punct(b')') => {
                if stack.len() > 1 {
                    stack.pop();
                }
            }
            Token::Word(w) => {
                if let Some(top) = stack.last_mut() {
                    if (w == "FROM" && !top.1) || w == "JOIN" {
                        top.0 = true;
                    } else if FROM_LIST_END_WORDS.contains(&w.as_str()) {
                        top.0 = false;
                    }
                }
            }
            Token::Punct(_) => {}
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
    let bytes = sql.as_bytes();
    let mut out = String::with_capacity(sql.len());
    for (kind, range) in lex(sql) {
        for &b in &bytes[range] {
            out.push(if kind == SpanKind::Code {
                char::from(b)
            } else {
                ' '
            });
        }
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
            "SELECT content FROM read_text('/etc/hosts')",
            "SELECT * FROM 's.csv'",
            "SELECT * FROM \"s.csv\"",
            "SELECT * FROM loom_active, 's.csv'",
            "SELECT * FROM loom_active a JOIN b ON a.x = b.x, 's.csv'",
            "SELECT * FROM loom_active JOIN 's.csv' USING (id)",
            "WITH x AS (SELECT * FROM 's.csv') SELECT * FROM x",
            "SELECT * FROM (SELECT 1) t, 's.csv'",
            "SELECT * FROM E's.csv'",
            "SELECT * FROM $$s.csv$$",
            "SELECT * FROM \"read_csv\"('s.csv')",
            "SELECT * FROM query('SELECT * FROM read_csv(''s.csv'')')",
            "SELECT * FROM query ('SELECT 1')",
            "SELECT * FROM sniff_csv('s.csv')",
            "SELECT * FROM parquet_metadata('s.parquet')",
            "SELECT * FROM read_ndjson_auto('s.json')",
            "SELECT * FROM read_json_objects('s.json')",
            "SELECT EXTRACT(YEAR FROM (SELECT max(d) FROM 's.csv'))",
            // Lexer desyncs: each hid `FROM 's.csv'` inside a fake string or comment.
            "SELECT E'\\'' AS q, * FROM 's.csv'",
            "SELECT 1e'\\'' AS q, * FROM 's.csv'",
            "SELECT * /* /* */ ' */ FROM 's.csv' /* ' */",
            "SELECT * --x\r FROM 's.csv'\n",
            "SELECT * FROM loom_active, $t$s.csv$t$",
            "SELECT $$'$$ AS q, * FROM read_csv('s.csv') --'\n",
            "SELECT 1 AS a$t$, * FROM 's.csv' /*$t$*/",
        ] {
            validate_user_sql(sql).expect_err(sql);
        }
    }

    #[test]
    fn allows_quoted_values_outside_table_positions() {
        for sql in [
            "SELECT EXTRACT(YEAR FROM \"date\") FROM loom_active",
            "SELECT TRIM(BOTH 'x' FROM name) FROM loom_active",
            "SELECT substring(title FROM 2) FROM loom_active",
            "SELECT 'a', \"b c\" FROM loom_active WHERE x IN ('a', 'b')",
            "SELECT * FROM loom_active a JOIN loom_active b ON a.x = 'y'",
            "SELECT query, count(*) FROM loom_active GROUP BY query",
            "SELECT regexp_matches(title, 'foo', 'i') FROM loom_active",
            "SELECT * FROM loom_active WHERE title = 'FROM x'",
            "SELECT * FROM loom_active -- FROM 'x.csv'\nLIMIT 5",
            "SELECT * FROM loom_active /* outer /* FROM 'x.csv' */ still comment */",
            "SELECT * FROM loom_active WHERE title LIKE'%e' OR title = '$5'",
            "SELECT * FROM loom_active WHERE namee'x' IS NULL",
        ] {
            validate_user_sql(sql).unwrap_or_else(|e| panic!("{sql}: {e}"));
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
