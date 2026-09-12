import fs from "node:fs";

const API = process.env.API_BASE ?? "http://127.0.0.1:18083/api";
const tx = JSON.parse(JSON.parse(fs.readFileSync("shots/sample-tx.json", "utf8")));

async function submit(label, payload) {
  const res = await fetch(API.replace(/\/+$/, "") + "/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transaction_json: JSON.stringify(payload) }),
  });
  const body = await res.text();
  console.log(`[${label}] HTTP ${res.status} :: ${body.slice(0, 200)}`);
}

// fetch a real on-chain payment output
const blocksRes = await fetch(API + `/blocks?from=${process.env.BLOCK_FROM ?? 331220}&to=${process.env.BLOCK_FROM ?? 331220}`);
const blocks = await blocksRes.json();
const out = blocks.blocks[0].outputs.find((o) => o.output_type_byte === 0);

// de-frame borsh metadata sig ([u32 LE 32][32] x 5) back to raw fields
const raw = Buffer.from(out.metadata_sig_hex, "hex");
const field = (i) => raw.subarray(i * 36 + 4, i * 36 + 36);
const meta = {
  ephemeral_commitment: field(0).toString("hex"),
  ephemeral_pubkey: field(1).toString("hex"),
  u_a: field(2).toString("hex"),
  u_x: field(3).toString("hex"),
  u_y: field(4).toString("hex"),
};

const zeros32 = "00".repeat(32);
const realInput = {
  version: "V0",
  spent_output: {
    OutputData: {
      version: "V0",
      features: {
        version: "V0",
        output_type: out.output_type_byte,
        maturity: Number(out.maturity),
        coinbase_extra: "",
        sidechain_feature: null,
        range_proof_type: "bullet_proof_plus",
      },
      commitment: out.commitment_hex,
      script: out.script_hex,
      sender_offset_public_key: out.sender_offset_pub_hex,
      covenant: "",
      encrypted_data: { data: out.encrypted_data_hex },
      metadata_signature: meta,
      rangeproof_hash: Array.from(Buffer.from(out.hash_hex, "hex")),
      minimum_value_promise: Number(out.minimum_value_promise),
    },
  },
  input_data: "",
  script_signature: meta,
};

const base = { offset: tx.offset, script_offset: tx.script_offset };
await submit("real-output-input", {
  ...base,
  body: { inputs: [realInput], outputs: [], kernels: tx.body.kernels },
});
