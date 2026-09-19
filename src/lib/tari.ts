import {
  WasmTariAddress,
  calculateFee,
} from "@chironbuilder/tari-l1-wasm";
import { getRpcBase, rpcSubmit } from "./rpc";

export const NETWORKS = [
  { id: "esmeralda", label: "Esmeralda", testnet: true },
  { id: "igor", label: "Igor", testnet: true },
  { id: "nextnet", label: "NextNet", testnet: true },
  { id: "stagenet", label: "StageNet", testnet: true },
  { id: "localnet", label: "LocalNet", testnet: true },
  { id: "mainnet", label: "MainNet", testnet: false },
] as const;

export type NetworkId = (typeof NETWORKS)[number]["id"];

export const FEATURES_AND_SCRIPTS_BYTES = 300;

export function parseAddress(input: string): WasmTariAddress | null {
  const s = input.trim();
  if (!s) return null;
  // Emoji ID first: it's the only one of the three whose alphabet can't collide with the other
  // two (base58/hex are both plain ASCII), so trying it first costs nothing and skips two
  // guaranteed-failing attempts for the common case of a copy-pasted emoji address.
  const attempts = [
    () => WasmTariAddress.fromEmoji(s),
    () => WasmTariAddress.fromBase58(s),
    () => WasmTariAddress.fromHex(s),
  ];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      /* try next encoding */
    }
  }
  return null;
}

export interface Selection {
  indices: number[];
  feeMicro: bigint;
}

function feeFor(
  feePerGram: bigint,
  numInputs: number,
  numOutputs: number,
): bigint {
  return calculateFee(
    feePerGram,
    1,
    numInputs,
    numOutputs,
    FEATURES_AND_SCRIPTS_BYTES,
  );
}

const OUTPUTS_WITH_CHANGE = 2;

export interface InputLike {
  valueMicro: bigint;
}

export function estimateMaxSpend(
  utxos: InputLike[],
  feePerGram: bigint,
): bigint {
  if (utxos.length === 0) return 0n;
  let total = 0n;
  for (const u of utxos) total += u.valueMicro;
  const fee = feeFor(feePerGram, utxos.length, OUTPUTS_WITH_CHANGE);
  return total > fee ? total - fee : 0n;
}

export function selectInputs(
  utxos: InputLike[],
  targetMicro: bigint,
  feePerGram: bigint,
): Selection | null {
  const sorted = utxos
    .map((u, i) => ({ i, v: u.valueMicro }))
    .sort((a, b) => (a.v > b.v ? -1 : a.v < b.v ? 1 : 0));
  let acc = 0n;
  const indices: number[] = [];
  for (const { i, v } of sorted) {
    indices.push(i);
    acc += v;
    const fee = feeFor(feePerGram, indices.length, OUTPUTS_WITH_CHANGE);
    if (acc >= targetMicro + fee) {
      return { indices, feeMicro: fee };
    }
  }
  return null;
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/**
 * Where a bridge broadcast goes, when one is needed. A custom URL, when set, is another deployment
 * of that same middleware.
 *
 * This used to be the only answer, because a base node was gRPC-only and had no HTTP endpoint a
 * browser could reach. It now serves `json_rpc` alongside gRPC, so the bridge is the fallback
 * rather than the route.
 */
export function broadcastBaseUrl(nodeUrl: string, scannerUrl: string): string {
  return nodeUrl.trim() || scannerUrl;
}

export interface SubmitOutcome {
  accepted: boolean;
  result: string;
  detail: string;
}

/**
 * Broadcast, preferring the base node's own JSON-RPC and falling back to the gRPC bridge.
 *
 * A rejection is not a fallback case: a node that deserialised the transaction and answered
 * `NOT_PROCESSABLE_AT_THIS_TIME` or `ALREADY_MINED` has given a real answer, and re-submitting it
 * elsewhere would only get the same one. Only a transport or serialisation failure falls through.
 */
export async function submitViaMiddleware(
  scannerUrl: string,
  transactionJson: string,
): Promise<SubmitOutcome> {
  if (getRpcBase()) {
    try {
      return await rpcSubmit(transactionJson);
    } catch {
      /* unreachable or malformed response — try the bridge */
    }
  }
  return submitViaBridge(scannerUrl, transactionJson);
}

async function submitViaBridge(
  scannerUrl: string,
  transactionJson: string,
): Promise<SubmitOutcome> {
  const res = await fetch(scannerUrl.replace(/\/+$/, "") + "/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transaction_json: transactionJson }),
  });
  const body = await res.text();
  let parsed: { result?: string } | null = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* non-json error body */
  }
  return {
    accepted: res.ok && parsed?.result === "ACCEPTED",
    result: parsed?.result ?? (res.ok ? "NONE" : `HTTP ${res.status}`),
    detail: body.slice(0, 500),
  };
}
