// =================================================================
// rafCoalesce — one callback per animation frame (LOOM-292, LOOM-285)
// =================================================================

export type RafCoalescer = {
  schedule: () => void;
  cancel: () => void;
};

export function createRafCoalescer(fn: () => void): RafCoalescer {
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      fn();
    });
  };
  const cancel = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  return { schedule, cancel };
}

/** Throttle high-frequency events to at most once per frame. */
export function rafThrottle<T extends (...args: never[]) => void>(fn: T): T {
  let raf = 0;
  let lastArgs: Parameters<T> | null = null;
  const run = () => {
    raf = 0;
    if (lastArgs) fn(...lastArgs);
    lastArgs = null;
  };
  return ((...args: Parameters<T>) => {
    lastArgs = args;
    if (!raf) raf = requestAnimationFrame(run);
  }) as T;
}
