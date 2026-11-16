import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  DEFAULT_ALLOWED_ORIGIN_HOSTS,
  originAllowed,
  parseAllowedOriginHosts,
} from "../../../workers/allowedOrigins";

describe("allowedOrigins (LOOM-654)", () => {
  it("allows loom and localhost origins", () => {
    expect(originAllowed("https://loom.ibm.io", DEFAULT_ALLOWED_ORIGIN_HOSTS)).toBe(true);
    expect(originAllowed("http://localhost:3000", DEFAULT_ALLOWED_ORIGIN_HOSTS)).toBe(true);
  });

  it("rejects unknown hosts", () => {
    expect(originAllowed("https://evil.example", DEFAULT_ALLOWED_ORIGIN_HOSTS)).toBe(false);
  });

  it("parses env override list", () => {
    expect(parseAllowedOriginHosts("a.example,b.example")).toEqual(["a.example", "b.example"]);
  });

  const ROOT = resolve(__dirname, "../../..");
  const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

  it("defines the list in one place: wrangler.jsonc carries no copy of the defaults", () => {
    const wrangler = read("wrangler.jsonc").replace(/^\s*\/\/.*$/gm, "");
    expect(wrangler).not.toMatch(/"ALLOWED_ORIGIN_HOSTS"/);
    for (const host of DEFAULT_ALLOWED_ORIGIN_HOSTS) expect(wrangler).not.toContain(`"${host},`);
  });

  it("static _headers CSP and MCP link only to hosts in the shared list", () => {
    const headers = read("public/_headers");
    const csp = headers.match(/connect-src ([^;]+)/)?.[1] ?? "";
    // Analytics beacons are CSP-only (not app CORS origins).
    const cspOnly = new Set(["static.cloudflareinsights.com", "cloudflareinsights.com"]);
    for (const m of csp.matchAll(/https:\/\/([a-z0-9.*-]+)/gi)) {
      const host = m[1]!.replace(/^\*\./, "");
      if (host === "workers.dev") continue; // wildcard for the workers.dev deploy host
      if (cspOnly.has(host)) continue;
      expect(originAllowed(`https://${host}`, DEFAULT_ALLOWED_ORIGIN_HOSTS), host).toBe(true);
    }
    const mcpUrl = read("mcp/src/tools.ts").match(/const LOOM_URL = "(https:\/\/[^"]+)"/)?.[1];
    expect(mcpUrl).toBeTruthy();
    expect(originAllowed(mcpUrl!, DEFAULT_ALLOWED_ORIGIN_HOSTS)).toBe(true);
  });
});
