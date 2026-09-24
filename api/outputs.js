import { getClient, hex, mapOutput, json, corsHeaders, allowRequest } from "./_grpc.js";

/**
 * Full records for named outputs in one block.
 *
 * The scan pass omits range proofs and chain hashes, which is where roughly half the bytes go. A
 * wallet only needs them for outputs it has recognised as its own, and that is a handful per scan
 * rather than every output in every block — so it asks for those here, by commitment.
 */
const MAX_COMMITMENTS = 256;

function fetchBlock(height) {
  return new Promise((resolve, reject) => {
    const out = [];
    const call = getClient().getBlocks({ heights: [height] }, { deadline: Date.now() + 10_000 });
    call.on("data", (hb) => {
      out.push(...(hb.block?.body?.outputs || []));
    });
    call.on("error", reject);
    call.on("end", () => resolve(out));
  });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  if (!allowRequest(req, 60)) return json(res, 429, { error: "rate limit exceeded" });
  const url = new URL(req.url, "http://localhost");
  const height = Number(url.searchParams.get("height"));
  const wanted = (url.searchParams.get("commitments") ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);

  if (!Number.isFinite(height) || height < 0) {
    return json(res, 400, { error: "invalid height" });
  }
  if (wanted.length === 0) return json(res, 200, { outputs: [] });
  if (wanted.length > MAX_COMMITMENTS) {
    return json(res, 400, { error: `at most ${MAX_COMMITMENTS} commitments per request` });
  }

  try {
    const want = new Set(wanted);
    const outputs = [];
    for (const o of await fetchBlock(height)) {
      if (want.has(hex(o.commitment).toLowerCase())) outputs.push(mapOutput(o));
    }
    json(res, 200, { outputs });
  } catch (e) {
    json(res, 502, { error: e?.message || String(e) });
  }
}
