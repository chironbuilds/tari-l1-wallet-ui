# GGBP-1 v3 real-wallet script-key and signing-boundary design

> **Design only. Nothing here is implemented.** No key access, wallet signing or proof method is
> added by this document or by the change that carries it. `ggbp1BalanceProof` stays `false`.

This is the source-backed design for how Web Tari Universe could, in the future, produce a GGBP1R
**v3** response from real L1 wallet outputs without exposing secret material. GGBP-1 v2 is out of
scope and prohibited.

## Sources and pinned revisions

Every claim below cites one of these. Line numbers refer to these exact revisions.

| Tag | Source | Revision |
| --- | --- | --- |
| **WTU** | `chironbuilds/tari-l1-wallet-ui` `master` | `3ee0a3172b62a9eed92661ae6e7b9ef170be2e24` |
| **WASM** | `chironbuilds/tari-l1-wasm` (source of `vendor/tari-l1-wasm`) | `e23e4c9ea956818ae28e3b8978b8c1b2ca3cf727` |
| **T601** | `tari-project/tari` tag `v6.0.1-pre.2` | `44ffb862ee970f3bc0ff41fef362d49fdfcc8ff6` |
| **T620** | `tari-project/tari` tag `v6.2.0` | `3bcb607f1e725c50693aba381b7574dece5fd3b9` |
| **V3** | `GSXRspartan/ggbp1-v3-external-review` | `2ff24577603002e294d89bc604b889db0380a728` |

The vendored binary's provenance is not perfectly established:

- `vendor/tari-l1-wasm/package.json` says `6.0.1-pre.2`.
- `vendor/tari-l1-wasm/README.md` still tells you to build against Tari `v5.6.0-pre.1`.
- The WASM crate uses `workspace = true`, so its Tari version is whatever workspace it was built in.
- `integration.patch` applies cleanly to **T601** (`git apply --check` exit 0) and does **not**
  apply to **T620**, where `builder.rs:48` has drifted.
- The vendored `.wasm` contains the `compact-v3` build marker (WASM `wallet.rs:606-612`) and the
  error strings of `import_scanned_output`, in source order.

The most likely base is T601. That is a reasoned inference, not a reproducible-build proof. A real
prover must be built from a pinned, recorded Tari revision, with a reproducible artifact hash.

## 1. Real Tari script-key derivation

### Where the key comes from (T601)

A one-sided stealth output that pays this wallet carries `script = PushPubKey(K_s)`, built by the
sender in `transaction_builder/builder.rs:894-918` (`spec_script`, `RecipientScript::Default`). For
a Diffie-Hellman recipient, `K_s` is
`stealth_address_script_spending_key(commitment_mask_key_id, destination_spend_key)`:

```text
k_mask = commitment mask private key        (TariKeyId::DHCommitmentMask, recovered from the sender-offset DH)
h      = PrivateKey::from_uniform_bytes(
           DomainSeparatedHasher<Blake2b<U64>, KeyManagerTransactionsHashDomain>("script key")
             .chain(k_mask.as_bytes()))
K_s    = h·G + K_spend                       key_manager/manager.rs:1667-1680
k_s    = h   + k_spend                       key_manager/manager.rs:1691-1703 (TariKeyId::Derived arm)
```

The label is `HASHER_LABEL_STEALTH_KEY = "script key"` (`manager.rs:109`). The wallet represents
`k_s` as `TariKeyId::Derived { key: <mask key id> }` (`manager.rs:896-925`). The secret `k_s`
therefore depends on **both** the per-output mask and the wallet's **private spend key**. The
sender knows `k_mask` and `K_s` but cannot compute `k_s`. That is what makes a signature under
`K_s` evidence of output authority.

T620 has the same math and the same label (`manager.rs:122`). The only change is that key-ID
parsing was refactored into `parse_inner_key_id` (`manager.rs:218`).

### Script shapes a wallet output can have

`calculate_script_private_key_id` (T601 `transaction_components/wallet_output.rs:342-370`) resolves
these cases:

| Script | Script key | GGBP-1 v3 eligibility |
| --- | --- | --- |
| `PushPubKey(K)` with `K == K_s` derived as above | `TariKeyId::Derived{mask}` | **Eligible** (the normal one-sided receive case) |
| `PushPubKey(K)` with `K == K_spend` | `TariKeyId::SpendKey` | **Ineligible by default.** Signing would publish the wallet's public spend key and link the proof to the address. |
| `PushPubKey(K)` for the wallet's own change (`RecipientKeys::Own`, `builder.rs:886-889`) | `Derived{fresh random mask}` | Eligible once confirmed. Same derivation, verified the same way. |
| `Nop` | a random key is used for the input stack | **Ineligible.** v3 accepts exactly `PushPubKey`. |
| `CheckMultiSigVerify … PushPubKey` (`builder.rs:912-933`) | multisig | **Ineligible.** Spending needs other parties. |
| Any `RecipientScript::Explicit` script (HTLC, time locks, …) | n/a | **Ineligible.** |
| Burn outputs | n/a | **Ineligible.** Burned outputs are not in the UTXO set. |

v3 enforces the first column at the verifier: the script must byte-equal
`push_pubkey_script(script_public_key)`, which is 33 bytes, `0x7e ‖ K` (V3 `src/lib.rs:444-458`).

### Defect in the current import path

`WasmWallet.importScannedOutput` (WASM `wallet.rs:436-574`) passes **`None`** as the expected
public script key:

```rust
// WASM src/wallet.rs:528-532
let script_key_id = self.key_manager
    .find_script_key_id_from_commitment_mask_key_id(&mask_key_id, None)   // ← no check
    .map_err(...)?
    .unwrap_or(TariKeyId::Derived { key: mask_str });
```

With `None`, `find_script_key_id_from_commitment_mask_key_id` returns `Derived{mask}`
unconditionally (T601 `manager.rs:908-925`). The import never checks that the output's script
actually commits to `K_s`. For spending, the node catches a mismatch by rejecting the transaction.
For GGBP-1 this is not acceptable: the prover would sign with a key that does not match the
disclosed script, and the proof would fail at the verifier. Worse, a prover that trusted the
disclosed script could be tricked about which outputs it controls.

**Requirement:** a GGBP-1 prover must call
`find_script_key_id_from_commitment_mask_key_id(&mask_key_id, Some(&K_from_script))` and treat
`None` as ineligible. It must also check that `script == [PushPubKey(K)]` exactly.

## 2. Wallet-owned output selection

Selection happens **inside WASM**, over `WalletOutput`s the wallet already holds. A dApp never
names outputs.

State available today:

- **JS** (WTU `src/store.tsx:52-77`, `UtxoRecord`): `id` (= commitment hex), `valueMicro`, `kind`,
  `minedHeight`, `maturityHeight`, `pending`, `raw` (the scanned chain fields).
- **WASM handle** (WASM `wallet.rs:842-855`, `WasmWalletOutput`): `inner: WalletOutput` (value,
  mask key ID, features, script, script key ID, sender offset, metadata signature, covenant,
  encrypted data, minimum value promise), plus `chain_output_hash_hex`.

Eligibility rules (all must hold). Each one must be checked again at signing time:

1. The script is exactly `PushPubKey(K)`, and `K` re-derives as `K_s` from the held mask key ID
   (the `Some(K)` check above). `K != K_spend`.
2. `chain_output_hash_hex` is present and equals `TransactionOutput::hash()` recomputed **inside
   WASM** from the held fields (T601 `transaction_output.rs:203-219`). A handle without a chain
   hash (for example `createSelfUtxo`, WASM `wallet.rs:576-593`) is ineligible.
3. The commitment opens to `(k_mask, value)` (`KeyManager::verify_mask`, already used in
   `recover_output_keys`, WASM `wallet.rs:236-255`).
4. `OutputType` is `Standard` or `Coinbase`, never `Burn`. The covenant is empty
   (`Covenant::default()`). `minimum_value_promise` must be read. It never adds eligibility, it
   only gets reported.
5. It is confirmed: `minedHeight` is known, and `tip − minedHeight ≥` the policy's confirmation
   depth (see the chain verifier design).
6. It is mature: `features.maturity ≤ tip` (coinbase outputs get mined + 180; WTU `store.tsx:57`).
   Unknown tip → locked, matching `isLocked` (WTU `store.tsx:89-93`).
7. It is not `pending`, not spent, not leased by another request, and not an input of an
   unconfirmed send or burn.

Choose the **fewest** outputs (at most 16) whose sum reaches the threshold, favouring outputs
already disclosed to the same gate. The wallet then shows the user exactly which outputs will be
disclosed. Return a uniform failure on insufficiency: no partial sums and no
`InsufficientEligibleValue` detail to the dApp.

## 3. Wallet state the prover may read vs. secret material that stays internal

| May be read by the prover | Stays inside Rust/WASM, never crosses to JS |
| --- | --- |
| Public output fields: commitment, script, `K_s`, features, covenant, chain hash, mined height | Private spend key `k_spend` (`TariKeyId::SpendKey`) |
| Value (to select and to sum) | Private view key (today exportable via `exportPrivateViewKeyHex`, WASM `wallet.rs:332-335`; the prover must not use that path) |
| Tip height and confirmation status from the chain view | Commitment masks `k_mask` and their sum |
| Challenge fields after canonical parsing | Script private keys `k_s` |
| The framed origin `DappFrame` verified | Hedged-nonce seeds, entropy, BP+ witness bytes |
| | Seed / CipherSeed (today exportable via `getBackupHex`, WASM `wallet.rs:361-370`) |
| | Subject private key (see §4) |

The JS layer gets back **only** the canonical `GGBP1R` v3 bytes, plus a structured preview made of
public fields for the approval view.

## 4. Dedicated GGBP-1 signing boundary

### What must not be reused

These existing exports must never be used, extended or composed for GGBP-1:

- `WasmSchnorrSignature.sign(secret_key_hex, message)` (WASM `schnorr.rs:48`). It takes a raw
  secret from JS and uses a generic domain.
- `WasmKeyPair.secretKeyHex` (WASM `keys.rs:60-63`) and `fromSecretKeyHex`.
- `commitValue` / `openValue` with JS-supplied blinding factors.
- `KeyManager::sign_script_message` (T601 `manager.rs:1432-1447`, `CheckSigSchnorrSignature`).
  That is the script-spend domain. Using it would turn a GGBP-1 approval into a spend-authorizing
  signature.
- `sign_message_with_spend_key` (T601 `manager.rs:1401-1430`, `WalletMessageSigningDomain`).
- `WasmTxBuilder` / `WasmBurnBuilder`.

### Proposed Rust surface (inside `tari_l1_wasm`, not exported as primitives)

```rust
// Exposed to JS: exactly one pair of opaque, single-use operations.
#[wasm_bindgen] fn ggbp1_v3_prepare(wallet: &WasmWallet, framed_origin: &str, challenge: &[u8],
                                    chain_view: &AuthenticatedChainView) -> Result<Ggbp1Prepared, JsValue>;
//   -> parses the challenge (version 3 only), checks network/genesis/origin_hash/threshold/expiry,
//      selects and leases outputs, returns an opaque handle + a public preview.
#[wasm_bindgen] fn ggbp1_v3_approve(prepared: Ggbp1Prepared, decision: ForegroundDecision)
                                    -> Result<Vec<u8>, JsValue>;
//   -> re-checks the lease and chain view, then, entirely internally:
//      k_s_i  = key_manager.get_private_key(Derived{mask_i})      (after the Some(K_i) check)
//      k_agg  = Σ k_mask_i ;  v = Σ value_i  (checked add)
//      rho    = BP+ extended proof (v, k_agg, min = threshold)       (BulletproofsPlusService::init(64,1,default))
//      T3     = "GGBP1V3/proof-binding" ‖ R ‖ SHA-256("GGBP1V3/aggregate-minimum-proof" ‖ rho)
//      sig_i  = RistrettoSchnorrWithDomain<"com.ghost-gate.ggbp1.balance_proof",1>
//                 .sign(k_s_i, "GGBP1/output-authority" ‖ i ‖ T3, hedged_rng(k_s_i, "authority", msg))
//      sig_s  = …subject_binding… with the per-origin subject key
//   -> returns canonical GGBP1R v3 bytes and nothing else; consumes the handle.
```

Required properties:

- **No caller RNG or entropy.** The hedged-nonce construction is reproduced byte-for-byte from
  `V3_PROTOCOL.md` (V3 `src/lib.rs:515-557`) and pinned by the KAT. The CSPRNG is probed before
  BP+, so the call fails closed.
- **No caller-chosen message.** Every signed byte string is built inside the function from the
  parsed challenge and the selected outputs. There is no "sign these bytes" entry point. That is
  what keeps it from being a generic GGBP signing oracle.
- **`Ggbp1Prepared` is single-use and short-lived.** Dropping it releases the lease.
- **Software wallets only.** Ledger key IDs return `KeyManagerError::LedgerError("Cannot access
  ledger private keys")` (T601 `manager.rs:1718-1720`). A hardware path needs firmware support for
  the GGBP-1 domain and is out of scope.
- **View-only wallets** (`WalletType::ViewWallet`, WASM `wallet.rs:348-359`) are rejected up front.

### Subject key

The v3 subject signature needs `subject_authentication_public_key`'s secret when the response is
built. Options:

- **(Recommended)** The wallet derives a **per-origin subject key**,
  `k_sub = H_dom("ggbp1-v3/subject" ‖ canonical_origin)(wallet secret)`, from a dedicated derivation
  branch. It is never the spend, view or a script key. The dApp learns `K_sub` through a separate,
  approved registration step. It cannot be linked across origins.
- Have Ghost Gate hold the subject key. That would need a two-phase protocol, because the subject
  signs `T3`, which depends on `rho`. That is a **v3 wire change** and out of scope here.

Never accept a subject secret from the dApp.

## 5. Foreground user approval

Reuse the existing wallet-chrome approval queue in `DappFrame` (`askUser`, WTU
`src/components/DappFrame.tsx`; exact origin and source checks at `:270-287`). The GGBP-1 view must
render from `ggbp1_v3_prepare`'s **public preview**, never from dApp-supplied text, consistent with
`describeRequest` (WTU `src/lib/dappBridge.ts`, "Built from the request itself"). It must show:

- the canonical origin, plus the network name and genesis fingerprint;
- the gate ID and configuration version, the subject ID, the threshold in XTM, and the expiry as
  local time with a countdown;
- every disclosed output (short commitment and output hash, mined height), the count, and their sum
  shown only as "≥ threshold";
- a linkability warning: "These outputs become identifiable to this site and anyone it shares the
  proof with";
- a statement that nothing is sent, burned, locked on chain or exported;
- a request fingerprint, the first bytes of `SHA-256(challenge)`.

Rules:

- Approval requires the page to be visible (`document.visibilityState === "visible"`) and the PIN
  lock to be open (WTU `src/lib/pinLock.ts`, `LockScreen`).
- No approval is remembered and there is no "always allow". A backgrounded tab cancels.

## 6. Origin-specific dApp permissions

- Keep the exact-origin model already in place. The connector posts only to known wallet origins
  and accepts replies only from `event.origin === parentOrigin` (WTU `public/tari-connector.js`),
  and the bridge compares source and origin.
- Add a per-origin **GGBP-1 grant**, separate from `connected` and from the Ootle view grant
  (`hasViewAccess`, WTU `dappBridge.ts:145`). The grant allows a dApp to *ask*. It never
  pre-approves a proof.
- Recompute `origin_hash` from the canonical framed origin inside WASM and reject any mismatch with
  the challenge.
- Apply per-origin rate limits (for example one pending request, and N per hour) to blunt threshold
  probing.

## 7. Atomic output reservation

The current send and burn flows have no reservation:

- `SendPanel` filters `isSpendable` and passes handles straight to `WasmTxBuilder.addInput` (WTU
  `src/components/SendPanel.tsx:65-90`).
- `BurnPanel` does the same (WTU `src/components/BurnPanel.tsx:96-99`).
- Handles are dropped only *after* broadcast, in `spendInputs` (WTU `src/store.tsx:1004-1040`).

Design:

- A **lease table** keyed by commitment, in memory and mirrored to `sessionStorage`:
  `{commitment → {requestId, origin, expiresAt, purpose: "ggbp1" | "send" | "burn"}}`.
- Acquire leases **all-or-nothing** inside a Web Locks critical section
  (`navigator.locks.request("tari-l1-outputs", …)`). The app uses no Web Locks today. Cross-tab
  coordination is currently a `storage`-event reload on network change only (WTU
  `src/store.tsx:666-677`).
- The GGBP-1 lease TTL is no longer than the challenge expiry, and released on any terminal state.
  Startup never restores a GGBP-1 lease.
- Send and burn selection must exclude leased outputs and must take a "send"/"burn" lease before
  building, so a GGBP-1 proof can never disclose an input a pending transaction is spending.

## 8. Send and burn conflicts

| Situation | Rule |
| --- | --- |
| Output leased for GGBP-1, user starts a send | Exclude it from selection. If the user needs it, the send UI offers to cancel the GGBP-1 request first. |
| Output in a broadcast but unconfirmed send or burn | Ineligible for GGBP-1 (rule 7) until the scanner confirms the spend or the transaction fails. |
| Output spent after a proof was issued | Expected. A proof is a point-in-time statement. The relying party must revalidate and revoke (see the chain verifier design). The wallet does **not** freeze funds after proving. |
| Burn of a disclosed output | Allowed after the lease ends. The gate sees the spend at its next revalidation. |

## 9. Browser concurrency

- **Multiple tabs on one wallet:** coordinate the lease table and the "one pending GGBP-1 request
  per origin" rule with Web Locks. A `storage` event is not a lock.
- **Scan worker** (WTU `src/lib/scan-worker.ts`): it imports outputs. The prover must take a
  snapshot of eligible handles under the lock, then revalidate before signing.
- **Re-entrancy:** `ggbp1_v3_approve` consumes its handle, so a second approve for the same
  preparation fails.
- **WASM memory:** `WasmWalletOutput` handles must be freed exactly once. The prover borrows them
  and never frees them (see the existing leak fix in commit `a8435ee`).

## 10. Missing WASM functions

To exist inside `tari_l1_wasm` (none do today):

1. A strict import mode that passes `Some(K)` (§1), or a separate `isGgbp1Eligible(handle)` that
   performs the §2 checks internally.
2. `WalletOutput → TransactionOutput` hash recomputation for an eligibility check, with no new
   public field exposed.
3. `ggbp1_v3_prepare` / `ggbp1_v3_approve` as above, plus a parse-only `ggbp1_v3_parse_challenge`.
4. Subject key derivation for each origin, returning the public key only.
5. A verifier export for local self-checking: the v3 `verify_synthetic` logic, already shown to run
   in real Chromium (see `BROWSER_PROVER_READINESS.md`).
6. Build configuration: `getrandom 0.4` `wasm_js` is already set by `integration.patch`
   (`.cargo/config.toml`) and WASM `Cargo.toml`. The prover must not add any other entropy backend.

## 11. Tari version compatibility

| Item | v3 reference | T601 (likely vendored base) | T620 (latest tag) |
| --- | --- | --- | --- |
| `tari_crypto` | `=0.23.4` | `0.23.4` | **`0.24`** |
| `tari_script` | `=6.0.1-pre.2` (crates.io) | `6.0.1-pre.2` (path) | `6.2.0` (path) |
| `rand` | `=0.10.3` | `0.10.1` (workspace) | `0.10.1` (workspace) |
| `tari_bulletproofs_plus` (lock) | `0.5.3` | (via `tari_crypto`) | (via `tari_crypto`) |
| Script-key derivation | n/a (fixtures use raw keys) | `manager.rs:1691-1703` | identical math, refactored parse |
| `TransactionOutput::hash` / `smt_hash` | opaque 32 B | `transaction_output.rs:203-229` | identical |
| `integration.patch` | n/a | applies | **does not apply** |

Implications:

- A prover built in a T601 workspace can share v3's exact `tari_crypto 0.23.4`. Rebasing onto T620
  or later requires re-pinning, re-running the hedged-nonce KAT (it depends on
  `RistrettoSecretKey::random`'s 64-byte wide reduction and on `rand`'s `StdRng`), and re-checking
  BP+ proof compatibility and the commitment-generator fingerprint.
- `rand` must resolve to the exact version the KAT was generated with (`0.10.3`). A workspace that
  resolves a different `rand`/ChaCha must re-derive and re-check the KAT.
- Do not assume the native Tari wallet and Web TU's WASM are equivalent. The WASM crate carries two
  local edits to `tari_transaction_components` (`integration.patch`) and its own `KeyManager` setup.
