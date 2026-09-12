/// <reference lib="webworker" />
// Type-only: erased at build time, so it costs no top-level await. The module itself is pulled in
// dynamically below, which is what lets the message handler exist before the wasm has loaded.
import type { WasmWallet } from "@chironbuilder/tari-l1-wasm";
import type { ScanOutput } from "./scanner";

/**
 * Ownership testing, off the main thread.
 *
 * Deciding whether an output belongs to a wallet costs a Diffie-Hellman and a decrypt attempt, and
 * it has to be paid for *every* output on the chain — the wallet's own are a rounding error in the
 * total. Run inline that work saturates the main thread and the page stops painting mid-scan.
 * Here it is one worker per core instead, each with its own wasm instance and its own copy of the
 * wallet built from the same backup, so the work actually spreads across the machine.
 *
 * The worker only ever answers "is this one ours"; nothing is imported for keeps here. The main
 * thread re-fetches and re-imports the winners itself, which keeps a single authoritative wallet
 * instance owning every output that gets stored.
 */

export interface DetectItem {
  height: number;
  output: ScanOutput;
}

export interface DetectHit {
  height: number;
  commitment: string;
}

export interface DetectFailure {
  height: number;
  reason: string;
}

type InMessage =
  | { type: "init"; id: number; backupHex: string; network: string }
  | { type: "detect"; id: number; items: DetectItem[] };

type OutMessage =
  | { type: "ready"; id: number; error?: string }
  | { type: "detected"; id: number; hits: DetectHit[]; failures: DetectFailure[] };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let wallet: WasmWallet | null = null;
let WalletCtor: typeof WasmWallet | null = null;

function post(msg: OutMessage) {
  ctx.postMessage(msg);
}

/**
 * Messages that arrive before the wasm module has loaded.
 *
 * A worker's event loop starts before its module finishes evaluating, and a message dispatched
 * into that gap is *dropped*, not queued — there is no handler registered yet to receive it. A
 * static `import` of the wasm makes that gap the whole load, so the pool's very first `init` was
 * being thrown away and both sides waited on each other forever. Registering this handler in the
 * module's first synchronous run, before any await, closes the gap; anything that lands early
 * waits here until the module is ready.
 */
const queued: InMessage[] = [];
let ready = false;

ctx.onmessage = (ev: MessageEvent<InMessage>) => {
  if (!ready) {
    queued.push(ev.data);
    return;
  }
  handle(ev.data);
};

void (async () => {
  try {
    ({ WasmWallet: WalletCtor } = await import("@chironbuilder/tari-l1-wasm"));
  } catch (e) {
    // Report against whatever init is waiting, so the pool fails fast instead of timing out.
    const first = queued.find((m) => m.type === "init");
    post({
      type: "ready",
      id: first?.id ?? 0,
      error: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  ready = true;
  for (const m of queued.splice(0)) handle(m);
})();

function handle(msg: InMessage) {
  if (msg.type === "init") {
    try {
      if (!WalletCtor) throw new Error("wasm module unavailable");
      wallet = WalletCtor.fromBackupHex(msg.backupHex, msg.network);
      post({ type: "ready", id: msg.id });
    } catch (e) {
      post({ type: "ready", id: msg.id, error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (msg.type === "detect") {
    const hits: DetectHit[] = [];
    const failures: DetectFailure[] = [];
    if (!wallet) {
      post({ type: "detected", id: msg.id, hits, failures: [{ height: 0, reason: "worker has no wallet" }] });
      return;
    }
    for (const { height, output: o } of msg.items) {
      try {
        const owned = wallet.importScannedOutput(
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
          // Deliberately empty: the scan projection carries neither, and neither is needed to
          // answer the only question asked here.
          "",
          "",
        );
        owned.free();
        hits.push({ height, commitment: o.commitment_hex.toLowerCase() });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        // Not ours is the overwhelmingly common answer, and it is not a failure.
        if (!/does not belong to this wallet/.test(reason)) failures.push({ height, reason });
      }
    }
    post({ type: "detected", id: msg.id, hits, failures });
  }
}
