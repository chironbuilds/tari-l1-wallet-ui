import { useState } from "react";
import { KeyRound, Lock, Plus, ShieldCheck, TriangleAlert } from "lucide-react";
import { useStore } from "../store";
import { isPlausibleSeedPhrase, seedPhraseToWallet } from "../lib/cipherseed";
import { MIN_PIN_LENGTH } from "../lib/pinLock";
import { Button, Card, Field, Logo, Segmented, TextInput } from "./ui";
import { useToast } from "./toast";
import type { NetworkId } from "../lib/tari";
import { useI18n } from "../i18n";
import { LanguageSwitch } from "./LanguageSwitch";

type ImportMode = "create" | "seed" | "backup";

export function Welcome() {
  const { createWallet, restoreWallet, setWalletBirthday } = useStore();
  const toast = useToast();
  const { t } = useI18n();
  const [mode, setMode] = useState<ImportMode>("create");
  const [network, setNetwork] = useState<NetworkId>("mainnet");
  const [backup, setBackup] = useState("");
  const [seedInput, setSeedInput] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seedPlausible = seedInput.trim().length > 0 && isPlausibleSeedPhrase(seedInput);

  const go = async () => {
    setBusy(true);
    setError(null);
    if (pin.length < MIN_PIN_LENGTH) {
      setError(t("welcome.errPinShort", { min: MIN_PIN_LENGTH }));
      setBusy(false);
      return;
    }
    if (pin !== pinConfirm) {
      setError(t("welcome.errPinMismatch"));
      setBusy(false);
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
    try {
      if (mode === "create") {
        await createWallet(network, pin);
        toast({
          tone: "success",
          title: t("welcome.createdTitle"),
          message: t("welcome.createdMessage"),
        });
      } else if (mode === "seed") {
        if (!seedInput.trim()) {
          setError(t("welcome.errSeedEmpty"));
          setBusy(false);
          return;
        }
        const { backupHex, birthdayMs } = await seedPhraseToWallet(seedInput);
        const err = await restoreWallet(backupHex, network, pin);
        if (err) {
          setError(err);
          setBusy(false);
          return;
        }
        setWalletBirthday(birthdayMs);
        toast({
          tone: "success",
          title: t("welcome.restoredTitle"),
          message: t("welcome.restoredScanning"),
        });
      } else {
        if (!backup.trim()) {
          setError(t("welcome.errBackupEmpty"));
          setBusy(false);
          return;
        }
        const err = await restoreWallet(backup, network, pin);
        if (err) {
          setError(err);
          setBusy(false);
          return;
        }
        toast({ tone: "success", title: t("welcome.restoredTitle") });
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("welcome.errSeedImport"),
      );
    }
    setBusy(false);
  };

  return (
    <div
      className="relative z-10 flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10"
      style={{ background: "var(--tari-bg)" }}
    >
      <LanguageSwitch compact className="absolute top-4 right-4" />
      <div className="logo-pulse mb-8">
        <Logo size={72} />
      </div>

      <Card className="animate-fade-up w-full max-w-md p-7 sm:p-8">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--tari-text)]">
            {t("welcome.title")}
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{t("welcome.subtitle")}</p>
        </div>

        <Segmented
          value={mode}
          onChange={setMode}
          className="mb-6 flex w-full"
          options={[
            {
              value: "create",
              label: (
                <span className="flex items-center justify-center gap-1.5">
                  <Plus size={13} /> {t("welcome.modeCreate")}
                </span>
              ),
            },
            {
              value: "seed",
              label: (
                <span className="flex items-center justify-center gap-1.5">
                  <ShieldCheck size={13} /> {t("welcome.modeSeed")}
                </span>
              ),
            },
            {
              value: "backup",
              label: (
                <span className="flex items-center justify-center gap-1.5">
                  <KeyRound size={13} /> {t("welcome.modeBackup")}
                </span>
              ),
            },
          ]}
        />

        {mode === "seed" && (
          <div className="animate-fade-up mb-5">
            <Field
              label={t("welcome.seedLabel")}
              hint={
                seedInput.trim()
                  ? seedPlausible
                    ? t("welcome.seedValid")
                    : t("welcome.seedInvalid")
                  : t("welcome.seedHint")
              }
            >
              <textarea
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder={t("welcome.seedPlaceholder")}
                className="w-full rounded-xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-3.5 text-sm text-[var(--tari-text)] placeholder-[var(--tari-text-dim)] focus:border-[#9330ff]/60 focus:ring-2 focus:ring-[#9330ff]/30 focus:outline-none"
              />
            </Field>
          </div>
        )}

        {mode === "backup" && (
          <div className="animate-fade-up mb-5">
            <Field label={t("welcome.backupLabel")}>
              <textarea
                value={backup}
                onChange={(e) => setBackup(e.target.value)}
                rows={4}
                spellCheck={false}
                placeholder={t("welcome.backupPlaceholder")}
                className="w-full rounded-xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-3.5 font-mono text-[12px] break-all text-[var(--tari-text)] placeholder-[var(--tari-text-dim)] focus:border-[#9330ff]/60 focus:ring-2 focus:ring-[#9330ff]/30 focus:outline-none"
              />
            </Field>
          </div>
        )}

        <Field
          label={t("welcome.network")}
          hint={network === "mainnet" ? t("welcome.networkMainnetHint") : t("welcome.networkTestnetHint")}
        >
          <Segmented
            value={network}
            onChange={(v) => setNetwork(v as NetworkId)}
            className="flex w-full"
            options={[
              { value: "mainnet", label: t("common.mainnet") },
              { value: "esmeralda", label: t("common.esmeraldaTestnet") },
            ]}
          />
        </Field>

        <div className="animate-fade-up mt-5 grid grid-cols-2 gap-3">
          <Field label={t("welcome.choosePin")} hint={t("welcome.pinHint", { min: MIN_PIN_LENGTH })}>
            <TextInput
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
            />
          </Field>
          <Field label={t("welcome.confirmPin")}>
            <TextInput
              type="password"
              inputMode="numeric"
              value={pinConfirm}
              onChange={(e) => setPinConfirm(e.target.value)}
              placeholder="••••"
            />
          </Field>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-600">
          <Lock size={12} className="mt-0.5 shrink-0" />
          {t("welcome.pinNote")}
        </p>

        {error && (
          <div className="animate-pop mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-sm text-[var(--st-red)]">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

          <Button size="lg" className="mt-6 w-full" loading={busy} onClick={go}>
            {busy
              ? t("welcome.deriving")
              : mode === "create"
                ? t("welcome.create")
                : mode === "seed"
                  ? t("welcome.restoreSeed")
                  : t("welcome.restoreBackup")}
          </Button>

      </Card>
    </div>
  );
}
