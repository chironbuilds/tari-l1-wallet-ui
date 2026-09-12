import http from "node:http";
import fs from "node:fs";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import protobuf from "protobufjs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { serdeTxToProtoRequest } from "./serde-to-proto.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const GRPC_HOST = arg("host") || process.env.GRPC_HOST || "grpc.tari.com:443";
const GRPC_TLS = (arg("tls") ?? process.env.GRPC_TLS ?? "1") !== "0";
const PORT = Number(arg("port") || process.env.PORT || 8080);
const MAX_BLOCK_BATCH = 1000;
const PARALLEL_STREAMS = 4;

const packageDef = protoLoader.loadSync(path.join(__dirname, "proto", "base_node.proto"), {
  includeDirs: [path.join(__dirname, "proto")],
  keepCase: false,
  longs: String,
  defaults: true,
});
const proto = grpc.loadPackageDefinition(packageDef);
const BaseNode = proto.tari.rpc.BaseNode;
const client = new BaseNode(
  GRPC_HOST,
  GRPC_TLS ? grpc.credentials.createSsl() : grpc.credentials.createInsecure(),
  {
    "grpc.maxReceiveMessageLength": -1,
    "grpc.maxSendMessageLength": -1,
  },
);

const pbRoot = protobuf.loadSync(path.join(__dirname, "proto", "base_node.proto"));
const SubmitTxReq = pbRoot.lookupType("tari.rpc.SubmitTransactionRequest");
const SubmitTxResp = pbRoot.lookupType("tari.rpc.SubmitTransactionResponse");
const RESULT_NAMES = ["NONE", "ACCEPTED", "NOT_PROCESSABLE_AT_THIS_TIME", "ALREADY_MINED", "REJECTED"];

function submitTransactionRaw(requestBuf) {
  return new Promise((resolve, reject) => {
    client.makeUnaryRequest(
      "/tari.rpc.BaseNode/SubmitTransaction",
      (arg) =>
        arg instanceof Uint8Array
          ? Buffer.from(arg)
          : SubmitTxReq.encode(SubmitTxReq.fromObject(arg)).finish(),
      (buf) => {
        const decoded = SubmitTxResp.toObject(SubmitTxResp.decode(buf));
        const code = Number(decoded.result ?? 0);
        return { result: RESULT_NAMES[code] ?? String(code) };
      },
      requestBuf,
      (err, resp) => (err ? reject(err) : resolve(resp)),
    );
  });
}

const hex = (buf) => (buf ? Buffer.from(buf).toString("hex") : "");

function mapOutput(o) {
  const ms = o.metadataSignature || {};
  const f = o.features || {};
  const borshField = (b) => {
    const src = b ? Buffer.from(b) : Buffer.alloc(0);
    const out = Buffer.alloc(4 + src.length);
    out.writeUInt32LE(src.length, 0);
    src.copy(out, 4);
    return out;
  };
  const metadataSigHex = Buffer.concat([
    borshField(ms.ephemeralCommitment),
    borshField(ms.ephemeralPubkey),
    borshField(ms.uA),
    borshField(ms.uX),
    borshField(ms.uY),
  ]).toString("hex");
  return {
    commitment_hex: hex(o.commitment),
    hash_hex: hex(o.hash),
    encrypted_data_hex: hex(o.encryptedData),
    sender_offset_pub_hex: hex(o.senderOffsetPublicKey),
    script_hex: hex(o.script),
    metadata_sig_hex: metadataSigHex,
    minimum_value_promise: String(o.minimumValuePromise ?? "0"),
    maturity: String(f.maturity ?? "0"),
    output_type_byte: Number(f.outputType ?? 0),
    range_proof_type_byte: Number(f.rangeProofType ?? 0),
    coinbase_extra_hex: hex(f.coinbaseExtra),
    covenant_hex: hex(o.covenant),
    range_proof_hex: hex(o.rangeProof?.proofBytes ?? o.rangeProof?.proof_bytes),
    version: Number(o.version ?? 0),
  };
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(data);
}

async function getTip() {
  return new Promise((resolve, reject) => {
    client.getTipInfo({}, (err, resp) => {
      if (err) return reject(err);
      resolve({
        height: Number(resp.metadata?.bestBlockHeight ?? 0),
        hash: hex(resp.metadata?.bestBlockHash),
        prunedHeight: Number(resp.metadata?.prunedHeight ?? 0),
        timestamp: Date.now(),
      });
    });
  });
}

async function fetchHeights(heights) {
  return new Promise((resolve, reject) => {
    const out = [];
    const call = client.getBlocks({ heights });
    call.on("data", (hb) => {
      const height = Number(hb.block?.header?.height ?? 0);
      const outputs = (hb.block?.body?.outputs || []).map(mapOutput);
      const inputCommitments = (hb.block?.body?.inputs || []).map((i) => hex(i.commitment));
      out.push({
        height,
        timestamp: Number(hb.block?.header?.timestamp ?? 0),
        outputs,
        inputs: inputCommitments,
      });
    });
    call.on("error", reject);
    call.on("end", () => resolve(out));
  });
}

async function getBlocks(from, to) {
  const heights = [];
  for (let h = from; h <= to; h++) heights.push(h);
  const chunks = [];
  const per = Math.ceil(heights.length / PARALLEL_STREAMS);
  for (let i = 0; i < heights.length; i += per) chunks.push(heights.slice(i, i + per));
  const settled = await Promise.all(
    chunks.map((c) =>
      fetchHeights(c).catch(async (err) => {
        const msg = String(err?.message || err);
        if (!/RESOURCE_EXHAUSTED|larger than max/i.test(msg) || c.length === 1) {
          return [{ height: c[0], outputs: [], error: msg.slice(0, 200) }];
        }
        const singles = [];
        for (const h of c) {
          try {
            singles.push(await fetchHeights([h]));
          } catch (e2) {
            singles.push([{ height: h, outputs: [], error: String(e2?.message || e2).slice(0, 200) }]);
          }
        }
        return singles.flat();
      }),
    ),
  );
  const blocks = settled
    .flat()
    .filter(Boolean)
    .sort((a, b) => a.height - b.height);
  return { blocks, failed: [] };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/tip") {
      return json(res, 200, await getTip());
    }
    if (req.method === "GET" && url.pathname === "/api/blocks") {
      const from = Number(url.searchParams.get("from"));
      let to = Number(url.searchParams.get("to") ?? from);
      if (!Number.isFinite(from) || from <= 0 || to < from) {
        return json(res, 400, { error: "invalid range" });
      }
      to = Math.min(to, from + MAX_BLOCK_BATCH - 1);
      const { blocks } = await getBlocks(from, to);
      return json(res, 200, { blocks });
    }
    if (req.method === "GET" && url.pathname === "/api/utxo") {
      const hash = url.searchParams.get("hash");
      if (!hash || !/^[0-9a-fA-F]{64}$/.test(hash)) return json(res, 400, { error: "invalid hash" });
      const found = await new Promise((resolve) => {
        const stream = client.fetchMatchingUtxos({ hashes: [Buffer.from(hash, "hex")] });
        const out = [];
        stream.on("data", (d) => out.push(d));
        stream.on("error", () => resolve(null));
        stream.on("end", () => resolve(out.length > 0));
      });
      return json(res, 200, { unspent: found === true });
    }
    if (req.method === "POST" && url.pathname === "/api/submit") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}");
      if (body.request_b64) {
        const buf = Buffer.from(body.request_b64, "base64");
        if (buf.length === 0) return json(res, 400, { error: "invalid request bytes" });
        if (process.env.TX_DEBUG_DIR) {
          try {
            fs.mkdirSync(process.env.TX_DEBUG_DIR, { recursive: true });
            fs.writeFileSync(path.join(process.env.TX_DEBUG_DIR, "last-submit.b64"), buf.toString("base64"));
          } catch {}
        }
        const resp = await submitTransactionRaw(buf);
        return json(res, 200, { result: resp.result ?? "NONE" });
      }
      let txObj = body.transaction;
      if (!txObj && body.transaction_json) {
        try {
          txObj = JSON.parse(body.transaction_json);
        } catch {
          return json(res, 400, { error: "invalid transaction_json" });
        }
      }
      if (!txObj) return json(res, 400, { error: "missing transaction" });
      const mapped = serdeTxToProtoRequest(txObj);
      const reqBytes = SubmitTxReq.encode(SubmitTxReq.fromObject(mapped)).finish();
      if (process.env.TX_DEBUG_DIR) {
        try {
          fs.mkdirSync(process.env.TX_DEBUG_DIR, { recursive: true });
          fs.writeFileSync(path.join(process.env.TX_DEBUG_DIR, "last-submit.b64"), Buffer.from(reqBytes).toString("base64"));
        } catch {}
      }
      const resp = await submitTransactionRaw(Buffer.from(reqBytes));
      return json(res, 200, { result: resp.result ?? "NONE" });
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, grpcHost: GRPC_HOST, tls: GRPC_TLS });
    }
    return json(res, 404, { error: "not found" });
  } catch (e) {
    return json(res, 502, { error: e?.message || String(e) });
  }
});

server.listen(PORT, () => {
  console.log(
    `[tari-middleware] HTTP on :${PORT}  →  gRPC ${GRPC_HOST} (${GRPC_TLS ? "tls" : "insecure"})`,
  );
  console.log(`[tari-middleware] endpoints: /api/tip /api/blocks?from=&to= /api/submit /api/health`);
});
