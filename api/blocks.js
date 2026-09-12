import { getClient, hex, mapOutput, mapOutputScan, json, CORS } from "./_grpc.js";

const MAX_SPAN = 100;
/** Heights pulled from the node per round. Small, so a budget stop wastes little work. */
const GROUP = 10;
/**
 * How many outputs one response may carry, by mode.
 *
 * The platform caps a response body, and a block's size is not knowable before it is fetched, so
 * the client cannot pick a block span that is guaranteed to fit — it used to guess with a fixed
 * 100-block window and a single busy block could blow the limit. The server decides instead: it
 * fills a response up to this budget, then hands back a cursor saying where to resume. A block
 * larger than the whole budget is split across responses rather than failing, which is what makes
 * an arbitrarily large block scannable at all.
 */
const BUDGET = { scan: 6000, full: 1200 };

function fetchHeights(heights) {
  return new Promise((resolve, reject) => {
    const out = [];
    const call = getClient().getBlocks({ heights });
    call.on("data", (hb) => {
      out.push({
        height: Number(hb.block?.header?.height ?? 0),
        timestamp: Number(hb.block?.header?.timestamp ?? 0),
        outputs: hb.block?.body?.outputs || [],
        // Commitments spent in this block. A scanner needs these to avoid resurrecting an output
        // it once owned but has since spent — the node answers ALREADY_MINED for such an input.
        inputs: (hb.block?.body?.inputs || []).map((i) => hex(i.commitment)),
      });
    });
    call.on("error", reject);
    call.on("end", () => resolve(out));
  });
}

/** Fetches one group, falling back to single heights when the node refuses a batch as too large. */
async function fetchGroup(heights) {
  try {
    return await fetchHeights(heights);
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/resource_exhausted|larger than max/i.test(msg) || heights.length === 1) {
      return heights.map((h) => ({ height: h, outputs: [], inputs: [], error: msg.slice(0, 200) }));
    }
    const singles = [];
    for (const h of heights) {
      try {
        singles.push(...(await fetchHeights([h])));
      } catch (e2) {
        singles.push({
          height: h,
          outputs: [],
          inputs: [],
          error: String(e2?.message || e2).slice(0, 200),
        });
      }
    }
    return singles;
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  const url = new URL(req.url, "http://localhost");
  const from = Number(url.searchParams.get("from"));
  let to = Number(url.searchParams.get("to") ?? from);
  const mode = url.searchParams.get("fields") === "scan" ? "scan" : "full";
  // Where to resume inside the first height, when a previous response ran out of budget mid-block.
  const startOffset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);

  // Genesis is height 0, so 0 is a real block and a legitimate place for a full rescan to start.
  // Only a negative or non-numeric height is nonsense.
  if (!Number.isFinite(from) || from < 0 || to < from) {
    return json(res, 400, { error: "invalid range" });
  }
  to = Math.min(to, from + MAX_SPAN - 1);

  const project = mode === "scan" ? mapOutputScan : mapOutput;
  const budget = BUDGET[mode];

  try {
    const blocks = [];
    let remaining = budget;
    let cursor = null;
    let offset = startOffset;

    outer: for (let h = from; h <= to; h += GROUP) {
      const heights = [];
      for (let g = h; g < h + GROUP && g <= to; g++) heights.push(g);
      const fetched = (await fetchGroup(heights)).sort((a, b) => a.height - b.height);

      for (const b of fetched) {
        if (b.error) {
          blocks.push({ height: b.height, outputs: [], inputs: [], error: b.error });
          // The resume offset belongs to the height the cursor named, and nothing past it.
          offset = 0;
          continue;
        }
        const total = b.outputs.length;
        const slice = b.outputs.slice(offset, offset + remaining);
        const end = offset + slice.length;

        blocks.push({
          height: b.height,
          timestamp: b.timestamp,
          outputs: slice.map(project),
          // Spends belong to the block, not to a page of it. Sending them only with the first page
          // keeps the client from counting the same commitment twice across a split block.
          inputs: offset === 0 ? b.inputs : [],
          ...(total > end ? { outputTotal: total, outputOffset: offset } : {}),
        });

        remaining -= slice.length;
        if (end < total) {
          // Budget ran out inside this block; resume here rather than dropping the remainder.
          cursor = { height: b.height, offset: end };
          break outer;
        }
        offset = 0;
        if (remaining <= 0) {
          if (b.height < to) cursor = { height: b.height + 1, offset: 0 };
          break outer;
        }
      }
    }

    json(res, 200, { blocks, cursor });
  } catch (e) {
    json(res, 502, { error: e?.message || String(e) });
  }
}
