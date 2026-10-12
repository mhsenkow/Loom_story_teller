// =================================================================
// appActivity — document visibility + native lifecycle hooks
// =================================================================
// Single activity signal for pausing polls, animations, and heavy
// render work when the tab or shell is backgrounded (LOOM-081, LOOM-336).
// =================================================================

export type AppActivityListener = (active: boolean) => void;

let listeners = new Set<AppActivityListener>();
let active = true;
let wired = false;

export function isAppActive(): boolean {
  if (typeof document === "undefined") return true;
  return active && document.visibilityState !== "hidden";
}

export function subscribeAppActivity(fn: AppActivityListener): () => void {
  listeners.add(fn);
  fn(isAppActive());
  ensureWired();
  return () => {
    listeners.delete(fn);
  };
}

function setActive(next: boolean) {
  if (next === active) return;
  active = next;
  for (const fn of listeners) fn(isAppActive());
}

function ensureWired() {
  if (wired || typeof document === "undefined" || typeof window === "undefined") return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    setActive(document.visibilityState !== "hidden");
  });
  window.addEventListener("pagehide", () => setActive(false));
  window.addEventListener("pageshow", () => setActive(document.visibilityState !== "hidden"));
  try {
    const cap = (
      window as Window & {
        Capacitor?: {
          isNativePlatform?: () => boolean;
          Plugins?: { App?: { addListener?: (event: string, cb: (state: { isActive: boolean }) => void) => void } };
        };
      }
    ).Capacitor;
    if (cap?.isNativePlatform?.() && cap.Plugins?.App?.addListener) {
      void cap.Plugins.App.addListener("appStateChange", (state: { isActive: boolean }) => {
        setActive(!!state.isActive);
      });
    }
  } catch {
    /* optional Capacitor bridge */
  }
}

/** Test hook — reset module state between unit tests. */
export function _resetAppActivityForTests() {
  listeners = new Set();
  active = true;
  wired = false;
}
