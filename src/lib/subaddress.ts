// Sub-addresses for the L1 wallet.
//
// A sub-address is this wallet's own address with a payment id attached. Crucially it carries the
// *same* view and spend keys — the payment id only rides along in the address's memo field — so a
// payment to a sub-address is recovered by exactly the same scanning that finds a payment to the
// main address. No new key material is derived anywhere, which is what makes it impossible for a
// sub-address to receive funds this wallet cannot spend. (Proven in the wasm crate's
// `tests/sub_addresses.rs`.)
//
// A sending wallet copies the address's payment id into the output's memo — see
// `transaction_service/service.rs`'s "Address contains memo, overriding memo" path — and this
// wallet reads it back off the recovered output, which is what attributes a payment to the
// sub-address it was sent to.

import type { WasmTariAddress } from "@chironbuilder/tari-l1-wasm";

/** The address format's own ceiling on a payment id. */
export const MAX_PAYMENT_ID_BYTES = 256;

/**
 * Practical cap for a label. Well under the format limit, and short enough that the resulting
 * address stays a sane length to paste around.
 */
export const MAX_LABEL_BYTES = 64;

export interface SubAddress {
  /** The label, which is also the payment id — senders echo it into the output's memo. */
  label: string;
  /** Cached base58 form so the list renders without re-deriving each time. */
  base58: string;
  createdAt: number;
}

const encoder = new TextEncoder();

export function labelBytes(label: string): Uint8Array {
  return encoder.encode(label.trim());
}

export type LabelProblem = "empty" | "too-long" | "duplicate";

/** Validates a proposed label against the format's limits and the labels already in use. */
export function checkLabel(label: string, existing: SubAddress[]): LabelProblem | null {
  const trimmed = label.trim();
  if (trimmed.length === 0) return "empty";
  if (labelBytes(trimmed).length > MAX_LABEL_BYTES) return "too-long";
  // Attribution matches an incoming memo against these labels, so two sub-addresses sharing one
  // would make an incoming payment ambiguous.
  if (existing.some((s) => s.label.toLowerCase() === trimmed.toLowerCase())) return "duplicate";
  return null;
}

export function describeLabelProblem(problem: LabelProblem): string {
  switch (problem) {
    case "empty":
      return "Give it a name — the name is what senders' wallets attach to the payment.";
    case "too-long":
      return `Keep it under ${MAX_LABEL_BYTES} bytes.`;
    case "duplicate":
      return "You already have a sub-address with that name.";
  }
}

/** Derives the sub-address for a label from the wallet's own address. */
export function deriveSubAddress(walletAddress: WasmTariAddress, label: string): SubAddress {
  const trimmed = label.trim();
  const address = walletAddress.withPaymentId(labelBytes(trimmed));
  return { label: trimmed, base58: address.toBase58(), createdAt: Date.now() };
}

/**
 * Which sub-address an incoming payment landed on, or null when it went to the main address.
 *
 * The payment id comes back as raw bytes from the sender's memo; sub-addresses created here use
 * the label's UTF-8, so a byte-wise comparison against each known label is the match.
 */
export function attributePayment(paymentId: Uint8Array | undefined, subs: SubAddress[]): SubAddress | null {
  if (!paymentId || paymentId.length === 0) return null;
  for (const sub of subs) {
    const expected = labelBytes(sub.label);
    if (expected.length !== paymentId.length) continue;
    let same = true;
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== paymentId[i]) {
        same = false;
        break;
      }
    }
    if (same) return sub;
  }
  return null;
}
