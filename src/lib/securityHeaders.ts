// =================================================================
// Baseline HTTP security headers (Worker + static export)
// =================================================================

/** Headers safe for HTML shell, JSON APIs, and CSV proxy responses. */
export const BASELINE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export function applyBaselineSecurityHeaders(headers: Headers): void {
  for (const [key, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
}

export function baselineSecurityHeaderRecord(): Record<string, string> {
  return { ...BASELINE_SECURITY_HEADERS };
}
