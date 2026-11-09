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
export type { FeeType, PrivateBalance, TokenBalance } from "@chironbuilder/ootle-sdk";
export { indexerUrlFor, toOotleNetwork } from "@chironbuilder/ootle-sdk";
export type { NetworkName } from "@chironbuilder/ootle-sdk";
export { wipeOotleState } from "@chironbuilder/ootle-sdk";
export type { ShieldedOutputRecord } from "@chironbuilder/ootle-sdk";

import type { NetworkName } from "@chironbuilder/ootle-sdk";
import type { NetworkId } from "../lib/tari";

/**
 * The Ootle (L2) network that goes with an L1 network: MainNet with MainNet, and every testnet L1
 * with Esmeralda -- the only Ootle testnet with a public indexer, and the one that observes the
 * Esmeralda L1, so burns made there can be claimed. Switching the L1 network (which reloads the
 * app) therefore switches the L2 one too; both come from the same seed, so the account on each is
 * genuinely yours, and only the mainnet one holds real TARI.
 */
export function ootleNetworkFor(l1: NetworkId | null | undefined): NetworkName {
  return l1 === "mainnet" ? "mainnet" : "esmeralda";
}

/** The L2 token's ticker on `network`: real TARI on mainnet, test tTARI elsewhere. */
export function l2Symbol(network: NetworkName): string {
  return network === "mainnet" ? "TARI" : "tTARI";
}

/** The Ootle native token (TARI, formerly XTR) -- engine-special-cased on-chain, so its resource
 * address is a fixed, well-known constant. Match on this, never on the on-chain symbol, which
 * changed with the XTR -> TARI rename. */
export const TARI_RESOURCE_ADDRESS = "resource_0101010101010101010101010101010101010101010101010101010101010101";

/** Shown wherever an L2 balance or address appears, so test funds are never mistaken for real ones. */
export function ootleNetworkLabel(network: NetworkName): string {
  return network === "mainnet" ? "MainNet" : network === "esmeralda" ? "Esmeralda testnet" : "Igor testnet";
}

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
