import { useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, EyeOff, Eye, FileInput, Grid3x3, Layers, Loader2, Lock, RefreshCw, Search, TriangleAlert, Wallet } from "lucide-react";
import { useStore } from "../store";
import { TARI_RESOURCE_ADDRESS, formatResourceAmount, type TokenBalance } from "../ootle";
import { truncMiddle } from "../lib/format";
import { networkLabel } from "../lib/tari";
import { useToast } from "./toast";
import { useI18n } from "../i18n";
import { ActionTiles, Button, CopyButton, EmptyState, Segmented } from "./ui";

type L2Tab = "balances" | "activity";
import { logL2, useL2History } from "../lib/l2history";
import { L2ActivityRow } from "./L2ActivityPanel";

/**
 * The Ootle (L2) view, laid out to mirror the L1 wallet column: balance card on top, holdings
 * beneath it.
 *
 * Reads from the same seed as the L1 side, so this is the same wallet one layer up — but Ootle
 * has no public MainNet indexer, so the account here lives on Esmeralda and every surface says
 * so. Test TARI must never be mistaken for the MainNet XTM on the L1 side.
 */
export function L2Panel({
  onOpenPanel,
}: {
  /** Opens one of the Dashboard's floating panels — the same host the L1 send/receive use. */
  onOpenPanel: (panel: "l2send" | "l2shield" | "l2unshield" | "l2receive" | "l2activity" | "dapps" | "claimburn") => void;
}) {
  const store = useStore();
  const toast = useToast();
  const { t } = useI18n();
  const [scanning, setScanning] = useState(false);
  const { identity, balances, loading, error } = store.l2;
  const activity = useL2History(identity?.address);
  const [tab, setTab] = useState<L2Tab>("balances");
  const [actionsOpen, setActionsOpen] = useState(true);
  const scrollState = useRef({ last: 0, lockUntil: 0, upTravel: 0 });

  /**
   * Collapse the card's action rows when the list is scrolled down, and bring them back when it is
   * scrolled up. Hysteresis keeps it from flickering: collapse only past 24px going down, expand
   * after 40px of upward travel or at the top, and ignore scroll events for the length of the
   * animation, since the reflow itself moves scrollTop.
   */
  function onListScroll(el: HTMLDivElement) {
    const now = performance.now();
    const st = el.scrollTop;
    const state = scrollState.current;
    const dy = st - state.last;
    state.last = st;
    if (now < state.lockUntil) return;
    if (st <= 4) {
      state.upTravel = 0;
      if (!actionsOpen) {
        setActionsOpen(true);
        state.lockUntil = now + 350;
      }
      return;
    }
    if (dy > 0) {
      state.upTravel = 0;
      if (actionsOpen && st > 24) {
        setActionsOpen(false);
        state.lockUntil = now + 350;
      }
    } else if (dy < 0) {
      state.upTravel -= dy;
      if (!actionsOpen && state.upTravel > 40) {
        setActionsOpen(true);
        state.upTravel = 0;
        state.lockUntil = now + 350;
      }
    }
  }

  const headline = pickHeadline(balances);

  /**
   * Rebuilds the shielded-output ledger from the chain. Needed whenever funds were shielded from
   * another device or wallet on this seed: those outputs are freestanding substates no vault
   * lists, so without a local record this wallet cannot see them at all.
   */
  async function findPrivate() {
    if (scanning) return;
    setScanning(true);
    try {
      const claimed = await store.scanL2PrivateFunds();
      if (claimed > 0) logL2(identity?.address, { kind: "received", status: "done", note: String(claimed) });
      toast({
        tone: claimed > 0 ? "success" : "info",
        title: claimed > 0 ? t("l2.foundOutputs", { n: claimed }) : t("l2.nothingNew"),
        message: claimed > 0 ? t("l2.privateUpdated") : t("l2.noUnrecorded"),
      });
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      {/* Ootle balance card — same shape as the L1 card */}
      <div className="wallet-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="grid size-6 place-items-center rounded-full"
              style={{ background: "rgba(255,255,255,.14)" }}
            >
              <Layers size={13} />
            </span>
            <span className="text-sm font-bold">{t("l2.ootleL2")}</span>
            <span className="rounded-full bg-black/30 px-2 py-0.5 text-[9px] font-bold tracking-wide uppercase opacity-90">
              {t("l2.testnet")}
            </span>
          </div>
          {identity && (
            <CopyButton
              text={identity.address}
              label=""
              className="!border-white/20 !bg-white/10 hover:!bg-white/20"
            />
          )}
        </div>

        <p className="tabular mt-2.5 text-2xl font-extrabold leading-none">
          {loading && balances.length === 0 ? (
            <span className="inline-flex items-center gap-2 text-base font-bold opacity-80">
              <Loader2 size={16} className="animate-spin" />
              {t("common.loading")}
            </span>
          ) : (
            <>
              {headline ? formatResourceAmount(headline.amount, headline.divisibility) : "0"}{" "}
              <span className="text-xs font-bold opacity-80">{headline?.symbol ?? "TARI"}</span>
            </>
          )}
        </p>
        <p className="mt-1 text-[11px] opacity-70">{t("l2.revealedBalance")}</p>

        {/* Private funds sit in the same vault but are only visible to this account's view key, so
            they get their own line rather than being folded into the number above. */}
        {headline && headline.confidentialAmount > 0n && (
          <p className="tabular mt-0.5 flex items-center gap-1 text-[10px] opacity-70">
            <Lock size={9} />
            {t("l2.privateSuffix", {
              amount: formatResourceAmount(headline.confidentialAmount, headline.divisibility),
              symbol: headline.symbol ?? "TARI",
            })}
          </p>
        )}

        <button
          onClick={() => store.requestLayer("L1")}
          className="mt-3 flex w-full items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-left transition-colors hover:bg-black/35"
        >
          <span className="flex items-center gap-2 text-xs font-bold">
            <ChevronLeft size={14} /> {t("l2.backToL1")}
          </span>
          <span className="text-[10px] opacity-70">{networkLabel(store.network)}</span>
        </button>

        {/* Folds away while the list below is scrolled down, back on scrolling up: the list gets the room. */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${actionsOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
          aria-hidden={!actionsOpen}
          inert={!actionsOpen}
        >
          <div className="min-h-0 overflow-hidden">
            <button
              onClick={() => void findPrivate()}
              disabled={scanning || !identity}
              className="mt-1.5 flex w-full items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-left transition-colors hover:bg-black/35 disabled:opacity-60"
            >
              <span className="flex items-center gap-2 text-xs font-bold">
                {scanning ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                {scanning ? t("dash.scanning") : t("l2.findPrivate")}
              </span>
              <span className="text-[10px] opacity-70">{t("l2.shieldedTag")}</span>
            </button>

            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <button
                onClick={() => onOpenPanel("l2shield")}
                disabled={!identity}
                title={t("l2.shieldTitle")}
                className="flex min-w-0 items-center justify-center gap-2 rounded-xl bg-black/25 px-3 py-2 text-xs font-bold transition-colors hover:bg-black/35 disabled:opacity-60"
              >
                <EyeOff size={14} className="shrink-0" /> <span className="truncate">{t("l2.shield")}</span>
              </button>
              <button
                onClick={() => onOpenPanel("l2unshield")}
                disabled={!identity}
                title={t("l2.unshieldTitle")}
                className="flex min-w-0 items-center justify-center gap-2 rounded-xl bg-black/25 px-3 py-2 text-xs font-bold transition-colors hover:bg-black/35 disabled:opacity-60"
              >
                <Eye size={14} className="shrink-0" /> <span className="truncate">{t("l2.unshield")}</span>
              </button>
            </div>

            <button
              onClick={() => onOpenPanel("claimburn")}
              disabled={!identity}
              className="mt-1.5 flex w-full items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-left transition-colors hover:bg-black/35 disabled:opacity-60"
            >
              <span className="flex items-center gap-2 text-xs font-bold">
                <FileInput size={14} /> {t("l2.claimBurn")}
              </span>
              <span className="text-[10px] opacity-70">{t("l2.fromProof")}</span>
            </button>
          </div>
        </div>
      </div>

      <ActionTiles
        actions={[
          { label: t("l2.send"), icon: <ArrowUpRight size={16} />, onClick: () => onOpenPanel("l2send"), disabled: !identity },
          { label: t("l2.receive"), icon: <ArrowDownLeft size={16} />, onClick: () => onOpenPanel("l2receive"), disabled: !identity },
          { label: t("l2.apps"), icon: <Grid3x3 size={16} />, onClick: () => onOpenPanel("dapps"), title: t("dash.ootleApps") },
        ]}
      />

      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <Segmented
          value={tab}
          onChange={(v) => {
            setTab(v as L2Tab);
            setActionsOpen(true);
            scrollState.current.last = 0;
          }}
          options={[
            { value: "balances", label: t("l2tabs.balances") },
            { value: "activity", label: `${t("l2tabs.activity")}${activity.length ? ` · ${activity.length}` : ""}` },
          ]}
        />
        {tab === "balances" ? (
          <Button
            size="sm"
            variant="ghost"
            className="!px-1.5"
            loading={loading}
            onClick={() => store.refreshL2()}
            aria-label={t("l2.refreshBalances")}
          >
            <RefreshCw size={12} />
          </Button>
        ) : (
          <button
            onClick={() => onOpenPanel("l2activity")}
            className="flex items-center gap-0.5 text-xs font-semibold whitespace-nowrap text-zinc-500 hover:text-[var(--tari-text)]"
          >
            {t("l2hist.viewAll")} <ChevronRight size={12} />
          </button>
        )}
      </div>

      {/* Each tab scrolls on its own, so a long list never pushes the other out of reach. */}
      <div
        key={tab}
        className="min-h-[96px] flex-1 overflow-y-auto overscroll-contain pr-0.5"
        onScroll={(e) => onListScroll(e.currentTarget)}
      >
        {tab === "activity" ? (
          activity.length === 0 ? (
            <p className="rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] px-4 py-3 text-xs text-zinc-500">
              {t("l2hist.emptyTitle")}
            </p>
          ) : (
            <div className="divide-y divide-[var(--tari-border)] overflow-hidden rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)]">
              {activity.map((e) => (
                <button key={e.id} className="block w-full text-left hover:opacity-90" onClick={() => onOpenPanel("l2activity")}>
                  <L2ActivityRow e={e} compact />
                </button>
              ))}
            </div>
          )
        ) : (
          <>
          {error ? (
            <div className="flex items-start gap-2.5 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-xs text-[var(--st-red)]">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">{t("l2.indexerUnreachable")}</p>
                <p className="mt-1 break-all opacity-80">{error}</p>
              </div>
            </div>
          ) : loading && balances.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500">{t("l2.loadingBalances")}</p>
          ) : balances.length === 0 ? (
            <EmptyState
              icon={<Wallet size={20} />}
              title={t("l2.noBalances")}
              sub={t("l2.noFundsYet")}
            />
          ) : (
            <div className="space-y-2.5">
              {balances.map((b) => (
                <div
                  key={b.resourceAddress}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[var(--tari-text)]">
                      {b.symbol ?? b.name ?? truncMiddle(b.resourceAddress, 10, 6)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {b.kind}
                      {b.confidentialDecryptFailures > 0
                        ? t("l2.decryptFailures", { n: b.confidentialDecryptFailures })
                        : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular font-mono text-sm font-bold text-[var(--tari-text)]">
                      {b.kind === "NonFungible"
                        ? // Indivisible by definition — the count itself, never run through
                          // formatResourceAmount()'s divisibility math (that produced "0" here before
                          // this vault kind was handled: NonFungible has no `.amount` field at all).
                          `${b.amount.toString()} ${b.amount === 1n ? t("l2.nft") : t("l2.nfts")}`
                        : formatResourceAmount(b.amount, b.divisibility)}
                    </p>
                    {b.kind === "NonFungible" && b.nonFungibleTokenIds && b.nonFungibleTokenIds.length > 0 && (
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500" title={b.nonFungibleTokenIds.join(", ")}>
                        {b.nonFungibleTokenIds.slice(0, 3).join(", ")}
                        {b.nonFungibleTokenIds.length > 3 ? t("l2.moreSuffix", { n: b.nonFungibleTokenIds.length - 3 }) : ""}
                      </p>
                    )}
                    {b.confidentialAmount > 0n && (
                      <p className="tabular mt-0.5 flex items-center justify-end gap-1 font-mono text-[11px] text-[var(--st-violet)]">
                        <Lock size={9} />
                        {t("l2.privateAmount", { amount: formatResourceAmount(b.confidentialAmount, b.divisibility) })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The resource the card leads with. TARI is Ootle's native token, so it wins when present;
 * otherwise the largest holding stands in, and an account with nothing shows a plain zero.
 *
 * NonFungible resources are excluded from "largest holding" — their `amount` is a token *count*,
 * not a value on the same scale as a Fungible/Confidential/Stealth balance, so it isn't
 * meaningfully comparable and shouldn't win the header by having a bigger raw number (holding 3
 * NFTs and 0 of everything else must not headline as "3 NFT" run through decimal formatting).
 * Falls through to null (a plain "0") if NFTs are the account's only holding — the balances list
 * below still shows them correctly either way.
 */
function pickHeadline(balances: TokenBalance[]): TokenBalance | null {
  const eligible = balances.filter((b) => b.kind !== "NonFungible");
  if (eligible.length === 0) return null;
  const tari = eligible.find((b) => b.resourceAddress === TARI_RESOURCE_ADDRESS);
  if (tari) return tari;
  return eligible.reduce((best, b) => (b.amount > best.amount ? b : best), eligible[0]!);
}
