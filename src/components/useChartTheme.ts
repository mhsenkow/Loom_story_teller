"use client";

// Subscribe to the OS palette as well as stored settings so Canvas repaints with CSS.
import { useLoomStore } from "@/lib/store";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { resolveEffectiveTheme } from "@/lib/resolveEffectiveTheme";

export function useChartTheme() {
  const preference = useLoomStore((s) => s.appSettings.theme);
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  return resolveEffectiveTheme(preference, prefersDark);
}
