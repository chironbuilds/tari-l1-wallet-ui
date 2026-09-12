import type { DetectFailure, DetectHit, DetectItem } from "./scan-worker";
import { clampThreads } from "./threads";

/**
 * A pool of ownership-testing workers, sized to the machine.
 *
 * Work is hitched to whichever worker is idle rather than round-robined, because blocks vary
 * enormously in output count and a fixed rotation leaves fast workers waiting on a slow one.
 */
export interface DetectPool {
  readonly size: number;
  detect(items: DetectItem[]): Promise<{ hits: DetectHit[]; failures: DetectFailure[] }>;
  dispose(): void;
}

interface Slot {
  worker: Worker;
  busy: boolean;
}

/** Items handed to one worker at a time. Small enough to keep every worker fed. */
const CHUNK = 400;
/**
 * How long a worker gets to come up, and to answer.
 *
 * A worker that fails to start is not always a worker that reports an error: a module worker whose
 * top-level import never settles simply goes quiet, firing neither `message` nor `error`. Without a
 * deadline the pool waits on it forever and takes the whole scan down with it, which is worse than
 * having no pool at all. On timeout the caller falls back to detecting on the main thread — slower,
 * but the wallet still finds its money.
 */
const INIT_TIMEOUT_MS = 10_000;
const DETECT_TIMEOUT_MS = 60_000;

export async function createDetectPool(
  backupHex: string,
  network: string,
  threads: number,
): Promise<DetectPool> {
  const size = clampThreads(threads);
  let nextId = 1;

  const spawn = (): Promise<Slot> =>
    new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL("./scan-worker.ts", import.meta.url), { type: "module" });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error("worker did not start within " + INIT_TIMEOUT_MS + "ms"));
      }, INIT_TIMEOUT_MS);
      const settle = (fn: () => void) => {
        clearTimeout(timer);
        worker.removeEventListener("message", onReady);
        fn();
      };
      const onReady = (ev: MessageEvent) => {
        if (ev.data?.type !== "ready" || ev.data.id !== id) return;
        settle(() => {
          if (ev.data.error) {
            worker.terminate();
            reject(new Error(ev.data.error));
          } else {
            resolve({ worker, busy: false });
          }
        });
      };
      worker.addEventListener("message", onReady);
      worker.addEventListener(
        "error",
        (e) => settle(() => { worker.terminate(); reject(new Error(e.message || "worker failed")); }),
        { once: true },
      );
      worker.postMessage({ type: "init", id, backupHex, network });
    });

  const slots = await Promise.all(Array.from({ length: size }, spawn));
  const waiting: ((s: Slot) => void)[] = [];

  const acquire = (): Promise<Slot> => {
    const free = slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }
    return new Promise((resolve) => waiting.push(resolve));
  };

  const release = (slot: Slot) => {
    const next = waiting.shift();
    if (next) next(slot);
    else slot.busy = false;
  };

  const runOne = (slot: Slot, items: DetectItem[]) =>
    new Promise<{ hits: DetectHit[]; failures: DetectFailure[] }>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("worker did not answer within " + DETECT_TIMEOUT_MS + "ms"));
      }, DETECT_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timer);
        slot.worker.removeEventListener("message", onMessage);
        slot.worker.removeEventListener("error", onError);
      };
      const onMessage = (ev: MessageEvent) => {
        if (ev.data?.type !== "detected" || ev.data.id !== id) return;
        cleanup();
        resolve({ hits: ev.data.hits, failures: ev.data.failures });
      };
      const onError = (e: ErrorEvent) => {
        cleanup();
        reject(new Error(e.message || "worker failed"));
      };
      slot.worker.addEventListener("message", onMessage);
      slot.worker.addEventListener("error", onError);
      slot.worker.postMessage({ type: "detect", id, items });
    });

  return {
    size,
    async detect(items) {
      const chunks: DetectItem[][] = [];
      for (let i = 0; i < items.length; i += CHUNK) chunks.push(items.slice(i, i + CHUNK));
      const results = await Promise.all(
        chunks.map(async (chunk) => {
          const slot = await acquire();
          try {
            return await runOne(slot, chunk);
          } finally {
            release(slot);
          }
        }),
      );
      return {
        hits: results.flatMap((r) => r.hits),
        failures: results.flatMap((r) => r.failures),
      };
    },
    dispose() {
      for (const s of slots) s.worker.terminate();
      slots.length = 0;
    },
  };
}
