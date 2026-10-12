// =================================================================
// Shared helpers for chart PNG capture (share sheet, previews, carousel)
// =================================================================

import { useLoomStore } from "./store";

export function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function waitForPngHandler(timeoutMs: number): Promise<boolean> {
  const getState = useLoomStore.getState;
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (getState().pngExportHandler) {
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

/** True when PNG is a failed near-black slab (GPU race). */
export async function looksLikeFailedCapture(blob: Blob): Promise<boolean> {
  if (blob.size < 80) return true;
  try {
    const bmp = await createImageBitmap(blob);
    const sw = Math.min(48, bmp.width);
    const sh = Math.min(48, bmp.height);
    if (sw < 4 || sh < 4) {
      bmp.close();
      return true;
    }
    const c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      bmp.close();
      return false;
    }
    ctx.drawImage(bmp, 0, 0, sw, sh);
    bmp.close();
    const { data } = ctx.getImageData(0, 0, sw, sh);
    let sum = 0;
    let n = 0;
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      const lum = a < 8 ? 0 : 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += lum;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
      n++;
    }
    if (n === 0) return true;
    const mean = sum / n;
    const range = max - min;
    return mean < 28 && range < 10;
  } catch {
    return false;
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

let captureChain: Promise<unknown> = Promise.resolve();

/** Serialize capture paths that mutate stage geometry / chart view. */
export function runSerializedCapture<T>(fn: () => Promise<T>): Promise<T> {
  const run = captureChain.then(() => fn());
  captureChain = run.catch(() => undefined);
  return run;
}

/** Ellipsis-truncate text to fit maxWidth (canvas measureText). */
export function truncateTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0 || !text) return text;
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ell = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const slice = text.slice(0, mid).trimEnd() + ell;
    if (ctx.measureText(slice).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + ell;
}
