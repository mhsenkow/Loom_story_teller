import { defineConfig } from "vitest/config";
import path from "path";

/** Live network probes — never part of `npm test`; run by the nightly feed-health workflow. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["workers/probes/**/*.probe.ts"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
