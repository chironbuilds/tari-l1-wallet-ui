// Activity log for the Ootle (L2) account: what this wallet did on Ootle, when, and how it went.
//
// Ootle has no "transactions for my account" query a wallet can page through, so the log is kept
// locally as operations happen, per Ootle account (the same seed on another device has its own).
// Incoming value is added as it is discovered: public deposits from the account's vault events,
// private payments from the stealth-output scan (see recordReceipts).
// Components read it through useL2History(), which re-renders them when an entry is added or
// settled.
import { useSyncExternalStore } from "react";

export type L2ActivityKind = "send" | "sendPrivately" | "shield" | "unshield" | "claimBurn" | "dapp" | "received" | "receivedPrivately";
export type L2ActivityStatus = "pending" | "done" | "failed";

export interface L2Activity {
  id: string;
  kind: L2ActivityKind;
  status: L2ActivityStatus;
  createdAt: number;
  /** Raw amount in the resource's own units, as a decimal string. */
  amount?: string;
  divisibility?: number;
  symbol?: string;
  /** Counterparty address (sends) or dApp origin. */
  counterparty?: string;
  transactionId?: string;
  error?: string;
  /** Extra detail, e.g. how many private outputs a scan found. */
  note?: string;
  /** Found on chain with no way to tell when it happened (the account's history before this
   * wallet started watching it): shown as "earlier" and kept below dated entries. */
  undated?: boolean;
}

const KEY_PREFIX = "tari-l1-wallet:l2-history:";
const MAX = 200;
const listeners = new Set<() => void>();
const cache = new Map<string, L2Activity[]>();

function read(account: string): L2Activity[] {
  const hit = cache.get(account);
  if (hit) return hit;
  let list: L2Activity[] = [];
  try {
    const raw = localStorage.getItem(KEY_PREFIX + account);
    if (raw) list = JSON.parse(raw) as L2Activity[];
  } catch {
    /* unavailable or corrupt storage: start empty */
  }
  cache.set(account, list);
  return list;
}

function write(account: string, list: L2Activity[]) {
  const trimmed = list.slice(0, MAX);
  cache.set(account, trimmed);
  try {
    localStorage.setItem(KEY_PREFIX + account, JSON.stringify(trimmed));
  } catch {
    /* quota or disabled storage: the log still lives for this session */
  }
  listeners.forEach((l) => l());
}

/** Adds an entry (newest first) and returns its id. */
export function logL2(account: string | undefined, entry: Omit<L2Activity, "id" | "createdAt"> & { createdAt?: number }): string {
  const id = crypto.randomUUID();
  if (!account) return id;
  write(account, [{ id, createdAt: Date.now(), ...entry }, ...read(account)]);
  return id;
}

export function updateL2(account: string | undefined, id: string, patch: Partial<L2Activity>) {
  if (!account) return;
  write(account, read(account).map((e) => (e.id === id ? { ...e, ...patch } : e)));
}

/**
 * Adds incoming payments, once each: `key` identifies a payment (a transaction for a public
 * deposit, a commitment for a private output) and is remembered after the entry is added, so a
 * cleared history is not refilled with the same payments. Transactions this wallet made itself
 * (an unshield into its own vault, a claim) are skipped, since they are already logged.
 * A receipt with its own `at` (when the indexer saw the transaction) is dated by it; otherwise a
 * live pass dates it now and a backfill (`undated`) leaves it undated, below everything else.
 */
export function recordReceipts(
  account: string | undefined,
  receipts: Array<{ key: string; at?: number; entry: Omit<L2Activity, "id" | "createdAt" | "status"> }>,
  undated = false,
): number {
  if (!account || receipts.length === 0) return 0;
  const seen = readSeen(account);
  const list = read(account);
  const own = new Set(list.filter((e) => e.kind !== "received" && e.kind !== "receivedPrivately" && e.transactionId).map((e) => e.transactionId));
  // Already logged under another key (one transaction, one entry per kind).
  const logged = new Set(list.filter((e) => e.transactionId).map((e) => `${e.kind}:${e.transactionId}`));
  const fresh: L2Activity[] = [];
  for (const { key, at, entry } of receipts) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry.transactionId && (own.has(entry.transactionId) || logged.has(`${entry.kind}:${entry.transactionId}`))) continue;
    if (entry.transactionId) logged.add(`${entry.kind}:${entry.transactionId}`);
    const dated = !!at || !undated;
    fresh.push({ id: crypto.randomUUID(), createdAt: at || (dated ? Date.now() : 0), status: "done", undated: dated ? undefined : true, ...entry });
  }
  writeSeen(account, seen);
  if (fresh.length > 0) {
    // Newest first, undated last; a stable sort keeps same-time entries in the order given.
    const merged = [...fresh.filter((e) => !e.undated), ...list, ...fresh.filter((e) => e.undated)];
    merged.sort((a, b) => (a.undated ? 1 : 0) - (b.undated ? 1 : 0) || (a.undated || b.undated ? 0 : b.createdAt - a.createdAt));
    write(account, merged);
  }
  return fresh.length;
}

/** Whether this receipt has been recorded (or deliberately passed over) before. */
export function receiptKnown(account: string, key: string): boolean {
  return readSeen(account).has(key);
}

/** Whether payments for this account have been looked for before (false: the next pass is a backfill). */
export function receiptsSeeded(account: string): boolean {
  try {
    return localStorage.getItem(SEEN_PREFIX + account) !== null;
  } catch {
    return seenCache.has(account);
  }
}

/** Whether an operation of this wallet's own is still in flight — its transaction id is not known yet. */
export function hasPendingL2(account: string): boolean {
  return read(account).some((e) => e.status === "pending");
}

const SEEN_PREFIX = "tari-l1-wallet:l2-seen:";
const seenCache = new Map<string, Set<string>>();

function readSeen(account: string): Set<string> {
  const hit = seenCache.get(account);
  if (hit) return hit;
  let set = new Set<string>();
  try {
    const raw = localStorage.getItem(SEEN_PREFIX + account);
    if (raw) set = new Set(JSON.parse(raw) as string[]);
  } catch {
    /* start empty */
  }
  seenCache.set(account, set);
  return set;
}

function writeSeen(account: string, set: Set<string>) {
  seenCache.set(account, set);
  try {
    localStorage.setItem(SEEN_PREFIX + account, JSON.stringify([...set].slice(-2000)));
  } catch {
    /* session-only */
  }
}

export function clearL2History(account: string | undefined) {
  if (account) write(account, []);
}

/** The on-chain transaction id in an SDK result, whichever spelling the call uses. */
export function txIdOf(result: unknown): string | undefined {
  if (result && typeof result === "object") {
    const r = result as { transactionId?: unknown; transaction_id?: unknown };
    const id = r.transactionId ?? r.transaction_id;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}

/**
 * Runs an Ootle operation with a log entry around it: logged as pending, then settled as done
 * (with its transaction id) or failed (with the reason). Rethrows, so callers keep their own
 * error handling.
 */
export async function withL2Log<T>(account: string | undefined, entry: Omit<L2Activity, "id" | "createdAt" | "status">, run: () => Promise<T>): Promise<T> {
  const id = logL2(account, { ...entry, status: "pending" });
  try {
    const result = await run();
    updateL2(account, id, { status: "done", transactionId: txIdOf(result) });
    return result;
  } catch (e) {
    updateL2(account, id, { status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
    throw e;
  }
}

export function useL2History(account: string | undefined): L2Activity[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => (account ? read(account) : EMPTY),
  );
}
const EMPTY: L2Activity[] = [];

/** Where a transaction can be looked at: Veil, the Ootle explorer. */
export function explorerTxUrl(transactionId: string): string {
  return `https://explorer.tari.mw/tx/${transactionId}`;
}
