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
      // jsx-a11y via eslint-config-next/core-web-vitals (LOOM-483) — ratchet on new UI:
      "jsx-a11y/control-has-associated-label": "warn",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "CallExpression[callee.name='useLoomStore'][arguments.length=0]",
          message:
            "Use selective useLoomStore((s) => …) slices (LOOM-067); whole-store subscription rerenders on every write.",
        },
      ],
    },
  },
  {
    // LOOM-141 extraction still uses @ts-nocheck while ChartViewRuntime is a loose bag;
    // ban-ts-comment would block deploy until the bag is typed. Allow only under chartView/.
    files: ["src/components/chartView/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
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
