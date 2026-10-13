// =================================================================
// idleCallback — requestIdleCallback with Safari / older-WebKit fallback
// =================================================================
// requestIdleCallback landed in Safari 17.4; Capacitor iOS targets 16+,
// so ChartCard (and any future idle work) must not call the globals
// directly — ReferenceError crashes the whole Next client tree.
// =================================================================

export type IdleDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

export type IdleCallbackId = number;

type IdleRequestCallback = (deadline: IdleDeadline) => void;

type IdleRequestOptions = {
  timeout?: number;
};

function timeoutDeadline(didTimeout: boolean): IdleDeadline {
  const start = Date.now();
  return {
    didTimeout,
    timeRemaining: () => Math.max(0, 16 - (Date.now() - start)),
  };
}

/** Schedule low-priority work; falls back to setTimeout on WebKit without RIC. */
export function scheduleIdleCallback(
  cb: IdleRequestCallback,
  options?: IdleRequestOptions,
): IdleCallbackId {
  const g = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
  };
  if (typeof g.requestIdleCallback === "function") {
    return g.requestIdleCallback(cb, options);
  }
  const delay = options?.timeout != null ? Math.min(options.timeout, 50) : 1;
  return setTimeout(() => cb(timeoutDeadline(true)), delay) as unknown as IdleCallbackId;
}

/** Cancel a handle from `scheduleIdleCallback`. */
export function cancelScheduledIdleCallback(id: IdleCallbackId): void {
  const g = globalThis as typeof globalThis & {
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof g.cancelIdleCallback === "function") {
    g.cancelIdleCallback(id);
    return;
  }
  clearTimeout(id);
}
