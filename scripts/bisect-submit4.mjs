import fs from "node:fs";

const tx = JSON.parse(JSON.parse(fs.readFileSync("shots/sample-tx.json", "utf8")));
const API = process.env.API_BASE ?? "http://127.0.0.1:18083/api";

async function submit(label, payload) {
  const res = await fetch(API.replace(/\/+$/, "") + "/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transaction_json: JSON.stringify(payload) }),
  });
  const body = await res.text();
  let verdict;
  try {
    const j = JSON.parse(body);
    verdict = j.result ?? j.error;
  } catch {
    verdict = body.slice(0, 80);
  }
  console.log(`[${label}] ${res.status} :: ${verdict}`);
}

// real on-chain payment output fields (block 331220)
const blocksRes = await fetch(API + `/blocks?from=331220&to=331220`);
const blocks = await blocksRes.json();
const out = blocks.blocks[0].outputs.find((o) => o.output_type_byte === 0);
const raw = Buffer.from(out.metadata_sig_hex, "hex");
const field = (i) => raw.subarray(i * 36 + 4, i * 36 + 36).toString("hex");
const realSig = {
  ephemeral_commitment: field(0),
  ephemeral_pubkey: field(1),
  u_a: field(2),
  u_x: field(3),
  u_y: field(4),
};

const zeros32 = "00".repeat(32);
const zerosEnc = "00".repeat(80);
const zeroSig = {
  ephemeral_commitment: zeros32,
  ephemeral_pubkey: zeros32,
  u_a: zeros32,
  u_x: zeros32,
  u_y: zeros32,
};

function makeInput(o) {
  const d = {
    version: "V0",
    spent_output: {
      OutputData: {
        version: "V0",
        features: {
          version: "V0",
          output_type: 0,
          maturity: 0,
          coinbase_extra: "",
          sidechain_feature: null,
          range_proof_type: "bullet_proof_plus",
        },
        commitment: zeros32,
        script: "73",
        sender_offset_public_key: zeros32,
        covenant: "",
        encrypted_data: { data: zerosEnc },
        metadata_signature: zeroSig,
        rangeproof_hash: Array.from(Buffer.from(zeros32, "hex")),
        minimum_value_promise: 0,
      },
    },
    input_data: "",
    script_signature: zeroSig,
    ...o,
  };
  if (d.featuresPatch) Object.assign(d.spent_output.OutputData.features, d.featuresPatch);
  delete d.featuresPatch;
  if (d.odPatch) Object.assign(d.spent_output.OutputData, d.odPatch);
  delete d.odPatch;
  return d;
}

const base = { offset: tx.offset, script_offset: tx.script_offset, body: { inputs: [], outputs: [], kernels: tx.body.kernels } };

await submit("synthetic-baseline", { ...base, body: { ...base.body, inputs: [makeInput({})] } });
await submit("real-script", { ...base, body: { ...base.body, inputs: [makeInput({ odPatch: { script: out.script_hex } })] } });
await submit("real-commitment", { ...base, body: { ...base.body, inputs: [makeInput({ odPatch: { commitment: out.commitment_hex } })] } });
await submit("real-sender-offset", { ...base, body: { ...base.body, inputs: [makeInput({ odPatch: { sender_offset_public_key: out.sender_offset_pub_hex } })] } });
await submit("real-encrypted-data", { ...base, body: { ...base.body, inputs: [makeInput({ odPatch: { encrypted_data: { data: out.encrypted_data_hex } } })] } });
await submit("real-metadata-sig", { ...base, body: { ...base.body, inputs: [makeInput({ odPatch: { metadata_signature: realSig } })] } });
await submit("real-script-sig", { ...base, body: { ...base.body, inputs: [makeInput({ script_signature: realSig })] } });
await submit("real-rangeproof-hash", { ...base, body: { ...base.body, inputs: [makeInput({ odPatch: { rangeproof_hash: Array.from(Buffer.from(out.hash_hex, "hex")) } })] } });
