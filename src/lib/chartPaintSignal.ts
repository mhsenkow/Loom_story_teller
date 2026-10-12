// =================================================================
// Chart paint completion — wait for Canvas / WebGPU frames
// =================================================================
// Share sheet and platform capture resize the stage then read pixels.
// Fixed sleeps were slow and still raced GPU; renderers resolve this.
// =================================================================

let waiters: Array<() => void> = [];

/** Called after ChartView finishes a visible chart frame (Canvas or WebGPU). */
export function notifyChartPainted(): void {
  const pending = waiters;
  waiters = [];
  for (const w of pending) w();
}

/** Resolves on the next painted frame, or after timeout (still resolves). */
export function waitForChartPaint(timeoutMs = 2500): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      waiters = waiters.filter((w) => w !== finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    waiters.push(finish);
  });
}
