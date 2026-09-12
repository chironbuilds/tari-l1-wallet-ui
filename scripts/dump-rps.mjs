import fs from "node:fs";

const API = process.env.API_BASE ?? "http://127.0.0.1:18083/api";
const res = await fetch(API + "/blocks?from=331220&to=331220");
const { blocks } = await res.json();
const outs = blocks[0].outputs;
fs.mkdirSync("shots", { recursive: true });
outs.forEach((o, i) => {
  if (o.range_proof_hex) {
    fs.writeFileSync(`shots/rp-${i}.hex`, o.range_proof_hex);
  }
});
console.log("wrote", outs.length, "rp candidates + manifest");
fs.writeFileSync(
  "shots/rp-manifest.txt",
  outs.map((o, i) => `${i}: ${o.commitment_hex.slice(0, 12)} proof=${!!o.range_proof_hex} covLen=${(o.covenant_hex || "").length / 2}`).join("\n"),
);
