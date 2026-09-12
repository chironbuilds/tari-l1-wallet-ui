const API = process.env.API_BASE ?? "http://127.0.0.1:18083/api";
const fs = await import("node:fs");
const tx = JSON.parse(JSON.parse(fs.readFileSync("shots/sample-tx.json", "utf8")));

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

const zeros32 = "00".repeat(32);
const zeroSig = {
  ephemeral_commitment: zeros32,
  ephemeral_pubkey: zeros32,
  u_a: zeros32,
  u_x: zeros32,
  u_y: zeros32,
};
const base = { offset: tx.offset, script_offset: tx.script_offset };
const K = tx.body.kernels;

// compact input branch: commitment empty + output_hash present
await submit("compact-min", {
  ...base,
  body: {
    inputs: [{ version: "V0", spent_output: "Compact", output_hash: Array.from(Buffer.from(zeros32, "hex")), input_data: "", script_signature: zeroSig }],
    outputs: [],
    kernels: K,
  },
});

// serde compact might tag differently — try without spent_output entirely
await submit("compact-no-spent-output", {
  ...base,
  body: {
    inputs: [{ version: "V0", output_hash: Array.from(Buffer.from(zeros32, "hex")), input_data: "", script_signature: zeroSig }],
    outputs: [],
    kernels: K,
  },
});

// sanity: missing script_signature should still be INVALID_ARGUMENT (proves we reach conversion)
await submit("compact-no-script-sig", {
  ...base,
  body: {
    inputs: [{ version: "V0", output_hash: Array.from(Buffer.from(zeros32, "hex")), input_data: "" }],
    outputs: [],
    kernels: K,
  },
});
