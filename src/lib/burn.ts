import type { WasmSignedBurn } from "@chironbuilder/tari-l1-wasm";
import { assembleBurnClaimProof, type BurnClaimProofContents, type L1BurnProofParts } from "@chironbuilder/ootle-sdk";
import type { NetworkId } from "./tari";

/**
 * Burning is only offered where the burned coins can actually be claimed. Ootle runs on the
 * Esmeralda testnet alone, and a burn can only be claimed on the Ootle network that observes the
 * L1 it was burned on — a MainNet burn would destroy real XTM with nothing to claim it on.
 */
export function burnSupported(network: NetworkId | null): boolean {
  return network === "esmeralda";
}

/**
 * Where a burn is in its life:
 * - `broadcast`: accepted by a node, not yet in a block.
 * - `mined`: in a block; the kernel merkle proof is stored and the claim is waiting on L1
 *   confirmations (validators only accept a well-confirmed burn).
 * - `claiming`: a claim transaction is in flight on Ootle.
 * - `claimed`: minted on Ootle.
 * - `external`: burned to another Ootle account; the proof is exported, not claimed here.
 * - `failed`: the broadcast was rejected.
 */
export type BurnStatus = "broadcast" | "mined" | "claiming" | "claimed" | "external" | "failed";

/** `L1BurnProofParts` with its bigints as strings, so it survives JSON persistence. */
export interface StoredBurnParts {
  claimPublicKeyHex: string;
  commitmentHex: string;
  ownershipNonceHex: string;
  ownershipSignatureHex: string;
  senderOffsetPublicKeyHex: string;
  encryptedDataHex: string;
  amountMicro: string;
  kernel: {
    version: number;
    feeMicro: string;
    lockHeight: string;
    excessHex: string;
    nonceHex: string;
    signatureHex: string;
  };
}

export interface BurnRecord {
  id: string;
  createdAt: number;
  amountMicro: string;
  feeMicro: string;
  status: BurnStatus;
  /** True when the claim key is this wallet's own Ootle account. */
  toOwnAccount: boolean;
  parts: StoredBurnParts;
  /** The activity entry for the L1 transaction. */
  historyId: string;
  merkle?: { block_hash: string; encoded_merkle_proof: string; leaf_index: number };
  minedHeight?: number;
  claimTxId?: string;
  claimedMicro?: string;
  /** The last reason a claim did not go through; cleared on the next attempt. */
  lastError?: string;
  lastAttemptAt?: number;
}

export function partsFromSignedBurn(burn: WasmSignedBurn): StoredBurnParts {
  return {
    claimPublicKeyHex: burn.claimPublicKeyHex,
    commitmentHex: burn.commitmentHex,
    ownershipNonceHex: burn.ownershipNonceHex,
    ownershipSignatureHex: burn.ownershipSignatureHex,
    senderOffsetPublicKeyHex: burn.senderOffsetPublicKeyHex,
    encryptedDataHex: burn.encryptedDataHex,
    amountMicro: burn.amountMicro.toString(),
    kernel: {
      version: burn.kernelVersion,
      feeMicro: burn.kernelFeeMicro.toString(),
      lockHeight: burn.kernelLockHeight.toString(),
      excessHex: burn.kernelExcessHex,
      nonceHex: burn.kernelNonceHex,
      signatureHex: burn.kernelSignatureHex,
    },
  };
}

function toSdkParts(p: StoredBurnParts): L1BurnProofParts {
  return {
    claimPublicKeyHex: p.claimPublicKeyHex,
    commitmentHex: p.commitmentHex,
    ownershipNonceHex: p.ownershipNonceHex,
    ownershipSignatureHex: p.ownershipSignatureHex,
    senderOffsetPublicKeyHex: p.senderOffsetPublicKeyHex,
    encryptedDataHex: p.encryptedDataHex,
    amount: BigInt(p.amountMicro),
    kernel: {
      version: p.kernel.version,
      fee: BigInt(p.kernel.feeMicro),
      lockHeight: BigInt(p.kernel.lockHeight),
      excessHex: p.kernel.excessHex,
      nonceHex: p.kernel.nonceHex,
      signatureHex: p.kernel.signatureHex,
    },
  };
}

/** The claimable proof, once the burn has a merkle proof. */
export function claimProofFor(rec: BurnRecord): BurnClaimProofContents | null {
  if (!rec.merkle) return null;
  return assembleBurnClaimProof(toSdkParts(rec.parts), rec.merkle);
}

/**
 * The proof as a JSON file an Ootle wallet daemon accepts under Claim Burn → Paste proof
 * (`ClaimBurnProofContents`).
 */
export function claimProofFileText(rec: BurnRecord): string | null {
  const proof = claimProofFor(rec);
  return proof ? JSON.stringify(proof, null, 2) : null;
}

/**
 * Validators reject a claim for a burn that is not yet well confirmed, or one their L1 view has
 * not reached. Those are worth retrying; anything else (a bad proof, an already-claimed burn)
 * is not.
 */
export function isRetryableClaimError(message: string): boolean {
  return /not yet|claimable|confirm|epoch|not found|unknown block|timed out|timeout|unreachable|could not reach|fetch|network/i.test(
    message,
  );
}

/**
 * Validators check a claim against the L1 headers they have seen, so a claim made before they reach
 * the burn's block is rejected with "block header not found". That is the normal wait, not a fault.
 */
export function isAwaitingL1Observation(message: string | undefined): boolean {
  return !!message && /block header not found|not yet|epoch/i.test(message);
}

/** Minimum wait between automatic claim attempts. */
export const CLAIM_RETRY_MS = 3 * 60_000;
