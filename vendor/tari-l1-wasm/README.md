# tari-l1-wasm

WebAssembly bindings for Tari L1 (Minotari) core primitives. Build fully-signed Minotari
transactions entirely in the browser — no wallet daemon, no backend.

- **Wallet**: seed-based key derivation, address generation, encrypted backup import/export
- **UTXOs**: recover spendable outputs from scanned chain data (view-key + stealth DH decryption)
- **Transactions**: complete one-sided payments with Bulletproofs+ range proofs, kernel excess
  signatures, sender/script offsets and automatic change — all client-side
- **Submission payloads**: serde JSON for the base node HTTP `/json_rpc` endpoint (plain `fetch`),
  or protobuf `SubmitTransactionRequest` bytes for gRPC/gRPC-Web
- **Primitives**: Ristretto Schnorr sign/verify, Pedersen commitments, BLAKE2b, fee estimation

## Installation

```sh
npm install @your-scope/tari-l1-wasm
```

## Usage

```js
import {
  WasmWallet,
  WasmTxBuilder,
} from "@your-scope/tari-l1-wasm";
// The module self-initializes its WASM instance on import.
// Bundlers (Vite/webpack/rspack) handle the .wasm import automatically.
// Plain Node >= 22 needs: node --experimental-wasm-modules your-script.mjs

// 1. Wallet (or restore with WasmWallet.fromBackupHex(backup, "esmeralda"))
const alice = new WasmWallet("esmeralda");
console.log(alice.getAddress().toBase58());

// 2. Spendable inputs: from scanned chain data via alice.importScannedOutput(...),
//    or self-created handles for testing:
const utxo = alice.createSelfUtxo(5_000_000n); // amounts are BigInt micro-Minotari (uT)

// 3. Build + sign a payment
const builder = new WasmTxBuilder(alice);
builder.addInput(utxo);
builder.addRecipient(recipientAddressBase58OrEmoji, 1_000_000n);
builder.withFeePerGram(2n);
const signed = builder.build();
console.log("fee:", signed.feeMicro, "change:", signed.changeValueMicro);

// 4a. Submit over plain HTTP (base node wallet service)
await fetch(nodeUrl + "/json_rpc", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: "1", method: "submit_transaction",
    params: { transaction: JSON.parse(signed.toJson()), version: 2 },
  }),
});

// 4b. ...or gRPC: send signed.toSubmitRequestBytes() to BaseNode.SubmitTransaction
```

Recipients must be dual ("one-sided") addresses containing a view key.

## Building from source

```sh
wasm-pack build base_layer/tari_l1_wasm --target bundler --release --out-dir pkg
node base_layer/tari_l1_wasm/scripts/prepare-package.mjs --scope @your-scope
```

Requires Rust with the `wasm32-unknown-unknown` target. The workspace `.cargo/config.toml`
sets the getrandom wasm_js backend automatically.

## License

BSD-3-Clause — see [LICENSE](./LICENSE).
