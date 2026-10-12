// =================================================================
// startupIntent — precedence for cold-open flows (LOOM-043)
// =================================================================
// Order: shared link / suite handoff → saved session → onboarding.
// =================================================================

export type StartupIntentKind =
  | "shared-chart"
  | "shared-dive"
  | "shared-story"
  | "neospace-handoff"
  | "saved-session"
  | "onboarding"
  | "none";

export interface StartupIntent {
  kind: StartupIntentKind;
  /** When true, Onboarding must stay closed. */
  suppressOnboarding: boolean;
  reason?: string;
}

const SHARED_HASH = /(?:^#|&)(?:chart|dive|story)=/;

export function resolveStartupIntent(input: {
  hash: string;
  hasDiscoverSeen: boolean;
  hasLastSession: boolean;
  neospaceHandoff?: boolean;
}): StartupIntent {
  if (input.neospaceHandoff) {
    return { kind: "neospace-handoff", suppressOnboarding: true, reason: "NeoSpace ingest handoff" };
  }
  if (/#story=/.test(input.hash)) {
    return { kind: "shared-story", suppressOnboarding: true };
  }
  if (/#chart=/.test(input.hash)) {
    return { kind: "shared-chart", suppressOnboarding: true };
  }
  if (/#dive=/.test(input.hash)) {
    return { kind: "shared-dive", suppressOnboarding: true };
  }
  if (SHARED_HASH.test(input.hash)) {
    return { kind: "shared-chart", suppressOnboarding: true };
  }
  if (input.hasLastSession) {
    return { kind: "saved-session", suppressOnboarding: false, reason: "Resume last stream/file" };
  }
  if (!input.hasDiscoverSeen) {
    return { kind: "onboarding", suppressOnboarding: false };
  }
  return { kind: "none", suppressOnboarding: true };
}

export function shouldOpenOnboarding(intent: StartupIntent): boolean {
  return intent.kind === "onboarding" && !intent.suppressOnboarding;
}
