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
          "accent-dim": token("--loom-accent-dim"),
          success:  token("--loom-success"),
          warning:  token("--loom-warning"),
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
      animation: {
        "pulse-subtle": "pulse-subtle 2s ease-in-out infinite",
        "fade-in": "fade-in 0.2s ease-out",
        "slide-up": "slide-up 0.3s ease-out",
      },
      keyframes: {
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
