// =================================================================
// smartInputClamp — bounds for Smart tab numeric inputs (LOOM-273)
// =================================================================

export const SMART_TOP_N = { min: 2, max: 500 } as const;
export const SMART_WINDOW = { min: 1, max: 3650 } as const;
export const SMART_Z = { min: 0.5, max: 6 } as const;
export const SMART_IQR = { min: 0.5, max: 5 } as const;
export const SMART_FORECAST = { min: 1, max: 120 } as const;

export function clampSmartInt(raw: number, bounds: { min: number; max: number }): number {
  if (!Number.isFinite(raw)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(raw)));
}

export function clampSmartFloat(raw: number, bounds: { min: number; max: number }): number {
  if (!Number.isFinite(raw)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, raw));
}
