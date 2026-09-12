import fs from "node:fs";

const API = process.env.API_BASE ?? "http://127.0.0.1:18083/api";
const owned = JSON.parse(fs.readFileSync("shots/owned-commitments.json", "utf8"));
const targets = new Set(owned.map((c) => c.commitmentHex.toLowerCase()));
console.log("searching for spend of:", [...targets]);

const FROM = Number(process.env.SCAN_FROM ?? 331221);
const TO = Number(process.env.SCAN_TO ?? 331600);
let found = [];
for (let start = FROM; start <= TO; start += 50) {
  const end = Math.min(start + 49, TO);
  const res = await fetch(API + `/blocks?from=${start}&to=${end}`);
  if (!res.ok) continue;
  const { blocks } = await res.json();
  for (const b of blocks) {
    for (const i of b.inputs ?? []) {
      if (targets.has((i.commitment_hex || "").toLowerCase())) {
        found.push({ spentInBlock: b.height, commitment: i.commitment_hex });
        console.log(`SPENT in block ${b.height}: ${i.commitment_hex.slice(0, 16)}…`);
      }
    }
  }
}
if (found.length === 0) console.log(`no spends found in range ${FROM}–${TO} (middleware may not return inputs)`);
