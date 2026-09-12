// Bridges this wallet's L1 seed to an Ootle (L2) account.
//
// Both layers derive from the same CipherSeed: L1 through `@chironbuilder/tari-l1-wasm`, L2
// through `OotleAccount.fromSeed`, which takes the seed's 16-byte entropy. That is what makes
// "switch to L2" a change of layer rather than a change of wallet — the same recovery phrase
// controls both, and neither side needs the other's keys.

import { decipherSeed } from "tari-cipherseed";
import { OOTLE_NETWORK, OotleAccount, type TokenBalance } from "../ootle";
import { hexToBytes } from "./cipherseed";

/** Account index on the L2 side. The extension wallet supports several; this UI shows the first. */
const ACCOUNT_INDEX = 0;

export interface L2Identity {
  account: OotleAccount;
  /** bech32m `otl_…` address, for display and receiving. */
  address: string;
  /** On-chain account component address — what instructions target. */
  componentAddress: string;
}

/**
 * Derives the L2 account from the enciphered seed the L1 wallet already holds.
 *
 * Deriving keys is pure and local; nothing here touches the network, so this stays cheap enough
 * to call on demand rather than keeping a second wallet alive alongside the L1 one.
 */
export async function deriveL2Identity(backupHex: string): Promise<L2Identity> {
  const seed = await decipherSeed(hexToBytes(backupHex));
  const account = OotleAccount.fromSeed(seed.entropy, ACCOUNT_INDEX, OOTLE_NETWORK);
  const [address, componentAddress] = await Promise.all([
    account.getWalletAddress(),
    account.getComponentAddress(),
  ]);
  return { account, address, componentAddress };
}

export interface L2Balances {
  balances: TokenBalance[];
  /** Set when the indexer could not be reached or was too slow — distinct from "no funds yet". */
  error: string | null;
}

/**
 * Reads the account's L2 balances.
 *
 * An account that has never been funded has no vaults on chain at all, which the core reports as
 * an empty list rather than an error — the two are kept apart here so an unreachable indexer is
 * never displayed as a zero balance.
 */
export async function fetchL2Balances(account: OotleAccount): Promise<L2Balances> {
  try {
    return { balances: await account.getBalances(), error: null };
  } catch (e) {
    return { balances: [], error: e instanceof Error ? e.message : String(e) };
  }
}
