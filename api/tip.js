import { getClient, json, CORS } from "./_grpc.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  try {
    const r = await new Promise((resolve, reject) => {
      getClient().getTipInfo({}, (err, resp) =>
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
