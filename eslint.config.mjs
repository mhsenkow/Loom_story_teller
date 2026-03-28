// =================================================================
// Loom — ESLint flat config (Next.js + TypeScript)
// =================================================================
// Keeps `npm run lint` / `make check-ts` non-interactive. Ignores Rust
// and build output so agents only lint the Next.js app under src/.
// =================================================================

import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // React Compiler rules: many valid patterns (refs for remount keys, TanStack Virtual,
      // intentional hook deps) are flagged as errors; keep the tree lint-clean without
      // rewriting large components.
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/incompatible-library": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "node_modules/**",
    "src-tauri/**",
    "scripts/**",
    "*.config.*",
  ]),
]);
