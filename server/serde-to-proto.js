// Maps Tari's internal serde JSON (WasmSignedTransaction.toJson()) onto the
// public minotari_app_grpc proto schema expected by SubmitTransaction gRPC.

const RANGE_PROOF_TYPES = {
  bullet_proof_plus: 0,
  revealed_value: 1,
};

function hx(v) {
  if (v === null || v === undefined) return Buffer.alloc(0);
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.from(v);
  if (Array.isArray(v)) return Buffer.from(v);
  const s = String(v).startsWith("0x") ? String(v).slice(2) : String(v);
  return /^[0-9a-fA-F]*$/.test(s) && s.length % 2 === 0
    ? Buffer.from(s, "hex")
    : Buffer.from(String(v), "utf8");
}

function verNum(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^V\d+$/i.test(v)) return parseInt(v.slice(1), 10);
  return 0;
}

function covenantToBorsh(v) {
  const b = hx(v ?? "");
  const lenPrefix = [];
  let n = b.length;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    lenPrefix.push(byte);
  } while (n !== 0);
  return Buffer.concat([Buffer.from(lenPrefix), b]);
}

function mapFeatures(f) {
  if (!f) return undefined;
  const rpt =
    typeof f.range_proof_type === "string"
      ? (RANGE_PROOF_TYPES[String(f.range_proof_type).toLowerCase()] ?? 0)
      : Number(f.range_proof_type ?? 0);
  return {
    version: verNum(f.version),
    outputType: Number(f.output_type ?? 0),
    maturity: Number(f.maturity ?? 0),
    coinbaseExtra: hx(f.coinbase_extra ?? ""),
    rangeProofType: rpt,
  };
}

function cap(s) {
  if (!s) return undefined;
  return {
    ephemeralCommitment: hx(s.ephemeral_commitment),
    ephemeralPubkey: hx(s.ephemeral_pubkey),
    uA: hx(s.u_a),
    uX: hx(s.u_x),
    uY: hx(s.u_y),
  };
}

function mapInput(inp) {
  const variant = inp.spent_output ?? {};
  const so = variant.OutputData ?? {};
  const isFull = !!variant.OutputData;
  const chainHash = isFull ? null : variant.OutputHash ?? inp.output_hash ?? null;

  if (!isFull && !chainHash) return { outputHash: Buffer.alloc(0), scriptSignature: cap(inp.script_signature) };

  const out = {
    version: verNum(inp.version),
    features: mapFeatures(so.features),
    commitment: hx(so.commitment),
    script: hx(so.script),
    senderOffsetPublicKey: hx(so.sender_offset_public_key),
    inputData: hx(inp.input_data ?? ""),
    covenant: covenantToBorsh(so.covenant ?? ""),
    encryptedData: hx(so.encrypted_data?.data),
    metadataSignature: cap(so.metadata_signature),
    rangeproofHash: hx(so.rangeproof_hash),
    minimumValuePromise: Number(so.minimum_value_promise ?? 0),
  };
  const sig = cap(inp.script_signature);
  if (sig) out.scriptSignature = sig;
  if (chainHash) out.outputHash = hx(chainHash);
  return out;
}

function mapOutput(o) {
  const out = {
    version: verNum(o.version),
    features: mapFeatures(o.features),
    commitment: hx(o.commitment),
    script: hx(o.script),
    senderOffsetPublicKey: hx(o.sender_offset_public_key),
    metadataSignature: cap(o.metadata_signature),
    covenant: covenantToBorsh(o.covenant ?? ""),
    encryptedData: hx(o.encrypted_data?.data),
    minimumValuePromise: Number(o.minimum_value_promise ?? 0),
  };
  if (o.proof) out.rangeProof = { proofBytes: hx(o.proof) };
  return out;
}

function mapKernel(k) {
  const out = {
    version: verNum(k.version),
    features: Number(k.features ?? 0),
    fee: String(k.fee ?? "0"),
    lockHeight: String(k.lock_height ?? "0"),
    excess: hx(k.excess),
  };
  if (k.excess_sig) {
    out.excessSig = {
      publicNonce: hx(k.excess_sig.public_nonce),
      signature: hx(k.excess_sig.signature),
    };
  }
  if (k.burn_commitment) out.burnCommitment = hx(k.burn_commitment);
  return out;
}

export function serdeTxToProtoRequest(tx) {
  return {
    transaction: {
      offset: hx(tx.offset),
      body: {
        inputs: (tx.body?.inputs ?? []).map(mapInput),
        outputs: (tx.body?.outputs ?? []).map(mapOutput),
        kernels: (tx.body?.kernels ?? []).map(mapKernel),
      },
      scriptOffset: hx(tx.script_offset),
    },
  };
}
