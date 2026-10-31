# GGBP-1 v3 / Ghost Gate integration handoff

> **Status: experimental and disabled.** This wallet reports `ggbp1BalanceProof: false` and has no
> GGBP-1 method. Nothing in this document is implemented in Web Tari Universe, and nothing here
> authorizes any access. **A cryptographically valid GGBP1R v3 response does not show that anyone
> holds spendable Tari outputs.** Real wallet signing and production chain authorization are
> separate security gates. Neither is opened by this document.

This handoff covers **only** the hardened GGBP-1 **v3** protocol (`GGBP1R`, wire version `0x03`).

**GGBP-1 v2 is prohibited.** Its historical prover accepted caller-controlled randomness, so cloned
RNG state reused Schnorr nonces (audit finding H-1). It also did not bind the Bulletproofs+ bytes to
the signatures (M-1). This wallet must never implement, sign, produce or accept v2 in any form. A v2
or v1 response must be rejected as `UnsupportedWireVersion`.

## Sources reviewed

| Item | Revision |
| --- | --- |
| Web TU base (`chironbuilds/tari-l1-wallet-ui` `master`) | `3ee0a3172b62a9eed92661ae6e7b9ef170be2e24` |
| v3 reference implementation (`GSXRspartan/ggbp1-v3-external-review`) | `2ff24577603002e294d89bc604b889db0380a728` |
| v3 core source `ggbp1-v3-review/src/lib.rs` | SHA-256 `01f4ccad3885e5984d7aff68646aa54c2282a84cb86817650903bbda6bbfeb69` |
| Normative v3 documents | `V3_PROTOCOL.md`, `CHAIN_BOUNDARY.md`, `AUTHORIZATION_BOUNDARY.md`, `OUTPUT_USE_POLICY.md` in that repository |

The rest of this document is drawn from the Rust source. Where the prose and the source could differ,
the source wins.

## Security status

- **Experimental.** v3 passed an independent remediation review, which found that the hedged-nonce
  construction and the proof-byte binding fix H-1 and M-1 *within that crate*. That review is not a
  formal proof, not a production certification and not approval for wallet integration.
- **Synthetic only.** The v3 package proves and verifies in-memory fixtures. It opens no wallet,
  reads no chain and has no authorization result type.
- **No Web TU prover exists.** See [Missing wallet-owned prover](#missing-wallet-owned-prover).
- **No chain verifier exists.** See [Current chain-verification limitations](#current-chain-verification-limitations).

## What a valid v3 proof establishes

Given the records it carries, and the Tari default Pedersen generator assumption it pins, a valid
v3 response establishes only this conditional statement:

1. For each record `i`, someone who knows the discrete log of `script_public_key_i` signed the
   complete transcript, the record's index and the aggregate-proof hash.
2. The holder of `subject_authentication_public_key` signed the same transcript.
3. The public `aggregate_commitment` equals the sum of the per-record commitments.
4. Bulletproofs+ shows the committed aggregate value `v` satisfies
   `threshold <= v < threshold + 2^64`.

It does **not** establish that the records are real Tari outputs, that they are on the canonical
chain, that they are unspent, mature or unencumbered, that the prover's wallet owns them, that the
challenge is fresh, or that it has not been replayed. A response can carry made-up output hashes,
commitments and keys. The v3 regression test
`v3_crypto_verification_of_a_fabricated_fixture_is_not_chain_evidence` proves and verifies a
made-up 10^15 µT fixture on purpose, to show this.

## Wire format (version `0x03`)

All integers are little-endian. Sizes are in bytes. The parser is exact: it rejects trailing bytes,
a length mismatch, non-canonical points or scalars, and any version byte other than `0x03`.

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 6 | magic `"GGBP1R"` |
| 6 | 1 | wire version, must be `0x03` |
| 7 | 1 | `network` |
| 8 | 32 | `genesis_hash` |
| 40 | 32 | `origin_hash` |
| 72 | 16 | `gate_id` |
| 88 | 8 | `gate_configuration_version` (u64) |
| 96 | 16 | `subject_id` |
| 112 | 32 | `subject_authentication_public_key` (canonical Ristretto, not identity) |
| 144 | 8 | `threshold_micro_xtm` (u64, nonzero) |
| 152 | 32 | `nonce` |
| 184 | 8 | `expires_at_unix_seconds` (u64; serialized and signed, never clock-checked by the verifier) |
| 192 | 32 | `commitment_generator_fingerprint` |
| 224 | 1 | `output_count`, 1..=16 |
| 225 | 193 × n | records, see below, in strictly ascending `output_hash` order |
| … | 64 | subject signature: public nonce `R` (32) ‖ scalar `s` (32) |
| … | 32 | `aggregate_commitment` |
| … | 2 | `proof_len` (u16, ≤ 8192, must equal the remaining bytes) |
| … | `proof_len` | `rho`: Tari extended Bulletproofs+ aggregate-minimum proof |

Each 193-byte record is `output_hash (32) ‖ commitment (32) ‖ script (33) ‖ script_public_key (32) ‖
authority signature R (32) ‖ s (32)`. The script must be exactly
`push_pubkey_script(script_public_key)`: opcode `0x7e` (`PushPubKey`) followed by the same 32-byte
key. No other script is accepted. The identity key is rejected for both the subject key and the
script keys.

A one-output response from the fixed corpus is 1,093 bytes, carrying a 577-byte `rho`. The largest
response the grammar allows is 11,603 bytes. (Reviewer note: the reference `maximum_wire_size()`
pre-parse cap computes 11,635, which is 32 bytes looser than the grammar. That is harmless, because
the exact parser rejects any surplus, but the cap does not match the grammar exactly.)

The commitment-generator fingerprint is
`SHA-256("GGBP1 tari default extended Pedersen generators v1" ‖ commit(mask=1, v=0) ‖ commit(mask=0, v=1))`
computed with Tari's `ExtendedPedersenCommitmentFactory::default()`. A response that carries any
other value is rejected before any commitment arithmetic.

## Canonical signed transcript

Let `‖` be byte concatenation and `u8(i)` a single index byte.

```text
challenge_message = "GGBP1" ‖ 0x03 ‖ network ‖ genesis_hash ‖ origin_hash ‖ gate_id
                  ‖ le64(gate_configuration_version) ‖ subject_id ‖ subject_authentication_public_key
                  ‖ le64(threshold_micro_xtm) ‖ nonce ‖ le64(expires_at_unix_seconds)
                  ‖ commitment_generator_fingerprint ‖ u8(n) ‖ output_hash_0 ‖ … ‖ output_hash_{n-1}

R  = "GGBP1/output-transcript" ‖ challenge_message ‖ u8(n)
     ‖ for i in 0..n: u8(i) ‖ output_hash_i ‖ commitment_i ‖ script_i(33) ‖ script_public_key_i
```

Output hashes must be strictly ascending, which rules out duplicates. All four public fields of every
record are signed. The aggregate commitment is never a substitute for an individual commitment.

## Proof-hash signature binding (M-1 remediation)

The prover builds `rho` first, then:

```text
proof_hash = SHA-256("GGBP1V3/aggregate-minimum-proof" ‖ rho)
T3         = "GGBP1V3/proof-binding" ‖ R ‖ proof_hash

authority_message_i = "GGBP1/output-authority" ‖ u8(i) ‖ T3
subject_message     = "GGBP1/subject-binding"  ‖ T3
```

Authority signatures are Tari `RistrettoSchnorrWithDomain` over the dedicated hash domain
`com.ghost-gate.ggbp1.balance_proof` v1. The subject signature uses
`com.ghost-gate.ggbp1.subject_binding` v1. Neither is Tari's script (`CheckSigHashDomain`),
transaction, metadata or wallet-message signing domain, so a GGBP-1 signature cannot be replayed
as a spend authorization, and the reverse is also true. Moving `rho` from one session to another,
or re-pairing it under a changed threshold, invalidates every signature.
`v3_rejects_range_proof_transplant_between_sessions` and the `bp_only_negative.hex` vector cover
this. That vector has validly re-signed outer signatures and must still fail at Bulletproofs+ as
`InvalidMinimumProof`.

## Aggregate commitment verification

`verify_synthetic` runs in this order. It stops at the first failure.

1. Validate the challenge: the threshold is nonzero, the subject key is not identity, and the
   generator fingerprint matches.
2. Rebuild `R` (canonical ordering, exact script per record) and `T3` from the received `rho`.
3. There is exactly one authority signature per record, and `proof_len` ≤ 8192.
4. For each record, check the exact `PushPubKey` script, then verify `authority_message_i` under
   `script_public_key_i`.
5. Verify `subject_message` under the challenge's subject key.
6. Check that `Σ commitment_i == aggregate_commitment`.
7. Run Bulletproofs+ `verify_batch` with
   `BulletproofsPlusService::init(64, 1, ExtendedPedersenCommitmentFactory::default())` on
   statement `{commitment: aggregate_commitment, minimum_value_promise: threshold}`.

The verifier is clock-free. It never compares `expires_at_unix_seconds` to a clock and never
consults chain state.

## Hedged Schnorr nonce construction (H-1 remediation)

The prover computes this inside itself. The proof bytes cannot show whether it was followed, so a
wallet prover must reproduce it exactly inside its own key boundary and pass the known-answer test
before use. For each authority signature, and for the one subject signature:

```text
entropy = 32 fresh bytes from the system CSPRNG        (failure => SecureRandomnessUnavailable)
seed    = SHA-256("GGBP1V3/hedged-schnorr-nonce" ‖ role ‖ secret_key(32) ‖ signing_message ‖ entropy)
          role ∈ {"authority", "subject"}  (raw ASCII, closed internal constants)
rng     = rand 0.10.3 StdRng::from_seed(seed)            (ChaCha12)
sig     = RistrettoSchnorrWithDomain::sign(secret_key, signing_message, &mut rng)
          (tari_crypto 0.23.4 samples the nonce from 64 bytes with wide reduction)
```

The public prover takes no RNG, seed, entropy or callback argument. Before it builds `rho`, it
probes the CSPRNG and fails closed if randomness is unavailable. The KAT is: secret key `21`, role
`authority`, message `GGBP1V3 KAT authority message`, entropy `0xa5`×32 →
seed `f724062355be618d70203792abb9a20f16ed601c454c3b87821a701b9f57ac46`, public nonce
`be5c1a1f87d9548afa979104e7b848423d6149566a2afbc6a012b7f7466e2f69`. In a browser, the entropy has
to come from a trusted `crypto.getRandomValues` through the pinned `getrandom` `wasm_js` backend.
Cloned VM state, Web Crypto polyfills and custom `getrandom` backends are deployment risks.

## Real wallet output-authority requirements

None of these are met today. All of them are prerequisites. Full source references are in
[`docs/ggbp1/SCRIPT_KEY_DESIGN.md`](ggbp1/SCRIPT_KEY_DESIGN.md).

1. **Only exact `PushPubKey(K)` outputs whose `K` this wallet can sign for.** In Tari
   `v6.0.1-pre.2`, `K` is either the stealth-derived key `H_stealth(k_mask)·G + K_spend` or the
   wallet's raw spend key. `Nop`, multisig, HTLC and other explicit scripts are ineligible. The
   wallet must check that `K` matches the derived public key. Today's WASM import does not perform
   that check: it passes `None` to `find_script_key_id_from_commitment_mask_key_id`.
2. **Sign inside WASM, with the GGBP-1 domain, over an internally built message.** The script
   private key and the commitment masks never cross into JavaScript. The generic
   `WasmSchnorrSignature.sign(secret_key_hex, …)`, `WasmKeyPair.secretKeyHex`, `getBackupHex()`,
   `exportPrivateViewKeyHex()`, `commitValue`/`openValue` and the transaction builders must not be
   used, extended or composed to produce GGBP-1 material.
3. **Never sign with the raw spend key in a GGBP-1 response.** It would publish the wallet's public
   spend key, which is half of its address. Outputs whose script key is the raw spend key are
   ineligible by default.
4. **The subject key must not be a wallet spend, view or script key.** The design document
   recommends a per-origin subject key that the wallet derives itself.
5. **Software-key wallets only.** Ledger key IDs cannot expose private keys
   (`KeyManagerError::LedgerError`). Hardware wallets need firmware support and are out of scope.
6. **Disclose only confirmed, mature, unspent outputs held under a lease**, and approve them in the
   foreground (see below).

## Current chain-verification limitations

- Web TU reads L1 state from an HTTP query service (`/get_tip_info`, `/get_utxos_by_block`,
  `fetch_utxo`). Those are plain indexer responses with no proofs. They are not independent
  cryptographic evidence.
- Each Tari header commits `output_mr`, the root of a Jellyfish Merkle tree over the current
  unspent, non-burned output set, keyed by commitment, with value
  `smt_hash(output_hash, mined_height)`. **No Tari `v6.0.1-pre.2` base-node interface returns a
  membership proof against that root**, even though the `jmt 0.11.0` library can produce one
  (`get_with_proof`). The only output proof the node exposes is `generate_burn_output_proof`, an
  MMR inclusion proof restricted to burn outputs.
- So today, "current unspent" can only be asserted by a trusted node. The relying party has to
  operate, or explicitly trust, that node. A verifier design that separates cryptographic
  authentication from trust assumptions is in
  [`docs/ggbp1/CHAIN_VERIFIER_DESIGN.md`](ggbp1/CHAIN_VERIFIER_DESIGN.md).

## Output hash linkability

Every record publishes the output's on-chain `output_hash`, `commitment`, `script` and
`script_public_key`. A gate, and anyone the gate shares the response with, can therefore:

- find those exact UTXOs on chain, with their mined height, block and later spend;
- link every output in one response as having a common owner, which a one-sided stealth payment
  otherwise hides;
- link repeated proofs that reuse an output, across sessions and across unrelated gates;
- with a raw-spend-key script, link the response to the wallet's address.

v3 offers no unlinkability, and threshold choice alone can leak balance information through
probing. Thresholds must come from server-issued gate configuration, never from dApp input. The
wallet should rate-limit requests and give the dApp uniform failures that never reveal
`InsufficientEligibleValue`. The approval view must name each output that will be disclosed.

## Missing wallet-owned prover

- `vendor/tari-l1-wasm` (package version `6.0.1-pre.2`; its README still says it was built against
  Tari `v5.6.0-pre.1`) exposes no GGBP-1 function.
- The v3 reference crate pins `tari_crypto 0.23.4` and `tari_script 6.0.1-pre.2` and builds only a
  **verifier-only** WASM harness. Its prover has never been built for, or run in, a browser.
- A prover needs a new Rust function inside `tari_l1_wasm` that reads `WalletOutput` key IDs,
  derives keys through `KeyManager`, builds `rho` from the summed masks, computes `T3` and signs
  with the GGBP-1 domains, returning only the canonical response bytes. That function does not
  exist.

## Proposed transport (not implemented, not exposed)

Recorded so it can be reviewed. It must not be added to `BridgeMethod`, `public/tari-connector.js`
or `capabilitiesFor` until every gate below has passed.

```ts
// Future shape only. Today the capability is the literal `false`.
type Ggbp1V3Capability = {
  protocolVersion: 3;          // never 2
  network: "esmeralda";        // first live target; the network byte and genesis hash are mandatory
  maxOutputs: 16;
  maxProofBytes: 8192;
};

// window.tari.request({ method: "tari_requestBalanceProof", params })
type Ggbp1V3Request  = { protocol: "ggbp1"; version: 3; challenge: string }; // canonical bytes, base64url, no padding
type Ggbp1V3Response = { protocol: "ggbp1"; version: 3; response: string };  // canonical GGBP1R v3 bytes
```

The dApp can never select outputs or supply callback URLs, scripts, keys, masks, values, RNG or
entropy, proof options, or a "pre-approved" flag. The wallet must recompute `origin_hash` from the
exact framed origin that `DappFrame` verified, and reject any mismatch.

## Wallet-owned sequence (design target)

1. Accept the request only from the exact HTTPS origin currently framed. Canonicalize the origin
   and compare its hash to `origin_hash`.
2. Reject if the dApp is disconnected or backgrounded, or the request is expired or malformed, or
   carries the wrong network or genesis, a zero threshold, a version other than 3, or more bytes
   than the size limit allows.
3. Inside WASM, select at most 16 eligible outputs (exact `PushPubKey` with a derived-key match,
   confirmed, mature, unspent, not reserved). Lease them atomically under a lock shared across
   tabs. Send and burn must honour that lease.
4. Show a foreground approval view: the origin, network and genesis fingerprint, gate, subject,
   threshold, expiry, every disclosed output reference, and a linkability warning. The view must
   say that nothing is sent, burned or exported.
5. On approval, re-check the lease, chain state and expiry, then produce the response inside WASM
   (hedged nonces, proof-hash binding). Return only the canonical bytes.
6. Release the lease on rejection, expiry, error or cancellation. Never persist approval or grant
   reusable signing authority.

## Relying-party (Ghost Gate) obligations

These follow `AUTHORIZATION_BOUNDARY.md` and `OUTPUT_USE_POLICY.md`. None is satisfied by the
wallet:

1. Parse with a size bound. Load the issued challenge by nonce, reject unknown nonces, and compare
   every challenge field byte-for-byte.
2. Reject expiry against authoritative server time, and check it again at grant commit.
3. Move the challenge to single-use "redeeming" atomically before doing expensive work.
4. Run the v3 verifier. Then bind every record to authenticated, current-unspent chain evidence.
   A missing check is an error, never a grant.
5. Commit output-use state, grant state and expiry atomically. Revalidate, and revoke on spend or
   reorg.

## Gates before any live disposable-wallet test

1. A reviewed `tari_l1_wasm` v3 prover that reproduces the normative nonce KAT and passes the v3
   corpus and adversarial cases in a real-browser matrix.
2. An independent chain verifier that meets `CHAIN_BOUNDARY.md`, with its trust assumptions
   written down.
3. An origin-scoped permission, foreground approval, and an output lease that holds across tabs.
4. Explicit, user-operated approval from a **disposable Esmeralda** wallet. Synthetic fixtures never
   authorize anything.

Until every gate passes, the only honest result is `UnavailableUpstreamProofApi`, and no L1 access
session may be issued.

## Related design documents

- [`docs/ggbp1/SCRIPT_KEY_DESIGN.md`](ggbp1/SCRIPT_KEY_DESIGN.md): real script-key derivation,
  output selection, the signing boundary, approval, permissions, leasing, concurrency and version
  compatibility.
- [`docs/ggbp1/CHAIN_VERIFIER_DESIGN.md`](ggbp1/CHAIN_VERIFIER_DESIGN.md): an independent L1 chain
  verifier and its trust assumptions.
- [`docs/ggbp1/BROWSER_PROVER_READINESS.md`](ggbp1/BROWSER_PROVER_READINESS.md): what was tested in
  a real browser (verifier only) and what is still missing.
