// =================================================================
// chartViewThumbnail — downscale dashboard preview PNGs (LOOM-028)
// =================================================================

const MAX_EDGE = 320;
const JPEG_QUALITY = 0.72;

export async function downscaleChartSnapshotDataUrl(dataUrl: string): Promise<string> {
  if (typeof document === "undefined" || !dataUrl.startsWith("data:image")) return dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        resolve(dataUrl);
        return;
      }
      const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
      if (scale >= 0.99 && dataUrl.startsWith("data:image/jpeg")) {
        resolve(dataUrl);
        return;
      }
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, cw, ch);
      resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
