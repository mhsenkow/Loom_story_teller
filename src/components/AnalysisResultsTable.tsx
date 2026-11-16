// Keep numerical comparisons aligned, readable and independently scrollable on phones.
import type { ReactNode } from "react";
export default function AnalysisResultsTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: ReactNode[][] }) {
  return <div className="loom-analysis-results">
    <p className="text-2xs text-loom-muted mb-2">Scroll the table to see every value.</p>
    <div className="loom-analysis-table-scroll" tabIndex={0} role="region" aria-label={caption}>
      <table className="loom-analysis-table"><caption>{caption}</caption>
        <thead><tr>{columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i}>{row.map((v, j) => j === 0 ? <th scope="row" key={j}>{v}</th> : <td key={j}>{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </div>;
}
