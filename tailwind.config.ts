import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        loom: {
          bg:       "var(--loom-bg)",
          surface:  "var(--loom-surface)",
          elevated: "var(--loom-elevated)",
          border:   "var(--loom-border)",
          text:     "var(--loom-text)",
          muted:    "var(--loom-muted)",
          accent:   "var(--loom-accent)",
          "accent-dim": "var(--loom-accent-dim)",
          success:  "var(--loom-success)",
          warning:  "var(--loom-warning)",
          error:    "var(--loom-error)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "SF Mono", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
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
