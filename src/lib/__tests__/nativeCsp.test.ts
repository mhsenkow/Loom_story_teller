import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { DIRECT_FETCH_HOSTS } from "../webStreams";

// The iOS / desktop Tauri webview enforces its CSP. Anything the web build reaches
// directly (not via the Worker) must be in connect-src or it silently fails on iPad.
describe("Tauri CSP connect-src", () => {
  const conf = JSON.parse(readFileSync(resolve(__dirname, "../../../src-tauri/tauri.conf.json"), "utf8"));
  const csp: string = conf.app.security.csp;
  const connect = csp.match(/connect-src ([^;]+)/)?.[1] ?? "";

  it("allows every host the client fetches directly", () => {
    expect(DIRECT_FETCH_HOSTS.length).toBeGreaterThan(0);
    for (const host of DIRECT_FETCH_HOSTS) expect(connect, host).toContain(`https://${host}`);
  });

  it("allows the production Worker origin", () => {
    expect(connect).toContain("https://loom.ibm.io");
  });
});
