# GGBP-1 v3 browser prover readiness

> **What was tested: the verifier-only v3 WASM harness, in real headless Chromium.**
> **What was not tested: any prover.** No wallet prover exists, and none was built, run or
> simulated. Passing these checks says nothing about wallet proof generation. No wallet key,
> credential, seed or network endpoint was used.

## 1. Standalone v3 evidence reviewed

`GSXRspartan/ggbp1-v3-external-review@2ff24577` records (`VALIDATION.md`, `WASM_STATUS.md`):

- 27 native tests passing.
- The verifier-only `ggbp1-v3-wasm-verifier-harness` run under **Node 24.14 Web Crypto** returned
  `{"positive":0,"negative":0,"randomness":0}`.
- The package states explicitly that Node Web Crypto is not real-browser execution, and that the
  v3 **prover has never been built or tested in a browser**.

## 2. Reproduction in this review (2026-10-31, Linux x86_64 cloud container)

| Step | Command | Result |
| --- | --- | --- |
| Native suite | `cargo +1.97.1 test --workspace --locked` | **27 passed, 0 failed.** v2 archive 5 + 0, v2 WASM host 1, v3 core 13, v3 audit regressions 4, v3 vectors 3, v3 WASM host 1. Matches `VALIDATION.md`. |
| Verifier WASM build | `cargo +1.97.1 build -p ggbp1-v3-wasm-verifier-harness --target wasm32-unknown-unknown --release --locked` | OK. Raw `.wasm` 440,133 B, SHA-256 `a6079f957898154ffabb7bfc040529d918d2440edc62c41e5fcb326a7090d362`. `WASM_STATUS.md` records 440,311 B; the build is not byte-reproducible across environments. |
| Browser bindings | `wasm-bindgen 0.2.108 --target web` | OK. Bindgen `.wasm` 589,566 B, SHA-256 `711d7d20130662770b2106e05e250c34aea4dfd055372d9d20ecbee374991909`. |
| Real browser run | `node docs/ggbp1/browser-verifier-check/run.mjs <dir>` (Playwright 1.63.0) | **All 4 scenarios behaved as expected** (table below). |

Toolchain: `rustc 1.97.1` installed through `rustup` (the package pins `rust-version = 1.97.1`),
target `wasm32-unknown-unknown`, `wasm-bindgen-cli 0.2.108` (`--locked`). Crates were fetched from
crates.io under the checked-in `Cargo.lock`. `--offline` was not used because no vendored registry
was available.

### Real-browser results: HeadlessChrome 153.0.8010.12, secure context (`http://127.0.0.1`)

The module exports exactly three functions: `ggbp1_v3_verify_fixed_corpus`,
`ggbp1_v3_rejects_negative_corpus` and `ggbp1_v3_browser_secure_randomness_probe`. There are **no
proving or signing exports.**

| Scenario (injected before any page script) | positive | negative | randomness | Page errors | Meaning |
| --- | :-: | :-: | :-: | :-: | --- |
| Web Crypto available | 0 | 0 | 0 | none | The fixed v3 corpus parses, verifies and reserializes. Tampering, truncation, signature and record swaps, the re-signed BP+-only negative and v2 wire data are all rejected. The `getrandom` `wasm_js` backend works. |
| `crypto.getRandomValues` throws | 0 | 0 | **1** | none | Randomness failure is reported (fails closed) without a trap. Verification is unaffected, since it needs no randomness. |
| `globalThis.crypto` undefined | 0 | 0 | **1** | none | Same: fails closed. |
| Silent no-op polyfill (`getRandomValues = a => a`) | 0 | 0 | **0** | none | **The probe cannot detect a non-throwing, non-filling RNG.** See finding F-2. |

`0` = success, and for the negative corpus that means every negative case was rejected. `1` =
reported failure.

## 3. Findings

- **F-1 Verifier portability: confirmed in one real engine.** The v3 parser and verifier, including
  Tari BP+ `verify_batch`, run correctly in Chromium 153. Firefox, WebKit/Safari, mobile engines
  and Web Workers were **not** tested. Only Chromium is installed in this environment.
- **F-2 The entropy probe is necessary but not sufficient.** `getrandom` detects a *throwing* or
  *missing* Web Crypto, but not a polyfill that returns without filling. In a prover, that would
  give all-zero entropy. In the pinned stack that does not mean attacker-chosen nonces:
  - Schnorr nonces would degrade to deterministic `SHA-256(domain ‖ role ‖ key ‖ message ‖ 0³²)`
    (hedging, `V3_PROTOCOL.md`).
  - BP+ blinding would degrade to Merlin `TranscriptRng` re-keyed with the witness bytes
    (`tari_bulletproofs_plus 0.5.3` `src/transcripts.rs:185-192`).

  Even so, it breaks the design's entropy assumption and makes repeated proofs over identical
  transcripts byte-identical. A wallet prover must refuse to run unless `crypto.getRandomValues`
  is the native implementation. A practical check: compare it to a pristine iframe's function and
  check `Function.prototype.toString` for `[native code]`. The page CSP must also forbid untrusted
  script that could replace it before the WASM loads.
- **F-3 One `getrandom` in v3, two in Web TU.** The v3 lock has a single `getrandom 0.4.3`, shared
  by `rand 0.10.3` and `tari_bulletproofs_plus 0.5.3`. `tari_l1_wasm`'s `Cargo.toml` links both
  `getrandom 0.4` (`wasm_js`) and `getrandom 0.2` (`js`). A combined prover must audit that both
  resolve to Web Crypto, and pin them.
- **F-4 Verification needs no randomness.** A browser-side *verifier* (for wallet self-checks) is
  safe to ship where randomness is unavailable. A *prover* is not.

## 4. What remains before genuine browser proof generation

1. **A prover export that does not exist yet.** It would be built inside `tari_l1_wasm` against
   real `WalletOutput`s (see `SCRIPT_KEY_DESIGN.md`), not by exposing v3's synthetic
   `prove_synthetic`.
2. **The hedged-nonce KAT, run in the browser.** It must reproduce seed `f7240623…ac46` and nonce
   `be5c1a1f…2f69` from inside the WASM build that ships. That needs a test-only build flavour,
   because the v3 KAT seam is `#[cfg(test)]` and must never appear in a release artifact.
3. **Byte-exact cross-implementation vectors.** Proofs from the browser prover must verify under
   the native v3 verifier, and the reverse. Verification-time behaviour must match natively.
4. **A real-browser matrix:** Chromium, Firefox and WebKit, on desktop and mobile, on the main
   thread and in a dedicated worker, with the CSP the wallet ships. Measure proof time and memory
   for 1 and 16 outputs, since BP+ proving is CPU-heavy on low-end mobile.
5. **The entropy integrity check from F-2**, plus fail-closed behaviour when it fails. The prover
   must also refuse in iframes it does not control and in background tabs.
6. **Version alignment with the wallet's Tari base.** v3 pins `tari_crypto 0.23.4`; Tari `v6.2.0`
   uses `0.24`. See `SCRIPT_KEY_DESIGN.md` §11.
7. **Bundle and integrity policy.** The prover WASM must be served from the wallet origin with SRI
   or a hash-pinned build, with a size budget. The verifier bindgen artifact alone is about 590 KB
   before compression.

## 5. Reproduce

```sh
git clone https://github.com/GSXRspartan/ggbp1-v3-external-review && cd ggbp1-v3-external-review
git checkout 2ff24577603002e294d89bc604b889db0380a728
rustup toolchain install 1.97.1 --profile minimal --target wasm32-unknown-unknown
cargo +1.97.1 install wasm-bindgen-cli --version 0.2.108 --locked
cargo +1.97.1 test --workspace --locked
cargo +1.97.1 build -p ggbp1-v3-wasm-verifier-harness --target wasm32-unknown-unknown --release --locked
mkdir -p /tmp/ggbp1-browser/pkg
wasm-bindgen --target web --out-dir /tmp/ggbp1-browser/pkg --out-name ggbp1_v3_verifier \
  target/wasm32-unknown-unknown/release/ggbp1_v3_wasm_verifier_harness.wasm
cp <web-tu>/docs/ggbp1/browser-verifier-check/index.html /tmp/ggbp1-browser/
node <web-tu>/docs/ggbp1/browser-verifier-check/run.mjs /tmp/ggbp1-browser   # needs `playwright` + Chromium
```

The runner serves the directory on an ephemeral `127.0.0.1` port and runs each scenario in a fresh
browser context. It exits non-zero if any scenario deviates from its expectation. It touches no
wallet, network endpoint or key.
