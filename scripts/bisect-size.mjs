// Hand-encode SubmitTransactionRequest with a real kernel + padding bytes at
// unknown field number 9000 (prost skips unknown fields) to test size thresholds.
import fs from "node:fs";

const API = process.env.API_BASE ?? "http://127.0.0.1:18083/api";
const tx = JSON.parse(JSON.parse(fs.readFileSync("shots/sample-tx.json", "utf8")));

function varint(n) {
  const out = [];
  let v = n;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
  return out;
}
function tag(field, wire) {
  return varint((field << 3) | wire);
}
function lenDelim(field, bytes) {
  return [...tag(field, 2), ...varint(bytes.length), ...bytes];
}

const hx = (s) => Buffer.from(s, "hex");
const k = tx.body.kernels[0];
// kernel: features=1(varint), fee=2(varint), lock_height=3(varint), excess=6(bytes), excess_sig=7(msg{1,2}), version=9(varint)
const excessSig = [...lenDelim(1, hx(k.excess_sig.public_nonce)), ...lenDelim(2, hx(k.excess_sig.signature))];
const kernelMsg = [
  ...tag(1, 0), ...varint(Number(k.features ?? 0)),
  ...tag(2, 0), ...varint(Number(k.fee)),
  ...tag(3, 0), ...varint(Number(k.lock_height ?? 0)),
  ...lenDelim(6, hx(k.excess)),
  ...lenDelim(7, excessSig),
  ...(k.version !== undefined ? [...tag(9, 0), ...varint(typeof k.version === "string" ? parseInt(k.version.slice(1), 10) : Number(k.version))] : []),
];

async function submit(label, bodyBytes) {
  const res = await fetch(API.replace(/\/+$/, "") + "/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request_b64: Buffer.from(bodyBytes).toString("base64") }),
  });
  const text = await res.text();
  console.log(`[${label}] ${res.status} :: ${text.slice(0, 140)}`);
}

const sizes = [0, 512, 1024, 2048, 4096];
for (const padSize of sizes) {
  const padding = padSize ? lenDelim(9000, Buffer.alloc(padSize)) : [];
  const bodyMsg = [...lenDelim(3, kernelMsg), ...padding]; // body.kernels=3
  const txn = [...lenDelim(1, hx(tx.offset)), ...lenDelim(2, bodyMsg), ...lenDelim(3, hx(tx.script_offset))];
  const req = [...lenDelim(1, txn)]; // SubmitTransactionRequest.transaction = 1
  await submit(`kernels+pad${padSize}`, req);
}
