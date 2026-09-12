/**
 * How much parallelism this machine will actually give us.
 *
 * Scanning is dominated by wasm key recovery — one Diffie-Hellman and a decrypt attempt for every
 * output on the chain — so the useful thread count is bounded by cores, not by how many requests
 * the network will take. Offering "24" on a 4-core laptop just oversubscribes the CPU and makes
 * the scan slower while pinning the machine, so the picker is built from what the browser reports
 * rather than from a fixed list.
 */

/** Logical cores, or a conservative guess where the browser will not say. */
export function detectedCores(): number {
  const n = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 4;
}

/**
 * The most detection workers worth running: every core but the one the UI needs to stay
 * responsive. Single-core machines still get one worker — off the main thread is the point.
 */
export function maxWorkers(): number {
  return Math.max(1, detectedCores() - 1);
}

const STEPS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

/** Selectable thread counts for this machine, always including its ceiling. */
export function threadOptions(): number[] {
  const max = maxWorkers();
  const opts = STEPS.filter((n) => n <= max);
  if (opts[opts.length - 1] !== max) opts.push(max);
  return opts;
}

/** Clamps a stored preference — the machine may have changed since it was saved. */
export function clampThreads(n: number): number {
  const max = maxWorkers();
  if (!Number.isFinite(n) || n < 1) return Math.min(4, max);
  return Math.min(Math.floor(n), max);
}
