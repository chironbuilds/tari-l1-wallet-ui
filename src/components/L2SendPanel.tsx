import { useMemo, useState } from "react";
import { Check, Eye, EyeOff, Send, Wallet } from "lucide-react";
import { useStore } from "../store";
import { parseOotleAddress } from "@tari-project/ootle-wasm";
import { OOTLE_NETWORK, TARI_RESOURCE_ADDRESS, formatResourceAmount, toOotleNetwork, type TokenBalance } from "../ootle";
import { truncMiddle } from "../lib/format";
import { useToast } from "./toast";
import { Button, Field, TextInput } from "./ui";

type Mode = "send" | "sendPrivately" | "shield" | "unshield";

const MODES: { id: Mode; label: string; blurb: string }[] = [
  {
    id: "send",
    label: "Send",
    blurb: "A public transfer: the amount is visible on chain to anyone looking.",
  },
  {
    id: "sendPrivately",
    label: "Send privately",
    blurb:
      "Pays from your shielded funds into a stealth output only the recipient can open — the amount stays hidden.",
  },
  {
    id: "shield",
    label: "Shield",
    blurb: "Move revealed funds into a private output that only your view key can open.",
  },
  {
    id: "unshield",
    label: "Unshield",
    blurb: "Bring private funds back out into your revealed balance.",
  },
];

/**
 * Moving funds on Ootle: a plain transfer, or shielding/unshielding within your own account.
 *
 * Deliberately narrower than the L1 send panel — L2 has no coin selection or fee-per-gram to
 * reason about. A transfer names a resource, an amount and (for a send) a recipient; the account
 * pays a flat max fee out of its own vault.
 */
export function L2SendPanel() {
  const store = useStore();
  const toast = useToast();
  const { identity, balances } = store.l2;

  const [mode, setMode] = useState<Mode>("send");
  const usable = useMemo(
    // NonFungible excluded: this panel sends a decimal *amount* of a resource, but an NFT's
    // `amount` is a token count (see TokenBalance.nonFungibleTokenIds's doc comment) -- sending a
    // specific NFT needs its token id, a different flow this panel doesn't build yet, not a
    // quantity picker that would otherwise show a Confidential/Stealth-shaped balance for it.
    () => balances.filter((b) => b.kind !== "NonFungible" && (b.amount > 0n || b.confidentialAmount > 0n)),
    [balances],
  );
  const [resourceAddress, setResourceAddress] = useState<string>(
    () => usable.find((b) => b.resourceAddress === TARI_RESOURCE_ADDRESS)?.resourceAddress ?? usable[0]?.resourceAddress ?? "",
  );
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  const resource = usable.find((b) => b.resourceAddress === resourceAddress) ?? null;
  const amountRaw = useMemo(() => toRawAmount(amount, resource?.divisibility ?? 0), [amount, resource]);

  // A private send and an unshield both spend the shielded side of the vault; the public send and
  // a shield spend the revealed side.
  const spendsPrivate = mode === "unshield" || mode === "sendPrivately";
  const available = resource ? (spendsPrivate ? resource.confidentialAmount : resource.amount) : 0n;

  // A Stealth resource holds both sides at once: stealth UTXOs held as separate substates, and a
  // plain `revealed_amount` on the vault's own container. Only the first needs `StealthTransfer`.
  // The revealed side is spent by the ordinary `withdraw` + `deposit` pair like any other
  // resource — `ResourceContainer::withdraw` has a first-class `Stealth` arm that decrements
  // `revealed_amount` and hands back a Stealth bucket (`engine_types/src/resource_container.rs`),
  // the account template's `withdraw` is generic over the kind, and nothing in the SDK refuses to
  // sign it. So there is no resource kind that can only move privately.
  //
  // A public send of a Stealth resource fails only when its revealed balance is short, which is
  // the ordinary insufficient-funds case `overBalance` below already covers.
  const revealedEmpty = !!resource && resource.kind === "Stealth" && resource.amount === 0n;

  // Validated by the SDK's own parser rather than a pattern of our own. A real address looks like
  // `otl_esm_1sjfdh…` — two underscores, since the network is its own segment — and carries a
  // bech32m checksum, so a hand-written regex both rejects valid addresses and waves through
  // typo'd ones. This also catches an address meant for a different Ootle network.
  const recipientCheck = useMemo((): { valid: boolean; message: string | null } => {
    const value = recipient.trim();
    if (!value) return { valid: false, message: null };
    try {
      const parsed = parseOotleAddress(value);
      if (parsed.network !== toOotleNetwork(OOTLE_NETWORK)) {
        return { valid: false, message: "That address belongs to a different Ootle network." };
      }
      return { valid: true, message: "Valid Ootle address" };
    } catch {
      return { valid: false, message: "Not a valid Ootle address — check it for a typo." };
    }
  }, [recipient]);
  const recipientValid = recipientCheck.valid;
  const needsRecipient = mode === "send" || mode === "sendPrivately";
  const overBalance = amountRaw !== null && amountRaw > available;
  const canSubmit =
    !!identity &&
    !!resource &&
    amountRaw !== null &&
    amountRaw > 0n &&
    !overBalance &&
    (!needsRecipient || recipientValid);

  async function submit() {
    if (!identity || !resource || amountRaw === null || busy) return;
    setBusy(true);
    try {
      const trimmedMemo = memo.trim() || undefined;
      if (mode === "send") {
        await identity.account.send(recipient.trim(), resource.resourceAddress, amountRaw);
      } else if (mode === "sendPrivately") {
        // Note the argument order: sendPrivately takes (resource, recipient), the reverse of
        // send's (recipient, resource). Both are strings, so nothing but care catches a swap.
        await identity.account.sendPrivately(
          resource.resourceAddress,
          recipient.trim(),
          amountRaw,
          undefined,
          trimmedMemo,
        );
      } else if (mode === "shield") {
        await identity.account.shield(resource.resourceAddress, amountRaw, undefined, trimmedMemo);
      } else {
        await identity.account.unshield(resource.resourceAddress, amountRaw, undefined, trimmedMemo);
      }
      toast({
        tone: "success",
        title:
          mode === "send"
            ? "Sent on Ootle"
            : mode === "sendPrivately"
              ? "Sent privately"
              : mode === "shield"
                ? "Funds shielded"
                : "Funds unshielded",
        message: "Refreshing your balances…",
      });
      setAmount("");
      setRecipient("");
      setMemo("");
      store.refreshL2();
    } catch (e) {
      toast({
        tone: "error",
        title:
          mode === "send" || mode === "sendPrivately"
            ? "Send failed"
            : mode === "shield"
              ? "Shield failed"
              : "Unshield failed",
        message: explainFailure(e),
      });
    }
    setBusy(false);
  }

  if (!identity) {
    return <p className="py-8 text-center text-sm text-zinc-500">Switch to L2 first.</p>;
  }

  const active = MODES.find((m) => m.id === mode)!;

  return (
    <div>
      <h2 className="mb-5 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
        <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#9d6bff] to-[#6d28d9]">
          {mode === "send" || mode === "sendPrivately" ? (
            <Send size={15} />
          ) : mode === "shield" ? (
            <EyeOff size={15} />
          ) : (
            <Eye size={15} />
          )}
        </span>
        Ootle transfer
      </h2>

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-1 sm:grid-cols-4">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              setMode(m.id);
              setAmount("");
            }}
            title={
              m.id === "send" && revealedEmpty
                ? `${resource?.symbol ?? "This token"} has no revealed balance to send publicly — unshield some first.`
                : undefined
            }
            className={
              m.id === mode
                ? "rounded-xl bg-[#9d6bff]/20 px-2 py-2 text-xs font-bold text-[var(--tari-text)]"
                : "rounded-xl px-2 py-2 text-xs font-bold text-zinc-500 hover:text-[var(--tari-text)] disabled:cursor-not-allowed disabled:opacity-40"
            }
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-xs leading-relaxed text-zinc-500">{active.blurb}</p>

      {mode === "send" && revealedEmpty && (
        <p className="mb-4 rounded-2xl border border-[var(--st-amber)]/30 bg-[var(--st-amber)]/10 p-3 text-[11px] leading-relaxed text-[var(--tari-text)]">
          A public send spends your <b>revealed</b> balance, and none is showing —{" "}
          {resource?.symbol ?? "this token"} is currently held entirely in stealth outputs.{" "}
          <b>Unshield</b> some first, or use <b>Send privately</b> to spend the shielded side
          directly.
        </p>
      )}

      {mode === "sendPrivately" && resource && resource.confidentialAmount === 0n && (
        <p className="mb-4 rounded-2xl border border-[var(--st-amber)]/30 bg-[var(--st-amber)]/10 p-3 text-[11px] leading-relaxed text-[var(--tari-text)]">
          A private send spends your <b>shielded</b> balance, and none is showing. Shield some
          first — or, if you shielded from another wallet, use <b>Find private funds</b> on the
          Ootle card to rediscover it.
        </p>
      )}

      {usable.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <Wallet size={28} className="text-zinc-500" />
          <p className="text-sm font-bold text-[var(--tari-text)]">No funds available</p>
          <p className="max-w-[42ch] text-xs text-zinc-500">
            This account holds no Ootle funds. Claim some test TARI from the Ootle card first.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Token">
            <div className="flex flex-wrap gap-2">
              {usable.map((b) => (
                <button
                  key={b.resourceAddress}
                  onClick={() => setResourceAddress(b.resourceAddress)}
                  className={
                    b.resourceAddress === resourceAddress
                      ? "rounded-xl border border-[#9d6bff]/60 bg-[#9d6bff]/15 px-3 py-2 text-xs font-bold text-[var(--tari-text)]"
                      : "rounded-xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] px-3 py-2 text-xs font-bold text-zinc-400"
                  }
                >
                  {b.symbol ?? truncMiddle(b.resourceAddress, 8, 4)}
                  <span className="ml-2 font-mono opacity-70">
                    {formatResourceAmount(spendsPrivate ? b.confidentialAmount : b.amount, b.divisibility)}
                  </span>
                </button>
              ))}
            </div>
          </Field>

          {needsRecipient && (
            <Field
              label="Recipient address"
              hint={recipientCheck.message ?? "The otl_… address of the account you are paying"}
            >
              <div className="relative">
                <TextInput
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="otl_…"
                  mono
                  spellCheck={false}
                  className="pr-10"
                  error={recipient.trim().length > 0 && !recipientValid}
                />
                {recipientValid && (
                  <Check size={16} className="absolute top-1/2 right-3.5 -translate-y-1/2 text-[var(--st-green)]" />
                )}
              </div>
            </Field>
          )}

          <Field
            label="Amount"
            hint={
              resource
                ? `${spendsPrivate ? "Private" : "Revealed"} available: ${formatResourceAmount(
                    available,
                    resource.divisibility,
                  )} ${resource.symbol ?? ""}`
                : ""
            }
          >
            <div className="relative">
              <TextInput
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                className="pr-16"
                error={amount.length > 0 && (amountRaw === null || overBalance)}
              />
              <button
                onClick={() =>
                  resource && setAmount(formatResourceAmount(available, resource.divisibility))
                }
                className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full border border-[var(--tari-border)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--tari-text)] uppercase hover:bg-[color-mix(in_srgb,var(--tari-text)_10%,transparent)]"
              >
                Max
              </button>
            </div>
          </Field>

          {mode !== "send" && (
            <Field
              label="Memo — optional"
              hint={
                mode === "sendPrivately"
                  ? "Travels with the private output to the recipient."
                  : "Stored with the private output, visible only to you."
              }
            >
              <TextInput
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="What is this for?"
              />
            </Field>
          )}

          {overBalance && (
            <p className="text-center text-xs text-[var(--st-red)]">
              More than this account holds — the network fee comes out of the same vault.
            </p>
          )}

          <Button size="lg" className="w-full" disabled={!canSubmit} loading={busy} onClick={() => void submit()}>
            {busy ? "Working…" : active.label}
          </Button>

          <p className="text-center text-[10px] text-zinc-500">
            Shielded funds stay in this account — only their amount is hidden. Sending them to
            someone else is a separate step.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Turns the SDK's failures into something a person can act on.
 *
 * The untagged-enum message used to be reported here as "this token only moves privately", on the
 * theory that the signer refuses a plain withdraw/deposit for a Stealth resource. That is not what
 * it means, and the claim is not true: `ResourceContainer::withdraw` has a first-class `Stealth`
 * arm over `revealed_amount`, and the account template's `withdraw` is generic over the kind. The
 * error is a *serde* failure parsing the resolved transaction inside the wasm — a malformed field
 * somewhere in the transaction — so it is reported as the bug it is rather than explained away as
 * a protocol rule. `describeResolvedTx` in wallet.ts attaches the shape that failed.
 */
function explainFailure(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/untagged enum TransactionInput/.test(message)) {
    return `The wallet built a transaction the signer could not parse — this is a bug, not a limit on the token. Details: ${message.slice(0, 300)}`;
  }
  return message.slice(0, 180);
}

/**
 * Parses a typed decimal into the resource's own raw units. Returns null for anything that is not
 * a clean number, or that carries more decimal places than the resource can represent.
 */
function toRawAmount(input: string, divisibility: number): bigint | null {
  const trimmed = input.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return null;
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > divisibility) return null;
  const padded = fraction.padEnd(divisibility, "0");
  try {
    return BigInt(`${whole || "0"}${padded}`);
  } catch {
    return null;
  }
}
