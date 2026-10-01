import { ArrowDownLeft, ArrowUpRight, ExternalLink, Eye, EyeOff, Flame, Grid3x3, History as HistoryIcon, Loader2, Lock, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useStore } from "../store";
import { formatResourceAmount } from "../ootle";
import { timeAgo, truncMiddle } from "../lib/format";
import { clearL2History, explorerTxUrl, useL2History, type L2Activity } from "../lib/l2history";
import { useI18n, type TranslationKey } from "../i18n";
import { Badge, Button, Card, EmptyState } from "./ui";

const TITLE: Record<L2Activity["kind"], TranslationKey> = {
  send: "l2hist.kindSend",
  sendPrivately: "l2hist.kindSendPrivately",
  shield: "l2hist.kindShield",
  unshield: "l2hist.kindUnshield",
  claimBurn: "l2hist.kindClaimBurn",
  dapp: "l2hist.kindDapp",
  received: "l2hist.kindReceived",
};

function KindIcon({ kind }: { kind: L2Activity["kind"] }) {
  const icon: Record<L2Activity["kind"], ReactNode> = {
    send: <ArrowUpRight size={15} />,
    sendPrivately: <Lock size={14} />,
    shield: <EyeOff size={14} />,
    unshield: <Eye size={14} />,
    claimBurn: <Flame size={14} />,
    dapp: <Grid3x3 size={14} />,
    received: <ArrowDownLeft size={15} />,
  };
  const incoming = kind === "claimBurn" || kind === "received";
  return (
    <span
      className={
        incoming
          ? "grid size-9 shrink-0 place-items-center rounded-full border border-[#06C983]/30 bg-[#06C983]/10 text-[var(--st-green)]"
          : "grid size-9 shrink-0 place-items-center rounded-full border border-[#9d6bff]/30 bg-[#9d6bff]/10 text-[#9d6bff]"
      }
    >
      {icon[kind]}
    </span>
  );
}

/** One activity row. `compact` is the short form shown on the Ootle card. */
export function L2ActivityRow({ e, compact = false }: { e: L2Activity; compact?: boolean }) {
  const { t } = useI18n();
  const amount =
    e.amount !== undefined && e.divisibility !== undefined
      ? `${formatResourceAmount(BigInt(e.amount), e.divisibility)} ${e.symbol ?? ""}`.trim()
      : null;
  const sign = e.kind === "claimBurn" || e.kind === "received" ? "+" : e.kind === "send" || e.kind === "sendPrivately" ? "−" : "";
  const sub = [
    timeAgo(e.createdAt),
    e.counterparty ? (e.kind === "dapp" ? e.counterparty : t("l2hist.to", { who: truncMiddle(e.counterparty, 8, 6) })) : null,
    e.kind === "received" && e.note ? t("l2hist.outputs", { n: e.note }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={compact ? "flex items-center gap-3 px-3 py-2.5" : "flex items-start gap-3 px-4 py-3.5"}>
      <KindIcon kind={e.kind} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-[var(--tari-text)]">{t(TITLE[e.kind])}</p>
        <p className="mt-0.5 truncate text-[11px] text-zinc-500">{sub}</p>
        {!compact && e.status === "failed" && e.error && (
          <p className="mt-1 text-[11px] break-words text-[var(--st-red)]">{e.error}</p>
        )}
        {!compact && e.transactionId && (
          <a
            href={explorerTxUrl(e.transactionId)}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#9d6bff] hover:underline"
          >
            {t("l2hist.viewOnExplorer")} <ExternalLink size={11} />
            <span className="font-mono font-normal text-zinc-500">{truncMiddle(e.transactionId, 6, 6)}</span>
          </a>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {amount && <span className="tabular font-mono text-xs font-bold text-[var(--tari-text)]">{sign}{amount}</span>}
        {e.status === "pending" ? (
          <Badge tone="amber">
            <Loader2 size={10} className="animate-spin" /> {t("l2hist.pending")}
          </Badge>
        ) : e.status === "failed" ? (
          <Badge tone="red">{t("l2hist.failed")}</Badge>
        ) : compact && e.transactionId ? (
          <a
            href={explorerTxUrl(e.transactionId)}
            target="_blank"
            rel="noreferrer"
            title={t("l2hist.viewOnExplorer")}
            className="text-zinc-500 hover:text-[#9d6bff]"
          >
            <ExternalLink size={13} />
          </a>
        ) : (
          <Badge tone="green">{t("l2hist.done")}</Badge>
        )}
      </div>
    </div>
  );
}

export function L2ActivityPanel() {
  const store = useStore();
  const { t } = useI18n();
  const account = store.l2.identity?.address;
  const entries = useL2History(account);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#9d6bff] to-[#6d28d9] text-white">
            <HistoryIcon size={15} />
          </span>
          {t("l2hist.title")}
        </h2>
        {entries.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => clearL2History(account)}>
            <Trash2 size={13} /> {t("l2hist.clear")}
          </Button>
        )}
      </div>
      <p className="mb-4 text-xs leading-relaxed text-zinc-500">{t("l2hist.intro")}</p>
      {entries.length === 0 ? (
        <EmptyState icon={<HistoryIcon size={20} />} title={t("l2hist.emptyTitle")} sub={t("l2hist.emptySub")} />
      ) : (
        <Card className="divide-y divide-[var(--tari-border)] overflow-hidden p-0">
          {entries.map((e) => (
            <L2ActivityRow key={e.id} e={e} />
          ))}
        </Card>
      )}
    </div>
  );
}
