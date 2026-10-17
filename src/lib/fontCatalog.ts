// =================================================================
// fontCatalog — optional web font loading
// =================================================================

import type { AppFont, FacesSource } from "./lookSystem";

/** One catalog for Settings, Visual, canvas fallbacks, and optional downloads. */
export const FONT_CHOICES: Record<
  AppFont,
  {
    family: string;
    local: string;
    fallback: string;
    description: string;
    query: string;
  }
> = {
  "source-sans": {
    family: "Source Sans 3", local: "system-ui",
    fallback: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    description: "Open, humanist sans for small chart labels and dense tables.",
    query: "family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700",
  },
  "source-serif": {
    family: "Source Serif 4", local: "Georgia",
    fallback: 'Georgia, "Times New Roman", serif',
    description: "Editorial serif for narrative charts, annotations, and reading.",
    query: "family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700",
  },
  "ibm-plex-mono": {
    family: "IBM Plex Mono", local: "ui-monospace",
    fallback: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    description: "Technical mono for aligned values, timestamps, and precise readouts.",
    query: "family=IBM+Plex+Mono:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700",
  },
  inter: {
    family: "Inter",
    local: "system-ui",
    fallback: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    description: "Clear, balanced interface and chart text.",
    query:
      "family=Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,600;1,700",
  },
  "ibm-plex": {
    family: "IBM Plex Sans",
    local: "system-ui",
    fallback: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    description: "Distinct letterforms for technical labels and data.",
    query:
      "family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,600;1,700&family=IBM+Plex+Mono:wght@400;500;600",
  },
  geist: {
    family: "Geist",
    local: "system-ui",
    fallback: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    description: "Compact, neutral sans serif for dense workspaces.",
    query: "family=Geist:wght@300;400;500;600;700",
  },
  lora: {
    family: "Lora",
    local: "Georgia",
    fallback: 'Georgia, "Times New Roman", serif',
    description: "A reading serif for editorial charts and longer titles.",
    query: "family=Lora:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700",
  },
  "libre-baskerville": {
    family: "Libre Baskerville",
    local: "Georgia",
    fallback: 'Georgia, "Times New Roman", serif',
    description: "A broad, traditional serif; give long labels extra room.",
    query: "family=Libre+Baskerville:ital,wght@0,400;0,700;1,400",
  },
  "jetbrains-mono": {
    family: "JetBrains Mono",
    local: "ui-monospace",
    fallback: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    description:
      "Fixed-width text for numbers, codes, and aligned comparisons.",
    query:
      "family=JetBrains+Mono:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,600;1,700",
  },
  "fira-code": {
    family: "Fira Code",
    local: "ui-monospace",
    fallback: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    description: "A coding mono; useful for field names and identifiers.",
    query: "family=Fira+Code:wght@300;400;500;600;700",
  },
};

export const FONT_GROUPS: { label: string; fonts: AppFont[] }[] = [
  { label: "Sans serif", fonts: ["inter", "ibm-plex", "geist", "source-sans"] },
  { label: "Serif", fonts: ["lora", "libre-baskerville", "source-serif"] },
  { label: "Monospace", fonts: ["jetbrains-mono", "fira-code", "ibm-plex-mono"] },
];

const genericFamilies = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "system-ui",
  "ui-monospace",
  "ui-serif",
  "ui-sans-serif",
]);

const choiceByFamily = new Map(Object.entries(FONT_CHOICES).map(([id, choice]) => [choice.family, { ...choice, id: id as AppFont }]));
const deviceStacks = new Map(Object.values(FONT_CHOICES).map((choice) => [choice.local, choice.fallback]));

/** Preserve the intended category offline. Never quote a generic CSS family. */
export function chartFontStack(family = "Inter"): string {
  const name = family.trim() || "Inter";
  const choice = choiceByFamily.get(name);
  if (choice) return `"${name}", ${choice.fallback}`;
  const device = deviceStacks.get(name);
  if (device) return device;
  if (genericFamilies.has(name))
    return name === "ui-monospace"
      ? FONT_CHOICES["jetbrains-mono"].fallback
      : name;
  const safe = name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  const fallback = /mono|courier|consolas|menlo/i.test(name)
    ? FONT_CHOICES["jetbrains-mono"].fallback
    : /georgia|times/i.test(name)
      ? FONT_CHOICES.lora.fallback
      : FONT_CHOICES.inter.fallback;
  return `"${safe}", ${fallback}`;
}

export function resolveChartFontFamily(
  override: string | undefined,
  appFont: AppFont,
  faces: FacesSource,
): string {
  const explicit = override?.trim();
  if (explicit && explicit !== "inherit") {
    const chosen = choiceByFamily.get(explicit);
    return chosen && faces !== "web" ? chosen.local : explicit;
  }
  const choice = FONT_CHOICES[appFont] ?? FONT_CHOICES.inter;
  return faces === "web" ? choice.family : choice.local;
}

export function chartFontLabel(family: string): string {
  return family === "system-ui" ? "System sans" : family === "ui-monospace" ? "System mono" : family;
}

const loaded = new Set<AppFont>();

export function ensureLookFontLoaded(font: AppFont, faces: FacesSource): void {
  if (typeof document === "undefined" || faces !== "web" || loaded.has(font))
    return;
  const choice = FONT_CHOICES[font];
  if (!choice) return;
  loaded.add(font);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${choice.query}&display=swap`;
  link.onload = () => {
    // Canvas does not reflow like DOM text. Request its common weights so the
    // FontFaceSet loadingdone event can repaint with the final measurements.
    if (document.fonts)
      void Promise.all(
        [400, 600, 700].map((weight) =>
          document.fonts.load(`${weight} 12px "${choice.family}"`),
        ),
      ).catch(() => {});
  };
  link.onerror = () => {
    loaded.delete(font);
    link.remove();
  };
  document.head.appendChild(link);
}

export function ensureChartFontLoaded(
  family: string,
  faces: FacesSource,
): void {
  const id = choiceByFamily.get(family)?.id;
  if (id) ensureLookFontLoaded(id, faces);
}
