// Public surface of the Ootle (L2) module.
//
// The account core itself now comes from @chironbuilder/ootle-sdk -- the standalone package this
// app's own local copy (a "portable copy of the Sapient Chrome extension's L2 core") was extracted
// into, after reconciling it against Sapient's own independently-forked copy. This file is what's
// left of the seam the comment above used to describe: it configures the SDK's storage for this
// host (localStorage, not chrome.storage.local) and adds the handful of things that are this app's
// own, not the SDK's -- which network label to show, and how to format a resource amount for this
// UI.
import { configureOotleStorage, localStorageAdapter } from "@chironbuilder/ootle-sdk";
import { migrateOotleStorageOnce } from "./migrateStorage";

configureOotleStorage(localStorageAdapter());
void migrateOotleStorageOnce();

export { OotleAccount } from "@chironbuilder/ootle-sdk";
export type { PrivateBalance, TokenBalance } from "@chironbuilder/ootle-sdk";
export { toOotleNetwork } from "@chironbuilder/ootle-sdk";
export type { NetworkName } from "@chironbuilder/ootle-sdk";
export { wipeOotleState } from "@chironbuilder/ootle-sdk";
export type { ShieldedOutputRecord } from "@chironbuilder/ootle-sdk";

/**
 * The L2 network this wallet talks to.
 *
 * Ootle has no public MainNet indexer — `defaultIndexerUrl(Network.MainNet)` throws, and the only
 * endpoint the SDK ships is Esmeralda's (`https://ootle-indexer-a.tari.com`). The L1 side of this
 * wallet is MainNet, so the two layers are deliberately not on the same network, and every L2
 * surface says so. Both are derived from the same seed, so the account is genuinely yours; the
 * funds on it are test XTR.
 */
export const OOTLE_NETWORK = "esmeralda" as const;

/** Shown wherever an L2 balance or address appears, so test funds are never mistaken for XTM. */
export const OOTLE_NETWORK_LABEL = "Esmeralda testnet";

/** Formats a raw resource amount using the resource's own on-chain divisibility. */
export function formatResourceAmount(amount: bigint, divisibility: number): string {
  if (divisibility <= 0) return amount.toString();
  const base = 10n ** BigInt(divisibility);
  const whole = amount / base;
  const fraction = (amount < 0n ? -amount : amount) % base;
  if (fraction === 0n) return whole.toString();
  const digits = fraction.toString().padStart(divisibility, "0").replace(/0+$/, "");
  return `${whole}.${digits}`;
}
