import { useEffect, useState } from "react";
import {
  Clock,
  Download,
  Eye,
  EyeOff,
  Globe,
  History,
  KeyRound,
  Languages,
  Loader2,
  Lock,
  Package,
  Radar,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useStore } from "../store";
import { downloadText, truncMiddle } from "../lib/format";
import { exportSeedPhrase } from "../lib/cipherseed";
import { fetchChainTip } from "../lib/explorer";
import { AUTO_NODE_ID, getRpcBase, nodeById, nodesForNetwork } from "../lib/rpc";
import { networkLabel } from "../lib/tari";
import { NetworkSwitch } from "./NetworkSwitch";
import { MIN_PIN_LENGTH } from "../lib/pinLock";
import { useI18n, type TranslationKey } from "../i18n";
import { LanguageSwitch } from "./LanguageSwitch";
import { useToast } from "./toast";
import { Badge, Button, Card, CopyButton, Field, NodeStatusDot, Segmented, Switch, TextInput } from "./ui";
import { connectedSites, revokeConnection, revokeViewAccess } from "../lib/dappBridge";
import { forgetOrigin } from "../lib/dappRequests";
import { detectedCores, maxWorkers, threadOptions } from "../lib/threads";

const AUTO_LOCK_OPTIONS: { value: number; label: TranslationKey }[] = [
  { value: 1, label: "settings.min1" },
  { value: 5, label: "settings.min5" },
  { value: 15, label: "settings.min15" },
  { value: 30, label: "settings.min30" },
  { value: 0, label: "settings.never" },
];

// Wrong-PIN attempts allowed before the gate makes you wait, and how long the wait is.
const MAX_PIN_ATTEMPTS = 5;
const PIN_COOLDOWN_MS = 30_000;

/**
 * Settings exposes the seed phrase and backup hex, so an unattended open wallet must not hand them
 * to whoever sits down at it. Every time the panel opens (it unmounts when closed) the PIN has to
 * be re-entered; a wallet with no PIN yet must set one before anything here is shown, since
 * without one there is nothing to check a passer-by against.
 */
export function SettingsPanel() {
  const store = useStore();
  const [authorized, setAuthorized] = useState(false);
  if (!store.network) return null;
  if (authorized) return <SettingsContent />;
  return store.hasPin ? (
    <PinGate onPass={() => setAuthorized(true)} />
  ) : (
    <SetPinGate onPass={() => setAuthorized(true)} />
  );
}

function GateError({ message }: { message: string }) {
  return (
    <div className="animate-pop mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-sm text-[var(--st-red)]">
      <TriangleAlert size={16} className="mt-0.5 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  );
}

function PinGate({ onPass }: { onPass: () => void }) {
  const { verifyPin } = useStore();
  const { t } = useI18n();
  const [pin, setPinValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (lockedUntil <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [lockedUntil, now]);

  const coolingDown = lockedUntil > now;

  const go = async () => {
    if (!pin || busy || coolingDown) return;
    setBusy(true);
    setError(null);
    const ok = await verifyPin(pin);
    setBusy(false);
    if (ok) {
      onPass();
      return;
    }
    setPinValue("");
    const n = attempts + 1;
    if (n >= MAX_PIN_ATTEMPTS) {
      const until = Date.now() + PIN_COOLDOWN_MS;
      setAttempts(0);
      setLockedUntil(until);
      setNow(Date.now());
      setError(t("settings.tooManyAttempts", { seconds: PIN_COOLDOWN_MS / 1000 }));
    } else {
      setAttempts(n);
      setError(t("settings.incorrectPin"));
    }
  };

  return (
    <Card className="mx-auto w-full max-w-md p-6 sm:p-7">
      <h3 className="mb-1.5 flex items-center gap-2 text-sm font-bold text-[var(--tari-text)]">
        <Lock size={15} /> {t("settings.securityRecovery")}
      </h3>
      <p className="mb-5 text-xs leading-relaxed text-zinc-500">{t("settings.gateIntro")}</p>
      <Field label={t("settings.pin")}>
        <TextInput
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPinValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder="••••"
          error={!!error}
          disabled={coolingDown}
        />
      </Field>
      {error && (
        <GateError
          message={coolingDown ? t("settings.tooManyAttemptsShort", { seconds: Math.ceil((lockedUntil - now) / 1000) }) : error}
        />
      )}
      <Button className="mt-5 w-full" loading={busy} disabled={!pin || coolingDown} onClick={go}>
        <KeyRound size={15} /> {t("settings.unlockSettings")}
      </Button>
    </Card>
  );
}

function SetPinGate({ onPass }: { onPass: () => void }) {
  const store = useStore();
  const toast = useToast();
  const { t } = useI18n();
  const [pin, setPinValue] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setError(null);
    if (pin.length < MIN_PIN_LENGTH) {
      setError(t("settings.pinTooShort", { min: MIN_PIN_LENGTH }));
      return;
    }
    if (pin !== confirmPin) {
      setError(t("settings.pinMismatch"));
      return;
    }
    setBusy(true);
    try {
      await store.setPin(pin);
      toast({ tone: "success", title: t("settings.pinSetTitle"), message: t("settings.pinSetProtected") });
      onPass();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto w-full max-w-md p-6 sm:p-7">
      <h3 className="mb-1.5 flex items-center gap-2 text-sm font-bold text-[var(--tari-text)]">
        <ShieldCheck size={15} /> {t("settings.setPinFirst")}
      </h3>
      <p className="mb-5 text-xs leading-relaxed text-zinc-500">{t("settings.setPinFirstIntro")}</p>
      <div className="grid gap-3">
        <Field label={t("settings.newPin")}>
          <TextInput
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPinValue(e.target.value)}
            placeholder="••••"
          />
        </Field>
        <Field label={t("settings.confirmPin")}>
          <TextInput
            type="password"
            inputMode="numeric"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="••••"
            error={!!error}
          />
        </Field>
      </div>
      {error && <GateError message={error} />}
      <Button className="mt-5 w-full" loading={busy} disabled={!pin || !confirmPin} onClick={go}>
        <KeyRound size={15} /> {t("settings.setPinContinue")}
      </Button>
    </Card>
  );
}

function SettingsContent() {
  const store = useStore();
  const toast = useToast();
  const { t } = useI18n();
  const [revealBackup, setRevealBackup] = useState(false);
  const [revealWords, setRevealWords] = useState(false);
  const [words, setWords] = useState<string[] | null>(null);
  const [wordsBusy, setWordsBusy] = useState(false);
  const [scanFrom, setScanFrom] = useState("");
  const [scanTo, setScanTo] = useState("");
  const [tip, setTip] = useState<number | null>(null);
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPinConfirm, setNewPinConfirm] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  // Read once on mount and re-read after each change rather than subscribed to: these live in
  // localStorage, which fires no event for same-document writes, and they only change when the user
  // acts here or answers a prompt in a dApp frame.
  const [sites, setSites] = useState<{ origin: string; viewAccess: boolean }[]>(() => connectedSites());

  useEffect(() => {
    void fetchChainTip().then((chainTip) => {
      if (!chainTip) return;
      setTip(chainTip.height);
      // Never below the wallet's birthday block — that is the earliest block that can hold our
      // outputs, and the store floors every scan there anyway.
      const floor = store.birthdayHeight ?? 1;
      setScanFrom(String(Math.min(chainTip.height, Math.max(floor, chainTip.height - 499))));
      setScanTo(String(chainTip.height));
    });
  }, [store.birthdayHeight]);

  async function revealPhrase() {
    if (revealWords) {
      setRevealWords(false);
      return;
    }
    if (!store.backupHex) return;
    setWordsBusy(true);
    try {
      const w = await exportSeedPhrase(store.backupHex);
      setWords(w);
      setRevealWords(true);
    } catch (e) {
      toast({
        tone: "error",
        title: t("settings.decipherFailed"),
        message: e instanceof Error ? e.message : String(e),
      });
    }
    setWordsBusy(false);
  }

  async function submitPin() {
    setPinError(null);
    if (newPin.length < MIN_PIN_LENGTH) {
      setPinError(t("settings.pinTooShort", { min: MIN_PIN_LENGTH }));
      return;
    }
    if (newPin !== newPinConfirm) {
      setPinError(t("settings.newPinsMismatch"));
      return;
    }
    setPinBusy(true);
    try {
      if (store.hasPin) {
        const ok = await store.changePin(oldPin, newPin);
        if (!ok) {
          setPinError(t("settings.currentPinWrong"));
          setPinBusy(false);
          return;
        }
        toast({ tone: "success", title: t("settings.pinChanged") });
      } else {
        await store.setPin(newPin);
        toast({ tone: "success", title: t("settings.pinSetTitle"), message: t("settings.pinSetCanLock") });
      }
      setOldPin("");
      setNewPin("");
      setNewPinConfirm("");
    } finally {
      setPinBusy(false);
    }
  }

  if (!store.network) return null;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Two independent columns, so a short card never leaves a gap beside a tall one. */}
      <div className="grid content-start gap-5">
      <Card className="h-fit p-6 sm:p-7">
        <h3 className="mb-1.5 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#06C983] to-[#168552]">
            <ShieldCheck size={15} />
          </span>
          {t("settings.recoveryPhrase")}
        </h3>
        <p className="mb-5 text-xs leading-relaxed text-zinc-500">{t("settings.recoveryIntro")}</p>
        {revealWords && words && (
          <div className="mb-4 grid grid-cols-3 gap-1.5 rounded-2xl border border-white/[0.08] bg-black/30 p-3">
            {words.map((w, i) => (
              <span key={i} className="flex items-baseline gap-1.5 text-xs">
                <span className="w-4 text-right text-[10px] text-zinc-600">{i + 1}</span>
                <span className="font-semibold text-zinc-100">{w}</span>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2.5">
          <Button variant="outline" onClick={() => void revealPhrase()} disabled={wordsBusy}>
            {wordsBusy && <Loader2 size={14} className="animate-spin" />}
            {revealWords ? <EyeOff size={14} /> : <Eye size={14} />}
            {revealWords ? t("settings.hidePhrase") : t("settings.revealWords")}
          </Button>
          {revealWords && words && (
            <CopyButton text={words.join(" ")} label={t("settings.copyPhrase")} />
          )}
        </div>
      </Card>

      <Card className="h-fit p-6 sm:p-7">
        <h3 className="mb-1.5 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600">
            <Package size={15} />
          </span>
          {t("settings.encipheredBackup")}
        </h3>
        <p className="mb-5 text-xs leading-relaxed text-zinc-500">{t("settings.backupIntro")}</p>
        <div className="rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-4">
          <p className="font-mono text-[11px] break-all text-zinc-400">
            {revealBackup && store.backupHex
              ? store.backupHex
              : store.backupHex
                ? `${truncMiddle(store.backupHex, 24, 8)}`
                : "—"}
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <Button variant="outline" size="sm" onClick={() => setRevealBackup((s) => !s)}>
            {revealBackup ? <EyeOff size={14} /> : <Eye size={14} />}
            {revealBackup ? t("common.hide") : t("common.reveal")}
          </Button>
          {store.backupHex && (
            <>
              <Button variant="outline" size="sm" onClick={() => downloadText("tari-l1-backup.hex.txt", store.backupHex!)}>
                <Download size={14} /> {t("settings.downloadTxt")}
              </Button>
              <span className="self-center">
                <Badge tone="amber">{t("settings.keepPrivate")}</Badge>
              </span>
            </>
          )}
        </div>
      </Card>

      <Card className="h-fit p-6 sm:p-7">
        <h3 className="mb-1.5 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600">
            <Languages size={15} />
          </span>
          {t("settings.language")}
        </h3>
        <p className="mb-4 text-xs leading-relaxed text-zinc-500">{t("settings.languageIntro")}</p>
        <LanguageSwitch className="w-full" />
      </Card>
      </div>

      <Card className="h-fit p-6 sm:p-7">
        <h3 className="mb-1.5 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-cyan-600 to-blue-600">
            <Lock size={15} />
          </span>
          {t("settings.lock")}
        </h3>
        <p className="mb-5 text-xs leading-relaxed text-zinc-500">
          {store.hasPin ? t("settings.lockIntroPin") : t("settings.lockIntroNoPin")}
        </p>
        <div className={`grid gap-3 ${store.hasPin ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {store.hasPin && (
            <Field label={t("settings.currentPin")}>
              <TextInput
                type="password"
                inputMode="numeric"
                value={oldPin}
                onChange={(e) => setOldPin(e.target.value)}
              />
            </Field>
          )}
          <Field label={store.hasPin ? t("settings.newPin") : t("settings.choosePin")}>
            <TextInput
              type="password"
              inputMode="numeric"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
            />
          </Field>
          <Field label={t("settings.confirm")}>
            <TextInput
              type="password"
              inputMode="numeric"
              value={newPinConfirm}
              onChange={(e) => setNewPinConfirm(e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Button variant="outline" onClick={() => void submitPin()} disabled={pinBusy || !newPin}>
            {pinBusy && <Loader2 size={14} className="animate-spin" />}
            <KeyRound size={14} /> {store.hasPin ? t("settings.changePin") : t("settings.setPin")}
          </Button>
        </div>
        {pinError && <p className="mt-3 text-xs text-[var(--st-red)]">{pinError}</p>}

        <div className="mt-5 border-t border-[var(--tari-border)] pt-4">
          <Field label={t("settings.autoLock")}>
            <Segmented
              value={String(store.autoLockMinutes)}
              onChange={(v) => store.setAutoLockMinutes(Number(v))}
              options={AUTO_LOCK_OPTIONS.map((o) => ({ value: String(o.value), label: t(o.label) }))}
              fill
            />
          </Field>
        </div>

        <div className="mt-5 border-t border-[var(--tari-border)] pt-4">
          <Field label={t("settings.feePrivacy")}>
            <Switch
              checked={store.feePrivacyDefault === "private"}
              onChange={(v) => store.setFeePrivacyDefault(v ? "private" : "transparent")}
              offLabel={t("settings.transparent")}
              onLabel={t("settings.private")}
            />
          </Field>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{t("settings.feePrivacyNote")}</p>
        </div>

        <div className="mt-5 flex items-center gap-2.5 border-t border-[var(--tari-border)] pt-4">
          <Button variant="outline" size="sm" disabled={!store.hasPin} onClick={() => store.lock()}>
            <Clock size={14} /> {t("settings.lockNow")}
          </Button>
          {!store.hasPin && (
            <span className="text-[11px] text-zinc-600">{t("settings.setPinAbove")}</span>
          )}
        </div>
      </Card>


      <Card className="p-6 sm:p-7 lg:col-span-2">
        <h3 className="mb-4 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-cyan-600 to-blue-600">
            <Globe size={15} />
          </span>
          {t("settings.network")}
        </h3>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-zinc-500">
            {t("settings.l1Network")} <b className="text-zinc-400">{networkLabel(store.network)}</b>. {t("settings.networkNote")}
          </p>
          <NetworkSwitch />
        </div>
        {store.network && nodesForNetwork(store.network).length > 0 && (
          <div className="mt-4 border-t border-[var(--tari-border)] pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[var(--tari-text)]">{t("settings.node")}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-600">{t("settings.nodeIntro")}</p>
              </div>
              <select
                value={store.selectedNode}
                onChange={(e) => store.setSelectedNode(e.target.value)}
                aria-label={t("settings.queryNode")}
                className="shrink-0 rounded-lg border border-[var(--tari-border)] bg-[var(--tari-bg-input)] px-3 py-1.5 text-[13px] text-[var(--tari-text)] outline-none focus:border-zinc-500"
              >
                <option value={AUTO_NODE_ID}>{t("settings.autoFastest")}</option>
                {nodesForNetwork(store.network).map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2.5 flex items-center gap-2 text-[11px]">
              <NodeStatusDot status={store.nodeStatus} />
              <span className="min-w-0 text-zinc-500">
                {store.nodeStatus === "checking"
                  ? t("settings.checkingNodes")
                  : store.nodeStatus === "offline"
                    ? t("settings.noNodeResponded")
                    : (() => {
                        const node = store.activeNodeId ? nodeById(store.network!, store.activeNodeId) : null;
                        const name = node ? node.label : t("settings.nodeFallback");
                        const auto = store.selectedNode === AUTO_NODE_ID ? t("settings.autoArrow") : "";
                        const ms = store.activeNodeLatencyMs != null ? ` · ${store.activeNodeLatencyMs} ms` : "";
                        return t("settings.connectedTo", { name: `${auto}${name}${ms}` });
                      })()}
              </span>
              <button
                type="button"
                onClick={() => store.refreshNodeStatus()}
                className="ml-auto shrink-0 rounded-md px-2 py-0.5 text-[11px] whitespace-nowrap text-zinc-500 underline decoration-dotted hover:text-[var(--tari-text)]"
              >
                {t("settings.retest")}
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card className="h-fit p-6 sm:p-7 lg:col-span-2">
        <h3 className="mb-1.5 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#06C983] to-[#168552]">
            <Radar size={15} />
          </span>
          {t("settings.chainScan")}
        </h3>
        <p className="mb-5 text-xs leading-relaxed text-zinc-500">
          {t("settings.chainScanIntro", {
            network: networkLabel(store.network),
            host: (getRpcBase() ?? "").replace(/^https?:\/\//, ""),
          })}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <Field label={t("settings.fromBlock")}>
            <TextInput
              value={scanFrom}
              onChange={(e) => setScanFrom(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              mono
            />
          </Field>
          <Field label={t("settings.toBlock")}>
            <TextInput
              value={scanTo}
              onChange={(e) => setScanTo(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              mono
            />
          </Field>
        </div>
        {(tip || store.birthdayHeight) && (
          <p className="mt-2 mb-4 text-[11px] leading-relaxed text-zinc-500">
            {tip ? t("settings.chainTip", { height: tip.toLocaleString() }) : ""}
            {tip && store.birthdayHeight ? " " : ""}
            {store.birthdayHeight ? t("settings.birthdayFloor", { height: store.birthdayHeight.toLocaleString() }) : ""}
          </p>
        )}

        <Field
          label={t("settings.threads", { cores: detectedCores() })}
          hint={
            store.scanThreads >= maxWorkers()
              ? t("settings.threadsMax", { n: maxWorkers() })
              : store.scanThreads >= Math.ceil(maxWorkers() / 2)
                ? t("settings.threadsBalanced")
                : t("settings.threadsGentle")
          }
        >
          <Segmented
            value={String(store.scanThreads)}
            onChange={(v) => store.setScanThreads(Number(v))}
            // Only counts this machine can actually run at once. Offering more than there are
            // cores just oversubscribes the CPU: the scan gets slower, not faster.
            options={threadOptions().map((n) => ({
              value: String(n),
              label: n === maxWorkers() ? t("common.max") : String(n),
            }))}
            fill
          />
        </Field>

        {store.scan && (
          <div className="mt-4 rounded-2xl border border-white/[0.08] bg-black/25 p-4 text-xs text-zinc-400">
            <div className="flex items-center justify-between">
              <span>
                {store.scan.done
                  ? store.scan.error
                    ? t("settings.stoppedError")
                    : t("settings.scanComplete")
                  : t("settings.scanningLower")}
              </span>
              <span className="tabular font-mono">
                {store.scan.current.toLocaleString()} / {store.scan.to.toLocaleString()}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#06C983] to-[#168552] transition-all"
                style={{
                  width: `${Math.min(100, ((store.scan.current - Number(scanFrom || "1")) / Math.max(1, Number(scanTo || "1") - Number(scanFrom || "1"))) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-2">
              {t("settings.scanStats", {
                blocks: store.scan.blocksScanned.toLocaleString(),
                outputs: store.scan.outputsSeen.toLocaleString(),
              })}{" "}
              <b className="text-[var(--st-green)]">{t("settings.owned", { n: store.scan.found })}</b>
              {store.scan.skipped > 0 && (
                <span className="text-[var(--st-amber)]">{t("settings.unavailable", { n: store.scan.skipped })}</span>
              )}
              {store.scan.importFailures > 0 && (
                <span className="text-[var(--st-amber)]"> {t("settings.importFailures", { n: store.scan.importFailures })}</span>
              )}
            </p>
            {store.scan.failureSamples.length > 0 && (
              <p className="mt-1 font-mono text-[10px] text-zinc-600">
                {store.scan.failureSamples.join(" | ")}
              </p>
            )}
            {store.scan.skippedHeights.length > 0 && (
              <p className="mt-1 text-[10px] text-zinc-600">
                {t("settings.skippedHeights")} {store.scan.skippedHeights.slice(0, 8).join(", ")}
                {store.scan.skippedHeights.length > 8 ? "…" : ""}
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2.5">
          {!store.scan || store.scan.done ? (
            <>
              <Button
                disabled={!scanFrom || !scanTo}
                onClick={() =>
                  store.startScan(Math.max(Number(scanFrom), store.birthdayHeight ?? 1), Number(scanTo))
                }
              >
                <Radar size={15} /> {t("settings.startScan")}
              </Button>
              <Button
                variant="outline"
                title={t("settings.rescanTitle")}
                onClick={() => store.rescanFromBirthday()}
              >
                {t("settings.rescanBirthday")}
              </Button>
            </>
          ) : (
            <Button variant="danger" onClick={store.stopScan}>
              {t("settings.stopScan")}
            </Button>
          )}
        </div>
      </Card>

      {/* Connected dApps.
          Grants live in localStorage and outlive the frame that asked for them, so a user who
          closed a dApp has no other way to take one back — without this, revoking would mean
          reopening the site that holds the permission you are trying to remove. */}
      <Card className="p-6 sm:p-7 lg:col-span-2">
        <h3 className="mb-1.5 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600">
            <Globe size={15} />
          </span>
          {t("settings.connectedDapps")}
        </h3>
        <p className="mb-5 text-xs leading-relaxed text-zinc-500">
          {t("settings.dappsIntroBefore")} <b className="text-[var(--st-amber)]">{t("settings.seesPrivate")}</b>{" "}
          {t("settings.dappsIntroAfter")}
        </p>
        {sites.length === 0 ? (
          <p className="text-xs text-zinc-600">{t("settings.noDapps")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sites.map((site) => (
              <div
                key={site.origin}
                className="flex flex-wrap items-center gap-2 rounded-xl border p-3"
                style={{ borderColor: "var(--tari-border)" }}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--tari-text)]">
                  {site.origin}
                </span>
                {site.viewAccess && (
                  <Badge tone="amber">
                    <Eye size={11} /> {t("settings.seesPrivate")}
                  </Badge>
                )}
                {site.viewAccess && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      revokeViewAccess(site.origin);
                      setSites(connectedSites());
                      toast({ tone: "info", title: t("settings.viewRevoked"), message: site.origin });
                    }}
                  >
                    {t("settings.revokeView")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    revokeConnection(site.origin);
                    // Approved-but-unsubmitted requests go with the connection: otherwise a site
                    // could be disconnected and still submit something approved beforehand.
                    forgetOrigin(site.origin);
                    setSites(connectedSites());
                    toast({ tone: "info", title: t("settings.disconnected"), message: site.origin });
                  }}
                >
                  {t("settings.disconnect")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6 sm:p-7 lg:col-span-2">
        <h3 className="mb-1.5 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-red-600 to-orange-600">
            <Trash2 size={15} />
          </span>
          {t("settings.dangerZone")}
        </h3>
        <p className="mb-5 text-xs leading-relaxed text-zinc-500">{t("settings.dangerIntro")}</p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => {
              store.clearHistory();
              toast({ tone: "info", title: t("settings.historyCleared") });
            }}
          >
            <History size={15} /> {t("settings.clearHistory")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm(t("settings.eraseConfirm"))) {
                store.forget();
              }
            }}
          >
            <Trash2 size={15} /> {t("settings.eraseWallet")}
          </Button>
        </div>
      </Card>

      {/* CPAL-1.0 Exhibit B attribution: deployments of this code keep this notice visible. */}
      <p className="text-center text-[11px] text-zinc-500 lg:col-span-2">
        Built on the Tari L1 Web Wallet by chironbuilds · Copyright (c) 2026 chironbuilds ·{" "}
        <a
          href="https://github.com/chironbuilds/tari-l1-wallet-ui"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-dotted hover:text-[var(--tari-text)]"
        >
          Source (CPAL-1.0)
        </a>
      </p>
    </div>
  );
}
