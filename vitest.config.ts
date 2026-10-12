import { defineConfig } from "vitest/config";
import path from "path";

/** Fast Node project — pure lib tests (default `npm run test:run`). */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts", "mcp/src/**/*.test.ts", "workers/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/lib/**/*.ts", "workers/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "**/*.d.ts"],
      thresholds: {
        lines: 0,
        functions: 0,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
