import type { WasmWallet, WasmWalletOutput } from "@chironbuilder/tari-l1-wasm";
import type { DetectPool } from "./detect-pool";
import type { DetectFailure, DetectHit, DetectItem } from "./scan-worker";
import {
  bridgeAllowed,
  getRpcBase,
  rpcBlockBatch,
  rpcFullOutputs,
  rpcHeightAtTime,
  rpcTip,
} from "./rpc";

/**
 * Every read below prefers the base node's own wallet HTTP query service and falls back to the
 * gRPC bridge. The query service is the better source — a leaner projection, server-side paging,
 * no middleware to deploy — but it is a single public host, so losing it must not take the wallet
 * offline while the bridge is still there to answer.
 *
 * Only the caller giving up stops the fallback. Everything else falls through, a timeout very much
 * included — a query service that has stopped answering is the case the bridge is there for, and
 * its own deadline aborting looks like an abort too, so testing the error rather than the caller's
 * signal would skip the fallback exactly when it is needed.
 */
async function withBridgeFallback<T>(
  viaRpc: () => Promise<T>,
  viaBridge: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!getRpcBase()) return viaBridge();
  try {
    return await viaRpc();
  } catch (e) {
    if (signal?.aborted || !bridgeAllowed()) throw e;
    return viaBridge();
  }
}

export interface ScanOutput {
  commitment_hex: string;
  hash_hex: string;
  encrypted_data_hex: string;
  sender_offset_pub_hex: string;
  script_hex: string;
  metadata_sig_hex: string;
  minimum_value_promise: string;
  maturity: string;
  output_type_byte: number;
  range_proof_type_byte: number;
  coinbase_extra_hex: string;
  covenant_hex?: string;
  range_proof_hex?: string;
}

export interface ScanBlock {
  height: number;
  timestamp?: number;
  outputs: ScanOutput[];
  /** Commitments this block spends. */
  inputs?: string[];
  /**
   * Chain hashes of the outputs this block spends.
   *
   * The query service identifies a spend by the hash of the output consumed, not by its
   * commitment (`query_service.rs`, `fetch_inputs_in_block(..).map(|i| i.output_hash())`), and a
   * hash cannot be turned into a commitment without the output itself. Everything downstream is
   * keyed by commitment, so these are resolved against outputs the wallet knows are its own —
   * which is the only case that has any effect — and carried unresolved otherwise.
   */
  inputHashes?: string[];
  error?: string;
}

export interface ScanProgress {
  current: number;
  to: number;
  blocksScanned: number;
  outputsSeen: number;
  found: number;
  skipped: number;
  skippedHeights: number[];
  importFailures: number;
  failureSamples: string[];
  safeCompleted: number;
  /** Owned outputs that were dropped again because a later block spends them. */
  spentAgain: number;
  done: boolean;
  error?: string;
}

export async function fetchMiddlewareTip(baseUrl: string): Promise<{
  height: number;
  prunedHeight: number;
  timestamp: number;
} | null> {
  try {
    return await withBridgeFallback(
      () => rpcTip(),
      () => bridgeTip(baseUrl),
    );
  } catch {
    return null;
  }
}

async function bridgeTip(baseUrl: string): Promise<{
  height: number;
  prunedHeight: number;
  timestamp: number;
}> {
  const r = await fetch(baseUrl.replace(/\/+$/, "") + "/tip");
  if (!r.ok) throw new Error(`middleware tip ${r.status}`);
  const j = await r.json();
  return {
    height: Number(j.height),
    prunedHeight: Number(j.prunedHeight ?? 0),
    timestamp: Number(j.timestamp),
  };
}

/** How long a single block batch may take before it is treated as lost. */
const BATCH_TIMEOUT_MS = 45_000;
/** Safety stop, so a server that keeps handing back a cursor cannot spin here forever. */
const MAX_PAGES = 200;
/** Commitments per hydration request; the endpoint caps this at 256. */
const HYDRATE_CHUNK = 128;

/**
 * A request that hangs forever is worse here than one that fails: the scan loop only resolves once
 * every batch in flight has settled, so a single stalled connection leaves the whole scan running
 * in name only — and the caller's "a scan is already in progress" guard then blocks every later
 * catch-up for as long as the tab stays open. A deadline turns that into an ordinary error the
 * retry path can handle.
 */
function withDeadline(signal: AbortSignal | undefined): AbortSignal {
  const deadline = AbortSignal.timeout(BATCH_TIMEOUT_MS);
  if (!signal) return deadline;
  // AbortSignal.any is recent enough to be worth a fallback; losing the deadline is better than
  // throwing on a browser that lacks it.
  return typeof AbortSignal.any === "function" ? AbortSignal.any([signal, deadline]) : signal;
}

export async function fetchBlockBatch(
  baseUrl: string,
  from: number,
  to: number,
  signal?: AbortSignal,
): Promise<ScanBlock[]> {
  return withBridgeFallback(
    () => rpcBlockBatch(from, to, withDeadline(signal)),
    () => bridgeBlockBatch(baseUrl, from, to, signal),
    signal,
  );
}

async function bridgeBlockBatch(
  baseUrl: string,
  from: number,
  to: number,
  signal?: AbortSignal,
): Promise<ScanBlock[]> {
  const base = baseUrl.replace(/\/+$/, "");
  // The server fills a response up to its own output budget and says where to resume, so a range
  // is however many round trips it takes rather than a single response that has to fit. A block
  // too big for one response comes back split across several, and the pages are stitched here so
  // the caller still sees one entry per height.
  const merged = new Map<number, ScanBlock>();
  let height = from;
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const q = `from=${height}&to=${to}&fields=scan${offset > 0 ? `&offset=${offset}` : ""}`;
    const r = await fetch(`${base}/blocks?${q}`, { signal: withDeadline(signal) });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Middleware ${r.status}: ${body.slice(0, 140)}`);
    }
    const j = await r.json();
    for (const b of (j.blocks ?? []) as ScanBlock[]) {
      const seen = merged.get(b.height);
      if (!seen) {
        merged.set(b.height, b);
      } else {
        seen.outputs.push(...b.outputs);
        if (b.inputs?.length) seen.inputs = [...(seen.inputs ?? []), ...b.inputs];
        if (b.error) seen.error = b.error;
      }
    }
    const cursor = j.cursor as { height: number; offset: number } | null | undefined;
    if (!cursor) break;
    height = cursor.height;
    offset = cursor.offset;
  }

  return [...merged.values()].sort((a, b) => a.height - b.height);
}

/**
 * Full records for outputs the wallet has recognised as its own.
 *
 * The scan pass omits range proofs and chain hashes to keep responses small, so an owned output
 * has to be re-fetched in full before it is handed to the caller — otherwise what gets stored is
 * a record that cannot be replayed later.
 */
export async function fetchFullOutputs(
  baseUrl: string,
  height: number,
  commitments: string[],
  signal?: AbortSignal,
  /**
   * Chain hashes from the scan pass, keyed by commitment. The query service's per-block record
   * does not carry one, and an output stored without it cannot be replayed later, so the value
   * seen during detection is threaded through rather than looked up again.
   */
  hashes?: Map<string, string>,
): Promise<Map<string, ScanOutput>> {
  return withBridgeFallback(
    () => rpcFullOutputs(height, commitments, hashes, withDeadline(signal)),
    () => bridgeFullOutputs(baseUrl, height, commitments, signal),
    signal,
  );
}

async function bridgeFullOutputs(
  baseUrl: string,
  height: number,
  commitments: string[],
  signal?: AbortSignal,
): Promise<Map<string, ScanOutput>> {
  const base = baseUrl.replace(/\/+$/, "");
  const out = new Map<string, ScanOutput>();
  for (let i = 0; i < commitments.length; i += HYDRATE_CHUNK) {
    const slice = commitments.slice(i, i + HYDRATE_CHUNK);
    const r = await fetch(
      `${base}/outputs?height=${height}&commitments=${slice.join(",")}`,
      { signal: withDeadline(signal) },
    );
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Middleware ${r.status}: ${body.slice(0, 140)}`);
    }
    const j = await r.json();
    for (const o of (j.outputs ?? []) as ScanOutput[]) {
      out.set(o.commitment_hex.toLowerCase(), o);
    }
  }
  return out;
}

export function tryImportOutput(
  wallet: WasmWallet,
  o: ScanOutput,
): { handle: WasmWalletOutput | null; reason?: string } {
  try {
    return {
      handle: wallet.importScannedOutput(
        o.commitment_hex,
        o.encrypted_data_hex,
        o.sender_offset_pub_hex,
        o.script_hex,
        o.metadata_sig_hex,
        BigInt(o.minimum_value_promise || "0"),
        BigInt(o.maturity || "0"),
        o.output_type_byte,
        o.range_proof_type_byte,
        o.coinbase_extra_hex,
        o.covenant_hex ?? "",
        o.range_proof_hex ?? "",
        o.hash_hex ?? "",
      ),
    };
  } catch (e) {
    return { handle: null, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Ownership testing on the main thread, for when no worker pool could be started.
 *
 * Correct but slow: this is the work the pool exists to spread across cores, and running it here
 * is what makes a scan freeze the page. Kept only so a browser that refuses module workers still
 * finds the wallet's money.
 */
function detectInline(
  wallet: WasmWallet,
  items: DetectItem[],
): { hits: DetectHit[]; failures: DetectFailure[] } {
  const hits: DetectHit[] = [];
  const failures: DetectFailure[] = [];
  for (const { height, output: o } of items) {
    const { handle, reason } = tryImportOutput(wallet, o);
    if (handle) {
      handle.free();
      hits.push({ height, commitment: o.commitment_hex.toLowerCase() });
    } else if (reason && !/does not belong to this wallet/.test(reason)) {
      failures.push({ height, reason });
    }
  }
  return { hits, failures };
}

interface BatchState {
  from: number;
  to: number;
  settled: boolean;
  clean: boolean;
}

export async function scanRange(
  baseUrl: string,
  wallet: WasmWallet,
  from: number,
  to: number,
  onOutput: (
    handle: WasmWalletOutput,
    blockHeight: number,
    output: ScanOutput,
    /** Commitments spent by the block this output was mined in. */
    blockInputs: string[],
  ) => void,
  onSpent: (commitments: string[], blockHeight: number | null) => void,
  /**
   * An output that is ours but was already spent. Not spendable, and never income — but knowing we
   * once owned it is what lets the caller tell our own change apart from money arriving.
   */
  onOwnedSpent: (commitment: string) => void,
  onProgress: (p: ScanProgress) => void,
  shouldStop: () => boolean,
  concurrency = 10,
  /**
   * Ownership testing off the main thread, read fresh for every batch.
   *
   * A holder rather than the pool itself: starting workers means compiling a wasm module in each
   * of them, and the scan must not be held up waiting for that — or, worse, be lost entirely if a
   * worker never comes up. Scanning begins immediately on the main thread and picks the pool up
   * mid-flight once it is ready.
   */
  poolRef?: { current: DetectPool | null } | null,
  /**
   * Commitment for a chain output hash, when the wallet already holds that output.
   *
   * Only the wallet's own spends have any effect downstream, and it is the only party that can
   * answer this offline: every handle it holds carries the `chainOutputHash` it was imported with.
   */
  resolveOwnedHash?: (outputHash: string) => string | undefined,
): Promise<ScanProgress> {
  const BATCH = 100;
  const progress: ScanProgress = {
    current: from,
    to,
    blocksScanned: 0,
    outputsSeen: 0,
    found: 0,
    skipped: 0,
    skippedHeights: [],
    importFailures: 0,
    failureSamples: [],
    safeCompleted: from - 1,
    spentAgain: 0,
    done: false,
  };

  // An output we own can be spent in a later block — by an earlier send from this wallet, or by
  // another wallet on the same seed. Importing it anyway makes it look spendable, and the node
  // answers ALREADY_MINED when we try to spend it a second time. Blocks arrive out of order across
  // concurrent batches, so spends are collected for the whole scan and applied as they are seen.
  const spent = new Set<string>();
  const ownedByCommitment = new Set<string>();
  /**
   * Spends seen as a bare output hash that no commitment could be found for yet.
   *
   * Batches complete out of order, so a block spending an output can be processed before the block
   * that mined it. Keeping the raw hashes lets an output recognised later still be matched against
   * a spend already seen — which is what stops it being imported as spendable and answered
   * ALREADY_MINED on the next send.
   */
  const spentHashes = new Set<string>();
  /** Chain hash to commitment, for outputs this scan has recognised as ours. */
  const ownedHashToCommitment = new Map<string, string>();

  let cursor = from;
  let active = 0;
  let failed = false;
  let completedUpTo = from - 1;
  const batches: BatchState[] = [];

  const recomputeSafeCompleted = () => {
    let safe = from - 1;
    for (const b of batches) {
      if (!b.settled || !b.clean) break;
      safe = b.to;
    }
    progress.safeCompleted = Math.max(progress.safeCompleted, safe);
  };
  const noteFailure = (height: number, reason: string) => {
    progress.importFailures++;
    if (progress.failureSamples.length < 5) {
      progress.failureSamples.push(`${height}: ${reason}`);
    }
  };

  await new Promise<void>((resolve) => {
    const pump = () => {
      if (shouldStop() || failed) {
        if (active === 0) resolve();
        return;
      }
      while (cursor <= to && active < concurrency) {
        const batchFrom = cursor;
        const batchTo = Math.min(cursor + BATCH - 1, to);
        cursor = batchTo + 1;
        active++;
        const state: BatchState = { from: batchFrom, to: batchTo, settled: false, clean: true };
        batches.push(state);
        fetchBlockBatch(baseUrl, batchFrom, batchTo)
          .then(async (blocks) => {
            /** Owned outputs awaiting a full re-fetch, grouped by the block they were mined in. */
            const hydrations: { height: number; hits: string[]; inputs: string[] }[] = [];
            /** Chain hashes seen during detection, to survive the re-fetch. */
            const hashByCommitment = new Map<string, string>();
            for (const b of blocks) {
              for (const o of b.outputs) {
                if (o.hash_hex) hashByCommitment.set(o.commitment_hex.toLowerCase(), o.hash_hex);
              }
            }
            // Reported per block, and for every spend seen rather than only ours: the caller uses
            // these both to drop outputs it can no longer spend and to learn the exact block one of
            // its own transactions was mined in.
            /** Spends per block, as commitments, however the source happened to identify them. */
            const spentByHeight = new Map<number, string[]>();
            for (const b of blocks) {
              const spentHere: string[] = [];
              const noteSpent = (commitment: string) => {
                const key = commitment.toLowerCase();
                spent.add(key);
                spentHere.push(key);
                if (ownedByCommitment.delete(key)) {
                  progress.found--;
                  progress.spentAgain++;
                }
              };
              for (const commitment of b.inputs ?? []) noteSpent(commitment);
              for (const hash of b.inputHashes ?? []) {
                const key = hash.toLowerCase();
                spentHashes.add(key);
                const commitment = ownedHashToCommitment.get(key) ?? resolveOwnedHash?.(key);
                if (commitment) noteSpent(commitment);
              }
              spentByHeight.set(b.height, spentHere);
              if (spentHere.length > 0) onSpent(spentHere, b.height);
            }
            // Detection runs against the scan projection, which carries no range proof. That is
            // enough to tell ours from everyone else's, but not enough to keep — so the winners
            // are collected here and re-fetched in full below.
            const items: DetectItem[] = [];
            const inputsByHeight = new Map<number, string[]>();
            for (const b of blocks) {
              progress.blocksScanned++;
              if (b.error) {
                progress.skipped++;
                progress.skippedHeights.push(b.height);
                noteFailure(b.height, `block unavailable: ${b.error}`);
                state.clean = false;
                continue;
              }
              // What the caller needs here is the spends it can recognise as its own, which is
              // what the resolved set holds when the source identified them by hash.
              inputsByHeight.set(b.height, spentByHeight.get(b.height) ?? b.inputs ?? []);
              for (const o of b.outputs) {
                progress.outputsSeen++;
                items.push({ height: b.height, output: o });
              }
            }

            // The whole batch goes to the pool at once so every worker stays fed regardless of how
            // unevenly outputs are spread across these blocks.
            const workers = poolRef?.current ?? null;
            let hits: DetectHit[];
            let failures: DetectFailure[];
            if (workers) {
              try {
                ({ hits, failures } = await workers.detect(items));
              } catch {
                // A pool that stops answering must not take the scan with it.
                ({ hits, failures } = detectInline(wallet, items));
              }
            } else {
              ({ hits, failures } = detectInline(wallet, items));
            }
            for (const f of failures) {
              noteFailure(f.height, f.reason);
              state.clean = false;
            }

            const byHeight = new Map<number, string[]>();
            for (const { height, commitment } of hits) {
              // Now that this output is known to be ours, its hash is worth remembering: a spend
              // of it in another batch is identified by that hash and nothing else.
              const ownHash = hashByCommitment.get(commitment);
              if (ownHash) ownedHashToCommitment.set(ownHash, commitment);
              if (spent.has(commitment) || (ownHash && spentHashes.has(ownHash))) {
                // Ours once, but the chain has since spent it. Telling the caller anyway is what
                // keeps a rescan able to recognise the change our own transactions produced; it
                // must never become spendable, or the node answers ALREADY_MINED. Nothing is
                // stored for it, so no full record is needed.
                onOwnedSpent(commitment);
                continue;
              }
              const list = byHeight.get(height);
              if (list) list.push(commitment);
              else byHeight.set(height, [commitment]);
            }
            for (const [height, cs] of byHeight) {
              hydrations.push({ height, hits: cs, inputs: inputsByHeight.get(height) ?? [] });
            }

            for (const { height, hits, inputs } of hydrations) {
              let full: Map<string, ScanOutput>;
              try {
                full = await fetchFullOutputs(baseUrl, height, hits, undefined, hashByCommitment);
              } catch (e) {
                // The output is ours and we could not retrieve it. Leaving the batch dirty holds
                // the safe watermark back so the next pass retries, rather than banking a height
                // whose payment was never recorded.
                noteFailure(height, `hydrate failed: ${e instanceof Error ? e.message : String(e)}`);
                state.clean = false;
                continue;
              }
              for (const commitment of hits) {
                const o = full.get(commitment);
                if (!o) {
                  noteFailure(height, `output ${commitment.slice(0, 12)} vanished on re-fetch`);
                  state.clean = false;
                  continue;
                }
                const { handle, reason } = tryImportOutput(wallet, o);
                if (!handle) {
                  noteFailure(height, reason ?? "re-import failed");
                  state.clean = false;
                  continue;
                }
                progress.found++;
                ownedByCommitment.add(commitment);
                onOutput(handle, height, o, inputs);
              }
            }
            completedUpTo = Math.max(completedUpTo, batchTo);
            progress.current = Math.min(completedUpTo + 1, to);
          })
          .catch((e) => {
            failed = true;
            state.clean = false;
            progress.error = e instanceof Error ? e.message : String(e);
          })
          .finally(() => {
            state.settled = true;
            recomputeSafeCompleted();
            active--;
            onProgress({ ...progress });
            pump();
          });
      }
      if (active === 0 && (cursor > to || shouldStop() || failed)) resolve();
    };
    pump();
  });

  recomputeSafeCompleted();
  progress.done = true;
  onProgress({ ...progress });
  return progress;
}

export async function findHeightForTimestamp(
  baseUrl: string,
  targetMs: number,
  tipHeight: number,
): Promise<number | null> {
  // The query service answers this outright; the search below is the bridge's only way to get it.
  if (getRpcBase()) {
    try {
      const h = await rpcHeightAtTime(Math.floor(targetMs / 1000));
      if (Number.isFinite(h) && h > 0) return Math.min(h, tipHeight);
    } catch {
      /* fall through to the search */
    }
    if (!bridgeAllowed()) return null;
  }
  try {
    let lo = 1;
    let hi = tipHeight;
    let ans: number | null = null;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const blocks = await fetchBlockBatch(baseUrl, mid, mid);
      const ts = blocks[0]?.timestamp;
      if (!ts) return null;
      if (ts * 1000 >= targetMs) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return ans ?? 1;
  } catch {
    return null;
  }
}
