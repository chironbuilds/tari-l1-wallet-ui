import fs from "node:fs";

const tx = JSON.parse(JSON.parse(fs.readFileSync("shots/sample-tx.json", "utf8")));
const API = process.env.API_BASE ?? "http://127.0.0.1:18083/api/submit";

async function submit(label, payload) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transaction_json: JSON.stringify(payload) }),
  });
  const body = await res.text();
  console.log(`[${label}] HTTP ${res.status} :: ${body.slice(0, 200)}`);
}

const base = { offset: tx.offset, script_offset: tx.script_offset };
const k = tx.body.kernels;
const [out0] = tx.body.outputs;

await submit("output0-as-is", { ...base, body: { inputs: [], outputs: [out0], kernels: k } });

const { proof, ...out0NoProof } = out0;
await submit("output0-no-proof", { ...base, body: { inputs: [], outputs: [{ ...out0NoProof }], kernels: k } });

await submit("output0-ver1", { ...base, body: { inputs: [], outputs: [{ ...out0, version: "V1" }], kernels: k } });
await submit("inputs-only", { ...base, body: { inputs: tx.body.inputs, outputs: [], kernels: k } });
