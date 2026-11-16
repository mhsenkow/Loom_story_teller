import type { Config } from "tailwindcss";

/** Theme token color that also supports Tailwind opacity modifiers (`/20`). */
const token = (cssVar: string) =>
  `color-mix(in srgb, var(${cssVar}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
      },
      colors: {
        // Tokens are hex CSS vars, which Tailwind 3 can't split into channels,
        // so `bg-loom-accent/20`-style opacity modifiers generated NO CSS.
        // color-mix + <alpha-value> makes every `/NN` modifier work.
        loom: {
          bg:       token("--loom-bg"),
          surface:  token("--loom-surface"),
          elevated: token("--loom-elevated"),
          border:   token("--loom-border"),
          text:     token("--loom-text"),
          muted:    token("--loom-muted"),
          label:    token("--loom-label"),
          accent:   token("--loom-accent"),
          "accent-text": token("--loom-accent-text"),
          "accent-dim": token("--loom-accent-dim"),
          success:  token("--loom-success"),
          warning:  token("--loom-warning"),
          // AA text ink for warnings; `warning` stays the fill/border color
          "warning-text": token("--loom-warning-text"),
          error:    token("--loom-error"),
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "SF Mono", "Menlo", "monospace"],
      },
      spacing: {
        "sidebar": "var(--sidebar-width)",
        "panel":   "var(--panel-width)",
      },
      borderRadius: {
        "sm": "var(--radius-sm)",
        "md": "var(--radius-md)",
        "lg": "var(--radius-lg)",
      },
      boxShadow: {
        "loom": "var(--shadow-1)",
        "loom-lg": "var(--shadow-2)",
      },
      // Motion tokens live in globals.css (`--motion-*`, `--ease-*`) so every
      // stock `transition-*` / `ease-out` utility moves on Loom's curves.
      transitionTimingFunction: {
        DEFAULT: "var(--ease-standard)",
        out: "var(--ease-standard)",
        in: "var(--ease-exit)",
        enter: "var(--ease-enter)",
        exit: "var(--ease-exit)",
        spring: "var(--ease-spring)",
      },
      transitionDuration: {
        DEFAULT: "var(--motion-quick)",
      },
      animation: {
        "pulse-subtle": "pulse-subtle 2.4s var(--ease-ambient) infinite",
        "fade-in": "loom-fade-in var(--motion-standard) var(--ease-standard) backwards",
        enter: "loom-rise-in var(--motion-slow) var(--ease-enter) backwards",
        "slide-up": "loom-rise-in var(--motion-gentle) var(--ease-enter) backwards",
        "slide-out": "loom-rise-out var(--motion-quick) var(--ease-exit) forwards",
        pop: "loom-pop-in var(--motion-gentle) var(--ease-enter) backwards",
        sheet: "loom-sheet-in var(--motion-gentle) var(--ease-enter) backwards",
        drawer: "loom-drawer-in var(--motion-gentle) var(--ease-enter) backwards",
        panel: "loom-panel-in var(--motion-gentle) var(--ease-enter) backwards",
      },
      keyframes: {
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
