import { writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "out");
const id = new Date().toISOString();
writeFileSync(join(outDir, "build-id.txt"), `${id}\n`, "utf8");
console.log(`Wrote build-id.txt (${id})`);
