import { defineConfig } from "vitest/config";
import path from "path";

/** DOM project for React component tests (LOOM-503, LOOM-673). */
export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    globals: false,
    environment: "jsdom",
    include: ["src/**/*.test.tsx", "src/**/*.dom.test.ts"],
    setupFiles: ["src/lib/__tests__/setupDom.ts", "src/lib/__tests__/setupDomIdb.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
