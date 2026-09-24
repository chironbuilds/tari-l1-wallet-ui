import { getClient, json, corsHeaders, allowRequest } from "./_grpc.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  if (!allowRequest(req, 60)) return json(res, 429, { error: "rate limit exceeded" });
  try {
    const r = await new Promise((resolve, reject) => {
      getClient().getTipInfo({}, { deadline: Date.now() + 10_000 }, (err, resp) =>
        err ? reject(err) : resolve(resp),
      );
    });
    json(res, 200, {
      height: Number(r.metadata?.bestBlockHeight ?? 0),
      prunedHeight: Number(r.metadata?.prunedHeight ?? 0),
      hash: (() => {
        const b = r.metadata?.bestBlock;
        return b ? Buffer.from(b).toString("hex") : "";
      })(),
      timestamp: Date.now(),
    });
  } catch (e) {
    json(res, 502, { error: e?.message || String(e) });
  }
}
