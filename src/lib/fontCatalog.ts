// One font catalog for app controls, canvas, exports, and bundled font loading.
// Legacy faces settings remain readable; every named choice now uses its real face.
import type { AppFont, FacesSource } from "./lookSystem";

export type FontChoice = {
  family: string;
  local: string;
  fallback: string;
  description: string;
  weights: readonly number[];
  italic: boolean;
};

export const FONT_CHOICES: Record<AppFont, FontChoice> = {
  inter: {
    family: "Inter",
    local: "system-ui",
    fallback: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    description: "Balanced and neutral. A clear starting point for any chart.",
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    italic: true,
  },
  "source-sans": {
    family: "Source Sans 3",
    local: "system-ui",
    fallback: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    description: "Open, humanist letters for small labels and dense tables.",
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    italic: true,
  },
  "source-serif": {
    family: "Source Serif 4",
    local: "Georgia",
    fallback: 'Georgia, "Times New Roman", serif',
    description: "Editorial character for narrative charts and reading.",
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    italic: true,
  },
  "ibm-plex-mono": {
    family: "IBM Plex Mono",
    local: "ui-monospace",
    fallback: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    description: "Technical, fixed-width letters for values and timestamps.",
    weights: [300, 400, 500, 600, 700],
    italic: true,
  },
  "ibm-plex": {
    family: "IBM Plex Sans",
    local: "system-ui",
    fallback: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    description: "Distinct letterforms for technical labels and data.",
    weights: [100, 200, 300, 400, 500, 600, 700],
    italic: true,
  },
  geist: {
    family: "Geist",
    local: "system-ui",
    fallback: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    description: "Compact, crisp letters for dense workspaces.",
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    italic: true,
  },
  lora: {
    family: "Lora",
    local: "Georgia",
    fallback: 'Georgia, "Times New Roman", serif',
    description: "A warm reading serif for stories and longer titles.",
    weights: [400, 500, 600, 700],
    italic: true,
  },
  "libre-baskerville": {
    family: "Libre Baskerville",
    local: "Georgia",
    fallback: 'Georgia, "Times New Roman", serif',
    description: "Broad, traditional letters. Give long labels extra room.",
    weights: [400, 500, 600, 700],
    italic: true,
  },
  "jetbrains-mono": {
    family: "JetBrains Mono",
    local: "ui-monospace",
    fallback: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    description:
      "Clear fixed-width letters for numbers, codes, and comparisons.",
    weights: [100, 200, 300, 400, 500, 600, 700, 800],
    italic: true,
  },
  "fira-code": {
    family: "Fira Code",
    local: "ui-monospace",
    fallback: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    description: "A coding mono for field names and identifiers.",
    weights: [300, 400, 500, 600, 700],
    italic: false,
  },
  "atkinson-hyperlegible-next": {
    family: "Atkinson Hyperlegible Next",
    local: "system-ui",
    fallback: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    description: "Distinctive letter shapes for easier reading at small sizes.",
    weights: [200, 300, 400, 500, 600, 700, 800],
    italic: true,
  },
  "dm-sans": {
    family: "DM Sans",
    local: "system-ui",
    fallback: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    description: "Friendly, open curves for approachable data stories.",
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
    italic: true,
  },
  "space-grotesk": {
    family: "Space Grotesk",
    local: "system-ui",
    fallback: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    description: "Geometric character for bold headlines and word clouds.",
    weights: [300, 400, 500, 600, 700],
    italic: false,
  },
  manrope: {
    family: "Manrope",
    local: "system-ui",
    fallback: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    description: "Rounded, modern geometry with compact proportions.",
    weights: [200, 300, 400, 500, 600, 700, 800],
    italic: false,
  },
  fraunces: {
    family: "Fraunces",
    local: "Georgia",
    fallback: 'Georgia, "Times New Roman", serif',
    description: "Expressive, soft serifs for standout titles and word clouds.",
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    italic: true,
  },
  "ibm-plex-serif": {
    family: "IBM Plex Serif",
    local: "Georgia",
    fallback: 'Georgia, "Times New Roman", serif',
    description: "Structured serifs for editorial and scientific stories.",
    weights: [300, 400, 500, 600, 700],
    italic: true,
  },
};

export const FONT_GROUPS: { label: string; fonts: AppFont[] }[] = [
  {
    label: "Sans serif",
    fonts: [
      "inter",
      "ibm-plex",
      "geist",
      "source-sans",
      "atkinson-hyperlegible-next",
      "dm-sans",
      "space-grotesk",
      "manrope",
    ],
  },
  {
    label: "Serif",
    fonts: [
      "lora",
      "libre-baskerville",
      "source-serif",
      "fraunces",
      "ibm-plex-serif",
    ],
  },
  {
    label: "Monospace",
    fonts: ["jetbrains-mono", "fira-code", "ibm-plex-mono"],
  },
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

const choiceByFamily = new Map(
  Object.entries(FONT_CHOICES).map(([id, choice]) => [
    choice.family,
    { ...choice, id: id as AppFont },
  ]),
);
const deviceStacks = new Map(
  Object.values(FONT_CHOICES).map((choice) => [choice.local, choice.fallback]),
);

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
  _faces?: FacesSource,
): string {
  void _faces; // Persisted source modes no longer change the selected family.
  const explicit = override?.trim();
  if (explicit && explicit !== "inherit") return explicit;
  return (FONT_CHOICES[appFont] ?? FONT_CHOICES.inter).family;
}

export function fontChoiceForFamily(family: string): FontChoice | undefined {
  return choiceByFamily.get(family);
}

export function chartFontLabel(family: string): string {
  return family === "system-ui"
    ? "System sans"
    : family === "ui-monospace"
      ? "System mono"
      : family;
}

// Cache per document, and evict failures so the picker can offer a real retry.
const pending = new WeakMap<Document, Map<string, Promise<boolean>>>();

export function ensureChartFontLoaded(
  family: string,
  _faces?: FacesSource,
  weight = 600,
): Promise<boolean> {
  if (typeof document === "undefined" || !document.fonts?.load)
    return Promise.resolve(false);
  const choice = choiceByFamily.get(family);
  if (!choice) return Promise.resolve(true);
  let cache = pending.get(document);
  if (!cache) {
    cache = new Map();
    pending.set(document, cache);
  }
  const key = `${family}/${weight}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const weights = [...new Set([400, 600, 700, weight])];
  const requests = weights.map((weight) => `${weight} 12px "${family}"`);
  if (choice.italic)
    requests.push(
      ...weights.map((weight) => `italic ${weight} 12px "${family}"`),
    );
  const task = Promise.all(requests.map((font) => document.fonts.load(font)))
    .then(
      // The MCP build has no DOM lib, so FontFace[] is typed as unknown there.
      (faces) => faces.every((loaded) => (loaded as unknown[]).length > 0),
      () => false,
    )
    .then((ok) => {
      if (!ok) cache!.delete(key);
      return ok;
    });
  cache.set(key, task);
  return task;
}

export function ensureLookFontLoaded(
  font: AppFont,
  faces?: FacesSource,
): Promise<boolean> {
  return ensureChartFontLoaded(FONT_CHOICES[font]?.family ?? "Inter", faces);
}
