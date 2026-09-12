/**
 * The wallet side of the dApp bridge.
 *
 * A dApp runs in a cross-origin iframe, so the wallet cannot hand it a provider object the way a
 * browser extension can — an extension injects `window.ethereum` from a content script, a
 * privilege a web page does not have, and same-origin policy stops the parent touching the frame's
 * `window` at all. So the provider lives in the dApp's own page (see `public/tari-connector.js`)
 * and every call crosses as a `postMessage`.
 *
 * Cross-origin is also the security boundary, not an inconvenience to route around: serving dApps
 * from the wallet's own origin would let any of them read the wallet's `localStorage`, where the
 * enciphered seed lives.
 */

export const PROTOCOL = "tari-dapp-bridge/1";

/**
 * The provider methods, named exactly as the Sapient extension names them
 * (`tari-wallet-extension/src/lib/messages.ts`, `ProviderMethod`).
 *
 * Deliberately identical: a dApp should not have to know or care which Tari wallet it is talking
 * to. The same `window.tari.request({ method, params })` call has to work whether the page is
 * running inside this wallet's iframe or beside the extension in an ordinary tab, so the method
 * names, params and result shapes are matched rather than invented.
 *
 * Where this wallet cannot yet do something the extension can, the method is refused and
 * `tari_getCapabilities` reports it as false — so a dApp feature-detects instead of sniffing which
 * wallet it got.
 */
export type BridgeMethod =
  | "tari_requestAccounts"
  | "tari_getAccounts"
  | "tari_getNetwork"
  | "tari_getWalletAddress"
  | "tari_getBalances"
  | "tari_getSubstate"
  | "tari_getCapabilities"
  | "tari_getTransactionResult"
  | "tari_signAndSubmitTransaction"
  | "tari_withdrawStealthAndExecute"
  | "tari_htlcFund"
  | "tari_createTransactionRequest"
  | "tari_getTransactionRequest"
  | "tari_submitTransactionRequest"
  // ---- Private view access ----
  | "tari_requestViewAccess"
  | "tari_getViewAccess"
  | "tari_revokeViewAccess"
  // ---- Confidential reads, all gated on the grant above ----
  | "tari_getPrivateBalances"
  | "tari_getShieldedOutputs"
  | "tari_scanForPrivatePayments"
  | "tari_scanForResourceUtxos"
  | "tari_claimPrivatePayment"
  // ---- Ownership proof (spends nothing) ----
  | "tari_signOwnershipChallenge"
  | "tari_signWalletOwnershipChallenge"
  | "tari_disconnect";

/** Answerable without a connection, matching the extension (any page may ask the network). */
export const OPEN_METHODS: BridgeMethod[] = ["tari_getNetwork"];

/** Answerable once connected, with no further approval. */
export const CONNECTED_METHODS: BridgeMethod[] = [
  "tari_getAccounts",
  "tari_getWalletAddress",
  "tari_getBalances",
  "tari_getSubstate",
  "tari_getCapabilities",
  "tari_getTransactionResult",
  "tari_getViewAccess",
  "tari_revokeViewAccess",
];

/**
 * Answerable once connected **and** granted private view access — the account's confidential
 * position: what it holds in stealth outputs, which nothing else on-chain can see.
 *
 * Separate from `CONNECTED_METHODS` on purpose. Connecting reveals one public component address;
 * this reveals the position that is the entire reason for holding funds privately, so it is a
 * different question and gets a different prompt. Read-only either way: nothing here can spend, and
 * holding the grant never waives a spend's own approval.
 */
export const VIEW_METHODS: BridgeMethod[] = [
  "tari_getPrivateBalances",
  "tari_getShieldedOutputs",
  "tari_scanForPrivatePayments",
  "tari_scanForResourceUtxos",
  "tari_claimPrivatePayment",
];

/** Requires an explicit approval every time — never remembered, never batched. */
export const SIGNING_METHODS: BridgeMethod[] = ["tari_signAndSubmitTransaction"];

/**
 * The create/approve/submit trio. Also approval-gated, but the approval happens inside
 * `tari_createTransactionRequest` rather than blocking the call: create returns a `requestId`
 * immediately, so a dApp that reloads while the user is deciding can still find its request by id
 * instead of the whole flow dying with one promise.
 */
export const REQUEST_METHODS: BridgeMethod[] = [
  "tari_createTransactionRequest",
  "tari_getTransactionRequest",
  "tari_submitTransactionRequest",
];

/**
 * What this wallet can actually do, in the extension's own `WalletCapabilities` shape.
 *
 * Reporting false is the point: a dApp reads this instead of branching on wallet identity, so the
 * honest answer is more useful than an optimistic one.
 *
 * A function of the asking origin rather than a constant, because one field genuinely varies per
 * dApp: `privateViewGranted` is this site's own permission, not a property of the wallet. The rest
 * are fixed here — unlike the extension, which also serves daemon-relayed accounts that hold no
 * view secret, every account in this wallet is seed-derived and can do the whole stealth surface.
 */
export function capabilitiesFor(origin: string | null) {
  return {
    exactInputSelection: true,
    stealthWithdraw: true,
    /** The `redeemStealthOutputAndExecute` operation kind — spends one specific, externally-known
     * stealth commitment (e.g. a ballot/ticket token minted directly to this wallet by another
     * party) into a dApp's own contract call. Always true here, same reasoning as `stealthWithdraw`
     * above. */
    stealthRedeem: true,
    /** The `redeemStealthOutputWithPrivateFee` operation kind — like `stealthRedeem` but the fee
     * is also paid from a stealth UTXO, so the transaction never reveals this wallet's address.
     * Always true here, same reasoning as `stealthRedeem` above. */
    stealthRedeemPrivateFee: true,
    htlcFund: true,
    /** `htlcClaim`/`htlcRefund` — the other half of `htlcFund`, reachable as transaction-request
     * operation kinds. */
    scriptPathSpend: true,
    /** The `shield`/`unshield`/`sendPrivately` operation kinds. */
    privateSpend: true,
    /** Whether this wallet can serve confidential reads at all. Always true here; the extension
     * reports false for a daemon-relayed account, which never exposes a view secret. */
    privateBalanceView: true,
    /** Whether *this site* holds the read grant. False means `VIEW_METHODS` are refused and
     * `tari_getBalances` withholds `confidentialAmount` — call `tari_requestViewAccess`. */
    privateViewGranted: origin ? hasViewAccess(origin) : false,
    transactionResultLookup: true,
    transactionRequests: true,
    /** `tari_getWalletAddress` — the bech32m address needed to address a stealth output to this
     * account. */
    walletAddress: true,
    /** `minimumValuePromise` on the `shield`/`sendPrivately` operation kinds — proof-of-funds
     * outputs, publicly verifiable on-chain with no help from this wallet. */
    minimumValuePromise: true,
    /** `tari_signOwnershipChallenge` — proves control of a specific stealth output without
     * spending it. */
    ownershipProof: true,
    /** `tari_signWalletOwnershipChallenge` — proves control of the wallet address itself, not tied
     * to any particular output. */
    walletOwnershipProof: true,
    /** The `depositConfidential` transaction-request kind — moves revealed balance into a
     * Confidential-type vault, a different privacy mechanism from the Stealth surface above. */
    confidentialDeposit: true,
    dryRunIsLocal: true,
  };
}

export type BridgeCapabilities = ReturnType<typeof capabilitiesFor>;

/* ---------------------------------------------------------------------------------------------
 * `minimumValuePromise` (on the `shield` and `sendPrivately` operation kinds)
 *
 * A public claim, committed into the new output's own range proof, that it is worth **at least**
 * this much. Raw resource units as a decimal string; omitted or `"0"` means no claim, which is the
 * default and the ordinary case.
 *
 * A confidential output normally proves `0 <= v < 2^64`, hiding `v` entirely. With a promise `m`
 * the proof instead attests `m <= v < 2^64`, and `m` is stored in the clear as
 * `UnspentOutput.minimum_value_promise`. That makes the output a self-contained proof of funds:
 *
 * ```js
 * // Prove this wallet can cover 100000, without revealing what it actually holds.
 * const r = await window.tari.requestTransaction({
 *   kind: "shield", resourceAddress, amount: "100000", minimumValuePromise: "100000",
 * });
 * // Share r.substateId. Anyone verifies it with no cooperation from the wallet:
 * const s = await window.tari.getSubstate(r.substateId);
 * // -> read `minimum_value_promise` off the output, and that the substate is still unspent.
 * ```
 *
 * Three properties worth designing around:
 *
 * - **Non-interactive and permanent.** Verification needs no cooperation from the wallet, no
 *   signature and no live session -- just the chain. Equally, the disclosure is permanent and
 *   public: everyone sees it forever, not only whoever the proof was made for.
 * - **It proves one output, not a balance.** "This output is worth >= m", not "this account holds
 *   >= m". To prove total spending power, shield the whole amount into a single output and promise
 *   against that; `tari_getPrivateBalances`' `outputCount` shows how funds are currently split.
 * - **Spending the output destroys the proof.** Correct semantics -- a proof of funds should stop
 *   verifying once the funds move -- but a verifier must re-check that the substate is still
 *   unspent at the moment they care, not merely that it once existed.
 *
 * Must not exceed the output's own `amount`: a range proof asserting "at least m" is impossible for
 * an output actually worth less, and is refused before anything is signed (see `parseOperation`).
 * ------------------------------------------------------------------------------------------- */

/**
 * A dApp-proposed transaction's actual operation, matching the extension's
 * `TransactionRequestOperation` field for field — same reason the method names match: a dApp should
 * not have to know which Tari wallet it drew.
 *
 * The private-spend kinds are request kinds rather than something a dApp could express as raw
 * `instructions` because a real `StealthTransfer` instruction needs a balance proof and per-input
 * one-time authorizations only the wallet's own signer can produce. A dApp can ask the wallet to
 * build one; it can never hand one over.
 */
export type TransactionRequestOperation =
  | { kind: "instructions"; instructions: unknown[]; maxFee?: string; inputs?: unknown[] }
  | {
      kind: "withdrawStealthAndExecute";
      resourceAddress: string;
      amount: string;
      workspaceVarName: string;
      followUpInstructions: unknown[];
      relatedComponents?: string[];
      maxFee?: string;
    }
  /** Spends one specific, externally-known stealth commitment (e.g. a ballot/ticket token some
   * other party minted directly to this wallet's address, as opposed to `withdrawStealthAndExecute`'s
   * *amount* drawn from this account's own tracked vault balance) into a dApp's own follow-up
   * contract call. `revealedAmount` must be the output's actual value, known from whatever
   * protocol minted it — there is no client-side way to discover it otherwise. */
  | {
      kind: "redeemStealthOutputAndExecute";
      resourceAddress: string;
      commitmentHex: string;
      revealedAmount: string;
      followUpInstructions: unknown[];
      relatedComponents?: string[];
      maxFee?: string;
    }
  /** Identical to `redeemStealthOutputAndExecute`, except the fee is ALSO paid from a stealth
   * UTXO (a second, separate commitment of `feeResourceAddress` this account owns) instead of
   * this account's revealed balance — required whenever `followUpInstructions` carries
   * information that would deanonymize the account if the fee input did (e.g. a voting ballot's
   * ranking). Result adds `feeChangeCommitment` — the fee UTXO's unspent remainder, now a new
   * stealth output the caller must track itself to fund a next call the same way. */
  | {
      kind: "redeemStealthOutputWithPrivateFee";
      resourceAddress: string;
      commitmentHex: string;
      revealedAmount: string;
      followUpInstructions: unknown[];
      feeResourceAddress: string;
      feeCommitmentHex: string;
      maxFee: string;
      relatedComponents?: string[];
    }
  | {
      kind: "htlcFund";
      resourceAddress: string;
      amount: string;
      claimantWalletAddress: string;
      hashLockHex: string;
      refundEpoch: string;
      maxFee?: string;
    }
  /** Revealed -> private, staying in this same account. `minimumValuePromise` turns the resulting
   * output into a proof of funds -- see that field's shared explainer below. Result:
   * `{ transactionId, commitment, substateId, minimumValuePromise }`. */
  | { kind: "shield"; resourceAddress: string; amount: string; maxFee?: string; memo?: string; minimumValuePromise?: string }
  /** Revealed -> a Confidential-type vault, same account -- the "Confidential" `ResourceType`'s
   * equivalent of `shield`, a different privacy mechanism (vault-based, ElGamal-encrypted to a
   * resource view key) than the Stealth kinds around it. Only meaningful against a resource
   * actually created as `ResourceType::Confidential`; fails on-chain against any other resource
   * type, not client-side. No `minimumValuePromise` equivalent exists for Confidential vaults. */
  | { kind: "depositConfidential"; resourceAddress: string; amount: string; maxFee?: string }
  /** Private -> revealed, back into this account's on-chain vault. Which stealth UTXOs get spent to
   * cover `revealedAmount` is the wallet's own coin-selection decision, not the dApp's. */
  | { kind: "unshield"; resourceAddress: string; revealedAmount: string; maxFee?: string; memo?: string }
  /** Private -> private. The result's `recipientCommitment` is the recipient's only lead to the
   * payment — no scan-by-view-key API exists for a specific counterparty — so whoever brokered the
   * transfer must deliver it out of band. */
  | {
      kind: "sendPrivately";
      resourceAddress: string;
      recipientWalletAddress: string;
      amount: string;
      maxFee?: string;
      memo?: string;
      /** Applies to the *recipient's* output only, never this account's change. Lets a payer give
       * the recipient a publicly verifiable floor on what they were paid without revealing the
       * exact amount. Result adds `recipientSubstateId` and `minimumValuePromise`. */
      minimumValuePromise?: string;
    }
  /** Spends an HTLC output addressed to this account by revealing the claim leaf's preimage.
   * `conditions` must be the exact two-leaf tree the funder produced: only its root is on-chain, so
   * it cannot be recovered from the chain alone. */
  | { kind: "htlcClaim"; resourceAddress: string; commitment: string; conditions: object[]; preimageHex: string; maxFee?: string }
  /** Refunds an HTLC this account funded, once `refundEpoch` passed. `amount` and `outputMask` must
   * be exactly what the matching `htlcFund` returned — the output is addressed to the claimant, so
   * this account cannot decrypt it and has no other way back to those values. */
  | {
      kind: "htlcRefund";
      resourceAddress: string;
      commitment: string;
      conditions: object[];
      amount: string;
      outputMask: string;
      maxFee?: string;
    };

export interface BridgeRequest {
  protocol: typeof PROTOCOL;
  id: string;
  method: BridgeMethod;
  params?: Record<string, unknown>;
}

export interface BridgeResponse {
  protocol: typeof PROTOCOL;
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export const ERROR = {
  rejected: { code: 4001, message: "Request rejected by the user" },
  unauthorized: { code: 4100, message: "Not connected — call connect() first" },
  unsupported: (m: string) => ({ code: 4200, message: `Unsupported method: ${m}` }),
  internal: (m: string) => ({ code: -32603, message: m }),
} as const;

export function isBridgeRequest(data: unknown): data is BridgeRequest {
  if (!data || typeof data !== "object") return false;
  const d = data as Partial<BridgeRequest>;
  return d.protocol === PROTOCOL && typeof d.id === "string" && typeof d.method === "string";
}

/** The origin a dApp URL is allowed to speak from. Every message is checked against this. */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const PERMISSIONS_KEY = "tari.dapps.permissions.v1";

interface SitePermission {
  connectedAt: number;
  /**
   * When (if ever) this origin was granted **private view access** — permission to read the
   * account's confidential position (`VIEW_METHODS`, plus the `confidentialAmount` half of
   * `tari_getBalances`). Absent = never granted.
   *
   * Deliberately not implied by a connection, and deliberately not carried into a *new* one: see
   * `grantConnection`. Read-only in every case — it never authorizes a spend.
   */
  viewAccessGrantedAt?: number;
}

type Permissions = Record<string, SitePermission>;

function readPermissions(): Permissions {
  try {
    const raw = localStorage.getItem(PERMISSIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Permissions) : {};
  } catch {
    return {};
  }
}

function writePermissions(next: Permissions): void {
  try {
    localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the connection simply does not survive a reload */
  }
}

/**
 * Connection is remembered per *origin*, not per stored dApp entry — two entries pointing at the
 * same site are the same trust decision, and a path cannot be a security boundary since a page can
 * navigate itself anywhere within its origin.
 */
export function isConnected(origin: string): boolean {
  return !!readPermissions()[origin];
}

/** Records (or re-records) a connection. Any previous entry for the origin is replaced wholesale
 * rather than merged, so a prior view grant does **not** survive into the new connection —
 * re-approving a *connection* must not silently re-grant a *view* permission the user was never
 * re-asked about. */
export function grantConnection(origin: string): void {
  const next = readPermissions();
  next[origin] = { connectedAt: Date.now() };
  writePermissions(next);
}

/** Whether this origin is connected *and* holds the private view grant — the single gate in front
 * of every confidential read. */
export function hasViewAccess(origin: string): boolean {
  return readPermissions()[origin]?.viewAccessGrantedAt !== undefined;
}

/**
 * Grants the private view permission. A no-op for an origin that isn't connected: there is nothing
 * to attach it to, and creating a connection as a side effect of a view grant would let a site skip
 * the connect prompt entirely. Returns whether it wrote anything.
 */
export function grantViewAccess(origin: string): boolean {
  const next = readPermissions();
  const existing = next[origin];
  if (!existing) return false;
  next[origin] = { ...existing, viewAccessGrantedAt: Date.now() };
  writePermissions(next);
  return true;
}

/** Revokes the view permission while leaving the connection intact — the site keeps working, it
 * just stops seeing the private side. Idempotent. */
export function revokeViewAccess(origin: string): void {
  const next = readPermissions();
  const existing = next[origin];
  if (!existing) return;
  // Rebuilt without the key rather than set to `undefined`: this record is JSON-serialized into
  // localStorage, where an explicit `undefined` is dropped on write anyway — spelling it out keeps
  // the in-memory shape identical to what reads back.
  next[origin] = { connectedAt: existing.connectedAt };
  writePermissions(next);
}

export function revokeConnection(origin: string): void {
  const next = readPermissions();
  delete next[origin];
  writePermissions(next);
}

export function connectedOrigins(): string[] {
  return Object.keys(readPermissions());
}

/** Connected sites and whether each holds the view grant — for a wallet-side "connected dApps"
 * listing that can show and revoke it. */
export function connectedSites(): { origin: string; viewAccess: boolean }[] {
  return Object.entries(readPermissions()).map(([origin, p]) => ({ origin, viewAccess: p.viewAccessGrantedAt !== undefined }));
}

/** A request waiting on the user, surfaced by the frame so the wallet can draw an approval. */
export interface PendingApproval {
  id: string;
  origin: string;
  method: BridgeMethod;
  params: Record<string, unknown>;
  /** Human-readable lines describing exactly what is being approved. */
  summary: string[];
  resolve: (approved: boolean) => void;
}

/**
 * What an approval dialog shows.
 *
 * Built from the request itself rather than anything the dApp says about it: a dApp supplying its
 * own description of what it is asking for is the oldest trick there is.
 */
export function describeRequest(method: BridgeMethod, params: Record<string, unknown>): string[] {
  switch (method) {
    case "tari_requestAccounts":
      return [
        "View your Ootle account address",
        "View your public token balances",
        "Ask you to approve transactions (each one separately)",
        "It will NOT see your private balance — that is a separate request",
      ];
    case "tari_requestViewAccess":
      // Spelled out in both directions, because "view access" on its own reads as harmless and the
      // thing being handed over — the whole confidential position, which is the entire reason for
      // holding funds privately — is precisely what nothing else on-chain can see. The "cannot
      // spend" half matters as much: a user who assumes otherwise refuses grants they'd be fine
      // with.
      return [
        "See your PRIVATE balance — what you hold in shielded outputs, hidden from everyone else on-chain",
        "See the individual shielded outputs behind that balance",
        "Scan for private payments sent to you",
        "It will NOT be able to spend anything — every transaction still needs your approval",
        "It will NOT receive your keys, and cannot read payments sent to anyone else",
        "You can revoke this at any time without disconnecting the site",
      ];
    case "tari_signOwnershipChallenge":
      // The challenge is shown verbatim -- it's the one thing a human is actually evaluating here.
      // The wallet builds the domain-tagged bytes it actually signs itself (ownershipProof.ts),
      // never from anything the site supplies, but that's a fact about how it's protected, not
      // what the user is being asked to read and approve.
      return [
        "Prove you control a specific private output — this does NOT spend or move anything",
        `Sign exactly this text: "${String(params.challenge ?? "")}"`,
        `Output: ${shortId(String(params.substateId ?? ""))}`,
        "It will NOT receive your keys",
      ];
    case "tari_signWalletOwnershipChallenge":
      return [
        "Prove you hold this wallet address — this does NOT spend or move anything",
        `Sign exactly this text: "${String(params.challenge ?? "")}"`,
        "It will NOT receive your keys",
      ];
    case "tari_createTransactionRequest":
      return describeOperation(params as unknown as TransactionRequestOperation);
    case "tari_signAndSubmitTransaction": {
      const instructions = Array.isArray(params.instructions) ? params.instructions : [];
      const lines = [
        `Sign and submit a transaction with ${instructions.length} instruction${instructions.length === 1 ? "" : "s"}`,
        `Max fee ${String(params.maxFee ?? "5000")}`,
      ];
      // Named methods and addresses are the part worth reading before approving.
      for (const instr of instructions.slice(0, 4)) {
        const call = instr as Record<string, Record<string, unknown>>;
        const kind = Object.keys(call)[0];
        if (kind === "CallMethod") {
          const body = call.CallMethod as Record<string, unknown>;
          const target = (body.call as Record<string, unknown> | undefined)?.Address;
          lines.push(`· ${String(body.method)} on ${shortId(String(target ?? "?"))}`);
        } else if (kind) {
          lines.push(`· ${kind}`);
        }
      }
      if (instructions.length > 4) lines.push(`· …and ${instructions.length - 4} more`);
      return lines;
    }
    default:
      return [method];
  }
}

function shortId(value: string): string {
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

/**
 * The minimum-value-promise disclosure lines, or nothing when no promise is set.
 *
 * Written once rather than per operation kind so the warning cannot drift between them: the point is
 * that the user reads the same unambiguous sentence about a permanent public disclosure whichever
 * operation carries it. An absent or zero promise adds no line at all — a warning that appears on
 * every transaction is one nobody reads on the transaction that needed it.
 */
function promiseLines(minimumValuePromise: string | undefined, subject: string): string[] {
  if (minimumValuePromise === undefined || BigInt(minimumValuePromise) === 0n) return [];
  return [
    `PUBLICLY records that ${subject} is worth at least ${minimumValuePromise} — permanently, on-chain, visible to everyone and not just this site`,
  ];
}

/**
 * What a transaction request's approval dialog shows, one case per operation kind.
 *
 * Every private-spend line states plainly which direction value moves and whether it becomes
 * publicly visible, because that is the only thing distinguishing these from one another — they all
 * render as "a stealth transfer" otherwise, and "unshield" in particular makes an amount visible
 * on-chain forever, which a user has to be told before approving and not after.
 */
export function describeOperation(operation: TransactionRequestOperation): string[] {
  switch (operation?.kind) {
    case "instructions":
      return describeRequest("tari_signAndSubmitTransaction", operation as unknown as Record<string, unknown>);
    case "withdrawStealthAndExecute":
      return [
        `Reveal ${operation.amount} of ${shortId(operation.resourceAddress)} for use in this transaction`,
        `Then run ${(operation.followUpInstructions ?? []).length} follow-up instruction(s) supplied by the site`,
      ];
    case "redeemStealthOutputAndExecute":
      return [
        `Redeem a stealth token (${shortId(operation.commitmentHex)}, ${operation.revealedAmount} of ${shortId(operation.resourceAddress)}) for use in this transaction`,
        `Then run ${(operation.followUpInstructions ?? []).length} follow-up instruction(s) supplied by the site`,
      ];
    case "redeemStealthOutputWithPrivateFee":
      return [
        `Redeem a stealth token (${shortId(operation.commitmentHex)}, ${operation.revealedAmount} of ${shortId(operation.resourceAddress)}) for use in this transaction`,
        `Pay the fee from a separate stealth UTXO (${shortId(operation.feeCommitmentHex)}) — this wallet's address is never revealed`,
        `Then run ${(operation.followUpInstructions ?? []).length} follow-up instruction(s) supplied by the site`,
      ];
    case "shield":
      return [
        `Move ${operation.amount} of ${shortId(operation.resourceAddress)} from your PUBLIC balance into your PRIVATE balance`,
        "Stays in this account — nothing leaves your wallet",
        // Stated outright, not left to be inferred from a field name. Shielding is the act of making
        // value invisible; a promise puts a permanent public floor back on it, for everyone, for as
        // long as the output lives. Someone approving a "move to private" must not discover
        // afterwards that they also published a number.
        ...promiseLines(operation.minimumValuePromise, "this new private output"),
      ];
    case "depositConfidential":
      return [
        `Move ${operation.amount} of ${shortId(operation.resourceAddress)} from your PUBLIC balance into a CONFIDENTIAL vault`,
        "Stays in this account — nothing leaves your wallet",
        "Different privacy mechanism from \"shield\" — only works if this resource was created as a Confidential-type resource",
      ];
    case "unshield":
      return [
        `Move ${operation.revealedAmount} of ${shortId(operation.resourceAddress)} from your PRIVATE balance back into your PUBLIC balance`,
        "This amount becomes visible on-chain",
      ];
    case "sendPrivately":
      return [
        `Send ${operation.amount} of ${shortId(operation.resourceAddress)} privately`,
        `To ${shortId(operation.recipientWalletAddress)}`,
        "The amount and recipient stay hidden on-chain",
        ...promiseLines(operation.minimumValuePromise, "the recipient's new output"),
      ];
    case "htlcFund":
      return [
        `Lock ${operation.amount} of ${shortId(operation.resourceAddress)} in a hash-timelock contract`,
        `Claimable by ${shortId(operation.claimantWalletAddress)} with the matching secret, before epoch ${operation.refundEpoch}`,
        "Refundable back to you after that epoch",
      ];
    case "htlcClaim":
      return [
        `Claim an HTLC-locked private payment of ${shortId(operation.resourceAddress)}`,
        "Reveals your secret to the network — the counterparty can see it once this lands",
      ];
    case "htlcRefund":
      return [
        `Refund ${operation.amount} of ${shortId(operation.resourceAddress)} from an HTLC you funded`,
        "Only succeeds once its refund epoch has passed",
      ];
    default:
      return ["Unrecognised operation — reject this unless you know exactly what it is"];
  }
}
