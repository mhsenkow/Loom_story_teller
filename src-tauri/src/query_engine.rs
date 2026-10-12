// =================================================================
// Shared DuckDB user-query execution (file, stream, poll sources)
// =================================================================

use crate::db::{duckdb_value_to_json, ColumnInfo, QueryResult};
use duckdb::{params, Connection};

/// JavaScript `Number.MAX_SAFE_INTEGER` (2^53 − 1).
pub const JS_MAX_SAFE_INTEGER: i64 = 9007199254740991;

/// Strip a trailing `LIMIT n` / `limit n` / `LIMIT n OFFSET m` (comments ignored).
pub fn parse_trailing_limit(sql: &str) -> (String, Option<u32>) {
    let trimmed = sql.trim().trim_end_matches(';').trim();
    if trimmed.is_empty() {
        return (String::new(), None);
    }
    let masked = crate::sql_policy::mask_strings_and_comments(trimmed);
    let folded: String = masked
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_string();
    let upper = folded.to_uppercase();
    let limit_pos = match upper.rfind(" LIMIT ") {
        Some(p) => p,
        None => return (trimmed.to_string(), None),
    };
    let tail = upper.get(limit_pos + 7..).unwrap_or("").trim();
    let (limit_str, _offset_ok) = if let Some(off_pos) = tail.find(" OFFSET ") {
        let lim = tail.get(..off_pos).unwrap_or("").trim();
        let off = tail.get(off_pos + 8..).unwrap_or("").trim();
        if !off.chars().all(|c| c.is_ascii_digit()) {
            return (trimmed.to_string(), None);
        }
        (lim, true)
    } else {
        (tail, true)
    };
    if limit_str.is_empty() || !limit_str.chars().all(|c| c.is_ascii_digit()) {
        return (trimmed.to_string(), None);
    }
    let n: u32 = limit_str.parse().unwrap_or(0);
    let base = folded
        .get(..limit_pos)
        .unwrap_or(&folded)
        .trim()
        .to_string();
    (base, Some(n))
}

/// Wrap user SQL in an outer `LIMIT` so inner `LIMIT`/`OFFSET` never duplicates.
pub fn build_limited_sql(user_sql: &str, backend_limit: u32, empty_default: &str) -> String {
    if user_sql.trim().is_empty() {
        return empty_default.replace("{limit}", &backend_limit.to_string());
    }
    let (_, user_limit) = parse_trailing_limit(user_sql);
    let effective = user_limit
        .map(|n| n.min(backend_limit))
        .unwrap_or(backend_limit);
    let inner = user_sql.trim().trim_end_matches(';');
    format!("SELECT * FROM ({inner}) AS loom_user_q LIMIT {effective}")
}

pub fn run_query(conn: &Connection, full_sql: &str) -> Result<QueryResult, String> {
    let mut stmt = conn.prepare(full_sql).map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![]).map_err(|e| e.to_string())?;
    let stmt_ref = rows
        .as_ref()
        .ok_or_else(|| "Query statement unavailable".to_string())?;
    let column_count = stmt_ref.column_count();
    let columns = stmt_ref.column_names();
    let types = (0..column_count)
        .map(|i| duckdb::types::Type::from(&stmt_ref.column_type(i)).to_string())
        .collect();

    let mut rows_out: Vec<Vec<serde_json::Value>> = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut row_vec = Vec::new();
        for i in 0..column_count {
            let val: duckdb::types::Value = row.get(i).map_err(|e| e.to_string())?;
            row_vec.push(duckdb_value_to_json(val));
        }
        rows_out.push(row_vec);
    }

    Ok(QueryResult {
        columns,
        types,
        total_rows: rows_out.len() as u64,
        rows: rows_out,
    })
}

pub fn run_user_query(
    conn: &Connection,
    user_sql: &str,
    backend_limit: u32,
    empty_default: &str,
) -> Result<QueryResult, String> {
    let full_sql = build_limited_sql(user_sql, backend_limit, empty_default);
    run_query(conn, &full_sql)
}

/// Column stats for `SELECT * FROM {table}` (creates temp view `loom_stats`).
pub fn column_stats_for_table(conn: &Connection, table: &str) -> Result<Vec<ColumnInfo>, String> {
    conn.execute_batch(&format!(
        "CREATE OR REPLACE TEMP VIEW loom_stats AS SELECT * FROM {}",
        table
    ))
    .map_err(|e| e.to_string())?;

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM loom_stats", params![], |r| r.get(0))
        .unwrap_or(0);
    if count == 0 {
        return Ok(vec![]);
    }

    let mut stmt = conn
        .prepare("DESCRIBE loom_stats")
        .map_err(|e| e.to_string())?;
    let schema_rows = stmt
        .query_map(params![], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let schema: Vec<(String, String)> = schema_rows.flatten().collect();
    if schema.is_empty() {
        return Ok(vec![]);
    }

    let mut select_parts: Vec<String> = Vec::with_capacity(schema.len() * 4);
    for (col_name, _) in &schema {
        let col_quoted = format!("\"{}\"", col_name.replace('"', "\"\""));
        let safe = col_name.replace('"', "_");
        select_parts.push(format!(
            "COUNT(*) - COUNT({cq}) AS {s}_nulls",
            cq = col_quoted,
            s = safe
        ));
        select_parts.push(format!(
            "APPROX_COUNT_DISTINCT({cq}) AS {s}_distinct",
            cq = col_quoted,
            s = safe
        ));
        select_parts.push(format!(
            "TRY_CAST(MIN({cq}) AS VARCHAR) AS {s}_min",
            cq = col_quoted,
            s = safe
        ));
        select_parts.push(format!(
            "TRY_CAST(MAX({cq}) AS VARCHAR) AS {s}_max",
            cq = col_quoted,
            s = safe
        ));
    }

    let stats_sql = format!("SELECT {} FROM loom_stats", select_parts.join(", "));
    let mut stats_stmt = conn.prepare(&stats_sql).map_err(|e| e.to_string())?;
    let mut columns = Vec::with_capacity(schema.len());
    stats_stmt
        .query_row(params![], |sr| {
            for (idx, (col_name, data_type)) in schema.iter().enumerate() {
                let base = idx * 4;
                columns.push(ColumnInfo {
                    name: col_name.clone(),
                    data_type: data_type.clone(),
                    null_count: sr.get::<_, i64>(base).unwrap_or(0) as u64,
                    distinct_count: sr.get::<_, i64>(base + 1).unwrap_or(0) as u64,
                    min_value: sr.get::<_, Option<String>>(base + 2).unwrap_or(None),
                    max_value: sr.get::<_, Option<String>>(base + 3).unwrap_or(None),
                });
            }
            Ok(())
        })
        .map_err(|e| e.to_string())?;

    Ok(columns)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_trailing_limit_offset_newline_and_case() {
        let (base, lim) = parse_trailing_limit("SELECT 1 LIMIT 10 OFFSET 5");
        assert_eq!(base, "SELECT 1");
        assert_eq!(lim, Some(10));

        let (base2, lim2) = parse_trailing_limit("SELECT 1\nlimit 7");
        assert_eq!(base2, "SELECT 1");
        assert_eq!(lim2, Some(7));

        let (base3, lim3) = parse_trailing_limit("SELECT 1 -- keep\nLIMIT 3");
        assert_eq!(base3, "SELECT 1");
        assert_eq!(lim3, Some(3));
    }

    #[test]
    fn build_limited_sql_wraps_inner_limit() {
        let sql = build_limited_sql(
            "SELECT * FROM t LIMIT 10 OFFSET 5",
            500,
            "SELECT 1 LIMIT {limit}",
        );
        assert!(sql.contains("AS loom_user_q LIMIT 10"));
        assert!(sql.contains("LIMIT 10 OFFSET 5"));
    }
}
