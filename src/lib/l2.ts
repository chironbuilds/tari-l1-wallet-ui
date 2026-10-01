// Bridges this wallet's L1 seed to an Ootle (L2) account.
//
// Both layers derive from the same CipherSeed: L1 through `@chironbuilder/tari-l1-wasm`, L2
// through `OotleAccount.fromSeed`, which takes the seed's 16-byte entropy. That is what makes
// "switch to L2" a change of layer rather than a change of wallet — the same recovery phrase
// controls both, and neither side needs the other's keys.

import { decipherSeed } from "tari-cipherseed";
import { defaultIndexerUrl, getVaultIdsForAccount } from "@tari-project/ootle";
import { OOTLE_NETWORK, OotleAccount, toOotleNetwork, type TokenBalance } from "../ootle";
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

/**
 * Whether an L1 burn has been claimed on Ootle, by any wallet: the engine writes a
 * `tombstone_<commitment>` substate for every claimed burn (holding its value) and refuses a second
 * claim of the same commitment. Returns the claimed value, or null while it is unclaimed. Throws
 * when the indexer can't answer, so a network error is never read as "unclaimed".
 */
export async function burnClaimedOnOotle(commitmentHex: string): Promise<bigint | null> {
  const base = defaultIndexerUrl(toOotleNetwork(OOTLE_NETWORK));
  const res = await fetch(`${base}/substates/tombstone_${commitmentHex.toLowerCase()}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`indexer ${res.status}`);
  const body = (await res.json()) as { substate?: { ClaimedOutputTombstone?: { value?: number | string } } };
  const value = body.substate?.ClaimedOutputTombstone?.value;
  if (value === undefined) throw new Error("unexpected tombstone substate");
  return BigInt(value);
}

/** A transaction that moved value into one of the account's vaults. */
export interface L2Deposit {
  /** Identifies this receipt across passes (see recordReceipts). */
  key: string;
  transactionId: string;
  vaultId: string;
  resourceAddress: string | null;
  /** Deposited minus withdrawn within that transaction, in the resource's own units. */
  net: bigint;
  /** When the indexer saw the transaction, if it is still among the recent ones. */
  at?: number;
}

const EVENT_PAGE = 100;
const EVENT_PAGES = 5;
const RECENT_PAGES = 2;

type VaultEvent = [string, { topic: string; payload: { amount?: number | string } }];

/**
 * Transactions that left the account's vaults richer, newest first, read from the indexer's
 * per-vault `std.vault.deposit`/`withdraw` events (the payment that creates an account fires a
 * deposit too). The events say nothing about who sent the value, so this would include the
 * account's own unshields and claims too. A transaction whose fee this same vault paid
 * (`pay_fee`) is the account's own and is left out; the rest the caller tells apart by
 * transaction id. A plain incoming transfer is just its deposit — the sender pays the fee.
 *
 * Events carry no time, so deposits the caller doesn't have yet (`known(key)` false) are dated from
 * the indexer's recent-transactions list where they still appear. The indexer can index events a
 * few minutes after a transaction lands, so a fresh payment may take a pass or two to show.
 */
export async function fetchL2Deposits(identity: L2Identity, known: (key: string) => boolean = () => false): Promise<L2Deposit[]> {
  const provider = await identity.account.getProvider();
  const vaultIds = await getVaultIdsForAccount(provider, identity.componentAddress as Parameters<typeof getVaultIdsForAccount>[1]);
  if (vaultIds.length === 0) return [];
  const { substates } = await provider.fetchSubstates(vaultIds);
  const base = defaultIndexerUrl(toOotleNetwork(OOTLE_NETWORK));
  const out: L2Deposit[] = [];
  for (const vaultId of vaultIds) {
    const value = substates[vaultId]?.substate as { Vault?: { resource_container: Record<string, { address?: string }> } } | undefined;
    const container = value?.Vault ? Object.values(value.Vault.resource_container)[0] : undefined;
    const resourceAddress = container?.address ?? null;
    const order: string[] = [];
    const net = new Map<string, bigint>();
    const feePaid = new Set<string>();
    for (let page = 0; page < EVENT_PAGES; page++) {
      const url = `${base}/transactions/events?substate_id=${vaultId}&limit=${EVENT_PAGE}&offset=${page * EVENT_PAGE}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`indexer ${res.status}`);
      const { events } = (await res.json()) as { events: VaultEvent[] };
      for (const [txId, ev] of events) {
        if (ev.topic === "std.vault.pay_fee") feePaid.add(txId);
        const sign = ev.topic === "std.vault.deposit" ? 1n : ev.topic === "std.vault.withdraw" ? -1n : 0n;
        if (sign === 0n) continue;
        if (!net.has(txId)) order.push(txId);
        let amount = 0n;
        try {
          amount = BigInt(String(ev.payload.amount ?? 0));
        } catch {
          /* non-integer payload: count as nothing */
        }
        net.set(txId, (net.get(txId) ?? 0n) + sign * amount);
      }
      if (events.length < EVENT_PAGE) break;
    }
    for (const txId of order) {
      const n = net.get(txId)!;
      if (n > 0n && !feePaid.has(txId)) out.push({ key: `pub:${txId}:${vaultId}`, transactionId: txId, vaultId, resourceAddress, net: n });
    }
  }

  const fresh = out.filter((d) => !known(d.key));
  if (fresh.length > 0) {
    const times = await recentTransactionTimes(base, new Set(fresh.map((d) => d.transactionId)));
    for (const d of fresh) d.at = times.get(d.transactionId);
  }
  return out;
}

/** When the indexer saw each of these transactions, for the ones still among its recent transactions. */
async function recentTransactionTimes(base: string, wanted: Set<string>): Promise<Map<string, number>> {
  const times = new Map<string, number>();
  let lastId: string | null = null;
  try {
    for (let page = 0; page < RECENT_PAGES && times.size < wanted.size; page++) {
      const res = await fetch(`${base}/transactions/recent?limit=50${lastId ? `&last_id=${lastId}` : ""}`);
      if (!res.ok) break;
      const { transactions } = (await res.json()) as { transactions: { transaction_id: string; created_at?: string }[] };
      if (transactions.length === 0) break;
      for (const t of transactions) {
        if (!wanted.has(t.transaction_id) || !t.created_at) continue;
        // "2026-10-01 09:06:40.0", in UTC.
        const at = Date.parse(t.created_at.replace(" ", "T") + "Z");
        if (Number.isFinite(at)) times.set(t.transaction_id, at);
      }
      lastId = transactions[transactions.length - 1].transaction_id;
    }
  } catch {
    /* undated is fine */
  }
  return times;
}
