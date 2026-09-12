# dApp Provider API

A dApp runs in a cross-origin iframe inside the wallet and reaches it through `window.tari`,
published by `public/tari-connector.js`:

```html
<script src="https://universe.tari.mw/tari-connector.js"></script>
```

Every method is callable two ways — `window.tari.request({ method, params })` (identical to the
Sapient browser extension's provider) or the named sugar (`window.tari.getPrivateBalances()`). They
are the same call.

**Method names, params and result shapes match the extension deliberately.** A dApp should not have
to know which Tari wallet it drew. Feature-detect with `tari_getCapabilities`; never wallet-detect.

---

## Permission model

Three separate grants, asked for at different moments, because they are different questions:

| Grant | What it reveals | How it is asked |
|---|---|---|
| **Connection** | One public component address, plus public balances | `tari_requestAccounts` |
| **Private view** | The confidential position — shielded balances and the outputs behind them | `tari_requestViewAccess` |
| **A spend** | Nothing; it *moves* funds | Per transaction, every time |

Connecting does **not** imply view access, and view access does **not** imply or waive a spend
approval. A site with view access can see *what* the account holds privately; it can never derive
the material to spend it, and it cannot read payments addressed to anyone else.

Grants are per-origin and persist in the wallet's `localStorage`. They are dropped by
`tari_disconnect`, by the user disconnecting the site (from the dApp frame's header or **Settings →
Connected dApps**), and — for view access alone — by **Revoke view**, which leaves the site
connected and working. Re-approving a connection does **not** restore a previous view grant.

---

## Connection

| Method | Params | Returns |
|---|---|---|
| `tari_getNetwork` | none | `string` — answerable with no connection, so a dApp can check the chain before prompting |
| `tari_requestAccounts` | none | `string[]` — **prompts** the first time |
| `tari_getAccounts` | none | `string[]`, `[]` when disconnected |
| `tari_getWalletAddress` | none | `string` |
| `tari_getCapabilities` | none | `Capabilities` |
| `tari_disconnect` | none | `null` |

`tari_getWalletAddress` returns the bech32m `otl_…` address — owner + view **public** keys, which is
what a stealth output's `destination` decodes as. This is what you need to pay the user *privately*.
It is not the component address `tari_requestAccounts` returns and is **not derivable** from one (a
component address is a one-way hash of the owner key and carries no view key at all). Holding it is
safe: it lets anyone pay this account privately and no one read it.

```ts
interface Capabilities {
  exactInputSelection: boolean;
  stealthWithdraw: boolean;      // withdrawStealthAndExecute
  htlcFund: boolean;
  scriptPathSpend: boolean;      // htlcClaim / htlcRefund
  privateSpend: boolean;         // shield / unshield / sendPrivately
  minimumValuePromise: boolean;  // proof-of-funds outputs
  privateBalanceView: boolean;   // can this wallet serve confidential reads at all
  privateViewGranted: boolean;   // has THIS site been granted them
  transactionResultLookup: boolean;
  transactionRequests: boolean;
  walletAddress: boolean;
  dryRunIsLocal: boolean;
}
```

---

## Reading state

| Method | Params | Returns |
|---|---|---|
| `tari_getBalances` | none | `TokenBalance[]` |
| `tari_getSubstate` | `{ substateId, version? }` | raw `Substate` |
| `tari_getTransactionResult` | `{ transactionId }` | indexer result |

Amounts are real `bigint`s, not strings: the bridge is `postMessage`, which structured-clones them,
so there is nothing for a dApp to parse back.

```ts
interface TokenBalance {
  resourceAddress: string;
  kind: string;                  // "Fungible" | "NonFungible" | "Confidential" | "Stealth"
  amount: bigint;                // public, revealed — always real
  confidentialAmount: bigint;    // 0n unless privateVisible is true
  confidentialDecryptFailures: number;
  privateVisible: boolean;
  divisibility: number;
  symbol: string | null;
  name: string | null;
}
```

> **`confidentialAmount: 0n` is not a balance.** Without view access the field is withheld, not
> measured. Branch on `privateVisible` first — reading a withheld value as "this account holds
> nothing privately" is the mistake this field exists to prevent.

---

## Private view access

| Method | Params | Returns |
|---|---|---|
| `tari_requestViewAccess` | none | `{ granted: boolean }` — **prompts**; resolves `{ granted: false }` on refusal rather than throwing |
| `tari_getViewAccess` | none | `{ granted: boolean }` — never prompts |
| `tari_revokeViewAccess` | none | `null` — idempotent, never prompts |

Requires an existing connection. Ask when a feature actually needs it, not at connect time: a prompt
the user meets in the middle of a flow they started is one they can answer. Re-check
`tari_getViewAccess` (or `capabilities.privateViewGranted`) instead of assuming a grant from earlier
still holds — the user can revoke it from the wallet at any time.

---

## Reading private state

All four require the grant above. Without it they reject with code `4100` and the message
`"No private view access — call tari_requestViewAccess first"` — deliberately distinct from the
not-connected error, so a dApp doesn't loop on the connect prompt for a user who is already
connected and simply hasn't been asked yet.

| Method | Params | Returns |
|---|---|---|
| `tari_getPrivateBalances` | none | `PrivateBalance[]` |
| `tari_getShieldedOutputs` | `{ resourceAddress? }` | `ShieldedOutput[]`, newest first |
| `tari_scanForPrivatePayments` | `{ maxPages? }` | `{ claimed, found }` |
| `tari_claimPrivatePayment` | `{ resourceAddress, commitment }` | `{ amount, memo? }` |

```ts
interface PrivateBalance {
  resourceAddress: string;
  amount: bigint;       // total unspent shielded value, raw resource units
  outputCount: number;  // how many outputs make it up — each is spent whole
  divisibility: number;
  symbol: string | null;
  name: string | null;
}

interface ShieldedOutput {
  resourceAddress: string;
  commitment: string;   // 32-byte Pedersen commitment, hex — public on-chain data
  amount: string;
  transactionId: string;
  createdAt: number;
  memo?: string;
}
```

`tari_getPrivateBalances` is the authoritative "what can be spent privately right now": it is
exactly the set of outputs the wallet's own coin selection draws from. It differs from
`TokenBalance.confidentialAmount` on purpose — that also folds in a Confidential *vault*'s decrypted
commitments, whereas this counts the freestanding `utxo_{resource}_{commitment}` substates a shield
or private send actually creates. A resource can have a real private balance and no on-chain vault
at all.

`outputCount` is not decoration: each output is spent whole, so a balance of 100 held as one output
and as fifty are very different things to a caller planning a spend.

`tari_scanForPrivatePayments` costs real network round trips (it walks transaction pages). Treat it
as a user-initiated refresh, not a poll.

Neither read ever exposes a blinding mask, a key id, or the view secret.

---

## Transactions

| Method | Params | Returns |
|---|---|---|
| `tari_createTransactionRequest` | an operation (below) | `{ requestId }` — **prompts**, without blocking on it |
| `tari_getTransactionRequest` | `{ requestId }` | `TransactionRequestSummary` |
| `tari_submitTransactionRequest` | `{ requestId }` | the operation's result |

`create` returns a `requestId` the instant the request exists, without waiting on the human. A dApp
that reloads its iframe mid-approval can poll by id and pick the flow back up; a single blocking
call loses the outcome entirely. Poll `tari_getTransactionRequest` until `status` is `"approved"`,
then submit. `window.tari.requestTransaction(operation)` does the whole cycle for you when the page
is happy to stay alive for it.

Submission is claimed atomically before anything executes, so two racing submits over one request
cannot both go through — exactly one wins and the other is told the status is wrong.

Requests live in the wallet page's memory, not storage. They survive every dApp-side reload and are
lost only when the **wallet** is closed, which ends the session anyway. An unknown `requestId` after
a wallet reload means gone, not pending. Requests are also dropped when the site is disconnected, so
an approval cannot be carried across a reconnect.

```ts
interface TransactionRequestSummary {
  requestId: string;
  status: "pending" | "approved" | "submitting" | "submitted" | "rejected" | "failed";
  note: string;       // the same lines shown on the approval dialog
  createdAt: number;
  expiresAt: number;  // 15 minutes; expiry is derived on read
  result?: unknown;
  error?: string;
}
```

### Operations

```ts
type Operation =
  | { kind: "instructions"; instructions: Instruction[]; maxFee?: string; inputs?: SubstateRequirement[] }
  | { kind: "withdrawStealthAndExecute"; resourceAddress: string; amount: string;
      workspaceVarName: string; followUpInstructions: Instruction[];
      relatedComponents?: string[]; maxFee?: string }
  | { kind: "shield";   resourceAddress: string; amount: string; maxFee?: string; memo?: string;
      minimumValuePromise?: string }                       // see "Proof of funds" below
  | { kind: "unshield"; resourceAddress: string; revealedAmount: string; maxFee?: string; memo?: string }
  | { kind: "sendPrivately"; resourceAddress: string; recipientWalletAddress: string;
      amount: string; maxFee?: string; memo?: string;
      minimumValuePromise?: string }                       // applies to the recipient's output
  | { kind: "htlcFund"; resourceAddress: string; amount: string; claimantWalletAddress: string;
      hashLockHex: string; refundEpoch: string; maxFee?: string }
  | { kind: "htlcClaim";  resourceAddress: string; commitment: string; conditions: object[];
      preimageHex: string; maxFee?: string }
  | { kind: "htlcRefund"; resourceAddress: string; commitment: string; conditions: object[];
      amount: string; outputMask: string; maxFee?: string };
```

| Kind | Moves | Result |
|---|---|---|
| `shield` | public → private, same account | `{ transactionId, commitment, substateId, minimumValuePromise }` |
| `unshield` | private → public, same account | `{ transactionId }` |
| `sendPrivately` | private → private, to another wallet address | `{ transactionId, recipientCommitment, recipientSubstateId, minimumValuePromise }` |
| `htlcFund` | public → HTLC-locked private output | `{ transactionId, conditions, ownCommitment, outputMask }` |
| `htlcClaim` | HTLC-locked → your private balance (reveals the preimage) | `{ transactionId }` |
| `htlcRefund` | HTLC you funded → back to your private balance | `{ transactionId }` |

Things that will bite otherwise:

- **You cannot build a stealth transfer yourself.** A raw `StealthTransfer` passed as
  `{ kind: "instructions" }` needs a balance proof and per-input one-time authorizations only the
  wallet's signer can produce. These kinds exist precisely so you can ask for one without ever
  holding the material to make one.
- **You don't choose which UTXOs get spent.** Coin selection (largest-first, across several outputs
  where needed) is the wallet's decision from its local ledger. You supply an amount.
- **`sendPrivately`'s `recipientCommitment` must reach the recipient out of band.** No
  scan-by-view-key API exists for a specific counterparty, so a payment whose commitment you drop is
  invisible to them even though it landed on-chain. They redeem it with `tari_claimPrivatePayment`.
- **Persist `htlcFund`'s `outputMask` and `amount`.** The output is addressed to the *claimant*, so
  the funder cannot decrypt it — without those retained from funding time, `htlcRefund` has no
  recovery path at all.
- **`htlcClaim`/`htlcRefund` need the full `conditions` tree** the funder produced. Only its root is
  committed on-chain, so it cannot be recovered from the chain. Pass it through unchanged.
- **`unshield` makes an amount publicly visible, permanently.** The approval dialog says so; your
  own UI should too.

---

## Proof of funds

`shield` and `sendPrivately` accept a `minimumValuePromise` — a public claim, committed into the new
output's own range proof, that it is worth **at least** that much.

A confidential output normally proves `0 ≤ v < 2^64`, hiding `v` completely. With a promise `m` the
proof instead attests `m ≤ v < 2^64`, and `m` is stored in the clear as the output's
`minimum_value_promise`. The output becomes a self-contained proof of funds.

```js
// Prove the wallet can cover 100000, without revealing what it actually holds.
const proof = await window.tari.proveFunds(resourceAddress, "100000");
// -> { transactionId, commitment, substateId, minimumValuePromise }

// Share proof.substateId. Anyone verifies it — no cooperation from the wallet, no signature,
// no live session, just the chain:
const { ok, minimumValuePromise, meets } = await window.tari.verifyFunds(proof.substateId, "100000");
```

`proveFunds` is sugar over `{ kind: "shield", …, minimumValuePromise }`; `verifyFunds` is sugar over
`tari_getSubstate`. Both are ordinary calls you can make yourself, and verification needs no
permission beyond a connection because the data is public on-chain.

**Three properties to design around:**

1. **Non-interactive and permanent, in both directions.** A verifier needs nothing from the prover.
   Equally, the disclosure is permanent and visible to *everyone* — not only to whoever the proof was
   made for. Shielding is how value stops being publicly visible; a promise puts a floor back on
   public view for the life of the output. The approval dialog states this outright, and your UI
   should too.
2. **It proves one output, not a balance.** "This output is worth ≥ m", not "this account holds ≥ m".
   To prove total spending power, shield the whole amount into a single output and promise against
   that. `tari_getPrivateBalances`' `outputCount` shows how funds are currently split.
3. **Spending the output destroys the proof.** That is the correct semantics — a proof of funds
   *should* stop verifying once the funds move — but it means a verifier must re-check that the
   substate is still unspent at the moment they care. `verifyFunds` returns `ok: false` for a spent
   or missing output precisely so this case is hard to skip. Anything you build on this should carry
   its own expiry and re-verify at view time; a proof that verified yesterday says nothing about
   today.

`minimumValuePromise` must not exceed the output's own `amount` — a range proof asserting "at least
m" is impossible for an output actually worth less, and is refused before anything is signed.

On `sendPrivately` the promise applies to the **recipient's** output only, never your change; putting
one on change would publish a floor on your own remaining private balance, which nobody asked for.

### `tari_signAndSubmitTransaction`

Still supported. `dryRun: true` is a direct call that never prompts and spends nothing — safe to
run on every keystroke for a live quote. A real submission prompts, every time.

---

## Security notes

- Messages are checked on **both** `event.source` and `event.origin`. The frame is cross-origin, and
  that isolation — not the `sandbox` attribute — is what stops a dApp reading the wallet's storage
  where the enciphered seed lives.
- Replies are posted to the dApp's exact origin, never `"*"`, so a response carrying balance data
  cannot be read by whatever occupies the frame if it navigates mid-request.
- Approval dialogs are drawn in the wallet's own chrome, outside the iframe. A dApp cannot paint
  there, so it cannot fake or cover a prompt.
- Approval prompts are serialized. Two outstanding requests queue rather than overwrite, so a user
  is never approving one thing while reading another.
- The wallet describes every request from the request itself, never from anything the dApp says
  about it.
