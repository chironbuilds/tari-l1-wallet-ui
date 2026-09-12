import { getClient, submitTransactionRaw, serdeTxToProtoRequest, SubmitTxReq, json, CORS } from "./_grpc.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return json(res, 400, { error: "invalid json" });
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
