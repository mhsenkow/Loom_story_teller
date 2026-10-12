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

const MISSING_DISPLAY = "—";

export function formatMissingCell(): string {
  return MISSING_DISPLAY;
}

function isDateOnlyString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function formatDateOnlyParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Format for table display (compact). Optional column type avoids timezone drift on DATE. */
export function formatDateCell(
  value: string | number | boolean | null,
  dataType?: string,
): string {
  if (value == null || value === "") return MISSING_DISPLAY;
  const s = String(value).trim();
  if (!s) return MISSING_DISPLAY;

  const dt = (dataType ?? "").toUpperCase();
  if (dt === "DATE" || isDateOnlyString(s)) {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return formatDateOnlyParts(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) {
    const iso = s.includes("T") ? s : s.replace(" ", "T");
    const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
    if (!hasZone) {
      const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
      if (m) {
        return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
      }
    }
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours();
  const min = d.getMinutes();
  const sec = d.getSeconds();
  if (h === 0 && min === 0 && sec === 0 && !dt.includes("TIME")) {
    return formatDateOnlyParts(y, mo, day);
  }
  return `${formatDateOnlyParts(y, mo, day)} ${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Format for axis labels (e.g. "Mar 2025"). */
export function formatDateAxis(value: string | number | boolean | null): string {
  if (value == null || value === "") return "";
  const s = String(value).trim();
  if (isDateOnlyString(s)) {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return d.toLocaleDateString(undefined, { month: "short", year: "numeric", day: "numeric" });
    }
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(value ?? "");
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric", day: "numeric" });
}
