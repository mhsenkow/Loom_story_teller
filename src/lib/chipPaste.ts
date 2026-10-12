// =================================================================
// chipPaste — split clipboard text into Dive chip values (LOOM-571)
// =================================================================
// Prefer newlines/tabs as separators. When only commas are present,
// honour simple CSV quoting, and re-join an unquoted "City, ST" /
// "City, D.C." tail (a short all-caps abbreviation after a non-
// abbreviation) so "Washington, D.C." pastes as one value.
// =================================================================

/** Split pasted text into chip values without breaking quoted commas. */
export function splitChipPaste(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (/[\n\t]/.test(normalized)) {
    return normalized
      .split(/[\n\t]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const hasQuote = normalized.includes('"');
  const parts = splitCsvLine(normalized);
  return hasQuote ? parts : rejoinPlaceTails(parts);
}

const ABBREV = /^(?:[A-Z]\.){1,3}$|^[A-Z]{2,3}$/;

/** Merge "D.C."/"NY"-style tails into the preceding place name (never when the previous item is itself an abbreviation). */
function rejoinPlaceTails(parts: string[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev !== undefined && ABBREV.test(p) && !ABBREV.test(prev)) out[out.length - 1] = `${prev}, ${p}`;
    else out.push(p);
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      const trimmed = cur.trim();
      if (trimmed) out.push(trimmed);
      cur = "";
      continue;
    }
    cur += ch;
  }
  const trimmed = cur.trim();
  if (trimmed) out.push(trimmed);
  return out;
}
