import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import protobuf from "protobufjs";
import path from "node:path";
import { serdeTxToProtoRequest } from "../server/serde-to-proto.js";

export { serdeTxToProtoRequest };

const PROTO_DIR = path.join(process.cwd(), "server", "proto");
const HOST = process.env.GRPC_HOST || "grpc.tari.com:443";
const TLS = (process.env.GRPC_TLS ?? "1") !== "0";

let cachedClient = null;

export function getClient() {
  if (cachedClient) return cachedClient;
  const def = protoLoader.loadSync(path.join(PROTO_DIR, "base_node.proto"), {
    includeDirs: [PROTO_DIR],
    keepCase: false,
    longs: String,
    defaults: true,
  });
  const BaseNode = grpc.loadPackageDefinition(def).tari.rpc.BaseNode;
  cachedClient = new BaseNode(
    HOST,
    TLS ? grpc.credentials.createSsl() : grpc.credentials.createInsecure(),
    {
      "grpc.maxReceiveMessageLength": -1,
      "grpc.maxSendMessageLength": -1,
    },
  );
  return cachedClient;
}

export const hex = (b) => (b ? Buffer.from(b).toString("hex") : "");

function borshField(b) {
  const src = b ? Buffer.from(b) : Buffer.alloc(0);
  const out = Buffer.alloc(4 + src.length);
  out.writeUInt32LE(src.length, 0);
  src.copy(out, 4);
  return out;
}

/**
 * Everything a wallet needs to decide an output is *not* its own, and to import it if it is —
 * minus the two fields it cannot use until it already knows the answer.
 *
 * Ownership is settled by `try_output_key_recovery`, which reads only the commitment, the
 * encrypted data and the sender offset key. The range proof and the chain hash are dead weight
 * during a scan and together are roughly half the bytes on the wire, so scan mode leaves them out
 * and the client re-fetches the full record for the handful of outputs that turn out to be its.
 * Everything else has to stay: `import_scanned_output` parses the script, metadata signature and
 * covenant before it can return, so omitting those would turn a miss into a hard error.
 */
function mapOutputBase(o) {
  const ms = o.metadataSignature || {};
  const f = o.features || {};
  return {
    commitment_hex: hex(o.commitment),
    encrypted_data_hex: hex(o.encryptedData),
    sender_offset_pub_hex: hex(o.senderOffsetPublicKey),
    script_hex: hex(o.script),
    metadata_sig_hex: Buffer.concat([
      borshField(ms.ephemeralCommitment),
      borshField(ms.ephemeralPubkey),
      borshField(ms.uA),
      borshField(ms.uX),
      borshField(ms.uY),
    ]).toString("hex"),
    minimum_value_promise: String(o.minimumValuePromise ?? "0"),
    maturity: String(f.maturity ?? "0"),
    output_type_byte: Number(f.outputType ?? 0),
    range_proof_type_byte: Number(f.rangeProofType ?? 0),
    coinbase_extra_hex: hex(f.coinbaseExtra),
    covenant_hex: hex(o.covenant),
  };
}

/** Scan projection: no range proof, no chain hash. */
export const mapOutputScan = mapOutputBase;

/** The complete record, for outputs the wallet has recognised as its own. */
export function mapOutput(o) {
  const out = mapOutputBase(o);
  out.hash_hex = hex(o.hash);
  // Hex-encoding proofs is the single most expensive thing this function does, which is the other
  // reason scan mode skips it rather than building the string and discarding it.
  out.range_proof_hex = hex(o.rangeProof?.proofBytes ?? o.rangeProof?.proof_bytes);
  return out;
}

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

const pbRoot = protobuf.loadSync(path.join(PROTO_DIR, "base_node.proto"));
export const SubmitTxReq = pbRoot.lookupType("tari.rpc.SubmitTransactionRequest");
const SubmitTxResp = pbRoot.lookupType("tari.rpc.SubmitTransactionResponse");
export const SUBMIT_RESULT_NAMES = [
  "NONE",
  "ACCEPTED",
  "NOT_PROCESSABLE_AT_THIS_TIME",
  "ALREADY_MINED",
  "REJECTED",
];

export function submitTransactionRaw(requestBuf) {
  return new Promise((resolve, reject) => {
    getClient()
      .makeUnaryRequest(
        "/tari.rpc.BaseNode/SubmitTransaction",
        (arg) =>
          arg instanceof Uint8Array
            ? Buffer.from(arg)
            : SubmitTxReq.encode(SubmitTxReq.fromObject(arg)).finish(),
        (buf) => {
          const decoded = SubmitTxResp.toObject(SubmitTxResp.decode(buf));
          const code = Number(decoded.result ?? 0);
          return { result: SUBMIT_RESULT_NAMES[code] ?? String(code) };
        },
        requestBuf,
        (err, resp) => (err ? reject(err) : resolve(resp)),
      );
  });
}

export function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify(body));
}
