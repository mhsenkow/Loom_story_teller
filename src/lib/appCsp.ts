// =================================================================
// appCsp — report-only shell policy (LOOM-106)
// =================================================================

/** Report-only CSP for the Next static shell (fonts, Worker API, blobs). */
export const APP_CSP_REPORT_ONLY =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com data:; " +
  "img-src 'self' data: blob: https:; " +
  "connect-src 'self' https://loom.ibm.io https://*.workers.dev wss://stream.wikimedia.org; " +
  "frame-ancestors 'self'; " +
  "base-uri 'self'; " +
  "object-src 'none'";

export const APP_CSP_REPORT_ONLY_HEADER = `Content-Security-Policy-Report-Only: ${APP_CSP_REPORT_ONLY}`;
