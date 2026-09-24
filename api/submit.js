import { submitTransactionRaw, serdeTxToProtoRequest, SubmitTxReq, json, corsHeaders, allowRequest } from "./_grpc.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  if (!allowRequest(req, 10)) return json(res, 429, { error: "rate limit exceeded" });
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const body = req.body;
  if (Buffer.byteLength(JSON.stringify(body ?? {})) > MAX_BODY_BYTES) {
    return json(res, 413, { error: "request body too large" });
  }
  try {
    let requestBuf;
    if (body.request_b64) {
      requestBuf = Buffer.from(body.request_b64, "base64");
      if (requestBuf.length === 0) return json(res, 400, { error: "invalid request bytes" });
    } else {
      let txObj = body.transaction;
      if (!txObj && body.transaction_json) {
        txObj = JSON.parse(body.transaction_json);
      }
      if (!txObj) return json(res, 400, { error: "missing transaction" });
      const mapped = serdeTxToProtoRequest(txObj);
      requestBuf = SubmitTxReq.encode(SubmitTxReq.fromObject(mapped)).finish();
    }
    const resp = await submitTransactionRaw(requestBuf);
    json(res, 200, { result: resp.result ?? "NONE" });
  } catch (e) {
    json(res, 502, { error: e?.message || String(e) });
  }
}
