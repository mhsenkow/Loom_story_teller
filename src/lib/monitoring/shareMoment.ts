// =================================================================
// Loom — Share a moment (story page, image, NeoSpace)
// =================================================================

import { useLoomStore } from "../store";
import { buildChartSharePageHtml } from "../dashboardMicrosite";
import { publishStoryToWorker } from "../socialExport";
import { handOffToNeoSpace } from "../neospaceShare";
import { downloadBlob } from "../download";
import { MOMENT_DARK, momentSvg, momentText, type Moment } from "./moments";

/** Rasterise the 1200×627 moment card (PNG blob). */
export async function momentPng(mo: Moment): Promise<Blob> {
  const svg = momentSvg(mo, { palette: MOMENT_DARK });
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("Couldn't draw the moment")); img.src = url; });
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 627;
    c.getContext("2d")!.drawImage(img, 0, 0, 1200, 627);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't encode the moment"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

/** Publish a story page for the moment; remembers and returns its URL. */
export async function publishMoment(mo: Moment): Promise<{ url?: string; error?: string; png?: Blob }> {
  if (mo.storyUrl) return { url: mo.storyUrl };
  const png = await momentPng(mo);
  const { publicLoomWebOrigin } = await import("../publicOrigin");
  const origin = publicLoomWebOrigin();
  // The private plan ("if this fires, I will…") stays private on published pages.
  const caption = `${mo.reason}. ${mo.feedLabel}.`;
  const html = buildChartSharePageHtml({
    title: mo.monitorName,
    caption,
    imageDataUrl: await blobToDataUrl(png),
    sourceLabel: mo.feedLabel,
    appUrl: origin,
    openUrl: mo.chartLink ? `${origin}/#${mo.chartLink}` : origin,
  });
  const res = await publishStoryToWorker({ html, title: mo.monitorName, ogImageDataUrl: await blobToDataUrl(png) });
  if (!res?.url) return { error: res?.error ?? "Couldn't publish the moment", png };
  useLoomStore.getState().updateMoment(mo.id, { storyUrl: res.url });
  return { url: res.url, png };
}

/** Call from a click: opens NeoSpace compose with the moment card attached. */
export async function postMomentToNeoSpace(mo: Moment): Promise<void> {
  const setToast = useLoomStore.getState().setToast;
  const child = window.open("about:blank", "neospace_loom_share");
  const res = await publishMoment(mo).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e), url: undefined, png: undefined }));
  if (!res.url) {
    child?.close();
    setToast(res.error ?? "Couldn't publish the moment");
    return;
  }
  const png = res.png ?? (await momentPng(mo));
  await handOffToNeoSpace(child, { storyUrl: res.url, text: `${momentText(mo)}\n${res.url}`, image: { blob: png, name: `${mo.monitorName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png` } });
  setToast("Opening NeoSpace with the moment…");
}

export async function downloadMomentPng(mo: Moment): Promise<void> {
  const png = await momentPng(mo);
  const name = `${mo.monitorName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${new Date(mo.at).toISOString().slice(0, 16).replace(/[:T]/g, "")}.png`;
  // Shared helper: iPhone/iPad Tauri drops anchor downloads, so it uses the share sheet there.
  const outcome = await downloadBlob(png, name);
  if (outcome === "unsupported") useLoomStore.getState().setToast("Couldn’t save the image on this device");
}
