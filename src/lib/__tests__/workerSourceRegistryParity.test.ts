import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SOURCE_KINDS } from "../sourceRegistry";

/**
 * LOOM-500 — every registry kind must have a Worker fetcher + TTL entry.
 * Parses workers/catalog-proxy.ts to avoid pulling Worker types into Vitest.
 */
describe("Worker source registry parity", () => {
  const proxy = readFileSync(join(process.cwd(), "workers/catalog-proxy.ts"), "utf8");

  it("defines SOURCE_FETCHERS and SOURCE_TTL_SECS for each SOURCE_KINDS entry", () => {
    for (const kind of SOURCE_KINDS) {
      expect(proxy, `fetcher missing for ${kind}`).toMatch(new RegExp(`\\b${kind}\\s*:`));
    }
  });

  it("TTL map includes each kind with numeric seconds", () => {
    const ttlBlock = proxy.match(/SOURCE_TTL_SECS[^=]*=\s*\{([\s\S]*?)\n\};/);
    expect(ttlBlock).not.toBeNull();
    const body = ttlBlock![1]!;
    for (const kind of SOURCE_KINDS) {
      expect(body, `TTL missing for ${kind}`).toMatch(new RegExp(`\\b${kind}\\s*:\\s*\\d+`));
    }
  });
});
