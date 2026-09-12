import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  FlaskConical,
  Grid3x3,
  History,
  Loader2,
  Lock,
  Moon,
  QrCode,
  Send,
  Settings as SettingsIcon,
  Sun,
  Tag,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { isLocked, useStore } from "../store";
import { formatMicro, timeAgo, truncMiddle } from "../lib/format";
import { Button, Card, CopyButton, Logo } from "./ui";
import { TowerBackground } from "./TowerBackground";
import { BlockExplorerMini } from "./blocks/BlockExplorerMini";
import { SendPanel } from "./SendPanel";
import { ReceivePanel } from "./ReceivePanel";
import { ActivityPanel } from "./ActivityPanel";
import { ToolsPanel } from "./ToolsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { L2Panel } from "./L2Panel";
import { DappStore } from "./DappStore";
import { L2SendPanel } from "./L2SendPanel";
import { L2ReceivePanel } from "./L2ReceivePanel";
import { SubAddressPanel } from "./SubAddressPanel";
import { AddressSwitcher } from "./AddressSwitcher";
import { LayerJump } from "./LayerJump";
import { SoonMascot } from "./SoonMascot";

type Panel = "send" | "receive" | "activity" | "tools" | "settings" | "l2send" | "l2receive" | "subaddresses" | "dapps" | null;

/** True while the viewport is phone-sized. Re-evaluates on rotation and resize. */
function useIsPhone() {
  const query = "(max-width: 767px)";
  const [isPhone, setIsPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setIsPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return isPhone;
}

export function Dashboard() {
  const store = useStore();
  const [panel, setPanel] = useState<Panel>(null);
  const [dark, setDark] = useState(false);
  const isPhone = useIsPhone();


  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "";
  }, [dark]);

  // Any activity resets the idle timer; hitting it locks the wallet (a no-op until a PIN is set,
  // per store.lock()'s own guard) rather than erasing anything.
  useEffect(() => {
    if (!store.hasPin || store.autoLockMinutes <= 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => store.lock(), store.autoLockMinutes * 60_000);
    };
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [store.hasPin, store.autoLockMinutes, store.lock]);

  if (!store.wallet || !store.addressInfo || !store.network) return null;

  const addr = store.addressInfo;
  // Whichever address the switcher is presenting — the main one, or a sub-address. Only affects
  // what is handed out for receiving; the balance below is the same wallet either way.
  const activeAddress =
    store.subAddresses.find((s) => s.label === store.activeSubAddress)?.base58 ?? addr.base58;
  // Earliest height at which any locked output becomes spendable.
  const nextUnlockHeight = store.utxos.reduce<number | null>((soonest, u) => {
    if (!isLocked(u, store.tipHeight)) return soonest;
    const h = u.maturityHeight ?? 0;
    return soonest === null || h < soonest ? h : soonest;
  }, null);
  const failedCount = store.history.filter((t) => t.status === "failed").length;
  const recent = [...store.history].sort((a, b) => b.createdAt - a.createdAt);
  const openPanel = (p: Panel) => setPanel(p);

  return (
    <div className="pointer-events-none relative flex h-[100dvh] w-full flex-col p-2 md:p-[10px]">
      {!isPhone && (
        <TowerBackground
          successes={Math.max(0, store.history.length - failedCount)}
          failures={failedCount}
          theme={dark ? "dark" : "light"}
        />
      )}

      <div className="z-10 flex h-full w-full min-h-0 flex-col gap-2 md:flex-row md:gap-[10px]">
        {/* ── Rail (white, black active tile) ── */}
        <aside
          className="pointer-events-auto relative z-20 order-3 flex h-16 w-full shrink-0 flex-row items-center justify-around rounded-[20px] px-2 md:order-1 md:h-full md:w-[78px] md:flex-col md:justify-between md:px-0 md:py-5"
          style={{
            background: "var(--tari-bg-deep)",
            border: "1px solid var(--tari-border)",
            boxShadow: "var(--tari-shadow)",
          }}
        >
          <div className="hidden md:block">
            <button className="un-rail-btn" title="Tari" onClick={() => openPanel("settings")}>
              <Logo size={30} />
            </button>
          </div>

          <div className="flex flex-row items-center gap-1 md:flex-col md:gap-2.5">
            <button className="un-rail-btn rail-active" title="Wallet" data-active="true">
              <WalletIcon size={21} />
            </button>
            <button
              className="un-rail-btn"
              title={store.layer === "L2" ? "Send on Ootle" : "Send XTM"}
              onClick={() => openPanel(store.layer === "L2" ? "l2send" : "send")}
            >
              <Send size={20} />
            </button>
            <button
              className="un-rail-btn"
              title={store.layer === "L2" ? "Receive on Ootle" : "Receive XTM"}
              onClick={() => openPanel(store.layer === "L2" ? "l2receive" : "receive")}
            >
              <QrCode size={20} />
            </button>
            <button
              className="un-rail-btn"
              title="Sub-addresses"
              onClick={() => openPanel("subaddresses")}
            >
              <Tag size={20} />
            </button>
            <button
              className="un-rail-btn"
              title="All activity"
              onClick={() => openPanel("activity")}
            >
              <History size={20} />
            </button>
            <button
              className="un-rail-btn"
              title="Crypto lab"
              onClick={() => openPanel("tools")}
            >
              <FlaskConical size={20} />
            </button>
            <button
              className="un-rail-btn"
              title="dApp store"
              onClick={() => openPanel("dapps")}
            >
              <Grid3x3 size={20} />
            </button>
          </div>

          <div className="flex flex-row items-center gap-1 md:flex-col md:gap-2.5">
            <button
              className="un-rail-btn"
              title="Toggle theme"
              onClick={() => setDark((d) => !d)}
            >
              {dark ? <Moon size={19} /> : <Sun size={19} />}
            </button>
            <button
              className="un-rail-btn"
              title="Settings"
              onClick={() => openPanel("settings")}
            >
              <SettingsIcon size={21} />
            </button>
            <button
              className="un-rail-btn"
              style={!store.hasPin ? { opacity: 0.35, cursor: "not-allowed" } : undefined}
              title={store.hasPin ? "Lock wallet" : "Set a PIN in Settings to enable Lock"}
              disabled={!store.hasPin}
              onClick={() => store.lock()}
            >
              <Lock size={19} />
            </button>
          </div>
        </aside>

        {/* ── Left panel — wallet column (v1.6 replica) ── */}
        <aside
          className="pointer-events-auto relative z-20 order-1 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[20px] md:order-2 md:mb-4 md:h-[56vh] md:max-h-[calc(100vh-20px)] md:w-[320px] md:flex-none md:self-end"
          style={{
            background: "var(--tari-bg-deep)",
            border: "1px solid var(--tari-border)",
            boxShadow: "var(--tari-shadow)",
          }}
        >
          <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3">
            {store.layer === "L2" ? (
              <div className="animate-fade-up">
                <L2Panel onOpenPanel={openPanel} />
              </div>
            ) : (
              <>
            {/* Olive wallet card — balance on top */}
            <div className="wallet-card p-4">
              <div className="flex items-center justify-between gap-2">
                <AddressSwitcher onAddNew={() => openPanel("subaddresses")} />
                <CopyButton
                  text={activeAddress}
                  label=""
                  className="!border-white/20 !bg-white/10 hover:!bg-white/20"
                />
              </div>
              <p className="tabular mt-2.5 text-2xl font-extrabold leading-none">
                {store.scan && !store.scan.done ? (
                  <span className="inline-flex items-center gap-2 text-base font-bold opacity-80">
                    <Loader2 size={16} className="animate-spin" />
                    Scanning…
                  </span>
                ) : (
                  <>
                    {formatMicro(store.unlockedMicro)}{" "}
                    <span className="text-xs font-bold opacity-80">XTM</span>
                  </>
                )}
              </p>
              <p className="mt-1 text-[11px] opacity-70">Available balance</p>
              <button
                onClick={() => store.requestLayer("L2")}
                className="mt-3 flex w-full items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-left transition-colors hover:bg-black/35"
              >
                <span className="flex items-center gap-2 text-xs font-bold">
                  <SoonMascot size={18} /> Switch to L2
                </span>
                <span className="text-[10px] opacity-70">Ootle · testnet</span>
              </button>
              {store.pendingMicro > 0n && (
                <p className="tabular mt-0.5 flex items-center gap-1 text-[10px] opacity-60" title="Change from a broadcast transaction — spendable once it is mined and scanned">
                  <Loader2 size={9} className="animate-spin" />
                  {formatMicro(store.pendingMicro)} XTM confirming
                </p>
              )}
              {store.lockedMicro > 0n && (
                <p
                  className="tabular mt-0.5 flex items-center gap-1 text-[10px] opacity-60"
                  title={
                    nextUnlockHeight !== null && store.tipHeight !== null
                      ? `Unlocks at block ${nextUnlockHeight.toLocaleString()} — ${(
                          nextUnlockHeight - store.tipHeight
                        ).toLocaleString()} blocks to go`
                      : "Coinbase outputs mature 180 blocks after they are mined"
                  }
                >
                  <Lock size={9} />
                  {formatMicro(store.lockedMicro)} XTM locked
                </p>
              )}
              <button
                onClick={() => openPanel("settings")}
                className="mt-3 flex w-full items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-left transition-colors hover:bg-black/35"
              >
                <span className="flex items-center gap-2 text-xs font-bold">
                  <AlertCircle size={12} className="text-[var(--st-amber)]" />
                  Secure your wallet
                </span>
                <span className="text-[10px] opacity-70">Backup · Steps ●○</span>
              </button>
            </div>

            {/* Activity header + quick actions */}
            <div className="flex items-center justify-between px-1">
              <button
                onClick={() => openPanel("activity")}
                className="flex items-center gap-1 text-sm font-bold text-[var(--tari-text)]"
              >
                All Activity
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => openPanel("send")}
                  className="tx-pill px-4 py-1.5 text-xs font-bold text-[var(--tari-text)] hover:opacity-80"
                >
                  Send
                </button>
                <button
                  onClick={() => openPanel("receive")}
                  className="tx-pill px-4 py-1.5 text-xs font-bold text-[var(--tari-text)] hover:opacity-80"
                >
                  Receive
                </button>
              </div>
            </div>

            {/* Transaction list */}
            <div
              className="flex min-h-[180px] flex-1 flex-col gap-2 rounded-2xl p-2"
              style={{ background: "var(--tari-bg-input)" }}
            >
              {recent.length === 0 ? (
                <div className="grid place-items-center py-6">
                  <span className="tx-pill px-5 py-2 text-xs font-bold text-[var(--tari-text)]">
                    No transactions found
                  </span>
                </div>
              ) : (
                recent.slice(0, 6).map((t) => {
                  const incoming = t.direction === "in";
                  return (
                  <button
                    key={t.id}
                    onClick={() => openPanel("activity")}
                    className="tx-pill flex items-center gap-3 px-3 py-2.5 text-left hover:opacity-90"
                  >
                    <span
                      className={
                        t.status === "failed"
                          ? "grid size-7 shrink-0 place-items-center rounded-full border border-red-500/30 bg-red-500/10 text-red-500"
                          : incoming
                            ? "grid size-7 shrink-0 place-items-center rounded-full border border-[#06C983]/30 bg-[#06C983]/10 text-[#06C983]"
                            : "grid size-7 shrink-0 place-items-center rounded-full border border-[#9330ff]/30 bg-[#9330ff]/10 text-[#9330ff]"
                      }
                    >
                      {incoming ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11px] font-semibold text-[var(--tari-text)]">
                        {incoming
                          ? t.paidTo && t.paidTo.length > 0
                            ? t.paidTo.join(", ")
                            : "Received"
                          : truncMiddle(t.toBase58, 6, 4)}
                      </span>
                      <span className="block text-[10px] text-zinc-400">
                        {timeAgo(t.createdAt)}
                        {t.status === "pending" || t.status === "submitted" ? " · pending" : ""}
                      </span>
                    </span>
                    <span
                      className={
                        incoming
                          ? "tabular rounded-md bg-[#06C983]/10 px-2 py-0.5 font-mono text-[11px] font-bold text-[#06C983]"
                          : "tabular rounded-md bg-black/[0.06] px-2 py-0.5 font-mono text-[11px] font-bold text-[var(--tari-text)] dark:bg-white/10"
                      }
                    >
                      {BigInt(t.amountMicro) > 0n
                        ? `${incoming ? "+" : ""}${formatMicro(BigInt(t.amountMicro))} XTM`
                        : "—"}
                    </span>
                  </button>
                  );
                })
              )}
            </div>
              </>
            )}
          </div>
        </aside>

        {/* ── Main area over the tower ── */}
        <main className="relative order-2 hidden w-full min-w-0 shrink-0 md:order-3 md:block md:h-auto md:w-auto md:flex-1">
          {/* Live block explorer bubbles — bottom center (Universe BlockExplorerMini) */}
          {!isPhone && (
            <div className="absolute inset-x-0 bottom-0 z-10 md:bottom-5">
              <BlockExplorerMini />
            </div>
          )}

        </main>
      </div>

        {/* Soon's leap between layers. The switch commits on landing, so the wallet underneath
          never changes while the animation is still in the air. */}
      {store.pendingLayer && (
        <LayerJump to={store.pendingLayer} onDone={() => store.setLayer(store.pendingLayer!)} />
      )}

      {/* Floating panel host */}
        {panel && (
          <div className="pointer-events-auto fixed inset-2 z-30 mx-auto max-w-3xl md:inset-x-0 md:top-1/2 md:bottom-auto md:max-h-[84vh] md:-translate-y-1/2 md:px-2">
            <Card className="popup-shadow animate-pop flex max-h-full flex-col overflow-hidden !rounded-[20px] p-0">
              <div
                className="flex items-center justify-end border-b px-4 py-2"
                style={{ borderColor: "var(--tari-border)" }}
              >
                <button
                  onClick={() => setPanel(null)}
                  className="rounded-full p-1.5 text-[var(--tari-text-dim)] transition-colors hover:bg-[color-mix(in_srgb,var(--tari-text)_8%,transparent)] hover:text-[var(--tari-text)]"
                  aria-label="Close panel"
                >
                  <X size={15} />
                </button>
              </div>
              <div key={panel} className="animate-fade-up min-h-0 flex-1 overflow-y-auto p-5 sm:p-7 md:max-h-[calc(84vh-41px)]">
                {panel === "send" && <SendPanel />}
                {panel === "receive" && <ReceivePanel />}
                {panel === "activity" && <ActivityPanel />}
                {panel === "tools" && <ToolsPanel />}
                {panel === "settings" && <SettingsPanel />}
                {panel === "l2send" && <L2SendPanel />}
                {panel === "l2receive" && <L2ReceivePanel />}
                {panel === "subaddresses" && <SubAddressPanel />}
                {panel === "dapps" && <DappStore />}
              </div>
            </Card>
          </div>
        )}
    </div>
  );
}

export function AddressQr({ value }: { value: string }) {
  return (
    <div className="grid place-items-center rounded-[20px] bg-white p-4 shadow-[0_0_45px_-6px_rgba(147,48,255,.55)]">
      <QRCodeSVG value={value} size={168} bgColor="#ffffff" fgColor="#1b1b1b" level="M" />
    </div>
  );
}

export function CoinPill({ kind }: { kind: string }) {
  const map: Record<string, string> = {
    demo: "border-cyan-400/25 bg-cyan-400/10 text-cyan-300",
    scanned: "border-[#06C983]/30 bg-[#06C983]/10 text-[#7CD9A7]",
    change: "border-[#9330ff]/35 bg-[#9330ff]/15 text-[#d4acff]",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${map[kind] ?? map.demo}`}
    >
      {kind}
    </span>
  );
}
