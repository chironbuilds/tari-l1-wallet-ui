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
import { broadcastBaseUrl, submitViaMiddleware } from "../lib/tari";
import { copyText, downloadText, formatMicro, timeAgo, truncMiddle } from "../lib/format";
import { useToast } from "./toast";
import { Badge, Button, Card, EmptyState } from "./ui";

const statusTone = {
  signed: "violet",
  // A node accepted it, but it is only spent for good once a miner puts it in a block.
  pending: "amber",
  submitted: "amber",
  mined: "green",
  failed: "red",
} as const;

const statusLabel: Record<TxRecord["status"], string> = {
  signed: "signed",
  pending: "pending",
  submitted: "pending",
  mined: "mined",
  failed: "failed",
};

export function ActivityPanel() {
  const store = useStore();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);

  if (store.history.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={<HistoryIcon size={22} />}
          title="No transactions yet"
          sub="Signed and broadcast payments will appear here with their full transaction JSON."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-lg font-bold text-[var(--tari-text)]">Activity</h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            store.clearHistory();
            toast({ tone: "info", title: "History cleared" });
          }}
        >
          <Trash2 size={14} /> Clear
        </Button>
      </div>

      {[...store.history]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((t) => {
          const incoming = t.direction === "in";
          return (
          <Card key={t.id} className="overflow-hidden p-0">
            <button
              onClick={() => setOpenId(openId === t.id ? null : t.id)}
              className="flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-white/[0.03]"
            >
              <span
                className={
                  t.status === "failed"
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
                    ? t.paidTo && t.paidTo.length > 0
                      ? `Received · ${t.paidTo.join(", ")}`
                      : "Received"
                    : `→ ${truncMiddle(t.toBase58, 12, 8)}`}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {timeAgo(t.createdAt)}
                  {incoming ? "" : ` · fee ${formatMicro(BigInt(t.feeMicro))} T`}
                  {t.minedHeight ? ` · block #${t.minedHeight.toLocaleString()}` : ""}
                </p>
                {/* A one-sided payment is unlinkable to its sender on chain; an address only
                    appears here because the sending wallet chose to include one. Saying so beats
                    leaving a blank where an identity would go. */}
                {incoming && (
                  <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                    {t.senders && t.senders.length > 0
                      ? `from ${t.senders.map((s) => truncMiddle(s, 10, 8)).join(", ")}`
                      : "sender not disclosed"}
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
                  {BigInt(t.amountMicro) > 0n
                    ? `${incoming ? "+" : "-"}${formatMicro(BigInt(t.amountMicro))} T`
                    : "—"}
                </span>
                <Badge tone={statusTone[t.status]}>{statusLabel[t.status]}</Badge>
              </div>
              <ChevronRight
                size={16}
                className={
                  openId === t.id
                    ? "shrink-0 rotate-90 text-zinc-400 transition-transform"
                    : "shrink-0 text-zinc-600 transition-transform"
                }
              />
            </button>

            {openId === t.id && <TxDetail rec={t} />}
          </Card>
          );
        })}
    </div>
  );
}

function TxDetail({ rec }: { rec: TxRecord }) {
  const store = useStore();
  const toast = useToast();

  return (
    <div className="animate-fade-up space-y-3.5 border-t border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-5">
      <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
        <dt className="text-zinc-500">Mined in block</dt>
        <dd className="text-right font-mono text-[var(--tari-text)]">
          {rec.minedHeight
            ? `#${rec.minedHeight.toLocaleString()}`
            : rec.status === "pending" || rec.status === "submitted"
              ? "waiting for a block"
              : "—"}
        </dd>
      </dl>
      {rec.changeMicro && BigInt(rec.changeMicro) > 0n && (
        <p className="text-xs text-[var(--st-violet)]">
          change returned: <b>{formatMicro(BigInt(rec.changeMicro))} T</b> · tracked locally as a new UTXO
        </p>
      )}
      {rec.result && (
        <p className="max-h-20 overflow-y-auto rounded-xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-3 font-mono text-[11px] break-all whitespace-pre-wrap text-zinc-400">
          node response: {rec.result}
        </p>
      )}
      <pre className="max-h-52 overflow-auto rounded-xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-3.5 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-zinc-400">
        {pretty(rec.json)}
      </pre>
      <div className="flex flex-wrap gap-2.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void copyText(rec.json).then((ok) => ok && toast({ tone: "success", title: "JSON copied" }))}
        >
          <FileJson size={13} /> Copy JSON
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloadText(`tari-tx-${rec.id.slice(0, 6)}.json`, rec.json)}>
          <FileJson size={13} /> Download
        </Button>
        {(rec.status === "signed" || rec.status === "failed") && (
          <Button size="sm" onClick={() => void resubmit(rec)}>
            <Zap size={13} /> Broadcast{rec.status === "failed" ? " again" : ""}
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
      store.updateTx(rec.id, {
        status: out.accepted ? "pending" : "failed",
        result: out.detail,
      });
      toast({
        tone: out.accepted ? "success" : "error",
        title: out.accepted ? "Broadcast accepted" : `Rejected (${out.result})`,
        message: truncMiddle(out.detail, 50, 30),
      });
    } catch (e) {
      store.updateTx(rec.id, { status: "failed", result: e instanceof Error ? e.message : String(e) });
      toast({ tone: "error", title: "Submission failed" });
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
