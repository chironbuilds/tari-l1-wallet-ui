# GGBP-1 v3 independent L1 chain-verifier design

> **Design only. No chain verifier exists in Web TU, in the v3 package or in Ghost Gate.** A v3
> response that verifies cryptographically, without the evidence below, must produce **no** grant.
> A missing or failed check is an error, never a positive outcome (`CHAIN_BOUNDARY.md`).

This document turns the v3 `CHAIN_BOUNDARY.md` requirements into a concrete verifier design
against the real Tari chain interfaces. It keeps two things apart throughout:

- **Cryptographically authenticated** evidence: checkable by the verifier from data a node cannot
  forge without breaking a hash, a signature or proof-of-work.
- **Trust assumptions**: statements the verifier accepts because a node it operates, or chooses to
  trust, says so.

A plain indexer or query-service response (for example `/get_utxos_by_block`, `fetch_utxo` or
`get_tip_info`, as Web TU uses today in `src/lib/rpc.ts`) is a trust assumption. It is never
independent cryptographic evidence.

## Sources

| Tag | Source | Revision |
| --- | --- | --- |
| **T601** | `tari-project/tari` `v6.0.1-pre.2` | `44ffb862ee970f3bc0ff41fef362d49fdfcc8ff6` |
| **T620** | `tari-project/tari` `v6.2.0` | `3bcb607f1e725c50693aba381b7574dece5fd3b9` |
| **JMT** | crate `jmt 0.11.0` (Tari `base_layer/core/Cargo.toml`) | crates.io |
| **V3** | `GSXRspartan/ggbp1-v3-external-review` | `2ff24577603002e294d89bc604b889db0380a728` |

## What Tari commits to, from source

| Fact | Source (T601) |
| --- | --- |
| The header PoW is over `mining_hash`, which chains `prev_hash`, `height`, `timestamp`, `input_mr`, **`output_mr`**, `output_smt_size`, `block_output_mr`, `kernel_mr`, … | `base_layer/node_components/src/blocks/block_header.rs` `mining_hash()`; `hash()` = H(`mining_hash` ‖ `pow` ‖ `nonce`) at `:148-154` |
| `output_mr` is the root of a **Jellyfish Merkle tree over the current unspent set**: key = output **commitment** (32 B); value = `smt_hash(output_hash, mined_height)`; burned outputs are never inserted; each block input deletes its key | `base_layer/core/src/chain_storage/blockchain_database.rs:2425-2516` (`calculate_mmr_roots`) |
| `smt_hash = H_TransactionHashDomain("smt_hash", output_hash, mined_height)` | `transaction_components/src/transaction_components/transaction_output.rs:221-229` |
| `output_hash = TransactionOutput::hash()` over version, features, commitment, range-proof hash, script, sender offset, metadata signature, covenant, encrypted data, minimum value promise | `transaction_output.rs:203-219`, `transaction_components/mod.rs:109` (`hash_output`) |
| PoW algorithms: `RandomXM`, `Sha3x`, `RandomXT`, `Cuckaroo` | `transaction_components/src/tari_proof_of_work/proof_of_work_algorithm.rs:35-40` |
| Output types: `Standard`, `Coinbase`, `Burn`, `ValidatorNodeRegistration`, `CodeTemplateRegistration`, `SidechainCheckpoint` | `transaction_components/src/transaction_components/output_type.rs:49-62` |
| The node keeps **only the current JMT version**: stale nodes are cleaned on every write | `base_layer/core/src/chain_storage/lmdb_db/lmdb_db.rs:1969, 2286, 2730` (`cleanup_stale`), `:3071-3081` (`create_smt_reader` reads a single `JMTVersion`) |
| `jmt 0.11.0` *can* produce membership and non-membership proofs | `jmt-0.11.0/src/tree.rs:1006` `JellyfishMerkleTree::get_with_proof(key, version) -> (Option<Value>, SparseMerkleProof)` |
| The only output proof the node serves is **burn-only**: an MMR inclusion proof against `block_output_mr` | `blockchain_database.rs:2276-2376` `generate_burn_output_proof`; `base_node/rpc/mod.rs:96`; `wallet.proto:2677-2685` |

Hashing and output-hash logic is unchanged in T620. T620 adds no UTXO-proof RPC either. The only
`MmrInclusionProof` in its protos is the burn one.

## Precisely missing Tari mechanisms

1. **No UTXO-set membership proof is exposed.** None of these calls `get_with_proof` on the output
   JMT:
   - the gRPC `BaseNode` service (`applications/minotari_app_grpc/proto/base_node.proto`);
   - the `t/bnwallet/1` `BaseNodeWalletService` (`base_node/rpc/mod.rs:106-170`);
   - the HTTP query service trait `BaseNodeWalletQueryService` (`base_node/rpc/mod.rs:55-104`).

   Spent status comes only as node assertions: `utxo_query`, `query_deleted` /
   `get_utxos_deleted_info`, and `fetch_outputs_with_spend_status_at_tip`
   (`blockchain_database.rs:1362-1394`, which uses `smt.get`, not `get_with_proof`).
2. **No historical JMT versions.** Stale-node cleanup means that even a new proof RPC could only
   prove against the **current tip's** `output_mr`. "Unspent at height h < tip" cannot be proven
   after the fact.
3. **No light-client header verifier.** Checking headers without a full node needs every PoW
   algorithm, including RandomX, which in light mode still needs about 256 MiB and is slow. It also
   needs per-algorithm LWMA target difficulty and accumulated-difficulty fork choice. No
   browser-suitable or standalone library for this exists in the reviewed sources.
4. **The query service omits the output hash** in `get_utxos_by_block` (noted in Web TU
   `src/lib/rpc.ts:552-560`). The verifier has to fetch by hash and recompute the hash locally.

Until (1) exists, **"current unspent" is a trust assumption in a node.**

## Who operates the verifier

The **relying party (Ghost Gate), on its own infrastructure.** Never the wallet, the dApp frontend
or a third-party indexer.

- It runs a **self-operated, fully validating Minotari base node** for the configured network,
  synced from genesis or from a pinned, reviewed checkpoint. Validation must stay fully enabled,
  and the node must not accept chain state from peers on trust.
- The verifier service talks only to that node, over an authenticated local channel.
- Optional hardening: a second node with independently chosen peers. Grant only if both agree on
  the tip hash, header and output state. This narrows, but does not remove, the trust in node
  software and in the eclipse resistance of the peer set.

Trust statement to publish with any deployment: *"Current-unspent and canonical-chain status is
asserted by base node(s) operated by \<operator\>, which fully validate consensus. It is not a
proof the user or a third party can check."*

## Verification procedure (per response)

Run this after `AUTHORIZATION_BOUNDARY.md` steps 1–4 (bounded parse, issued-challenge lookup and
byte comparison, server-time expiry, atomic `redeeming` transition) and after the v3
cryptographic verifier has passed.

### 1. Canonical chain identity

- Configuration pins `(network_byte, genesis_hash, network_name)`. The challenge's `network` and
  `genesis_hash` must equal it. The node's header at height 0 must hash (`BlockHeader::hash`) to
  `genesis_hash`, and its reported network must match.
- *Authenticated?* Genesis is pinned by configuration, which is trusted. Everything after it is
  authenticated by the node's own full validation, which is trust in the node.

### 2. Authenticated tip

- Read the tip `(height, hash)` and header. Require the node to report itself synced, and require
  `server_time − tip.timestamp ≤ MAX_TIP_AGE`, a policy value (for example 30 minutes for
  Esmeralda). Record `(tip_height, tip_hash, tip.output_mr)` in the decision.
- *Authenticated?* PoW-linked headers *could* be checked independently (gap 3). In this design they
  are trusted from the self-operated full node.

### 3. Output inclusion and field binding

For each v3 record `i`:

1. Fetch the full `TransactionOutput` **by `output_hash_i`** from the node (`get_utxo` /
   `utxo_query` / `fetch_matching_utxos`), along with its `mined_height` and mined header hash.
2. **Recompute** `TransactionOutput::hash()` locally from the fetched fields with the pinned Tari
   version, and require equality with `output_hash_i`. That binds every fetched field to the hash
   the user signed.
3. Require byte equality: fetched `commitment == commitment_i`, `script == script_i`, and
   `script == push_pubkey_script(script_public_key_i)`.
4. Require the header at `mined_height` on the node's canonical chain to have the recorded hash.
5. *Authenticated?* Steps 2–3 are cryptographic: a node cannot change fields without breaking the
   hash. Whether the output exists on the canonical chain at all is trusted from the node (gap 1).
   The burn-only MMR proof does not apply.

### 4. Current-unspent evidence

- **Today (trust):** the node's UTXO set, at the recorded tip, still contains the commitment with
  value `smt_hash(output_hash_i, mined_height_i)` (`fetch_outputs_with_spend_status_at_tip`, or an
  equivalent query).
- **With a future Tari RPC (cryptographic against an authenticated tip):** request
  `get_with_proof(KeyHash(commitment_i), tip_version)` and verify the `SparseMerkleProof` against
  `tip.output_mr` with `SmtHasher`, for the value `smt_hash(output_hash_i, mined_height_i)`. A
  membership proof under the tip root shows unspent-at-tip, because spends delete the key and burns
  are never inserted. Proposed upstream shape:
  `get_output_smt_proof(commitment) -> {tip_hash, tip_height, jmt_version, value?, proof}`, served
  only at the current version (gap 2).

### 5. Maturity, locks, type, covenants, scripts

Reject unless **all** of these hold for each fetched output:

- `features.output_type ∈ {Standard, Coinbase}`. Reject `Burn`, `ValidatorNodeRegistration`,
  `CodeTemplateRegistration` and `SidechainCheckpoint`.
- `features.maturity ≤ tip_height`, plus the consensus coinbase lock for coinbases (the node
  enforces it at spend time; the verifier re-checks with the pinned consensus constants).
- `covenant` is empty (`Covenant::default()`). A covenant constrains the spending transaction, so
  policy rejects every non-empty one.
- `script` is exactly the 33-byte `PushPubKey(K)`. No `CheckHeight*`, multisig, hash-lock or other
  opcodes, so no script-level time lock can apply.
- Record `range_proof_type` and `minimum_value_promise` for audit. They add no eligibility.
- Verify the output's range proof and metadata signature locally, as defence in depth against a
  faulty node. The hash binds the range-proof *hash*, not its validity.

### 6. Confirmation and reorganization policy

- Require `tip_height − mined_height_i + 1 ≥ MIN_CONFIRMATIONS`. This is a per-network policy:
  low for Esmeralda testing, and set from Tari's observed reorg depth for mainnet. The value is a
  policy decision, not a cryptographic fact.
- Store `(mined_height_i, mined_header_hash_i)` with the grant. Revalidate at every privileged
  action and on a timer (≤ the grant TTL). If the header hash at `mined_height_i` changed (a reorg),
  or the output is spent, or the tip is stale, then **revoke** the grant.

### 7. Freshness and revalidation

- The grant TTL must not exceed the policy maximum. The verifier never extends a grant without a
  fresh proof.
- Revalidation runs steps 2–5 against a new tip. Any failure revokes.
- If the node is unreachable, not synced, or older than `MAX_TIP_AGE`: deny new grants and suspend
  existing ones (fail closed). Never fall back to cached state.

### 8. Challenge-nonce persistence and replay rejection

- Generate nonces as 32 CSPRNG bytes on the server. Persist the full canonical challenge in a
  durable store with a unique index on `nonce`. Its state machine is
  `issued → redeeming → granted | rejected | expired`.
- Accept a response only for a stored `issued` nonce, with every challenge field byte-equal and
  unexpired by server time. Use a compare-and-set into `redeeming` before any expensive or
  chain-dependent work.
- Never reopen a nonce. A second response for the same nonce is rejected even if it is valid.
- Bind each challenge to the authenticated session that requested it (subject, origin, gate).

### 9. Output-reuse policy (`OUTPUT_USE_POLICY.md`)

- Keep a registry keyed by `(network, genesis, origin, gate_id, gate_configuration_version,
  subject_id, output_hash)`.
- At most one active or redeeming proof per output per gate scope. Commit the output-use record and
  the grant in **one** transaction.
- Same-subject renewal requires fresh evidence after expiry. Reuse by a different subject inside the
  same gate scope is rejected while a grant is active.
- This cannot stop someone voluntarily lending outputs across unrelated gates. Document that as
  accepted residual risk.

### 10. Fail-closed operation

Every condition below is a **denial**, with a uniform external error and a detailed internal audit
log:

- a parse error, unknown or used nonce, field mismatch or expiry;
- a v3 verify error;
- the node is unreachable or unsynced, the tip is stale, or genesis or network mismatch;
- an output was not found, its hash or a field mismatches, or the type, covenant or script is not
  allowed;
- the output is immature, under-confirmed or spent;
- a DB or transaction error.

The service has no "degraded" path and no grant from a partially evaluated response.

## Trust model summary

| Property | Evidence in this design | Kind |
| --- | --- | --- |
| Response is internally consistent (signatures, aggregate, BP+) | v3 verifier | Cryptographic |
| Records bind the exact on-chain output fields | Local `TransactionOutput::hash` recomputation | Cryptographic (given the fetched preimage) |
| Output was mined on the canonical chain | Self-operated full node | **Trust** (no inclusion proof served) |
| Output is currently unspent | Self-operated full node's UTXO set | **Trust** today; cryptographic against the tip `output_mr` *if* a JMT proof RPC is added |
| Tip is canonical and fresh | Full node fork choice, plus a tip-age bound | **Trust** in node consensus and peers (could become PoW-checked with a header light client) |
| The prover's wallet owns the outputs | Authority signature under `K_s` | Cryptographic *only if* the wallet signed honestly inside its boundary (see `SCRIPT_KEY_DESIGN.md`) |
| Challenge is fresh and single-use | Durable nonce state machine | Server-side state, not cryptographic |
| Confirmation depth suffices | `MIN_CONFIRMATIONS` | Policy |

## Interfaces (sketch, not implemented)

```rust
trait TrustedL1Node {            // self-operated; every method returns Err on any uncertainty
    fn network_identity(&self) -> Result<(u8, FixedHash /*genesis*/), E>;
    fn synced_tip(&self) -> Result<TipHeader, E>;                     // height, hash, timestamp, output_mr
    fn output_by_hash(&self, h: FixedHash) -> Result<MinedOutput, E>; // full TransactionOutput + mined height/hash
    fn header_hash_at(&self, height: u64) -> Result<FixedHash, E>;
    fn is_unspent_at_tip(&self, c: &CompressedCommitment, tip: &TipHeader) -> Result<bool, E>;
    // Future, needs an upstream Tari RPC (gap 1); proves against tip.output_mr only (gap 2):
    // fn unspent_proof(&self, c: &CompressedCommitment) -> Result<(TipHeader, SparseMerkleProof<SmtHasher>), E>;
}

enum ChainDecision { Deny(InternalReason) }  // There is deliberately no `Grant` variant here:
                                             // granting is the authorization layer's atomic commit.
```

## Non-goals

- The wallet (Web TU) is not a chain verifier for the relying party. Its scanner, tip and
  `isSpendable` logic (`src/store.tsx`) are inputs to *selection* only.
- No synthetic or simulated chain adapter may stand in for this design in any authorization path.
