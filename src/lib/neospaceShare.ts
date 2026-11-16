// =================================================================
// NeoSpace compose handoff (shared by Share sheet and Monitor moments)
// =================================================================
// Opens neospace.ibm.io in a window the caller already opened during the
// click (popup blockers), points it at the published story, and posts the
// PNG over postMessage once NeoSpace says it's ready. NeoSpace falls back to
// fetching `/s/{id}.img` if the message never lands.
// Native shells have a single webview and no popups, so there we hand the
// compose URL to the system browser instead of navigating the app away.
// =================================================================

import { isNativeShell, openExternalUrl } from "./tauri";

export const NEOSPACE_ORIGIN = "https://neospace.ibm.io";

export function neoSpaceComposeUrl(storyUrl: string, text: string): string {
  const dest = new URL(NEOSPACE_ORIGIN);
  dest.searchParams.set("compose", "loom");
  dest.searchParams.set("story", storyUrl);
  dest.searchParams.set("text", text);
  return dest.toString();
}

export async function handOffToNeoSpace(
  child: Window | null,
  input: { storyUrl: string; text: string; image?: { blob: Blob; name: string } },
): Promise<void> {
  const url = neoSpaceComposeUrl(input.storyUrl, input.text);
  if (!child) {
    if (isNativeShell()) await openExternalUrl(url);
    else window.location.assign(url);
    return;
  }
  child.location.href = url;
  if (!input.image) return;
  try {
    const buffer = await input.image.blob.arrayBuffer();
    const payload = {
      type: "loom-neospace-share" as const,
      v: 1 as const,
      text: input.text,
      story: input.storyUrl,
      image: { name: input.image.name, type: input.image.blob.type || "image/png", buffer },
    };
    const send = () => {
      if (child.closed) return;
      try {
        child.postMessage(payload, NEOSPACE_ORIGIN);
      } catch {
        /* ignore */
      }
    };
    const pump = window.setInterval(send, 400);
    const onReady = (e: MessageEvent) => {
      if (e.source !== child) return;
      if (e.origin !== NEOSPACE_ORIGIN && !String(e.origin).includes("neospace")) return;
      const type = (e.data as { type?: string } | null)?.type;
      if (type === "neospace-loom-ready" || type === "neospace-loom-ack") send();
      if (type === "neospace-loom-ack") {
        window.removeEventListener("message", onReady);
        window.clearInterval(pump);
      }
    };
    window.addEventListener("message", onReady);
    window.setTimeout(() => {
      window.removeEventListener("message", onReady);
      window.clearInterval(pump);
    }, 10_000);
    send();
  } catch {
    /* NeoSpace fetches /s/{id}.img instead */
  }
}
