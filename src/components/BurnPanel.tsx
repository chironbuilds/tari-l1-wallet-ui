import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, Download, Flame, Loader2, RefreshCw } from "lucide-react";
import { WasmBurnBuilder } from "@chironbuilder/tari-l1-wasm";
import { coinSymbol, networkLabel, estimateMaxSpend, selectInputs, submitViaMiddleware, broadcastBaseUrl } from "../lib/tari";
import { fetchMiddlewareTip } from "../lib/scanner";
import { downloadText, formatMicro, tariToMicro, tick, timeAgo, truncMiddle } from "../lib/format";
import {
  burnClaimableNow,
  claimProofFileText,
  isAwaitingL1Observation,
  partsFromSignedBurn,
  type BurnRecord,
} from "../lib/burn";
import { isSpendable, useStore } from "../store";
import { useToast } from "./toast";
import { Button, CopyButton, Field, Logo, Segmented, TextInput, cn } from "./ui";
import { BurnAnimation } from "./BurnAnimation";
import { t as translate, useI18n, type TranslationKey } from "../i18n";

/**
 * What an Ootle claim costs, for the estimate shown before burning. The claim itself measures its
 * exact fee with a dry run (about 13,300 µT on Esmeralda); this only needs to be close.
 */
const CLAIM_FEE_MICRO = 15_000n;

type Stage = "form" | "review" | "burning" | "done";
type Destination = "own" | "other";

export function BurnPanel() {
  const store = useStore();
  const toast = useToast();
  const { t } = useI18n();
  const symbol = coinSymbol(store.network);

  const [destination, setDestination] = useState<Destination>("own");
  const [ownKey, setOwnKey] = useState<string | null>(null);
  const [otherKey, setOtherKey] = useState("");
  const [amount, setAmount] = useState("");
  const [feePerGram, setFeePerGram] = useState("5");
  const [acknowledged, setAcknowledged] = useState(false);
  const [stage, setStage] = useState<Stage>("form");
  const [justBurned, setJustBurned] = useState<{ amount: bigint } | null>(null);

  const claimable = burnClaimableNow(store.network);
  const l2Symbol = store.network === "mainnet" ? "TARI" : "tTARI";

  useEffect(() => {
    let cancelled = false;
    store
      .ootleClaimPublicKey()
      .then((k) => !cancelled && setOwnKey(k))
      .catch(() => !cancelled && setOwnKey(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.backupHex]);

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
  const canReview = claimKeyValid && !!selection && receiveMicro > 0n && acknowledged;

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
        if (!handle) throw new Error(t("burn.outputUnavailable", { id: rec.id.slice(0, 6) }));
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
        // At least one selected input is already consumed on-chain, but maybe not all — re-sync from
        // the birthday rather than blanket-dropping the whole selection, so only the genuinely spent
        // output is removed and the rest are kept.
        const inputsAlreadyConsumed = /MINED|SPENT|DOUBLE/i.test(out.result);
        if (inputsAlreadyConsumed) void store.rescanFromBirthday();
        toast({
          tone: "error",
          title: t("burn.nodeRejected", { result: out.result }),
          message: inputsAlreadyConsumed
            ? t("burn.alreadySpent")
            : out.detail.slice(0, 160),
        });
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
      toast({ tone: "error", title: t("burn.failed"), message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (stage === "done" && justBurned) {
    return (
      <div className="animate-fade-up">
        <Header />
        <BurnAnimation
          amountLabel={t("burn.burnedLabel", { amount: formatMicro(justBurned.amount), symbol })}
          receiveLabel={
            !claimable
              ? t("burn.notClaimableYetLong", { network: networkLabel(store.network) })
              : destination === "own"
                ? t("burn.autoClaim")
                : t("burn.exportBelow")
          }
          onDone={() => undefined}
        />
        <div className="mt-2 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => { setJustBurned(null); setStage("form"); }}>
            {t("burn.done")}
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
            aria-label={t("burn.back")}
          >
            <ChevronLeft size={18} />
          </button>
          {t("burn.reviewTitle")}
        </h2>
        <dl className="space-y-3 rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-5 text-sm">
          <Row label={t("burn.rowBurn")}>
            <span className="tabular text-base font-bold text-[var(--tari-text)]">
              {formatMicro(amountMicro ?? 0n)} {symbol}
            </span>
          </Row>
          <Row label={t("burn.rowL1Fee")}>
            <span className="tabular">{selection ? formatMicro(selection.feeMicro) : "—"} {symbol}</span>
          </Row>
          <Row label={t("burn.rowClaimTo")}>
            <span>{destination === "own" ? t("burn.yourOotle") : truncMiddle(claimKey ?? "", 10, 8)}</span>
          </Row>
          <Row label={t("burn.rowReceive")}>
            <span className="tabular">
              {claimable ? `${formatMicro(receiveMicro)} ${l2Symbol}` : t("burn.notClaimableShort")}
            </span>
          </Row>
        </dl>
        {!claimable && <NotClaimableWarning network={store.network} />}
        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-zinc-500">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--st-amber)]" />
          {t("burn.irreversible", { symbol })}
        </p>
        <Button
          size="lg"
          className="mt-5 w-full"
          loading={stage === "burning"}
          onClick={() => void burn()}
        >
          {stage === "burning" ? t("burn.signingBroadcasting") : t("burn.burnAmount", { amount: formatMicro(amountMicro ?? 0n), symbol })}
        </Button>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <Header />
      {!claimable && <NotClaimableWarning network={store.network} />}

      <div className="space-y-4">
        <Field label={t("burn.claimToField")}>
          <Segmented
            value={destination}
            onChange={setDestination}
            className="flex w-full"
            options={[
              { value: "own", label: t("burn.myOotle") },
              { value: "other", label: t("burn.anotherAccount") },
            ]}
          />
        </Field>

        {destination === "own" ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] px-4 py-3">
            <span className="min-w-0">
              <span className="block text-xs text-zinc-500">{t("burn.publicKey")}</span>
              <span className="block truncate font-mono text-xs text-[var(--tari-text)]">
                {ownKey ? truncMiddle(ownKey, 14, 10) : t("burn.deriving")}
              </span>
            </span>
            {ownKey && <CopyButton text={ownKey} label="" />}
          </div>
        ) : (
          <Field
            label={t("burn.publicKey")}
            hint={otherKey.trim() && !claimKeyValid ? t("burn.keyInvalid") : t("burn.keyHint")}
          >
            <TextInput
              value={otherKey}
              onChange={(e) => setOtherKey(e.target.value)}
              placeholder={t("burn.keyPlaceholder")}
              mono
              spellCheck={false}
              error={otherKey.trim().length > 0 && !claimKeyValid}
            />
          </Field>
        )}

        <Field
          label={t("burn.amount")}
          hint={`${t("burn.available", { amount: formatMicro(maxSpend), symbol })}${
            selection && amountMicro ? t("burn.l1FeeSuffix", { amount: formatMicro(selection.feeMicro), symbol }) : ""
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
              {t("burn.max")}
            </button>
          </div>
        </Field>

        <div className="flex items-center justify-between rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] px-4 py-3">
          <span className="text-sm text-zinc-400">{t("burn.feeRate")}</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={200}
              value={Number(feePerGram) || 1}
              onChange={(e) => setFeePerGram(e.target.value)}
              className="w-36 accent-[var(--tari-purple)]"
              aria-label={t("burn.feeRate")}
            />
            <span className="tabular w-16 text-right font-mono text-xs text-[var(--tari-text)]">
              {fpg?.toString() ?? "—"} µT/g
            </span>
          </div>
        </div>

        {amountMicro && amountMicro > 0n && !selection && (
          <p className="text-center text-xs text-[var(--st-red)]">{t("burn.insufficient")}</p>
        )}
        {amountMicro !== null && amountMicro > 0n && amountMicro <= CLAIM_FEE_MICRO && (
          <p className="text-center text-xs text-[var(--st-red)]">
            {t("burn.belowClaimFee", { amount: formatMicro(CLAIM_FEE_MICRO), symbol: l2Symbol })}
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
            {t("burn.acknowledge", { symbol })} {destination === "other" && t("burn.wrongKeyLoses")}
          </span>
        </label>

        <Button size="lg" className="w-full" disabled={!canReview} onClick={() => setStage("review")}>
          {t("burn.reviewTitle")}
        </Button>
      </div>

      <BurnList />
    </div>
  );
}

function NotClaimableWarning({ network }: { network: import("../lib/tari").NetworkId | null }) {
  const { t } = useI18n();
  const name = networkLabel(network);
  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-[var(--st-red)]/30 bg-[var(--st-red)]/10 p-4 text-xs leading-relaxed text-[var(--tari-text)]">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--st-red)]" />
      <p>
        <b>{t("burn.notClaimableTitle")}</b> {t("burn.notClaimableBody", { network: name, symbol: coinSymbol(network) })}
      </p>
    </div>
  );
}

function Header() {
  const { t } = useI18n();
  return (
    <div className="mb-5">
      <h2 className="flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
        <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white">
          <Flame size={16} />
        </span>
        {t("burn.title")}
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">{t("burn.intro")}</p>
    </div>
  );
}

const STEPS: TranslationKey[] = ["burn.stepBroadcast", "burn.stepMined", "burn.stepClaimed"];

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
      return rec.outputProof ? 1 : 0;
    case "failed":
      return -1;
  }
}

function statusText(rec: BurnRecord, claimable: boolean): string {
  if (!claimable && (rec.status === "mined" || rec.status === "claiming")) {
    return translate("burn.minedNotClaimable");
  }
  switch (rec.status) {
    case "broadcast":
      return translate("burn.waitingMined");
    case "mined":
      if (!rec.toOwnAccount) return translate("burn.mined");
      return isAwaitingL1Observation(rec.lastError) ? translate("burn.waitingObserve") : translate("burn.waitingConfirmations");
    case "claiming":
      return translate("burn.claimingOotle");
    case "claimed":
      return rec.claimedElsewhere
        ? translate("burn.claimedElsewhere", { amount: formatMicro(BigInt(rec.claimedMicro ?? rec.amountMicro)) })
        : translate("burn.claimed", { amount: formatMicro(BigInt(rec.claimedMicro ?? "0")) });
    case "external":
      return rec.outputProof ? translate("burn.proofReady") : translate("burn.waitingMined");
    case "failed":
      return translate("burn.rejected");
  }
}

function BurnList() {
  const store = useStore();
  const toast = useToast();
  const { t } = useI18n();
  const symbol = coinSymbol(store.network);
  const claimable = burnClaimableNow(store.network);
  const [claiming, setClaiming] = useState<string | null>(null);

  if (store.burns.length === 0) return null;

  async function claim(id: string) {
    setClaiming(id);
    try {
      await store.claimBurnNow(id);
      toast({ tone: "success", title: t("burn.claimedTitle"), message: t("burn.claimedMessage") });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast(
        isAwaitingL1Observation(message)
          ? { tone: "info", title: t("burn.notYetTitle"), message: t("burn.notYetMessage") }
          : { tone: "error", title: t("burn.notAccepted"), message: message.slice(0, 180) },
      );
    } finally {
      setClaiming(null);
    }
  }

  return (
    <section className="mt-8">
      <h3 className="un-label mb-3">{t("burn.burns")}</h3>
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
                    {timeAgo(rec.createdAt)} ·{" "}
                    {rec.toOwnAccount ? t("burn.toOwn") : t("burn.toKey", { key: truncMiddle(rec.parts.claimPublicKeyHex, 6, 4) })}
                    {rec.minedHeight ? t("burn.blockSuffix", { height: rec.minedHeight.toLocaleString() }) : ""}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-500">
                  {(rec.status === "broadcast" || rec.status === "claiming") && <Loader2 size={12} className="animate-spin" />}
                  {statusText(rec, claimable)}
                </span>
              </div>

              {step >= 0 && (
                <ol className="mt-3 grid grid-cols-3 gap-2" aria-label={t("burn.progress")}>
                  {STEPS.map((label, i) => (
                    <li key={label} className="min-w-0">
                      <span
                        className={cn(
                          "block h-1 rounded-full",
                          i <= step ? "bg-[var(--tari-purple)]" : "bg-[color-mix(in_srgb,var(--tari-text)_12%,transparent)]",
                        )}
                      />
                      <span className={cn("mt-1 block truncate text-[10px]", i <= step ? "text-[var(--tari-text)]" : "text-zinc-500")}>
                        {t(label)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {rec.lastError && rec.status === "mined" && !isAwaitingL1Observation(rec.lastError) && (
                <p className="mt-2 text-[11px] break-words text-zinc-500">{t("burn.lastAttempt", { error: rec.lastError.slice(0, 200) })}</p>
              )}

              {(proofText || (rec.status === "mined" && rec.toOwnAccount && claimable)) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {rec.status === "mined" && rec.toOwnAccount && claimable && (
                    <Button size="sm" variant="outline" loading={claiming === rec.id} onClick={() => void claim(rec.id)}>
                      <RefreshCw size={12} /> {t("burn.claimNow")}
                    </Button>
                  )}
                  {proofText && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => downloadText(`burn-proof-${rec.parts.commitmentHex.slice(0, 12)}.json`, proofText)}
                    >
                      <Download size={12} /> {t("burn.exportProof")}
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
