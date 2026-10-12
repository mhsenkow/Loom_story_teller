// =================================================================
// Loom — Safe user-supplied regular expressions
// =================================================================
// Dive filters and derived-column expressions compile user patterns on
// the main thread. Reject overlong or nested-quantifier patterns that
// can freeze the tab (e.g. (a+)+ on long strings).
// =================================================================

export const MAX_USER_REGEX_LEN = 256;

/** Patterns likely to cause catastrophic backtracking on long inputs. */
export function isUnsafeRegexPattern(src: string): boolean {
  if (src.length > MAX_USER_REGEX_LEN) return true;
  // Quantified group wrapping an inner quantifier: (a+)+, (.*)*, etc.
  if (/\([^)]*[+*?][^)]*\)[+*?{]/.test(src)) return true;
  if (/\)[+*?]{2,}/.test(src)) return true;
  return false;
}

/** Compile a user regex when safe; otherwise null (invalid / rejected). */
export function safeUserRegex(src: string, flags = "i"): RegExp | null {
  const trimmed = src.trim();
  if (!trimmed || isUnsafeRegexPattern(trimmed)) return null;
  try {
    return new RegExp(trimmed, flags);
  } catch {
    return null;
  }
}
