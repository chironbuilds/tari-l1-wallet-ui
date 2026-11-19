/**
 * GGBP-1 v3 balance proofs (experimental): the wallet-side policy around the wasm prover.
 *
 * The cryptography and every secret stay in `tari_l1_wasm` (`WasmWallet.ggbp1Request` →
 * `addCandidate` → `prepare` → `approve`). This module only holds what the design puts on the
 * JavaScript side: which networks are live, the encodings a dApp exchanges, per-site rate limits,
 * and the cross-tab lease that keeps an output from being disclosed while it is being spent.
 *
 * See docs/GGBP1_GHOST_GATE_HANDOFF.md and docs/ggbp1/WALLET_INTEGRATION.md.
 */
import type { NetworkId } from "./tari";
import { formatMicro } from "./format";
import { t } from "../i18n";

/** Networks a proof may be made on. Esmeralda only, as the design's first live target. */
const LIVE_NETWORKS: readonly NetworkId[] = ["esmeralda"];

/** Height-0 block hashes; the wasm checks a challenge against the same values. */
export const GGBP1_GENESIS_HASH: Partial<Record<NetworkId, string>> = {
  mainnet: "01f0cf665bd4cd31cbb2b2470236389c483522b350335e10a4a5dca34cb85990",
  esmeralda: "3c3681ad318eb54ca3f3e8aed79d3d207d94a5291aec84ba1a0b628633db3621",
};

/** An output must be this deep before it can be disclosed. */
export const GGBP1_MIN_CONFIRMATIONS = 5;
export const GGBP1_CHALLENGE_BYTES = 223;
const MAX_PER_HOUR = 10;
const MAX_LEASE_MS = 10 * 60_000;

export interface Ggbp1Capability {
  protocolVersion: 3;
  network: NetworkId;
  maxOutputs: 16;
  maxProofBytes: 8192;
}

/** What `tari_getCapabilities` reports for `ggbp1BalanceProof` on this wallet right now. */
export function ggbp1Capability(
  network: NetworkId | null,
  canSpend: boolean,
): Ggbp1Capability | false {
  if (!network || !canSpend || !LIVE_NETWORKS.includes(network)) return false;
  return { protocolVersion: 3, network, maxOutputs: 16, maxProofBytes: 8192 };
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strict: unpadded base64url only. Null for anything else. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (
    typeof text !== "string" ||
    text.length > 4096 ||
    !/^[A-Za-z0-9_-]*$/.test(text) ||
    text.length % 4 === 1
  )
    return null;
  try {
    const bin = atob(
      text.replace(/-/g, "+").replace(/_/g, "/") +
        "=".repeat((4 - (text.length % 4)) % 4),
    );
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    // Re-encoding must give back the same text, or two strings would name one challenge.
    return toBase64Url(out) === text ? out : null;
  } catch {
    return null;
  }
}

/** The preview `WasmGgbp1Request.prepare` returns. Every field is public data built by the wasm. */
export interface Ggbp1Preview {
  origin: string;
  network: string;
  genesisHash: string;
  gateId: string;
  gateConfigurationVersion: string;
  subjectId: string;
  thresholdMicro: string;
  expiresAt: number;
  challengeFingerprint: string;
  totalMicro: string;
  outputs: {
    commitment: string;
    outputHash: string;
    valueMicro: string;
    minedHeight: number;
  }[];
}

const short = (hex: string) =>
  hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-6)}` : hex;

/** Approval-dialog lines. Built from the wasm preview only, never from dApp text. */
export function previewSummary(p: Ggbp1Preview): string[] {
  const lines = [
    t("frame.ggbp1Threshold", {
      amount: formatMicro(BigInt(p.thresholdMicro)),
    }),
    t("frame.ggbp1Network", {
      network: p.network,
      genesis: short(p.genesisHash),
    }),
    t("frame.ggbp1Gate", {
      gate: short(p.gateId),
      version: p.gateConfigurationVersion,
      subject: short(p.subjectId),
    }),
    t("frame.ggbp1Expires", {
      time: new Date(p.expiresAt * 1000).toLocaleString(),
    }),
    t("frame.ggbp1Outputs", { count: p.outputs.length }),
  ];
  for (const o of p.outputs) {
    lines.push(
      t("frame.ggbp1Output", {
        commitment: short(o.commitment),
        hash: short(o.outputHash),
        height: o.minedHeight,
        amount: formatMicro(BigInt(o.valueMicro)),
      }),
    );
  }
  lines.push(
    t("frame.ggbp1Fingerprint", { fingerprint: p.challengeFingerprint }),
  );
  return lines;
}

/* ---------------- rate limit ---------------- */

const RATE_KEY = "tari-l1:ggbp1-rate";
const pendingOrigins = new Set<string>();

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the in-memory checks still hold for this tab */
  }
}

/**
 * Takes a slot for one proof request from `origin`: at most one open at a time, and
 * `MAX_PER_HOUR` per hour, so a site cannot probe the balance by trying threshold after threshold.
 * Returns a release function, or null when the site must wait.
 */
export function takeRequestSlot(origin: string): (() => void) | null {
  if (pendingOrigins.has(origin)) return null;
  const now = Date.now();
  const all = readJson<Record<string, number[]>>(RATE_KEY, {});
  const recent = (all[origin] ?? []).filter((ts) => now - ts < 3_600_000);
  if (recent.length >= MAX_PER_HOUR) return null;
  all[origin] = [...recent, now];
  writeJson(RATE_KEY, all);
  pendingOrigins.add(origin);
  return () => pendingOrigins.delete(origin);
}

/* ---------------- output leases ---------------- */

interface Lease {
  requestId: string;
  origin: string;
  expiresAt: number;
}

const leaseKey = (network: NetworkId) => `tari-l1:ggbp1-leases:${network}`;

function liveLeases(network: NetworkId): Record<string, Lease> {
  const now = Date.now();
  const all = readJson<Record<string, Lease>>(leaseKey(network), {});
  return Object.fromEntries(
    Object.entries(all).filter(([, l]) => l.expiresAt > now),
  );
}

/** Runs `fn` while holding the wallet's cross-tab output lock (Web Locks), or directly without it. */
async function withOutputLock<T>(fn: () => T): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return fn();
  return locks.request("tari-l1-outputs", async () => fn());
}

/** Outputs (by commitment) a proof request is disclosing right now, in any tab. Send and burn skip
 * these. */
export function leasedOutputIds(network: NetworkId | null): Set<string> {
  return network ? new Set(Object.keys(liveLeases(network))) : new Set();
}

/**
 * Leases `ids` for one proof request, all or nothing. Fails when another request already holds any
 * of them. Returns a release function, or null.
 */
export async function leaseOutputs(
  network: NetworkId,
  ids: string[],
  requestId: string,
  origin: string,
  challengeExpiresAtMs: number,
): Promise<(() => Promise<void>) | null> {
  const expiresAt = Math.min(challengeExpiresAtMs, Date.now() + MAX_LEASE_MS);
  const taken = await withOutputLock(() => {
    const leases = liveLeases(network);
    if (ids.some((id) => leases[id] && leases[id].requestId !== requestId))
      return false;
    for (const id of ids) leases[id] = { requestId, origin, expiresAt };
    writeJson(leaseKey(network), leases);
    return true;
  });
  if (!taken) return null;
  return () =>
    withOutputLock(() => {
      const leases = liveLeases(network);
      for (const id of ids)
        if (leases[id]?.requestId === requestId) delete leases[id];
      writeJson(leaseKey(network), leases);
    });
}
