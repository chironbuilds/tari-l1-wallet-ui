import fs from "node:fs";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import protobuf from "protobufjs";
import path from "node:path";

const HOST = process.env.GRPC_HOST || "grpc.tari.com:443";
const PROTO_DIR = path.join("server", "proto");

const def = protoLoader.loadSync(path.join(PROTO_DIR, "base_node.proto"), {
  includeDirs: [PROTO_DIR],
  keepCase: false,
  longs: String,
  defaults: true,
});
const BaseNode = grpc.loadPackageDefinition(def).tari.rpc.BaseNode;
const client = new BaseNode(HOST, grpc.credentials.createSsl(), {
  "grpc.maxReceiveMessageLength": -1,
});

const call = (method, req) =>
  new Promise((resolve, reject) => client[method](req, (err, r) => (err ? reject(err) : resolve(r))));

async function main() {
  const v = await call("getVersion", {});
  console.log("[node version]", JSON.stringify(v));

  // resolve owned commitments -> output hashes via the block they were mined in,
  // then ask the node which of those outputs are still unspent
  const targets = new Set(
    JSON.parse(fs.readFileSync("shots/owned-commitments.json", "utf8")).map((c) =>
      c.commitmentHex.toLowerCase(),
    ),
  );
  const tip = await call("getTipInfo", {});
  const tipHeight = Number(tip.metadata?.bestBlockHeight ?? 0);
  const hashes = [];
  for (let h = 331220; h <= Math.min(tipHeight, 331260); h += 40) {
    const res = await fetch((process.env.API_BASE ?? "http://127.0.0.1:18083/api") + `/blocks?from=${h}&to=${Math.min(h + 39, tipHeight)}`);
    if (!res.ok) continue;
    const { blocks } = await res.json();
    for (const b of blocks) {
      for (const o of b.outputs ?? []) {
        if (targets.has(o.commitment_hex.toLowerCase())) {
          hashes.push({ hash: Buffer.from(o.hash_hex, "hex"), commitment: o.commitment_hex });
        }
      }
      // also stop early once all found
      if (hashes.length >= targets.length) break;
    }
    if (hashes.length >= targets.length) break;
  }
  if (hashes.length === 0) {
    console.log("[utxo] could not resolve owned output hashes");
    return;
  }
  console.log("[utxo] checking", hashes.length, "owned output hash(es)");
  const found = [];
  await new Promise((resolve) => {
    const stream = client.fetchMatchingUtxos({ hashes: hashes.map((h) => h.hash) });
    stream.on("data", (d) => found.push(d));
    stream.on("end", resolve);
    stream.on("error", (e) => {
      console.log("[fetchMatchingUtxos error]", e.message);
      resolve();
    });
  });
  const foundHashes = new Set();
  for (const f of found) {
    const outJson = JSON.stringify(
      f.output,
      (k, v) => (v && v.type === "Buffer" ? Buffer.from(v.data).toString("hex") : v),
    );
    console.log("[stored output]", outJson);
    foundHashes.add(Buffer.from(f.output?.commitment ?? []).toString("hex").toLowerCase());
  }
  for (const { commitment } of hashes) {
    console.log(
      `[utxo] ${commitment.slice(0, 16)}… : ${foundHashes.has(commitment.toLowerCase()) ? "UNSPENT ✓" : "not in UTXO set (spent)"}`,
    );
  }
}

main().then(process.exit.bind(null, 0), (e) => { console.error(e.message); process.exit(1); });
