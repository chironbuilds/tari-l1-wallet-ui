/**
 * Transaction requests: the create → user approval → submit flow a dApp uses for anything that
 * spends, mirroring the extension's `tari_createTransactionRequest`/`tari_getTransactionRequest`/
 * `tari_submitTransactionRequest` (and, upstream of that, `tari_ootle_walletd`'s own
 * `transaction_requests`).
 *
 * Why this rather than one blocking call: `create` returns a `requestId` the instant the request
 * exists, without waiting on the human. A dApp that reloads its iframe while the user is reading the
 * approval — or that simply wants to render its own "waiting for approval" UI — can poll by id and
 * pick the flow back up. A single blocking promise loses everything the moment the page reloads,
 * and for a `sendPrivately` that means losing the `recipientCommitment` the recipient needs to ever
 * see their payment.
 *
 * Records live in memory, keyed by id. That is weaker than the extension, which persists them
 * because Chrome tears its service worker down mid-flow — here the wallet is an ordinary page, so a
 * record outlives every dApp-side reload and only dies when the *wallet* is closed, which ends the
 * session anyway. The difference is documented rather than papered over: `tari_getTransactionRequest`
 * on an unknown id after a wallet reload means "gone", not "still pending".
 */
import type { OotleAccount } from "../ootle";
import type { TransactionRequestOperation } from "./dappBridge";

/** How long an approved-but-unsubmitted request stays submittable. Matches the extension's 15
 * minutes: long enough for a human to be interrupted mid-decision, short enough that a stale
 * request isn't submitted much later against substate versions and a fee estimate that have moved. */
export const REQUEST_TTL_MS = 15 * 60 * 1000;

export type RequestStatus = "pending" | "approved" | "submitting" | "submitted" | "rejected" | "failed";

/** The dApp-facing view of a request. Deliberately excludes the account and the raw operation — the
 * dApp already holds its own copy of the latter, and neither belongs in a response. */
export interface TransactionRequestSummary {
  requestId: string;
  status: RequestStatus;
  /** The same human-readable lines shown on the approval dialog, joined — so a dApp's own waiting
   * UI can say exactly what the user is being asked, rather than inventing its own wording. */
  note: string;
  createdAt: number;
  expiresAt: number;
  result?: unknown;
  error?: string;
}

interface RequestRecord {
  id: string;
  origin: string;
  operation: TransactionRequestOperation;
  note: string;
  status: RequestStatus;
  createdAt: number;
  expiresAt: number;
  result?: unknown;
  error?: string;
}

const records = new Map<string, RequestRecord>();

/** Bounds memory for a long-lived wallet session that a busy dApp keeps creating requests in.
 * Oldest-first eviction; a request old enough to be evicted is well past its TTL and unsubmittable
 * either way. */
const MAX_RECORDS = 200;

export function createRequest(origin: string, operation: TransactionRequestOperation, note: string): string {
  if (records.size >= MAX_RECORDS) {
    const oldest = [...records.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) records.delete(oldest.id);
  }
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  records.set(id, { id, origin, operation, note, status: "pending", createdAt, expiresAt: createdAt + REQUEST_TTL_MS });
  return id;
}

/**
 * Looks a record up, insisting it belongs to the asking origin. A record belonging to someone else
 * gives the same answer as one that does not exist, so a dApp cannot probe for another site's
 * request ids.
 */
export function getRecord(origin: string, requestId: string): RequestRecord | null {
  const record = records.get(requestId);
  return record && record.origin === origin ? record : null;
}

/** Expiry is derived on read rather than written by a timer — a pending request nobody looks at
 * costs nothing, and a timer that fired while the tab was backgrounded would misreport when it
 * happened. Mirrors the extension's own lazy-expiry design. */
function isExpired(record: RequestRecord): boolean {
  return (record.status === "pending" || record.status === "approved") && Date.now() > record.expiresAt;
}

export function summarize(record: RequestRecord): TransactionRequestSummary {
  const expired = isExpired(record);
  return {
    requestId: record.id,
    status: expired ? "failed" : record.status,
    note: record.note,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    result: record.result,
    error: expired ? "This transaction request expired before it was submitted." : record.error,
  };
}

/** Records the user's verdict. Guarded to a still-pending record: a submission may already have
 * claimed it (see `claimForSubmit`), and writing "approved" over that would reopen the
 * double-submit window this whole gate exists to close. */
export function recordDecision(requestId: string, approved: boolean): void {
  const record = records.get(requestId);
  if (!record || record.status !== "pending") return;
  record.status = approved ? "approved" : "rejected";
  if (!approved) record.error = "Rejected by the user.";
}

export type ClaimOutcome = { claimed: true; record: RequestRecord } | { claimed: false; reason: string };

/**
 * Moves a record from "approved" to "submitting" **before** anything executes.
 *
 * This is what makes submission safe against concurrency: two simultaneous submits over one request
 * cannot both pass — exactly one wins and the other is told the status is wrong, instead of both
 * executing and paying twice. A dApp retrying on a slow network is the ordinary way this happens,
 * not an attack.
 */
export function claimForSubmit(origin: string, requestId: string): ClaimOutcome {
  const record = getRecord(origin, requestId);
  if (!record) return { claimed: false, reason: "Unknown transaction request." };
  if (isExpired(record)) return { claimed: false, reason: "This transaction request expired before it was submitted." };
  if (record.status !== "approved") return { claimed: false, reason: `Cannot submit: this request's status is "${record.status}".` };
  record.status = "submitting";
  return { claimed: true, record };
}

export function settle(requestId: string, outcome: { result: unknown } | { error: string }): void {
  const record = records.get(requestId);
  if (!record) return;
  if ("result" in outcome) {
    record.status = "submitted";
    record.result = outcome.result;
  } else {
    record.status = "failed";
    record.error = outcome.error;
  }
}

/** Drops every record belonging to an origin. Called when a site is disconnected, so an approved
 * request cannot be submitted by a site that has since lost its connection. */
export function forgetOrigin(origin: string): void {
  for (const [id, record] of records) {
    if (record.origin === origin) records.delete(id);
  }
}

/**
 * Runs an operation against the account.
 *
 * Each private-spend kind defers wholly to the `OotleAccount` method of the same name: the dApp
 * never sees a blinding mask, a view secret, or which specific UTXOs get spent — coin selection is
 * the wallet's own decision from its local ledger of stealth outputs, and the dApp supplies only an
 * amount.
 */
export async function executeOperation(account: OotleAccount, operation: TransactionRequestOperation): Promise<unknown> {
  const maxFee = operation.maxFee !== undefined ? BigInt(operation.maxFee) : undefined;
  switch (operation.kind) {
    case "instructions":
      return account.execute(operation.instructions as never[], { maxFee, inputs: operation.inputs as never[] | undefined });
    case "withdrawStealthAndExecute":
      return account.withdrawStealthAndExecute(
        operation.resourceAddress,
        BigInt(operation.amount),
        operation.workspaceVarName,
        operation.followUpInstructions as never[],
        operation.relatedComponents ?? [],
        maxFee,
      );
    case "redeemStealthOutputAndExecute":
      return account.redeemStealthOutputAndExecute(
        operation.resourceAddress,
        operation.commitmentHex,
        BigInt(operation.revealedAmount),
        operation.followUpInstructions as never[],
        operation.relatedComponents ?? [],
        maxFee,
      );
    case "shield":
      return account.shield(
        operation.resourceAddress,
        BigInt(operation.amount),
        maxFee,
        operation.memo,
        operation.minimumValuePromise !== undefined ? BigInt(operation.minimumValuePromise) : 0n,
      );
    case "unshield":
      return account.unshield(operation.resourceAddress, BigInt(operation.revealedAmount), maxFee, operation.memo);
    case "depositConfidential":
      return account.depositConfidential(operation.resourceAddress, BigInt(operation.amount), maxFee);
    case "sendPrivately":
      return account.sendPrivately(
        operation.resourceAddress,
        operation.recipientWalletAddress,
        BigInt(operation.amount),
        maxFee,
        operation.memo,
        operation.minimumValuePromise !== undefined ? BigInt(operation.minimumValuePromise) : 0n,
      );
    case "htlcFund":
      return account.htlcFund(
        operation.resourceAddress,
        BigInt(operation.amount),
        operation.claimantWalletAddress,
        operation.hashLockHex,
        BigInt(operation.refundEpoch),
        maxFee,
      );
    case "htlcClaim":
      return account.htlcClaim(operation.resourceAddress, operation.commitment, operation.conditions, operation.preimageHex, maxFee);
    case "htlcRefund":
      return account.htlcRefund(
        operation.resourceAddress,
        operation.commitment,
        operation.conditions,
        BigInt(operation.amount),
        operation.outputMask,
        maxFee,
      );
    default:
      throw new Error(`Unsupported operation kind: ${String((operation as { kind?: unknown }).kind)}`);
  }
}

/**
 * Validates an operation arriving from a dApp before it is ever shown to the user.
 *
 * A malformed request rejected here is one the user never sees; letting it reach the approval
 * dialog would mean asking someone to authorize something whose description was assembled from
 * missing fields, and then failing anyway at submit time.
 */
export function parseOperation(params: unknown): TransactionRequestOperation {
  const p = params as Partial<TransactionRequestOperation> & Record<string, unknown>;
  if (!p || typeof p.kind !== "string") throw new Error("A transaction request needs a `kind`.");

  const amountField = (name: string): string => {
    const value = p[name];
    if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`${name} must be an integer string in raw resource units.`);
    return value;
  };
  const stringField = (name: string): string => {
    const value = p[name];
    if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required.`);
    return value.trim();
  };
  /**
   * An optional promise, validated against the output's own amount here rather than at execution
   * time. Both halves matter: a malformed value must not reach an approval dialog (the user would be
   * asked to authorise a description built from a field that will fail), and an impossible one
   * — a promise above the amount — must be refused before signing, because the range proof asserting
   * it simply cannot be generated.
   */
  const promiseField = (amount: string): string | undefined => {
    const value = p.minimumValuePromise;
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
      throw new Error("minimumValuePromise must be a non-negative integer string in raw resource units.");
    }
    if (BigInt(value) > BigInt(amount)) {
      throw new Error(
        `minimumValuePromise (${value}) cannot exceed the output's own amount (${amount}) -- a range proof asserting "at least ${value}" is impossible for an output worth ${amount}.`,
      );
    }
    return value;
  };

  const conditionsField = (): object[] => {
    const value = p.conditions;
    // The exact two-leaf tree the funder produced. Only its root is committed on-chain, so a wrong
    // or reconstructed tree fails at the network with a condition-root mismatch rather than here —
    // checking the shape at least catches the common "forgot to pass it through" case early.
    if (!Array.isArray(value) || value.length === 0) throw new Error("conditions must be the leaf tree htlcFund returned.");
    return value as object[];
  };

  switch (p.kind) {
    case "instructions":
      if (!Array.isArray(p.instructions)) throw new Error("instructions must be an array.");
      return { kind: "instructions", instructions: p.instructions, maxFee: p.maxFee as string | undefined, inputs: p.inputs as unknown[] | undefined };
    case "withdrawStealthAndExecute":
      if (!Array.isArray(p.followUpInstructions)) throw new Error("followUpInstructions must be an array.");
      return {
        kind: "withdrawStealthAndExecute",
        resourceAddress: stringField("resourceAddress"),
        amount: amountField("amount"),
        workspaceVarName: stringField("workspaceVarName"),
        followUpInstructions: p.followUpInstructions,
        relatedComponents: p.relatedComponents as string[] | undefined,
        maxFee: p.maxFee as string | undefined,
      };
    case "redeemStealthOutputAndExecute":
      if (!Array.isArray(p.followUpInstructions)) throw new Error("followUpInstructions must be an array.");
      return {
        kind: "redeemStealthOutputAndExecute",
        resourceAddress: stringField("resourceAddress"),
        commitmentHex: stringField("commitmentHex"),
        revealedAmount: amountField("revealedAmount"),
        followUpInstructions: p.followUpInstructions,
        relatedComponents: p.relatedComponents as string[] | undefined,
        maxFee: p.maxFee as string | undefined,
      };
    case "shield": {
      const amount = amountField("amount");
      return {
        kind: "shield",
        resourceAddress: stringField("resourceAddress"),
        amount,
        maxFee: p.maxFee as string | undefined,
        memo: p.memo as string | undefined,
        minimumValuePromise: promiseField(amount),
      };
    }
    case "unshield":
      return {
        kind: "unshield",
        resourceAddress: stringField("resourceAddress"),
        revealedAmount: amountField("revealedAmount"),
        maxFee: p.maxFee as string | undefined,
        memo: p.memo as string | undefined,
      };
    case "depositConfidential":
      return {
        kind: "depositConfidential",
        resourceAddress: stringField("resourceAddress"),
        amount: amountField("amount"),
        maxFee: p.maxFee as string | undefined,
      };
    case "sendPrivately": {
      const amount = amountField("amount");
      return {
        kind: "sendPrivately",
        resourceAddress: stringField("resourceAddress"),
        recipientWalletAddress: stringField("recipientWalletAddress"),
        amount,
        maxFee: p.maxFee as string | undefined,
        memo: p.memo as string | undefined,
        minimumValuePromise: promiseField(amount),
      };
    }
    case "htlcFund":
      return {
        kind: "htlcFund",
        resourceAddress: stringField("resourceAddress"),
        amount: amountField("amount"),
        claimantWalletAddress: stringField("claimantWalletAddress"),
        hashLockHex: stringField("hashLockHex"),
        refundEpoch: amountField("refundEpoch"),
        maxFee: p.maxFee as string | undefined,
      };
    case "htlcClaim": {
      const preimageHex = stringField("preimageHex");
      // Checked here rather than left to the account method so a malformed secret is refused before
      // an approval dialog asks the user to reveal it.
      if (!/^[0-9a-f]{64}$/i.test(preimageHex)) throw new Error("preimageHex must be exactly 64 hex characters (32 bytes).");
      return {
        kind: "htlcClaim",
        resourceAddress: stringField("resourceAddress"),
        commitment: stringField("commitment"),
        conditions: conditionsField(),
        preimageHex,
        maxFee: p.maxFee as string | undefined,
      };
    }
    case "htlcRefund":
      return {
        kind: "htlcRefund",
        resourceAddress: stringField("resourceAddress"),
        commitment: stringField("commitment"),
        conditions: conditionsField(),
        amount: amountField("amount"),
        outputMask: stringField("outputMask"),
        maxFee: p.maxFee as string | undefined,
      };
    default:
      throw new Error(`Unsupported operation kind: ${p.kind}`);
  }
}
