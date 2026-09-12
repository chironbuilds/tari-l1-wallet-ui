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
  console.log(`[${label}] HTTP ${res.status} :: ${body.slice(0, 220)}`);
}

const empty = {
  offset: tx.offset,
  body: { inputs: [], outputs: [], kernels: [] },
  script_offset: tx.script_offset,
};
await submit("body-empty", empty);
await submit("kernels-only", { ...empty, body: { inputs: [], outputs: [], kernels: tx.body.kernels } });
await submit(
  "kernels+outputs",
  { ...empty, body: { inputs: [], outputs: tx.body.outputs, kernels: tx.body.kernels } },
);
await submit(
  "full",
  { ...empty, body: { inputs: tx.body.inputs, outputs: tx.body.outputs, kernels: tx.body.kernels } },
);
