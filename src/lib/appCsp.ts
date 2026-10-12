// =================================================================
// appCsp — report-only shell policy (LOOM-106)
// =================================================================
// Deliver via HTTP headers only (`public/_headers`). CSP Report-Only in a
// <meta http-equiv> is ignored by browsers (and Cloudflare Insights needs
// an explicit script-src host).

/** Report-only CSP for the Next static shell (fonts, Worker API, blobs). */
export const APP_CSP_REPORT_ONLY =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com data:; " +
  "img-src 'self' data: blob: https:; " +
  "connect-src 'self' https://loom.ibm.io https://*.workers.dev wss://stream.wikimedia.org https://static.cloudflareinsights.com https://cloudflareinsights.com; " +
  "frame-ancestors 'self'; " +
  "base-uri 'self'; " +
  "object-src 'none'";

export const APP_CSP_REPORT_ONLY_HEADER = `Content-Security-Policy-Report-Only: ${APP_CSP_REPORT_ONLY}`;

/** connect-src hosts that are analytics-only (not CORS allowlist origins). */
export const APP_CSP_ANALYTICS_CONNECT_HOSTS = [
  "static.cloudflareinsights.com",
  "cloudflareinsights.com",
] as const;
