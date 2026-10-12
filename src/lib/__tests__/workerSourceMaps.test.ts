// =================================================================
// Worker source-map config guard (LOOM-509)
// =================================================================
// Both Workers upload source maps to Cloudflare (for symbolicated stack
// traces) — declared exactly once per config, and never shipped as public
// static assets.
// =================================================================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");

function mapFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) mapFiles(p, acc);
    else if (name.endsWith(".map")) acc.push(p);
  }
  return acc;
}

describe("Worker source maps", () => {
  it.each(["wrangler.jsonc", "mcp/wrangler.jsonc"])("%s enables upload_source_maps exactly once", (file) => {
    const text = readFileSync(resolve(ROOT, file), "utf8");
    const withoutComments = text.replace(/^\s*\/\/.*$/gm, "");
    expect(withoutComments.match(/"upload_source_maps"\s*:\s*true/g)).toHaveLength(1);
    expect(withoutComments.match(/"upload_source_maps"/g)).toHaveLength(1);
  });

  it("public/ and the static export never contain .map files", () => {
    expect(mapFiles(resolve(ROOT, "public"))).toEqual([]);
    expect(mapFiles(resolve(ROOT, "out"))).toEqual([]);
  });
});
