# GGBP-1 v3 in the Tari L1 Web Wallet

> **Status: experimental, Esmeralda only.** The wallet produces GGBP1R v3 responses from its own
> L1 outputs. A valid response proves the cryptography only. It does **not** show that the
> disclosed outputs are on the canonical chain or unspent; the relying party must check that itself
> (see `CHAIN_VERIFIER_DESIGN.md`). MainNet stays off until the gates in
> `../GGBP1_GHOST_GATE_HANDOFF.md` are passed there.

This is what was built against the handoff, and the encodings a gate needs that the v3 reference
leaves undefined.

## What runs where

| Piece | Where |
| --- | --- |
| v3 core (transcripts, hedged nonces, BP+ aggregate-minimum proof, wire format, verifier) | `tari_l1_wasm` `src/ggbp1/core.rs`, vendored from `GSXRspartan/ggbp1-v3-external-review@2ff2457` (`lib.rs` SHA-256 `01f4ccad…eb69`) with no logic changes. Its 13 unit tests, including the hedged-nonce KAT, pass against `tari_crypto 0.24` and `rand 0.10.1`. |
| Wallet adapter (output eligibility, selection, key access, subject key) | `tari_l1_wasm` `src/ggbp1/wallet.rs`. No secret leaves wasm: JS gets a subject public key, a public preview, and the response bytes. |
| Policy (live networks, rate limit, output leases, approval text) | `src/lib/ggbp1.ts` |
| Bridge methods and approval dialog | `src/components/DappFrame.tsx` |

## Encodings

All integers are little-endian.

**Challenge** (exactly 223 bytes; the dApp sends it as unpadded base64url):

```text
"GGBP1" ‖ 0x03 ‖ network(1) ‖ genesis_hash(32) ‖ origin_hash(32) ‖ gate_id(16)
‖ le64(gate_configuration_version) ‖ subject_id(16) ‖ subject_authentication_public_key(32)
‖ le64(threshold_micro_xtm) ‖ nonce(32) ‖ le64(expires_at_unix_seconds)
‖ commitment_generator_fingerprint(32)
```

It is exactly the prefix of the signed `challenge_message`, before the output count, and the same
fields in the same order as the response header.

- `network`: Tari's network byte (`MainNet = 0x00`, `Esmeralda = 0x26`).
- `genesis_hash`: the height-0 block hash. MainNet
  `01f0cf665bd4cd31cbb2b2470236389c483522b350335e10a4a5dca34cb85990`, Esmeralda
  `3c3681ad318eb54ca3f3e8aed79d3d207d94a5291aec84ba1a0b628633db3621`.
- `origin_hash`: `SHA-256("GGBP1/origin" ‖ origin)`, where `origin` is the serialised web origin of
  the page that asks (`https://host[:port]`, lowercase, no path or trailing slash).
- `subject_authentication_public_key`: from `tari_getBalanceProofSubject` (below).
- `commitment_generator_fingerprint`: as in the handoff; also returned by
  `tari_getBalanceProofSubject`.

**Response**: the v3 `GGBP1R` wire format from the handoff, unchanged, as unpadded base64url.

**Subject key**: per wallet, per origin, per network:
`k_sub = from_uniform_bytes(Blake2b-512, domain "com.tari.l1-web-wallet.ggbp1.subject_key" v1,
label "subject" ‖ k_spend ‖ network ‖ genesis_hash ‖ le32(len(origin)) ‖ origin)`. It is never a
spend, view or script key; one site sees the same key every time, two sites see unrelated keys.

## dApp API

Check `getCapabilities().ggbp1BalanceProof` first: `false`, or
`{ protocolVersion: 3, network: "esmeralda", maxOutputs: 16, maxProofBytes: 8192 }`.

1. `tari_getBalanceProofSubject` (`window.tari.getBalanceProofSubject()`): connected sites only, the
   user approves. Returns `{ protocol: "ggbp1", version: 3, network, genesisHash, originHash,
   subjectPublicKey, commitmentGeneratorFingerprint }` (hex). The gate stores the subject key.
2. The gate issues a challenge with its own nonce, threshold, expiry and gate fields.
3. `tari_requestBalanceProof` (`window.tari.requestBalanceProof(challengeBase64Url)`): returns
   `{ protocol: "ggbp1", version: 3, response }`.
4. The gate parses the response, compares every challenge field byte for byte with what it issued,
   runs the v3 verifier, and then checks each disclosed output against the chain itself.

Errors: `4100` not connected; `4200` not available (another network, a view-only wallet);
`4001` for the user declining **and** for "this wallet cannot reach the threshold", so a site cannot
tell them apart; `-32603` with a message for a malformed or mismatched challenge (wrong site,
network, subject key, expired), which reveals nothing about the balance.

## What the wallet enforces

- Only exact `PushPubKey(K)` outputs whose `K` re-derives from the held mask as this wallet's
  stealth script key (`find_script_key_id_from_commitment_mask_key_id(…, Some(K))`), never the raw
  spend key. Standard or coinbase, no covenant, commitment opens, and the output hash recomputed
  in wasm equals the chain hash it was imported with.
- Confirmed at least 5 blocks, mature, not pending, not leased by another request.
- The fewest outputs (at most 16, largest first) that reach the threshold.
- The challenge must name this wallet's network and genesis, this exact framed origin, this
  wallet's subject key for that origin, the expected generator fingerprint, a nonzero threshold,
  and a future expiry. Expiry is re-checked at approval.
- Foreground only: a request from a hidden tab is refused, and approval is refused if the tab is
  hidden, the wallet locked, or a disclosed output spent while the dialog was open.
- At most one open request per site and 10 per hour, to blunt threshold probing.
- Outputs being disclosed are leased across tabs (Web Locks + a shared lease table) until the
  request ends; Send and Burn skip leased outputs.
- The approval dialog is built from the wasm's preview: threshold, network and genesis, gate,
  subject, expiry, every disclosed output with its amount and height, a request fingerprint, and the
  linkability warning. Nothing is remembered; every proof is approved on its own.
- Every response is checked with the reference verifier before it is returned.

## Known limits

- Point in time: an output can be spent right after the proof. Gates must revalidate.
- Leases coordinate tabs of one browser, not other devices using the same seed.
- The wallet's chain view comes from its query node; it is not independent evidence.
- MainNet is off by policy (`LIVE_NETWORKS` in `src/lib/ggbp1.ts`), not by any missing code.
