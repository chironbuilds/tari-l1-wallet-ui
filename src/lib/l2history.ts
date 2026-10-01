// Activity log for the Ootle (L2) account: what this wallet did on Ootle, when, and how it went.
//
// Ootle has no "transactions for my account" query a wallet can page through, so the log is kept
// locally as operations happen, per Ootle account (the same seed on another device has its own).
// Components read it through useL2History(), which re-renders them when an entry is added or
// settled.
import { useSyncExternalStore } from "react";

export type L2ActivityKind = "send" | "sendPrivately" | "shield" | "unshield" | "claimBurn" | "dapp" | "received";
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
