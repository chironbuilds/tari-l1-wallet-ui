import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  FileJson,
  History as HistoryIcon,
  Trash2,
  Zap,
} from "lucide-react";
import { useStore, type TxRecord } from "../store";
import { broadcastBaseUrl, coinSymbol, submitViaMiddleware } from "../lib/tari";
import { copyText, downloadText, formatMicro, timeAgo, truncMiddle } from "../lib/format";
import { useToast } from "./toast";
import { Badge, Button, Card, EmptyState } from "./ui";
import { useI18n, type TranslationKey } from "../i18n";

const statusTone = {
  signed: "violet",
  // A node accepted it, but it is only spent for good once a miner puts it in a block.
  pending: "amber",
  submitted: "amber",
  mined: "green",
  failed: "red",
} as const;

const statusLabel: Record<TxRecord["status"], TranslationKey> = {
  signed: "activity.statusSigned",
  pending: "activity.statusPending",
  submitted: "activity.statusPending",
  mined: "activity.statusMined",
  failed: "activity.statusFailed",
};

export function ActivityPanel() {
  const store = useStore();
  const symbol = coinSymbol(store.network);
  const toast = useToast();
  const { t } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);

  if (store.history.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={<HistoryIcon size={22} />}
          title={t("activity.emptyTitle")}
          sub={t("activity.emptySub")}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-lg font-bold text-[var(--tari-text)]">{t("activity.title")}</h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            store.clearHistory();
            toast({ tone: "info", title: t("activity.cleared") });
          }}
        >
          <Trash2 size={14} /> {t("activity.clear")}
        </Button>
      </div>

      {[...store.history]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((tx) => {
          const incoming = tx.direction === "in";
          return (
          <Card key={tx.id} className="overflow-hidden p-0">
            <button
              onClick={() => setOpenId(openId === tx.id ? null : tx.id)}
              className="flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-white/[0.03]"
            >
              <span
                className={
                  tx.status === "failed"
                    ? "grid size-10 shrink-0 place-items-center rounded-full border border-red-500/30 bg-red-500/10 text-[var(--st-red)]"
                    : incoming
                      ? "grid size-10 shrink-0 place-items-center rounded-full border border-[#06C983]/30 bg-[#06C983]/10 text-[var(--st-green)]"
                      : "grid size-10 shrink-0 place-items-center rounded-full border border-violet-500/30 bg-violet-500/10 text-[var(--st-violet)]"
                }
              >
                {incoming ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm font-semibold text-[var(--tari-text)]">
                  {incoming
                    ? tx.paidTo && tx.paidTo.length > 0
                      ? t("activity.receivedFor", { labels: tx.paidTo.join(", ") })
                      : t("activity.received")
                    : `→ ${truncMiddle(tx.toBase58, 12, 8)}`}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {timeAgo(tx.createdAt)}
                  {incoming ? "" : t("activity.feeSuffix", { amount: formatMicro(BigInt(tx.feeMicro)), symbol })}
                  {tx.minedHeight ? t("activity.blockSuffix", { height: tx.minedHeight.toLocaleString() }) : ""}
                </p>
                {/* A one-sided payment is unlinkable to its sender on chain; an address only
                    appears here because the sending wallet chose to include one. Saying so beats
                    leaving a blank where an identity would go. */}
                {incoming && (
                  <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                    {tx.senders && tx.senders.length > 0
                      ? t("activity.from", { senders: tx.senders.map((s) => truncMiddle(s, 10, 8)).join(", ") })
                      : t("activity.senderHidden")}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span
                  className={
                    incoming
                      ? "tabular font-mono text-sm font-bold text-[var(--st-green)]"
                      : "tabular font-mono text-sm font-bold text-[var(--tari-text)]"
                  }
                >
                  {BigInt(tx.amountMicro) > 0n
                    ? `${incoming ? "+" : "-"}${formatMicro(BigInt(tx.amountMicro))} ${symbol}`
                    : "—"}
                </span>
                <Badge tone={statusTone[tx.status]}>{t(statusLabel[tx.status])}</Badge>
              </div>
              <ChevronRight
                size={16}
                className={
                  openId === tx.id
                    ? "shrink-0 rotate-90 text-zinc-400 transition-transform"
                    : "shrink-0 text-zinc-600 transition-transform"
                }
              />
            </button>

            {openId === tx.id && <TxDetail rec={tx} />}
          </Card>
          );
        })}
    </div>
  );
}

function TxDetail({ rec }: { rec: TxRecord }) {
  const store = useStore();
  const toast = useToast();
  const { t } = useI18n();

  return (
    <div className="animate-fade-up space-y-3.5 border-t border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-5">
      <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
        <dt className="text-zinc-500">{t("activity.minedIn")}</dt>
        <dd className="text-right font-mono text-[var(--tari-text)]">
          {rec.minedHeight
            ? `#${rec.minedHeight.toLocaleString()}`
            : rec.status === "pending" || rec.status === "submitted"
              ? t("activity.waitingBlock")
              : "—"}
        </dd>
      </dl>
      {rec.changeMicro && BigInt(rec.changeMicro) > 0n && (
        <p className="text-xs text-[var(--st-violet)]">
          {t("activity.changeReturned")} <b>{formatMicro(BigInt(rec.changeMicro))} {coinSymbol(store.network)}</b>
        </p>
      )}
      {rec.result && (
        <p className="max-h-20 overflow-y-auto rounded-xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-3 font-mono text-[11px] break-all whitespace-pre-wrap text-zinc-400">
          {t("activity.nodeResponse", { result: rec.result })}
        </p>
      )}
      <pre className="max-h-52 overflow-auto rounded-xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-3.5 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-zinc-400">
        {pretty(rec.json)}
      </pre>
      <div className="flex flex-wrap gap-2.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void copyText(rec.json).then((ok) => ok && toast({ tone: "success", title: t("activity.jsonCopied") }))}
        >
          <FileJson size={13} /> {t("activity.copyJson")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloadText(`tari-tx-${rec.id.slice(0, 6)}.json`, rec.json)}>
          <FileJson size={13} /> {t("activity.download")}
        </Button>
        {(rec.status === "signed" || rec.status === "failed") && (
          <Button size="sm" onClick={() => void resubmit(rec)}>
            <Zap size={13} /> {rec.status === "failed" ? t("activity.broadcastAgain") : t("activity.broadcast")}
          </Button>
        )}
      </div>
    </div>
  );

  async function resubmit(rec: TxRecord) {
    try {
      const out = await submitViaMiddleware(
        broadcastBaseUrl(store.nodeUrl, store.scannerUrl),
        rec.json,
      );
      // "Already mined" on a re-broadcast means this transaction is already on-chain — it succeeded.
      // Treat it as pending (a scan will confirm it) and drop its now-spent inputs, rather than
      // marking it failed.
      const alreadyOnChain = !out.accepted && /MINED|SPENT|DOUBLE/i.test(out.result);
      store.updateTx(rec.id, {
        status: out.accepted || alreadyOnChain ? "pending" : "failed",
        result: out.detail,
      });
      if (alreadyOnChain && rec.inputCommitments?.length) {
        store.removeSpent(rec.inputCommitments);
      }
      toast({
        tone: out.accepted || alreadyOnChain ? "success" : "error",
        title: out.accepted ? t("activity.accepted") : alreadyOnChain ? t("activity.alreadyOnChain") : t("activity.rejected", { result: out.result }),
        message: truncMiddle(out.detail, 50, 30),
      });
    } catch (e) {
      store.updateTx(rec.id, { status: "failed", result: e instanceof Error ? e.message : String(e) });
      toast({ tone: "error", title: t("activity.submissionFailed") });
    }
  }
}

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
