import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, Droplets, FileInput, Grid3x3, Layers, Loader2, Lock, RefreshCw, Search, TriangleAlert, Wallet } from "lucide-react";
import { useStore } from "../store";
import { formatResourceAmount, type TokenBalance } from "../ootle";
import { truncMiddle } from "../lib/format";
import { networkLabel } from "../lib/tari";
import { useToast } from "./toast";
import { ActionTiles, Button, CopyButton, EmptyState } from "./ui";

/**
 * The Ootle (L2) view, laid out to mirror the L1 wallet column: balance card on top, holdings
 * beneath it.
 *
 * Reads from the same seed as the L1 side, so this is the same wallet one layer up — but Ootle
 * has no public MainNet indexer, so the account here lives on Esmeralda and every surface says
 * so. Test XTR must never be mistaken for the MainNet XTM on the L1 side.
 */
export function L2Panel({
  onOpenPanel,
}: {
  /** Opens one of the Dashboard's floating panels — the same host the L1 send/receive use. */
  onOpenPanel: (panel: "l2send" | "l2receive" | "dapps" | "claimburn") => void;
}) {
  const store = useStore();
  const toast = useToast();
  const [claiming, setClaiming] = useState(false);
  const [scanning, setScanning] = useState(false);
  const { identity, balances, loading, error } = store.l2;

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
      toast({
        tone: claimed > 0 ? "success" : "info",
        title: claimed > 0 ? `Found ${claimed} private output(s)` : "Nothing new found",
        message: claimed > 0 ? "Your private balance has been updated." : "No unrecorded shielded funds on this account.",
      });
    } finally {
      setScanning(false);
    }
  }

  async function claim() {
    if (!identity || claiming) return;
    setClaiming(true);
    try {
      await identity.account.claimTestnetXtr();
      toast({ tone: "success", title: "Test XTR claimed", message: "Refreshing your balances…" });
      store.refreshL2();
    } catch (e) {
      toast({
        tone: "error",
        title: "Claim failed",
        message: e instanceof Error ? e.message.slice(0, 160) : String(e),
      });
    }
    setClaiming(false);
  }

  return (
    <div className="flex flex-col gap-2.5">
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
            <span className="text-sm font-bold">Ootle L2</span>
            <span className="rounded-full bg-black/30 px-2 py-0.5 text-[9px] font-bold tracking-wide uppercase opacity-90">
              testnet
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
              Loading…
            </span>
          ) : (
            <>
              {headline ? formatResourceAmount(headline.amount, headline.divisibility) : "0"}{" "}
              <span className="text-xs font-bold opacity-80">{headline?.symbol ?? "XTR"}</span>
            </>
          )}
        </p>
        <p className="mt-1 text-[11px] opacity-70">Revealed balance</p>

        {/* Private funds sit in the same vault but are only visible to this account's view key, so
            they get their own line rather than being folded into the number above. */}
        {headline && headline.confidentialAmount > 0n && (
          <p className="tabular mt-0.5 flex items-center gap-1 text-[10px] opacity-70">
            <Lock size={9} />
            {formatResourceAmount(headline.confidentialAmount, headline.divisibility)}{" "}
            {headline.symbol ?? "XTR"} private
          </p>
        )}

        <button
          onClick={() => store.requestLayer("L1")}
          className="mt-3 flex w-full items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-left transition-colors hover:bg-black/35"
        >
          <span className="flex items-center gap-2 text-xs font-bold">
            <ChevronLeft size={14} /> Back to Tari L1
          </span>
          <span className="text-[10px] opacity-70">{networkLabel(store.network)}</span>
        </button>

        <button
          onClick={() => void findPrivate()}
          disabled={scanning || !identity}
          className="mt-1.5 flex w-full items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-left transition-colors hover:bg-black/35 disabled:opacity-60"
        >
          <span className="flex items-center gap-2 text-xs font-bold">
            {scanning ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {scanning ? "Scanning…" : "Find private funds"}
          </span>
          <span className="text-[10px] opacity-70">shielded</span>
        </button>

        <button
          onClick={() => void claim()}
          disabled={claiming || !identity}
          className="mt-1.5 flex w-full items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-left transition-colors hover:bg-black/35 disabled:opacity-60"
        >
          <span className="flex items-center gap-2 text-xs font-bold">
            {claiming ? <Loader2 size={14} className="animate-spin" /> : <Droplets size={14} />}
            {claiming ? "Claiming…" : "Claim test XTR"}
          </span>
          <span className="text-[10px] opacity-70">faucet</span>
        </button>

        <button
          onClick={() => onOpenPanel("claimburn")}
          disabled={!identity}
          className="mt-1.5 flex w-full items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-left transition-colors hover:bg-black/35 disabled:opacity-60"
        >
          <span className="flex items-center gap-2 text-xs font-bold">
            <FileInput size={14} /> Claim an L1 burn
          </span>
          <span className="text-[10px] opacity-70">from proof</span>
        </button>
      </div>

      <ActionTiles
        actions={[
          { label: "Send", icon: <ArrowUpRight size={16} />, onClick: () => onOpenPanel("l2send"), disabled: !identity },
          { label: "Receive", icon: <ArrowDownLeft size={16} />, onClick: () => onOpenPanel("l2receive"), disabled: !identity },
          { label: "Apps", icon: <Grid3x3 size={16} />, onClick: () => onOpenPanel("dapps"), title: "Ootle apps" },
        ]}
      />

      <div className="flex items-center justify-between px-1 pt-1">
        <span className="text-sm font-bold text-[var(--tari-text)]">Balances</span>
        <Button
          size="sm"
          variant="ghost"
          className="!px-1.5"
          loading={loading}
          onClick={() => store.refreshL2()}
          aria-label="Refresh balances"
        >
          <RefreshCw size={12} />
        </Button>
      </div>

      {error ? (
        <div className="flex items-start gap-2.5 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-xs text-[var(--st-red)]">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold">Could not reach the Ootle indexer</p>
            <p className="mt-1 break-all opacity-80">{error}</p>
          </div>
        </div>
      ) : loading && balances.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-500">Loading balances…</p>
      ) : balances.length === 0 ? (
        <EmptyState
          icon={<Wallet size={20} />}
          title="No balances"
          sub="This account holds no Ootle funds yet. Claim test XTR from the faucet, or burn tXTM from layer 1."
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
                    ? ` · ${b.confidentialDecryptFailures} commitment(s) failed to decrypt`
                    : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="tabular font-mono text-sm font-bold text-[var(--tari-text)]">
                  {b.kind === "NonFungible"
                    ? // Indivisible by definition — the count itself, never run through
                      // formatResourceAmount()'s divisibility math (that produced "0" here before
                      // this vault kind was handled: NonFungible has no `.amount` field at all).
                      `${b.amount.toString()} ${b.amount === 1n ? "NFT" : "NFTs"}`
                    : formatResourceAmount(b.amount, b.divisibility)}
                </p>
                {b.kind === "NonFungible" && b.nonFungibleTokenIds && b.nonFungibleTokenIds.length > 0 && (
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500" title={b.nonFungibleTokenIds.join(", ")}>
                    {b.nonFungibleTokenIds.slice(0, 3).join(", ")}
                    {b.nonFungibleTokenIds.length > 3 ? `, +${b.nonFungibleTokenIds.length - 3} more` : ""}
                  </p>
                )}
                {b.confidentialAmount > 0n && (
                  <p className="tabular mt-0.5 flex items-center justify-end gap-1 font-mono text-[11px] text-[var(--st-violet)]">
                    <Lock size={9} />
                    {formatResourceAmount(b.confidentialAmount, b.divisibility)} private
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The resource the card leads with. XTR is Ootle's native token, so it wins when present;
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
  const xtr = eligible.find((b) => b.symbol === "XTR");
  if (xtr) return xtr;
  return eligible.reduce((best, b) => (b.amount > best.amount ? b : best), eligible[0]!);
}
