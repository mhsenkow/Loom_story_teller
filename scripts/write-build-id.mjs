import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "out");
const id = new Date().toISOString();
writeFileSync(join(outDir, "build-id.txt"), `${id}\n`, "utf8");

const swPath = join(outDir, "sw.js");
if (existsSync(swPath)) {
  const sw = readFileSync(swPath, "utf8");
  const next = sw.replace(
    /const BUILD_ID = ["'][^"']*["']/,
    `const BUILD_ID = ${JSON.stringify(id)}`,
  );
  if (next === sw) {
    console.warn("write-build-id: BUILD_ID marker missing in out/sw.js");
  } else {
    writeFileSync(swPath, next, "utf8");
  }
}

console.log(`Wrote build-id.txt (${id})`);
