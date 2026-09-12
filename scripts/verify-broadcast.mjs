// End-to-end broadcast check against a live base node, through the same pipeline the UI uses:
//   wasm build  ->  toJson()  ->  middleware /submit  ->  gRPC SubmitTransaction
//
// Sends a small amount back to the wallet's own address, so only the fee is spent.
// Requires a funded wallet: put its 24-word phrase in "tari seed.txt".
//
//   node --experimental-wasm-modules scripts/verify-broadcast.mjs            # build only
//   MODE=submit node --experimental-wasm-modules scripts/verify-broadcast.mjs # broadcast
//
// Env: API_BASE (middleware, default http://127.0.0.1:8080/api), BLOCK_FROM (block to scan for a
// spendable output), AMOUNT (µT), FPG (fee per gram, µT).
import fs from "node:fs";
import { WasmWallet, WasmTxBuilder } from "@chironbuilder/tari-l1-wasm";
import { importWalletSeed, encipherSeed } from "tari-cipherseed";

const API = (process.env.API_BASE ?? "http://127.0.0.1:8080/api").replace(/\/+$/, "");
const BLOCK = Number(process.env.BLOCK_FROM ?? 331220);
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const mnemonic = fs.readFileSync("tari seed.txt", "utf8").trim();
const backupHex = hex(await encipherSeed(await importWalletSeed(mnemonic)));
const wallet = WasmWallet.fromBackupHex(backupHex, "mainnet");
console.log("address:", wallet.getAddress().toBase58());

const tip = await (await fetch(`${API}/tip`)).json();
console.log("tip:", tip.height);

const { blocks } = await (await fetch(`${API}/blocks?from=${BLOCK}&to=${BLOCK}`)).json();
const owned = [];
for (const b of blocks ?? []) {
  for (const o of b.outputs ?? []) {
    try {
      const handle = wallet.importScannedOutput(
        o.commitment_hex, o.encrypted_data_hex, o.sender_offset_pub_hex, o.script_hex,
        o.metadata_sig_hex, BigInt(o.minimum_value_promise || "0"), BigInt(o.maturity || "0"),
        o.output_type_byte, o.range_proof_type_byte, o.coinbase_extra_hex,
        o.covenant_hex ?? "", o.range_proof_hex ?? "", o.hash_hex ?? "",
      );
      owned.push({ handle, chainOutput: o });
    } catch {
      // not ours
    }
  }
}
console.log(`owned in block ${BLOCK}:`, owned.map((o) => `${o.handle.commitmentHex.slice(0, 12)}=${o.handle.valueMicro}µT`));

owned.sort((a, b) => (a.handle.valueMicro > b.handle.valueMicro ? -1 : 1));
let spend = null;
for (const candidate of owned) {
  const { unspent } = await (await fetch(`${API}/utxo?hash=${candidate.chainOutput.hash_hex}`)).json();
  if (unspent) {
    spend = candidate;
    break;
  }
}
if (!spend) {
  console.error("no unspent owned output found — try another BLOCK_FROM");
  process.exit(1);
}
console.log("spending:", spend.handle.commitmentHex.slice(0, 16), `(${spend.handle.valueMicro} µT)`);

const builder = new WasmTxBuilder(wallet);
builder.addInput(spend.handle);
builder.addRecipient(wallet.getAddress().toBase58(), BigInt(process.env.AMOUNT ?? "100000"));
builder.withFeePerGram(BigInt(process.env.FPG ?? "5"));
builder.withTipHeight(BigInt(tip.height));
const signed = builder.build();
console.log("signed. fee:", signed.feeMicro, "change:", signed.changeValueMicro);

const tx = JSON.parse(signed.toJson());
const input = tx.body.inputs[0];
if (!input.spent_output?.OutputData) {
  console.error("input is compact — the mempool cannot hydrate it and will reject the transaction");
  process.exit(1);
}

if (process.env.MODE !== "submit") {
  console.log("built only; set MODE=submit to broadcast");
  process.exit(0);
}
const res = await fetch(`${API}/submit`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ transaction_json: signed.toJson() }),
});
const body = await res.text();
console.log(`submit -> ${res.status} ${body}`);
process.exit(/"ACCEPTED"/.test(body) ? 0 : 1);
