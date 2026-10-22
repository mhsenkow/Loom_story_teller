// Test helper: resolve a globals.css token on <html> for one theme the way the
// cascade does, including the legacy html.dark / html.light classes that
// ThemeApplicator and the bootstrap script add next to data-theme.
import { readFileSync } from "node:fs";
import type { LookTheme } from "../lookSystem";

const css = readFileSync(new URL("../../styles/globals.css", import.meta.url), "utf8");

const LIGHT_THEMES = new Set<LookTheme>(["light", "paper", "glass", "brutal", "nes"]);

type Rule = { selectors: string[]; decls: Map<string, string> };

/** Top-level `:root` / `html…` rules (column 0), in source order. */
const RULES: Rule[] = [...css.matchAll(/^((?::root|html)[^{]*)\{([^}]*)\}/gm)].map((m) => {
  const decls = new Map<string, string>();
  const body = m[2]!.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const d of body.split(";")) {
    const i = d.indexOf(":");
    if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
  }
  return { selectors: m[1]!.split(",").map((s) => s.trim()), decls };
});

/** Selectors that match <html> for this theme (attribute plus legacy classes). */
function matching(theme: LookTheme): Set<string> {
  const out = new Set([`html[data-theme="${theme}"]`, LIGHT_THEMES.has(theme) ? "html.light" : "html.dark"]);
  if (theme === "contrast") out.add("html.high-contrast");
  return out;
}

/** Declared value of `name` on <html>, with `var()` references substituted. */
export function resolveThemeToken(theme: LookTheme, name: string): string | undefined {
  const sel = matching(theme);
  const lookup = (prop: string): string | undefined => {
    let value: string | undefined;
    // :root is (0,1,0); html[…] and html.x are (0,1,1), so they win in source order.
    for (const r of RULES) if (r.selectors.includes(":root") && r.decls.has(prop)) value = r.decls.get(prop);
    for (const r of RULES) if (r.selectors.some((s) => sel.has(s)) && r.decls.has(prop)) value = r.decls.get(prop);
    return value;
  };
  const substitute = (value: string, depth: number): string =>
    depth > 8
      ? value
      : value.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_, ref: string, fallback?: string) =>
          substitute(lookup(ref) ?? fallback ?? "", depth + 1),
        );
  const raw = lookup(name);
  return raw === undefined ? undefined : substitute(raw, 0);
}
