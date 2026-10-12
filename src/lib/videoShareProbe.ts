// =================================================================
// videoShareProbe — MIME + canShare checks for mobile export (LOOM-641)
// =================================================================

export type VideoRecorderSupport = {
  supported: boolean;
  mimeType: string | null;
  reason?: string;
};

const CANDIDATE_MIMES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
];

export function pickVideoRecorderMime(): VideoRecorderSupport {
  if (typeof MediaRecorder === "undefined") {
    return { supported: false, mimeType: null, reason: "MediaRecorder unavailable" };
  }
  for (const mimeType of CANDIDATE_MIMES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return { supported: true, mimeType };
    }
  }
  return { supported: false, mimeType: null, reason: "No supported video MIME" };
}

export function canShareVideoFile(file: File): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}
