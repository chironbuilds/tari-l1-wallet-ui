import type { ScanBlock, ScanOutput } from "./scanner";
import type { SubmitOutcome } from "./tari";

/**
 * A base node's own wallet HTTP query service.
 *
 * Every base node since 5.6.0-pre.1 serves this alongside gRPC (`applications/minotari_node/src/
 * http/server.rs`), and Tari runs a public MainNet instance at the address below — the per-network
 * defaults live in `common/src/configuration/bootstrap.rs`,
 * `wallet_get_default_seed_https_address`. It answers with `access-control-allow-origin` echoing
 * the caller's origin, so unlike gRPC it is reachable from a browser with no middleware in front
 * of it.
 *
 * That makes it a strictly better source than the gRPC bridge for everything the wallet does:
 * `sync_utxos_by_block` hands back exactly the scan projection the ownership test needs and
 * nothing else, paged by a server-side cursor, and `json_rpc` accepts a broadcast. The bridge is
 * kept only as a fallback for when this endpoint is unreachable.
 */
export const DEFAULT_RPC_URL = "https://rpc.tari.com";

let rpcBase: string | null = DEFAULT_RPC_URL;

/** Overrides the query service, or disables it entirely (`null`) so everything falls to the bridge. */
export function setRpcBase(url: string | null): void {
  rpcBase = url ? url.trim().replace(/\/+$/, "") : null;
}

export function getRpcBase(): string | null {
  return rpcBase;
}

function requireBase(): string {
  if (!rpcBase) throw new Error("query service disabled");
  return rpcBase;
}

/** A covenant carrying no bytes: the varint length `0`, and nothing after it. */
const EMPTY_COVENANT = "00";

/**
 * Five zero scalars, borsh-framed, standing in for a metadata signature the sync projection does
 * not carry. Never verified — recovery has already decided ownership by the time this is read —
 * it only has to be structurally a signature.
 */
const PLACEHOLDER_METADATA_SIG = ("20000000" + "00".repeat(32)).repeat(5);

/** Blocks per `sync_utxos_by_block` page. The node also stops early at its own response budget. */
const SYNC_LIMIT = 20;
/** Safety stop, so a server that keeps handing back a cursor cannot spin here forever. */
const MAX_PAGES = 400;

/**
 * Byte fields come back in three different encodings depending on the endpoint — headers as
 * number arrays, `sync_utxos_by_block` bodies as base64, `get_utxos_by_block` and `fetch_utxo` as
 * hex — and `next_header_to_scan` is hex inside a response whose other fields are base64. Rather
 * than track which is which per field, everything is normalised here.
 *
 * The string case distinguishes by charset: a base64 payload of any realistic length is
 * overwhelmingly unlikely to be all hex digits, and never has odd length after padding is counted.
 */
function toHex(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") {
    if (v === "") return "";
    if (/^[0-9a-fA-F]+$/.test(v) && v.length % 2 === 0) return v.toLowerCase();
    return base64ToHex(v);
  }
  if (Array.isArray(v)) return bytesToHex(Uint8Array.from(v as number[]));
  if (v instanceof Uint8Array) return bytesToHex(v);
  // `encrypted_data` arrives wrapped as `{ data: "…" }`.
  if (typeof v === "object" && "data" in (v as Record<string, unknown>)) {
    return toHex((v as Record<string, unknown>).data);
  }
  return "";
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

function base64ToHex(s: string): string {
  const bin = atob(s);
  let out = "";
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return out;
}

/**
 * A covenant, framed the way `importScannedOutput` reads it: a varint byte length, then the bytes.
 *
 * This API hex-encodes the covenant's contents alone, so an empty covenant arrives as an empty
 * string, where the same output over gRPC carries the framed `00`. Handing the bare contents
 * through fails to parse — "invalid covenant: Reached EOF" — for every output on the chain, since
 * almost all of them have no covenant.
 */
function covenantHex(v: unknown): string {
  const body = toHex(v);
  let n = body.length / 2;
  let prefix = "";
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    prefix += byte.toString(16).padStart(2, "0");
  } while (n !== 0);
  return prefix + body;
}

/** The wire spells the range proof type, but `importScannedOutput` wants the discriminant. */
const RANGE_PROOF_TYPES: Record<string, number> = { bullet_proof_plus: 0, revealed_value: 1 };

function rangeProofByte(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return RANGE_PROOF_TYPES[v] ?? 0;
  return 0;
}

/** Versions are spelled `V0`/`V1` on this API, and output types as plain numbers. */
function numeric(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const m = /^V(\d+)$/i.exec(v);
    if (m) return Number(m[1]);
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * The metadata signature is five separate scalars on the wire but one borsh-framed blob to
 * `importScannedOutput` — each field length-prefixed with a little-endian u32.
 */
function metadataSigHex(ms: Record<string, unknown> | null | undefined): string {
  if (!ms) return "";
  const parts = ["ephemeral_commitment", "ephemeral_pubkey", "u_a", "u_x", "u_y"].map((k) => {
    const hex = toHex(ms[k]);
    const len = (hex.length / 2) & 0xffffffff;
    const le = [len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return le + hex;
  });
  return parts.join("");
}

/**
 * Where a broadcast is POSTed, best first.
 *
 * The query service's CORS allows reads but not writes: a preflight for `POST /json_rpc` comes
 * back `access-control-allow-methods: GET`, so the browser blocks the broadcast even though the
 * endpoint itself works (curl and Node reach it fine — they do not enforce CORS, which is exactly
 * why this passed a command-line test and failed in the page).
 *
 * A same-origin path has no preflight at all, so a deployment that proxies `/rpc/json_rpc` to the
 * node fixes it outright. The direct URL stays as the fallback for a host that does not, and for
 * any non-browser caller where it works unmodified.
 */
function submitUrls(base: string): string[] {
  const urls: string[] = [];
  if (typeof window !== "undefined" && window.location?.origin?.startsWith("http")) {
    urls.push(`${window.location.origin}/rpc/json_rpc`);
  }
  urls.push(`${base}/json_rpc`);
  return urls;
}

async function getJson(
  base: string,
  path: string,
  params: Record<string, string | number | boolean>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  const r = await fetch(`${base}${path}?${q}`, { signal });
  if (!r.ok) throw new Error(`rpc ${path} ${r.status}: ${(await r.text()).slice(0, 140)}`);
  return (await r.json()) as Record<string, unknown>;
}

export async function rpcTip(
  signal?: AbortSignal,
): Promise<{ height: number; prunedHeight: number; timestamp: number }> {
  const j = await getJson(requireBase(), "/get_tip_info", {}, signal);
  const meta = (j.metadata ?? {}) as Record<string, unknown>;
  return {
    height: Number(meta.best_block_height ?? 0),
    prunedHeight: Number(meta.pruned_height ?? 0),
    timestamp: Number(meta.timestamp ?? 0),
  };
}

/**
 * The height a timestamp falls in, straight from the node.
 *
 * The bridge has no equivalent, so the fallback path binary-searches block timestamps — a dozen
 * or more round trips to place a birthday. This is one.
 */
export async function rpcHeightAtTime(epochSeconds: number, signal?: AbortSignal): Promise<number> {
  const j = await getJson(requireBase(), "/get_height_at_time", { time: epochSeconds }, signal);
  // Answers as a bare number on some builds and a wrapped object on others.
  if (typeof j === "number") return j as unknown as number;
  return Number((j as Record<string, unknown>).height ?? j);
}

async function headerHashAt(base: string, height: number, signal?: AbortSignal): Promise<string> {
  const j = await getJson(base, "/get_header_by_height", { height }, signal);
  const hash = toHex(j.hash ?? (j.header as Record<string, unknown> | undefined)?.hash);
  if (!hash) throw new Error(`no header at height ${height}`);
  return hash;
}

/**
 * Blocks `from`..`to`, in the projection the ownership test needs.
 *
 * `sync_utxos_by_block` is cursored by header hash rather than height, so the range is anchored by
 * resolving `from` to a hash once and then following `next_header_to_scan`. The node decides how
 * much fits in a page, which is what removes the bridge's byte-budget bookkeeping: there is no
 * response here that a single oversized block can overflow.
 *
 * The four fields it returns — commitment, encrypted data, sender offset key, output hash — are
 * exactly what `try_output_key_recovery` reads. Everything else is left at its zero value and
 * re-fetched in full by `rpcFullOutputs` for the handful of outputs that turn out to be ours;
 * passing empty script and metadata signature here is verified not to disturb the ownership
 * answer for either standard or coinbase outputs.
 */
export async function rpcBlockBatch(
  from: number,
  to: number,
  signal?: AbortSignal,
): Promise<ScanBlock[]> {
  const base = requireBase();
  /**
   * By height, because one block can be split across several entries of a single response when it
   * holds more outputs than the node's chunk size — the same height then arrives more than once
   * and the parts have to be stitched back together.
   */
  const merged = new Map<number, ScanBlock>();
  let cursor = await headerHashAt(base, from, signal);
  let next = from;

  for (let page = 0; page < MAX_PAGES && cursor && next <= to; page++) {
    const j = await getJson(
      base,
      "/sync_utxos_by_block",
      {
        start_header_hash: cursor,
        limit: Math.min(to - next + 1, SYNC_LIMIT),
        page: 0,
        exclude_spent: false,
        exclude_inputs: false,
        version: 1,
      },
      signal,
    );
    const pageBlocks = (j.blocks ?? []) as Record<string, unknown>[];
    if (pageBlocks.length === 0) break;

    for (const b of pageBlocks) {
      const height = Number(b.height ?? 0);
      if (height > to) continue;
      absorb(merged, height, b);
      next = Math.max(next, height + 1);
    }

    // `has_next_page` says the *requested range* is exhausted, not the chain: the node clears it
    // whenever a page fills, while still naming the header to resume from. Reading it as "stop"
    // truncates a scan silently, which is the one failure mode that loses money quietly, so the
    // cursor drives the loop and an empty cursor — set only at the tip — ends it.
    const c = toHex(j.next_header_to_scan);
    if (!c) break;
    if (c === cursor) {
      // The node could not fit this block in a page and handed back the same header rather than
      // advance, so what arrived for it is partial. Take the block whole from the endpoint that
      // never splits one, then step past it by height.
      await absorbWholeBlock(base, merged, next - 1, cursor, signal);
      if (next > to) break;
      cursor = await headerHashAt(base, next, signal);
      continue;
    }
    cursor = c;
  }

  return [...merged.values()].sort((a, b) => a.height - b.height);
}

function absorb(merged: Map<number, ScanBlock>, height: number, b: Record<string, unknown>): void {
  const outputs = ((b.outputs ?? []) as Record<string, unknown>[]).map(
    (o): ScanOutput => ({
      commitment_hex: toHex(o.commitment),
      hash_hex: toHex(o.output_hash),
      encrypted_data_hex: toHex(o.encrypted_data),
      sender_offset_pub_hex: toHex(o.sender_offset_public_key),
      // The sync projection carries none of these, and the ownership test does not read them —
      // but it only gets to *skip* them for an output that is not ours. Recovery on one that IS
      // ours succeeds and then builds the output in full, and anything unparseable fails there,
      // after the answer was already yes. So these are not blanks: they are the shortest values
      // that parse. Leaving the metadata signature or the covenant empty makes every owned output
      // fail with "Unexpected length of input" / "invalid covenant: Reached EOF", and the scan
      // quietly finds nothing at all.
      //
      // The script is the exception: empty is a valid empty script, while `00` is an invalid
      // opcode. None of it is kept — an owned output is re-fetched in full by `rpcFullOutputs`
      // before anything is stored.
      script_hex: "",
      metadata_sig_hex: PLACEHOLDER_METADATA_SIG,
      minimum_value_promise: "0",
      maturity: "0",
      output_type_byte: 0,
      range_proof_type_byte: 0,
      coinbase_extra_hex: "",
      covenant_hex: EMPTY_COVENANT,
    }),
  );
  // Spends arrive as the hash of the consumed output, never its commitment.
  const inputHashes = ((b.inputs ?? []) as unknown[]).map(toHex);
  const seen = merged.get(height);
  if (seen) {
    seen.outputs.push(...outputs);
    seen.inputHashes = [...(seen.inputHashes ?? []), ...inputHashes];
    return;
  }
  merged.set(height, {
    height,
    timestamp: Number(b.mined_timestamp ?? 0),
    outputs,
    inputHashes,
  });
}

/** Replaces whatever was collected for one height with the block in full. */
async function absorbWholeBlock(
  base: string,
  merged: Map<number, ScanBlock>,
  height: number,
  headerHash: string,
  signal?: AbortSignal,
): Promise<void> {
  const j = await getJson(base, "/get_utxos_by_block", { header_hash: headerHash }, signal);
  const seen = merged.get(height);
  const outputs = ((j.outputs ?? []) as Record<string, unknown>[]).map((o) => {
    const commitment = toHex(o.commitment);
    return {
      ...mapFullOutput(o, ""),
      // The chain hash is not part of this record; keep the one the sync pass reported.
      hash_hex:
        seen?.outputs.find((x) => x.commitment_hex === commitment)?.hash_hex ?? "",
    };
  });
  merged.set(height, {
    height,
    timestamp: Number(j.mined_timestamp ?? seen?.timestamp ?? 0),
    outputs,
    inputHashes: seen?.inputHashes ?? [],
  });
}

function mapFullOutput(o: Record<string, unknown>, hashHex: string): ScanOutput {
  const f = (o.features ?? {}) as Record<string, unknown>;
  return {
    commitment_hex: toHex(o.commitment),
    hash_hex: hashHex,
    encrypted_data_hex: toHex(o.encrypted_data),
    sender_offset_pub_hex: toHex(o.sender_offset_public_key),
    script_hex: toHex(o.script),
    metadata_sig_hex: metadataSigHex(o.metadata_signature as Record<string, unknown>),
    minimum_value_promise: String(o.minimum_value_promise ?? "0"),
    maturity: String(f.maturity ?? "0"),
    output_type_byte: numeric(f.output_type),
    range_proof_type_byte: rangeProofByte(f.range_proof_type),
    coinbase_extra_hex: toHex(f.coinbase_extra),
    covenant_hex: covenantHex(o.covenant),
    // `proof` on this API; `range_proof` over gRPC.
    range_proof_hex: toHex(o.proof ?? o.range_proof),
  };
}

/**
 * Full records for outputs the wallet has recognised as its own, keyed by commitment.
 *
 * `get_utxos_by_block` returns every output of one block in full, which is heavy — but hydration
 * only ever runs for a block that holds one of our outputs, so it is paid rarely. The alternative,
 * `fetch_utxo`, is per-output and needs the chain hash, and this way one request covers however
 * many of ours a block happens to contain.
 *
 * The chain hash is not part of a `get_utxos_by_block` record, so it is carried over from the scan
 * pass — an output stored without it cannot be replayed later.
 */
export async function rpcFullOutputs(
  height: number,
  commitments: string[],
  hashes?: Map<string, string>,
  signal?: AbortSignal,
): Promise<Map<string, ScanOutput>> {
  const base = requireBase();
  const wanted = new Set(commitments.map((c) => c.toLowerCase()));
  const headerHash = await headerHashAt(base, height, signal);
  const j = await getJson(base, "/get_utxos_by_block", { header_hash: headerHash }, signal);

  const out = new Map<string, ScanOutput>();
  for (const o of (j.outputs ?? []) as Record<string, unknown>[]) {
    const commitment = toHex(o.commitment);
    if (!wanted.has(commitment)) continue;
    out.set(commitment, mapFullOutput(o, hashes?.get(commitment) ?? ""));
  }
  return out;
}

/**
 * Broadcast.
 *
 * The node deserialises the *serde* `Transaction` here — `{offset, body:{sorted, inputs, outputs,
 * kernels}, script_offset}` — which is precisely what `WasmSignedTransaction.toJson()` produces.
 * Nothing has to be remapped onto the gRPC proto schema on the way, so the whole
 * `server/serde-to-proto.js` layer is bypassed on this path.
 */
export async function rpcSubmit(transactionJson: string): Promise<SubmitOutcome> {
  const base = requireBase();
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    // Must be a string; an integer id is rejected by the deserialiser.
    id: "1",
    method: "submit_transaction",
    params: { transaction: JSON.parse(transactionJson), version: 2 },
  });

  let res: Response | null = null;
  for (const url of submitUrls(base)) {
    try {
      const attempt = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
      // A deployment without the proxy answers 404/405 for the same-origin path; that is a
      // missing route rather than the node's verdict, so keep going. Anything else — including a
      // rejection — is a real answer and ends the search.
      if (attempt.status === 404 || attempt.status === 405) continue;
      res = attempt;
      break;
    } catch {
      // Blocked by CORS or unreachable: try the next candidate.
    }
  }
  if (!res) throw new Error("no reachable submit endpoint");
  const body = await res.text();
  let parsed: { result?: unknown; error?: unknown } | null = null;
  try {
    parsed = JSON.parse(body) as { result?: unknown; error?: unknown };
  } catch {
    /* non-json error body */
  }
  if (!res.ok || parsed?.error) {
    return {
      accepted: false,
      result: parsed?.error ? String(parsed.error) : `HTTP ${res.status}`,
      detail: body.slice(0, 500),
    };
  }
  // V1 answers with the bare result name; V2 with `{accepted, is_synced, rejection_reason}`,
  // where the reason is spelled in camel case and the rest of the app expects the gRPC spelling.
  const result = parsed?.result as Record<string, unknown> | string | undefined;
  if (typeof result === "string") {
    return { accepted: result === "ACCEPTED", result, detail: body.slice(0, 500) };
  }
  const accepted = result?.accepted === true;
  const reason = result?.rejection_reason;
  const name = accepted
    ? "ACCEPTED"
    : typeof reason === "string" && reason
      ? reason.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()
      : "NONE";
  return { accepted, result: name, detail: body.slice(0, 500) };
}
