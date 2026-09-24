import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, Download, Flame, Info, Loader2, RefreshCw } from "lucide-react";
import { WasmBurnBuilder } from "@chironbuilder/tari-l1-wasm";
import { coinSymbol, estimateMaxSpend, selectInputs, submitViaMiddleware, broadcastBaseUrl } from "../lib/tari";
import { fetchMiddlewareTip } from "../lib/scanner";
import { downloadText, formatMicro, tariToMicro, tick, timeAgo, truncMiddle } from "../lib/format";
import {
  burnSupported,
  claimProofFileText,
  isAwaitingL1Observation,
  partsFromSignedBurn,
  type BurnRecord,
} from "../lib/burn";
import { isSpendable, useStore } from "../store";
import { useToast } from "./toast";
import { Button, CopyButton, Field, Logo, Segmented, TextInput, cn } from "./ui";
import { BurnAnimation } from "./BurnAnimation";

/** Revealed from the claimed value to pay the Ootle claim transaction's fee. */
const CLAIM_FEE_MICRO = 2000n;

type Stage = "form" | "review" | "burning" | "done";
type Destination = "own" | "other";

export function BurnPanel() {
  const store = useStore();
  const toast = useToast();
  const symbol = coinSymbol(store.network);

  const [destination, setDestination] = useState<Destination>("own");
  const [ownKey, setOwnKey] = useState<string | null>(null);
  const [otherKey, setOtherKey] = useState("");
  const [amount, setAmount] = useState("");
  const [feePerGram, setFeePerGram] = useState("5");
  const [acknowledged, setAcknowledged] = useState(false);
  const [stage, setStage] = useState<Stage>("form");
  const [justBurned, setJustBurned] = useState<{ amount: bigint } | null>(null);

  const supported = burnSupported(store.network);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    store
      .ootleClaimPublicKey()
      .then((k) => !cancelled && setOwnKey(k))
      .catch(() => !cancelled && setOwnKey(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, store.backupHex]);

  const amountMicro = useMemo(() => tariToMicro(amount), [amount]);
  const fpg = useMemo(() => {
    const n = Number(feePerGram);
    return n > 0 && Number.isFinite(n) ? BigInt(Math.floor(n)) : null;
  }, [feePerGram]);

  const claimKey = destination === "own" ? ownKey : otherKey.trim().toLowerCase();
  const claimKeyValid = !!claimKey && /^[0-9a-f]{64}$/.test(claimKey);

  const spendable = store.utxos.filter((u) => isSpendable(u, store.tipHeight));
  const inputLikes = spendable.map((u) => ({ valueMicro: BigInt(u.valueMicro) }));
  const selection = amountMicro && fpg && amountMicro > 0n ? selectInputs(inputLikes, amountMicro, fpg) : null;
  const maxSpend = fpg ? estimateMaxSpend(inputLikes, fpg) : 0n;
  const receiveMicro = amountMicro && amountMicro > CLAIM_FEE_MICRO ? amountMicro - CLAIM_FEE_MICRO : 0n;
  const canReview = supported && claimKeyValid && !!selection && receiveMicro > 0n && acknowledged;

  async function burn() {
    if (!store.wallet || !claimKey || !amountMicro || !fpg || !selection) return;
    setStage("burning");
    try {
      await tick();
      const builder = new WasmBurnBuilder(store.wallet, amountMicro, claimKey);
      const ids: string[] = [];
      for (const idx of selection.indices) {
        const rec = spendable[idx];
        const handle = store.getHandle(rec.id);
        if (!handle) throw new Error(`Output ${rec.id.slice(0, 6)} is unavailable`);
        ids.push(rec.id);
        builder.addInput(handle);
      }
      builder.withFeePerGram(fpg);
      const tip = await fetchMiddlewareTip(store.scannerUrl);
      const tipHeight = tip?.height ?? store.lastScannedHeight ?? 0;
      if (tipHeight > 0) builder.withTipHeight(BigInt(tipHeight));
      await tick(80);
      const signed = builder.build();
      const json = signed.toJson();

      const out = await submitViaMiddleware(broadcastBaseUrl(store.nodeUrl, store.scannerUrl), json);
      const historyId = crypto.randomUUID();
      store.addTx({
        id: historyId,
        toBase58: `Burn to Ootle ${truncMiddle(claimKey, 6, 4)}`,
        amountMicro: amountMicro.toString(),
        feeMicro: signed.feeMicro.toString(),
        changeMicro: signed.changeValueMicro?.toString() ?? null,
        status: out.accepted ? "pending" : "failed",
        createdAt: Date.now(),
        json,
        result: out.detail,
        inputCommitments: ids,
      });
      if (!out.accepted) {
        setStage("review");
        toast({ tone: "error", title: `Node rejected the burn (${out.result})`, message: out.detail.slice(0, 160) });
        return;
      }
      store.spendInputs(ids, signed.changeValueMicro ?? 0n, signed.changeCommitmentHex ?? null);
      const rec: BurnRecord = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        amountMicro: amountMicro.toString(),
        feeMicro: signed.feeMicro.toString(),
        status: destination === "own" ? "broadcast" : "external",
        toOwnAccount: destination === "own",
        parts: partsFromSignedBurn(signed),
        historyId,
      };
      store.addBurn(rec);
      setJustBurned({ amount: amountMicro });
      setStage("done");
      setAmount("");
      setAcknowledged(false);
    } catch (e) {
      setStage("review");
      toast({ tone: "error", title: "Burn failed", message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (!supported) {
    return (
      <div className="animate-fade-up">
        <Header />
        <div className="flex items-start gap-3 rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-4 text-sm leading-relaxed text-[var(--tari-text)]">
          <Info size={16} className="mt-0.5 shrink-0 text-zinc-500" />
          <p>
            Burning to Ootle is available on the Esmeralda testnet only. Ootle does not run on MainNet yet, so
            MainNet {symbol} burned now could never be claimed. To try it, create or restore a wallet on
            Esmeralda.
          </p>
        </div>
      </div>
    );
  }

  if (stage === "done" && justBurned) {
    return (
      <div className="animate-fade-up">
        <Header />
        <BurnAnimation
          amountLabel={`${formatMicro(justBurned.amount)} ${symbol} burned`}
          receiveLabel={
            destination === "own"
              ? "It will be claimed to your Ootle account automatically once the burn is confirmed."
              : "Export the claim proof below once the burn is mined."
          }
          onDone={() => undefined}
        />
        <div className="mt-2 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => { setJustBurned(null); setStage("form"); }}>
            Done
          </Button>
        </div>
        <BurnList />
      </div>
    );
  }

  if (stage === "review" || stage === "burning") {
    return (
      <div className="animate-fade-up">
        <h2 className="mb-5 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <button
            onClick={() => setStage("form")}
            disabled={stage === "burning"}
            className="rounded-full p-1.5 text-zinc-400 hover:bg-[color-mix(in_srgb,var(--tari-text)_10%,transparent)] hover:text-[var(--tari-text)]"
            aria-label="Back"
          >
            <ChevronLeft size={18} />
          </button>
          Review burn
        </h2>
        <dl className="space-y-3 rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-5 text-sm">
          <Row label="Burn">
            <span className="tabular text-base font-bold text-[var(--tari-text)]">
              {formatMicro(amountMicro ?? 0n)} {symbol}
            </span>
          </Row>
          <Row label="L1 network fee (est.)">
            <span className="tabular">{selection ? formatMicro(selection.feeMicro) : "—"} {symbol}</span>
          </Row>
          <Row label="Claim to">
            <span>{destination === "own" ? "Your Ootle account" : truncMiddle(claimKey ?? "", 10, 8)}</span>
          </Row>
          <Row label="Receive on Ootle (approx.)">
            <span className="tabular">{formatMicro(receiveMicro)} tTARI</span>
          </Row>
        </dl>
        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-zinc-500">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--st-amber)]" />
          This transaction permanently removes the {symbol} from layer 1. It cannot be reversed.
        </p>
        <Button
          size="lg"
          className="mt-5 w-full"
          loading={stage === "burning"}
          onClick={() => void burn()}
        >
          {stage === "burning" ? "Signing and broadcasting…" : `Burn ${formatMicro(amountMicro ?? 0n)} ${symbol}`}
        </Button>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <Header />

      <div className="space-y-4">
        <Field label="Claim to">
          <Segmented
            value={destination}
            onChange={setDestination}
            className="flex w-full"
            options={[
              { value: "own", label: "My Ootle account" },
              { value: "other", label: "Another account" },
            ]}
          />
        </Field>

        {destination === "own" ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] px-4 py-3">
            <span className="min-w-0">
              <span className="block text-xs text-zinc-500">Ootle account public key</span>
              <span className="block truncate font-mono text-xs text-[var(--tari-text)]">
                {ownKey ? truncMiddle(ownKey, 14, 10) : "Deriving…"}
              </span>
            </span>
            {ownKey && <CopyButton text={ownKey} label="" />}
          </div>
        ) : (
          <Field
            label="Ootle account public key"
            hint={
              otherKey.trim() && !claimKeyValid
                ? "Must be 64 hexadecimal characters"
                : "The claim key of the Ootle account that will claim these funds"
            }
          >
            <TextInput
              value={otherKey}
              onChange={(e) => setOtherKey(e.target.value)}
              placeholder="64-character hex public key"
              mono
              spellCheck={false}
              error={otherKey.trim().length > 0 && !claimKeyValid}
            />
          </Field>
        )}

        <Field
          label="Amount"
          hint={`Available: ${formatMicro(maxSpend)} ${symbol}${
            selection && amountMicro ? ` · L1 fee ≈ ${formatMicro(selection.feeMicro)} ${symbol}` : ""
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

        <div className="flex items-center justify-between rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] px-4 py-3">
          <span className="text-sm text-zinc-400">Fee rate</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={200}
              value={Number(feePerGram) || 1}
              onChange={(e) => setFeePerGram(e.target.value)}
              className="w-36 accent-[var(--tari-purple)]"
              aria-label="Fee rate"
            />
            <span className="tabular w-16 text-right font-mono text-xs text-[var(--tari-text)]">
              {fpg?.toString() ?? "—"} µT/g
            </span>
          </div>
        </div>

        {amountMicro && amountMicro > 0n && !selection && (
          <p className="text-center text-xs text-[var(--st-red)]">Insufficient spendable balance</p>
        )}
        {amountMicro !== null && amountMicro > 0n && amountMicro <= CLAIM_FEE_MICRO && (
          <p className="text-center text-xs text-[var(--st-red)]">
            The amount must exceed the Ootle claim fee of {formatMicro(CLAIM_FEE_MICRO)} tTARI.
          </p>
        )}

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--st-amber)]/30 bg-[var(--st-amber)]/10 px-4 py-3 text-xs leading-relaxed text-[var(--tari-text)]">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 accent-[var(--st-amber)]"
          />
          <span>
            I understand that burned {symbol} is permanently removed from layer 1 and can only be claimed on Ootle
            by the account above. {destination === "other" && "A wrong key loses the funds for good."}
          </span>
        </label>

        <Button size="lg" className="w-full" disabled={!canReview} onClick={() => setStage("review")}>
          Review burn
        </Button>
      </div>

      <BurnList />
    </div>
  );
}

function Header() {
  return (
    <div className="mb-5">
      <h2 className="flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
        <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white">
          <Flame size={16} />
        </span>
        Burn to Ootle
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">
        Move funds from Tari layer 1 to Ootle. The burned amount is claimed on Ootle one-for-one, less the claim
        fee. Claims are accepted once the burn is well confirmed on layer 1, typically within an hour on
        Esmeralda.
      </p>
    </div>
  );
}

const STEPS = ["Broadcast", "Mined on L1", "Claimed on Ootle"] as const;

function stepIndex(rec: BurnRecord): number {
  switch (rec.status) {
    case "broadcast":
      return 0;
    case "mined":
    case "claiming":
      return 1;
    case "claimed":
      return 2;
    case "external":
      return rec.merkle ? 1 : 0;
    case "failed":
      return -1;
  }
}

function statusText(rec: BurnRecord): string {
  switch (rec.status) {
    case "broadcast":
      return "Waiting to be mined";
    case "mined":
      if (!rec.toOwnAccount) return "Mined";
      return isAwaitingL1Observation(rec.lastError)
        ? "Waiting for Ootle to observe the L1 block — retrying automatically"
        : "Waiting for confirmations, then claimed automatically";
    case "claiming":
      return "Claiming on Ootle…";
    case "claimed":
      return `Claimed ${formatMicro(BigInt(rec.claimedMicro ?? "0"))} tTARI`;
    case "external":
      return rec.merkle ? "Mined — proof ready to export" : "Waiting to be mined";
    case "failed":
      return "Rejected by the network";
  }
}

function BurnList() {
  const store = useStore();
  const toast = useToast();
  const symbol = coinSymbol(store.network);
  const [claiming, setClaiming] = useState<string | null>(null);

  if (store.burns.length === 0) return null;

  async function claim(id: string) {
    setClaiming(id);
    try {
      await store.claimBurnNow(id);
      toast({ tone: "success", title: "Burn claimed", message: "The funds are in your Ootle private balance." });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast(
        isAwaitingL1Observation(message)
          ? { tone: "info", title: "Not claimable yet", message: "Ootle has not observed this L1 block yet. The wallet keeps retrying." }
          : { tone: "error", title: "Claim not accepted", message: message.slice(0, 180) },
      );
    } finally {
      setClaiming(null);
    }
  }

  return (
    <section className="mt-8">
      <h3 className="un-label mb-3">Burns</h3>
      <ul className="space-y-2.5">
        {store.burns.map((rec) => {
          const step = stepIndex(rec);
          const proofText = claimProofFileText(rec);
          return (
            <li key={rec.id} className="rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="tabular text-sm font-bold text-[var(--tari-text)]">
                    {formatMicro(BigInt(rec.amountMicro))} {symbol}
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {timeAgo(rec.createdAt)} · {rec.toOwnAccount ? "to your Ootle account" : `to ${truncMiddle(rec.parts.claimPublicKeyHex, 6, 4)}`}
                    {rec.minedHeight ? ` · block ${rec.minedHeight.toLocaleString()}` : ""}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-500">
                  {(rec.status === "broadcast" || rec.status === "claiming") && <Loader2 size={12} className="animate-spin" />}
                  {statusText(rec)}
                </span>
              </div>

              {step >= 0 && (
                <ol className="mt-3 grid grid-cols-3 gap-2" aria-label="Burn progress">
                  {STEPS.map((label, i) => (
                    <li key={label} className="min-w-0">
                      <span
                        className={cn(
                          "block h-1 rounded-full",
                          i <= step ? "bg-[var(--tari-purple)]" : "bg-[color-mix(in_srgb,var(--tari-text)_12%,transparent)]",
                        )}
                      />
                      <span className={cn("mt-1 block truncate text-[10px]", i <= step ? "text-[var(--tari-text)]" : "text-zinc-500")}>
                        {label}
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {rec.lastError && rec.status === "mined" && !isAwaitingL1Observation(rec.lastError) && (
                <p className="mt-2 text-[11px] break-words text-zinc-500">Last attempt: {rec.lastError.slice(0, 200)}</p>
              )}

              {(proofText || (rec.status === "mined" && rec.toOwnAccount)) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {rec.status === "mined" && rec.toOwnAccount && (
                    <Button size="sm" variant="outline" loading={claiming === rec.id} onClick={() => void claim(rec.id)}>
                      <RefreshCw size={12} /> Claim now
                    </Button>
                  )}
                  {proofText && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => downloadText(`burn-proof-${rec.parts.commitmentHex.slice(0, 12)}.json`, proofText)}
                    >
                      <Download size={12} /> Export proof
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
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
