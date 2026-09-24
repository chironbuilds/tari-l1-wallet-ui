import { useMemo, useState } from "react";
import { Check, ChevronLeft, Send } from "lucide-react";
import {
  WasmTxBuilder,
  type WasmSignedTransaction,
} from "@chironbuilder/tari-l1-wasm";
import {
  broadcastBaseUrl,
  estimateMaxSpend,
  parseAddress,
  selectInputs,
  submitViaMiddleware,
} from "../lib/tari";
import { fetchMiddlewareTip } from "../lib/scanner";
import {
  copyText,
  downloadText,
  formatMicro,
  tariToMicro,
  tick,
  truncMiddle,
} from "../lib/format";
import { isSpendable, useStore } from "../store";
import { useToast } from "./toast";
import { Button, Field, Logo, TextInput } from "./ui";

type Stage = "idle" | "review" | "building" | "signed" | "submitting";

interface BuildResult {
  signed: WasmSignedTransaction;
  toBase58: string;
  amountMicro: bigint;
  consumedIds: string[];
}

export function SendPanel() {
  const store = useStore();
  const toast = useToast();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [feePerGram, setFeePerGram] = useState("5");
  // Off by default: a one-sided payment tells the recipient nothing about who sent it, and giving
  // that up is a choice the sender should make deliberately, per payment.
  const [revealSender, setRevealSender] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<BuildResult | null>(null);

  const parsed = useMemo(() => parseAddress(recipient), [recipient]);
  const amountMicro = useMemo(() => tariToMicro(amount), [amount]);
  const fpg = useMemo(() => {
    const n = Number(feePerGram);
    return n > 0 && Number.isFinite(n) ? BigInt(Math.floor(n)) : null;
  }, [feePerGram]);

  if (!store.wallet) return null;

  // Only confirmed, matured outputs we hold a handle for can be spent. The node rejects a
  // transaction that consumes an immature input, and one whose input it cannot find at all, so
  // neither locked nor pending coins may reach selection or the Max button.
  const spendable = store.utxos.filter((u) => isSpendable(u, store.tipHeight));
  const inputLikes = spendable.map((u) => ({ valueMicro: BigInt(u.valueMicro) }));
  const selection =
    amountMicro && fpg && amountMicro > 0n
      ? selectInputs(inputLikes, amountMicro, fpg)
      : null;
  const maxSpend = fpg ? estimateMaxSpend(inputLikes, fpg) : 0n;
  const addressValid = !!parsed && !parsed.isSingle;
  const canReview = addressValid && !!amountMicro && amountMicro > 0n && !!selection;

  async function build() {
    if (!store.wallet || !parsed || !amountMicro || !fpg || !selection) return;
    try {
      setStage("building");
      await tick();
      const builder = new WasmTxBuilder(store.wallet!);
      const ids: string[] = [];
      for (const idx of selection.indices) {
        const rec = spendable[idx];
        const handle = store.getHandle(rec.id);
        if (!handle) throw new Error(`UTXO ${rec.id.slice(0, 6)} unavailable`);
        ids.push(rec.id);
        builder.addInput(handle);
      }
      builder.addRecipient(parsed.toBase58(), amountMicro);
      builder.withFeePerGram(fpg);
      builder.withSenderRevealed(revealSender);
      // The builder picks its consensus constants (weights, permitted versions) from the tip
      // height; leaving it at 0 signs against the genesis epoch's rules.
      const tip = await fetchMiddlewareTip(store.scannerUrl);
      const tipHeight = tip?.height ?? store.lastScannedHeight ?? 0;
      if (tipHeight > 0) builder.withTipHeight(BigInt(tipHeight));
      await tick(120);
      const signed = builder.build();
      setResult({
        signed,
        toBase58: parsed.toBase58(),
        amountMicro,
        consumedIds: ids,
      });
      setStage("signed");
    } catch (e) {
      setStage("review");
      toast({
        tone: "error",
        title: "Signing failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function finishLocally(r: BuildResult) {
    store.spendInputs(
      r.consumedIds,
      r.signed.changeValueMicro ?? 0n,
      r.signed.changeCommitmentHex ?? null,
    );
    store.addTx({
      id: crypto.randomUUID(),
      toBase58: r.toBase58,
      amountMicro: r.amountMicro.toString(),
      feeMicro: r.signed.feeMicro.toString(),
      changeMicro: r.signed.changeValueMicro?.toString() ?? null,
      status: "signed",
      createdAt: Date.now(),
      json: r.signed.toJson(),
      inputCommitments: r.consumedIds,
    });
    setResult(null);
    setStage("idle");
    setAmount("");
    toast({ tone: "info", title: "Saved locally", message: "Broadcast later from Activity." });
  }

  async function broadcast(r: BuildResult) {
    setStage("submitting");
    try {
      const out = await submitViaMiddleware(
        broadcastBaseUrl(store.nodeUrl, store.scannerUrl),
        r.signed.toJson(),
      );
      store.addTx({
        id: crypto.randomUUID(),
        toBase58: r.toBase58,
        amountMicro: r.amountMicro.toString(),
        feeMicro: r.signed.feeMicro.toString(),
        changeMicro: r.signed.changeValueMicro?.toString() ?? null,
        // Accepted only means it reached a mempool; it stays pending until a block contains it.
        status: out.accepted ? "pending" : "failed",
        createdAt: Date.now(),
        json: r.signed.toJson(),
        result: out.detail,
        inputCommitments: r.consumedIds,
      });
      if (!out.accepted) {
        setStage("signed");
        toast({
          tone: "error",
          title: `Node rejected (${out.result})`,
          message: out.detail.slice(0, 160),
        });
        return;
      }
      store.spendInputs(
        r.consumedIds,
        r.signed.changeValueMicro ?? 0n,
        r.signed.changeCommitmentHex ?? null,
      );
      setResult(null);
      setStage("idle");
      setAmount("");
      toast({ tone: "success", title: "Transaction sent", message: truncMiddle(out.result, 60, 40) });
    } catch (e) {
      setStage("signed");
      toast({
        tone: "error",
        title: "Submission failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (stage === "review" || stage === "building") {
    return (
      <div key="review" className="animate-fade-up">
        <h2 className="mb-5 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <button
            onClick={() => setStage("idle")}
            className="rounded-full p-1.5 text-zinc-400 hover:bg-[color-mix(in_srgb,var(--tari-text)_10%,transparent)] hover:text-[var(--tari-text)]"
          >
            <ChevronLeft size={18} />
          </button>
          Review transaction
        </h2>
        <dl className="space-y-3 rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-5 text-sm">
          <Row label="To">
            <span className="break-all">{truncMiddle(parsed?.toBase58() ?? "", 18, 12)}</span>
          </Row>
          <Row label="Amount">
            <span className="tabular text-base font-bold text-[var(--tari-text)]">
              {formatMicro(amountMicro ?? 0n)} XTM
            </span>
          </Row>
          <Row label="Est. fee">
            <span className="tabular">{selection ? formatMicro(selection.feeMicro) : "—"} XTM</span>
          </Row>
          <Row label="Fee rate">{fpg?.toString()} µT/g</Row>
          <Row label="Sender">
            <span className={revealSender ? "text-[var(--st-amber)]" : "text-[var(--st-green)]"}>
              {revealSender ? "revealed to recipient" : "not disclosed"}
            </span>
          </Row>
        </dl>
        <Button
          size="lg"
          className="btn-green mt-5 w-full"
          loading={stage === "building"}
          onClick={() => void build()}
        >
          {stage === "building" ? "Signing…" : "Confirm & sign"}
        </Button>
      </div>
    );
  }

  return (
    <div key="idle" className="animate-fade-up">
      <h2 className="mb-5 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
        <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#06C983] to-[#168552]">
          <Send size={15} />
        </span>
        Send Tari
      </h2>

      <div className="space-y-4">
        <Field
          label="Recipient address"
          hint={
            recipient.trim()
              ? parsed
                ? addressValid
                  ? "Valid one-sided address"
                  : "This is a single address. One-sided payments need a dual address."
                : "Invalid Tari address"
              : "Base58 or hex"
          }
        >
          <div className="relative">
            <TextInput
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Paste address…"
              mono
              spellCheck={false}
              className="pr-10"
              error={recipient.trim().length > 0 && !parsed}
            />
            {addressValid && (
              <Check size={16} className="absolute top-1/2 right-3.5 -translate-y-1/2 text-[var(--st-green)]" />
            )}
          </div>
        </Field>

        <Field
          label="Amount"
          hint={`Max available: ${formatMicro(maxSpend)} XTM${
            selection && amountMicro ? ` · est. fee ${formatMicro(selection.feeMicro)} XTM` : ""
          }`}
        >
          <div className="relative">
            <span className="absolute top-1/2 left-3.5 -translate-y-1/2 opacity-80">
              <Logo size={16} />
            </span>
            <TextInput
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              className="pr-16 pl-10"
              error={amount.length > 0 && amountMicro === null}
            />
            <button
              onClick={() => setAmount(formatMicro(maxSpend))}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full border border-[var(--tari-border)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--tari-text)] uppercase hover:bg-[color-mix(in_srgb,var(--tari-text)_10%,transparent)]"
            >
              Max
            </button>
          </div>
        </Field>

        <button
          onClick={() => setRevealSender((v) => !v)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] px-4 py-3 text-left"
        >
          <span className="min-w-0">
            <span className="block text-sm text-[var(--tari-text)]">Reveal my address</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-500">
              {revealSender
                ? "The recipient will see this payment came from you."
                : "Private — the recipient will not know who paid."}
            </span>
          </span>
          <span
            className={
              revealSender
                ? "relative h-6 w-11 shrink-0 rounded-full bg-[var(--st-green)] transition-colors"
                : "relative h-6 w-11 shrink-0 rounded-full bg-zinc-600/50 transition-colors"
            }
            role="switch"
            aria-checked={revealSender}
          >
            <span
              className={
                revealSender
                  ? "absolute top-0.5 left-0.5 size-5 translate-x-5 rounded-full bg-white transition-transform"
                  : "absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform"
              }
            />
          </span>
        </button>

        <div className="flex items-center justify-between rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] px-4 py-3">
          <span className="text-sm text-zinc-400">Fee rate</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={200}
              value={Number(feePerGram) || 1}
              onChange={(e) => setFeePerGram(e.target.value)}
              className="accent-[var(--st-green)] w-36"
            />
            <span className="tabular w-16 text-right font-mono text-xs text-[var(--tari-text)]">
              {fpg?.toString() ?? "—"} µT/g
            </span>
          </div>
        </div>

        {amountMicro && amountMicro > 0n && !selection && (
          <p className="text-center text-xs text-[var(--st-red)]">
            Insufficient spendable balance
            {store.lockedMicro > 0n
              ? ` — ${formatMicro(store.lockedMicro)} XTM is still locked`
              : ""}
            {store.pendingMicro > 0n
              ? ` — ${formatMicro(store.pendingMicro)} XTM is awaiting confirmation`
              : ""}
          </p>
        )}

        <Button
          size="lg"
          className="btn-green w-full"
          disabled={!canReview}
          onClick={() => setStage("review")}
        >
          Review
        </Button>
      </div>

      {result && (
        <div className="mt-5 rounded-2xl border border-[#06C983]/25 bg-[#06C983]/10 p-5">
          <p className="flex items-center gap-2 text-sm font-bold text-[var(--st-green)]">
            <Check size={16} /> Transaction signed
          </p>
          <dl className="mt-3 space-y-2 rounded-xl bg-[var(--tari-bg-input)] p-4 text-sm">
            <Row label="Fee">
              <span className="tabular">{formatMicro(result.signed.feeMicro)} XTM</span>
            </Row>
            <Row label="Change back">
              <span className="tabular">
                {result.signed.changeValueMicro !== undefined
                  ? `${formatMicro(result.signed.changeValueMicro)} XTM`
                  : "—"}
              </span>
            </Row>
          </dl>
          <div className="mt-4 flex gap-2.5">
            <Button variant="outline" size="sm" onClick={() => void copyText(result.signed.toJson())}>
              Copy JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadText("tari-tx.json", result.signed.toJson())}
            >
              Download
            </Button>
            <Button variant="ghost" size="sm" onClick={() => finishLocally(result)}>
              Save locally
            </Button>
            <Button size="sm" loading={stage === "submitting"} onClick={() => void broadcast(result)}>
              Broadcast
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-[var(--tari-text)]">{children}</dd>
    </div>
  );
}
