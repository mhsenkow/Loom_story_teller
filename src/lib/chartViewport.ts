// =================================================================
// Chart viewport — social aspect ratios + device width presets
// =================================================================
// Used by TopBar controls and ChartView stage framing so exports and
// on-screen previews match common social / device canvases.
// =================================================================

export type ChartAspectId =
  | "free"
  | "square"
  | "16:9"
  | "4:5"
  | "9:16"
  | "1.91:1"
  | "3:2"
  | "2.35:1";

export type ChartDeviceId = "auto" | "mobile" | "tablet" | "desktop";

export type DetectedDevice = "mobile" | "tablet" | "desktop";

export const CHART_ASPECTS: {
  id: ChartAspectId;
  label: string;
  /** null = fill available space */
  ratio: number | null;
  blurb: string;
}[] = [
  { id: "free", label: "Free", ratio: null, blurb: "Fill the available chart area" },
  { id: "square", label: "Square", ratio: 1, blurb: "1:1 — Instagram feed" },
  { id: "16:9", label: "16:9", ratio: 16 / 9, blurb: "Landscape video / slides" },
  { id: "4:5", label: "4:5", ratio: 4 / 5, blurb: "Portrait feed post" },
  { id: "9:16", label: "9:16", ratio: 9 / 16, blurb: "Stories / Reels / TikTok" },
  { id: "1.91:1", label: "1.91:1", ratio: 1.91, blurb: "Link preview / Open Graph" },
  { id: "3:2", label: "3:2", ratio: 3 / 2, blurb: "Photo landscape" },
  { id: "2.35:1", label: "2.35:1", ratio: 2.35, blurb: "Cinematic wide" },
];

/** Max content width (px) for device preview frames. */
export const DEVICE_MAX_WIDTH: Record<DetectedDevice, number> = {
  mobile: 390,
  tablet: 834,
  desktop: 1440,
};

export function detectDevice(width: number): DetectedDevice {
  if (width < 768) return "mobile";
  if (width < 1100) return "tablet";
  return "desktop";
}

export function resolveDevice(
  preset: ChartDeviceId,
  viewportWidth: number,
): DetectedDevice {
  if (preset === "auto") return detectDevice(viewportWidth);
  return preset;
}

/**
 * Fit a chart frame into a host box with optional aspect ratio and device max width.
 * Returns CSS pixel size for the inner stage (centered by the parent flex).
 */
export function fitChartFrame(args: {
  hostW: number;
  hostH: number;
  aspectId: ChartAspectId;
  device: DetectedDevice;
  /** Outer padding around the framed stage */
  gutter?: number;
}): { width: number; height: number; aspectLocked: boolean } {
  const gutter = args.gutter ?? 12;
  const hostW = Math.max(120, args.hostW - gutter * 2);
  const hostH = Math.max(120, args.hostH - gutter * 2);
  const maxW = Math.min(hostW, DEVICE_MAX_WIDTH[args.device]);
  const aspect = CHART_ASPECTS.find((a) => a.id === args.aspectId)?.ratio ?? null;

  if (aspect == null || !Number.isFinite(aspect) || aspect <= 0) {
    // Free: fill host, capped by device width (centered when narrower)
    return {
      width: Math.round(maxW),
      height: Math.round(hostH),
      aspectLocked: false,
    };
  }

  // Fit largest rectangle of given aspect inside maxW × hostH
  let width = maxW;
  let height = width / aspect;
  if (height > hostH) {
    height = hostH;
    width = height * aspect;
  }
  // Keep a usable minimum
  width = Math.max(160, width);
  height = Math.max(140, height);
  if (width > maxW) {
    width = maxW;
    height = width / aspect;
  }
  if (height > hostH) {
    height = hostH;
    width = height * aspect;
  }

  // Host is already as narrow as the device cap (squeezed stage / real phone).
  // Locking aspect then only letterboxes height into a postage stamp — fill instead.
  const hostAlreadyDeviceWide = maxW >= hostW * 0.9;
  if (hostAlreadyDeviceWide && height < hostH * 0.6) {
    return {
      width: Math.round(hostW),
      height: Math.round(hostH),
      aspectLocked: false,
    };
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
    aspectLocked: true,
  };
}

export function aspectLabel(id: ChartAspectId): string {
  return CHART_ASPECTS.find((a) => a.id === id)?.label ?? id;
}
