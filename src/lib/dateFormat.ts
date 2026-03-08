// =================================================================
// Date/datetime detection and formatting for table and axes
// =================================================================

const DATE_TYPES = new Set(["DATE", "TIMESTAMP", "DATETIME", "TIME"]);
const DATE_TYPE_PATTERNS = [/^DATE$/i, /^TIMESTAMP/i, /^DATETIME/i, /^TIME$/i];

export function isDateColumn(dataType: string): boolean {
  const t = (dataType ?? "").toUpperCase();
  if (DATE_TYPES.has(t)) return true;
  return DATE_TYPE_PATTERNS.some((p) => p.test(t));
}

function parseDateLike(value: string | number | boolean | null): Date | null {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format for table display (compact). */
export function formatDateCell(value: string | number | boolean | null): string {
  const d = parseDateLike(value);
  if (!d) return value != null && value !== "" ? String(value) : "null";
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours();
  const min = d.getMinutes();
  const sec = d.getSeconds();
  if (h === 0 && min === 0 && sec === 0) {
    return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Format for axis labels (e.g. "Mar 2025"). */
export function formatDateAxis(value: string | number | boolean | null): string {
  const d = parseDateLike(value);
  if (!d) return String(value ?? "");
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric", day: "numeric" });
}
