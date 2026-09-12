import { useEffect, useState } from "react";
import {
  Clock,
  Download,
  Eye,
  EyeOff,
  Globe,
  History,
  KeyRound,
  Loader2,
  Lock,
  Package,
  Radar,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useStore } from "../store";
import { downloadText, truncMiddle } from "../lib/format";
import { exportSeedPhrase } from "../lib/cipherseed";
import { fetchChainTip } from "../lib/explorer";
import { MIN_PIN_LENGTH } from "../lib/pinLock";
import { useToast } from "./toast";
import { Badge, Button, Card, CopyButton, Field, Segmented, TextInput } from "./ui";
import { connectedSites, revokeConnection, revokeViewAccess } from "../lib/dappBridge";
import { forgetOrigin } from "../lib/dappRequests";
import { detectedCores, maxWorkers, threadOptions } from "../lib/threads";

const AUTO_LOCK_OPTIONS = [
  { value: 1, label: "1 min" },
  { value: 5, label: "5 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 0, label: "Never" },
];

export function SettingsPanel() {
  const store = useStore();
  const toast = useToast();
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
    void fetchChainTip().then((t) => {
      if (!t) return;
      setTip(t.height);
      setScanFrom(String(Math.max(1, t.height - 499)));
      setScanTo(String(t.height));
    });
  }, []);

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
        title: "Could not decipher seed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
    setWordsBusy(false);
  }

  async function submitPin() {
    setPinError(null);
    if (newPin.length < MIN_PIN_LENGTH) {
      setPinError(`PIN must be at least ${MIN_PIN_LENGTH} characters.`);
      return;
    }
    if (newPin !== newPinConfirm) {
      setPinError("New PINs don't match.");
      return;
    }
    setPinBusy(true);
    try {
      if (store.hasPin) {
        const ok = await store.changePin(oldPin, newPin);
        if (!ok) {
          setPinError("Current PIN is incorrect.");
          setPinBusy(false);
          return;
        }
        toast({ tone: "success", title: "PIN changed" });
      } else {
        await store.setPin(newPin);
        toast({ tone: "success", title: "PIN set", message: "You can now lock this wallet." });
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
      <Card className="h-fit p-6 sm:p-7">
        <h3 className="mb-1.5 flex items-center gap-2.5 text-lg font-bold text-white">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#06C983] to-[#168552]">
            <ShieldCheck size={15} />
          </span>
          Recovery phrase
        </h3>
        <p className="mb-5 text-xs leading-relaxed text-zinc-500">
          Your wallet's 24-word seed (Tari CipherSeed format — compatible with the official
          Tari wallet). Write it down; it restores your funds anywhere.
        </p>
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
            {revealWords ? "Hide phrase" : "Reveal 24 words"}
          </Button>
          {revealWords && words && (
            <CopyButton text={words.join(" ")} label="Copy phrase" />
          )}
        </div>
      </Card>

      <Card className="h-fit p-6 sm:p-7">
        <h3 className="mb-1.5 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-cyan-600 to-blue-600">
            <Lock size={15} />
          </span>
          Lock
        </h3>
        <p className="mb-5 text-xs leading-relaxed text-zinc-500">
          {store.hasPin
            ? "Your seed is encrypted on this device with your PIN. Locking hides the wallet and clears the decrypted seed from memory without erasing anything — unlock with the same PIN."
            : "Set a PIN to encrypt your seed on this device and enable locking. Without a PIN, this wallet can only be erased, not locked."}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          {store.hasPin && (
            <Field label="Current PIN">
              <TextInput
                type="password"
                inputMode="numeric"
                value={oldPin}
                onChange={(e) => setOldPin(e.target.value)}
              />
            </Field>
          )}
          <Field label={store.hasPin ? "New PIN" : "Choose a PIN"}>
            <TextInput
              type="password"
              inputMode="numeric"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
            />
          </Field>
          <Field label="Confirm">
            <TextInput
              type="password"
              inputMode="numeric"
              value={newPinConfirm}
              onChange={(e) => setNewPinConfirm(e.target.value)}
            />
          </Field>
          <Button variant="outline" onClick={() => void submitPin()} disabled={pinBusy || !newPin}>
            {pinBusy && <Loader2 size={14} className="animate-spin" />}
            <KeyRound size={14} /> {store.hasPin ? "Change PIN" : "Set PIN"}
          </Button>
        </div>
        {pinError && <p className="mt-3 text-xs text-[var(--st-red)]">{pinError}</p>}

        <div className="mt-5 border-t border-[var(--tari-border)] pt-4">
          <Field label="Auto-lock after inactivity">
            <Segmented
              value={String(store.autoLockMinutes)}
              onChange={(v) => store.setAutoLockMinutes(Number(v))}
              options={AUTO_LOCK_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
            />
          </Field>
        </div>

        <div className="mt-5 flex items-center gap-2.5 border-t border-[var(--tari-border)] pt-4">
          <Button variant="outline" size="sm" disabled={!store.hasPin} onClick={() => store.lock()}>
            <Clock size={14} /> Lock now
          </Button>
          {!store.hasPin && (
            <span className="text-[11px] text-zinc-600">Set a PIN above to enable this.</span>
          )}
        </div>
      </Card>

      <Card className="h-fit p-6 sm:p-7">
        <h3 className="mb-1.5 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600">
            <Package size={15} />
          </span>
          Enciphered backup
        </h3>
        <p className="mb-5 text-xs leading-relaxed text-zinc-500">
          Your CipherSeed encrypted with a built-in nonce — restore it on any device.
          Anyone holding this blob can spend your funds.
        </p>
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
            {revealBackup ? "Hide" : "Reveal"}
          </Button>
          {store.backupHex && (
            <>
              <Button variant="outline" size="sm" onClick={() => downloadText("tari-l1-backup.hex.txt", store.backupHex!)}>
                <Download size={14} /> Download .txt
              </Button>
              <span className="self-center">
                <Badge tone="amber">handle with care</Badge>
              </span>
            </>
          )}
        </div>
      </Card>

      <Card className="h-fit p-6 sm:p-7 lg:col-span-2">
        <h3 className="mb-1.5 flex items-center gap-2.5 text-lg font-bold text-white">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#06C983] to-[#168552]">
            <Radar size={15} />
          </span>
          Live chain scan
        </h3>
        <p className="mb-5 text-xs leading-relaxed text-zinc-500">
          Scans blocks for outputs owned by this wallet, reading them straight from a base node's
          query service at <code className="text-zinc-400">rpc.tari.com</code>. Found outputs are
          added automatically.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <Field label={`Scan from${tip ? ` — tip ${tip.toLocaleString()}` : ""}`}>
            <TextInput
              value={scanFrom}
              onChange={(e) => setScanFrom(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              mono
            />
          </Field>
          <Field label="Scan to">
            <TextInput
              value={scanTo}
              onChange={(e) => setScanTo(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              mono
            />
          </Field>
        </div>

        <Field
          label={`Threads — scan speed (${detectedCores()} cores detected)`}
          hint={
            store.scanThreads >= maxWorkers()
              ? `All ${maxWorkers()} available — fastest, leaves one core for the interface`
              : store.scanThreads >= Math.ceil(maxWorkers() / 2)
                ? "Balanced — quick without taking the whole machine"
                : "Gentle — slowest, leaves the machine free"
          }
        >
          <Segmented
            value={String(store.scanThreads)}
            onChange={(v) => store.setScanThreads(Number(v))}
            // Only counts this machine can actually run at once. Offering more than there are
            // cores just oversubscribes the CPU: the scan gets slower, not faster.
            options={threadOptions().map((n) => ({
              value: String(n),
              label: n === maxWorkers() ? `${n} · max` : String(n),
            }))}
          />
        </Field>

        {store.scan && (
          <div className="mt-4 rounded-2xl border border-white/[0.08] bg-black/25 p-4 text-xs text-zinc-400">
            <div className="flex items-center justify-between">
              <span>
                {store.scan.done
                  ? store.scan.error
                    ? "stopped — error"
                    : "scan complete"
                  : "scanning…"}
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
              blocks {store.scan.blocksScanned.toLocaleString()} · outputs seen{" "}
              {store.scan.outputsSeen.toLocaleString()} ·{" "}
              <b className="text-[var(--st-green)]">{store.scan.found} owned ✓</b>
              {store.scan.skipped > 0 && (
                <span className="text-[var(--st-amber)]"> · {store.scan.skipped} unavailable</span>
              )}
              {store.scan.importFailures > 0 && (
                <span className="text-[var(--st-amber)]">
                  {" "}· {store.scan.importFailures} import failures
                </span>
              )}
            </p>
            {store.scan.failureSamples.length > 0 && (
              <p className="mt-1 font-mono text-[10px] text-zinc-600">
                {store.scan.failureSamples.join(" | ")}
              </p>
            )}
            {store.scan.skippedHeights.length > 0 && (
              <p className="mt-1 text-[10px] text-zinc-600">
                skipped heights: {store.scan.skippedHeights.slice(0, 8).join(", ")}
                {store.scan.skippedHeights.length > 8 ? "…" : ""}
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex gap-2.5">
          {!store.scan || store.scan.done ? (
            <Button
              disabled={!scanFrom || !scanTo}
              onClick={() => store.startScan(Number(scanFrom), Number(scanTo))}
            >
              <Radar size={15} /> Start scan
            </Button>
          ) : (
            <Button variant="danger" onClick={store.stopScan}>
              Stop scan
            </Button>
          )}
        </div>
      </Card>

      {/* Connected dApps.
          Grants live in localStorage and outlive the frame that asked for them, so a user who
          closed a dApp has no other way to take one back — without this, revoking would mean
          reopening the site that holds the permission you are trying to remove. */}
      <Card className="p-6 sm:p-7 lg:col-span-2">
        <h3 className="mb-1.5 flex items-center gap-2.5 text-lg font-bold text-white">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600">
            <Globe size={15} />
          </span>
          Connected dApps
        </h3>
        <p className="mb-5 text-xs leading-relaxed text-zinc-500">
          Sites allowed to see your address and ask you to approve transactions. A site marked{" "}
          <b className="text-[var(--st-amber)]">sees private balance</b> can also read what you hold
          in shielded outputs — it still cannot spend anything without your approval.
        </p>
        {sites.length === 0 ? (
          <p className="text-xs text-zinc-600">No dApps connected.</p>
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
                    <Eye size={11} /> sees private balance
                  </Badge>
                )}
                {site.viewAccess && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      revokeViewAccess(site.origin);
                      setSites(connectedSites());
                      toast({ tone: "info", title: "Private view access revoked", message: site.origin });
                    }}
                  >
                    Revoke view
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
                    toast({ tone: "info", title: "Disconnected", message: site.origin });
                  }}
                >
                  Disconnect
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6 sm:p-7 lg:col-span-2">
        <h3 className="mb-1.5 flex items-center gap-2.5 text-lg font-bold text-white">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-red-600 to-orange-600">
            <Trash2 size={15} />
          </span>
          Danger zone
        </h3>
        <p className="mb-5 text-xs leading-relaxed text-zinc-500">
          Destructive actions for this browser session. Download your backup first —
          erased means erased.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => {
              store.clearHistory();
              toast({ tone: "info", title: "Activity history cleared" });
            }}
          >
            <History size={15} /> Clear activity history
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm("Erase wallet + backup from this browser? This cannot be undone.")) {
                store.forget();
              }
            }}
          >
            <Trash2 size={15} /> Erase wallet completely
          </Button>
        </div>
        <p className="mt-5 border-t border-[var(--tari-border)] pt-4 text-[11px] text-zinc-600">
          Network <b className="text-zinc-400">{store.network}</b> is fixed for this wallet's keys — create a new one to switch networks.
        </p>
      </Card>
    </div>
  );
}
