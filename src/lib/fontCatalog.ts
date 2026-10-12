// =================================================================
// fontCatalog — optional web font loading
// =================================================================

import type { AppFont, FacesSource } from "./lookSystem";

const BOOT_FAMILIES =
  "family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600";

const FONT_QUERY: Partial<Record<AppFont, string>> = {
  inter: BOOT_FAMILIES,
  "ibm-plex": "family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600",
  lora: "family=Lora:ital,wght@0,400;0,600;0,700;1,400",
  "libre-baskerville": "family=Libre+Baskerville:ital,wght@0,400;0,700;1,400",
  geist: "family=Inter:wght@400;500;600;700",
  "jetbrains-mono": "family=JetBrains+Mono:wght@400;500;600",
  "fira-code": "family=Fira+Code:wght@400;500;600",
};

const loaded = new Set<string>();

export function ensureLookFontLoaded(font: AppFont, faces: FacesSource): void {
  if (typeof document === "undefined") return;
  if (faces !== "web") return;
  const q = FONT_QUERY[font] ?? FONT_QUERY.inter!;
  if (loaded.has(q)) return;
  loaded.add(q);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${q}&display=swap`;
  document.head.appendChild(link);
}
