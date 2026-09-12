import { useState } from "react";
import { KeyRound, Lock, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { useStore } from "../store";
import { isPlausibleSeedPhrase, seedPhraseToWallet } from "../lib/cipherseed";
import { MIN_PIN_LENGTH } from "../lib/pinLock";
import { Button, Card, Field, Logo, Segmented, TextInput } from "./ui";
import { useToast } from "./toast";

type ImportMode = "create" | "seed" | "backup";

export function Welcome() {
  const { createWallet, restoreWallet, setWalletBirthday } = useStore();
  const toast = useToast();
  const [mode, setMode] = useState<ImportMode>("create");
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
      setError(`Choose a PIN of at least ${MIN_PIN_LENGTH} characters — it locks and unlocks this wallet.`);
      setBusy(false);
      return;
    }
    if (pin !== pinConfirm) {
      setError("PINs don't match.");
      setBusy(false);
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
    try {
      if (mode === "create") {
        await createWallet("mainnet", pin);
        toast({
          tone: "success",
          title: "Wallet created",
          message: "Reveal your 24-word phrase in Settings → Recovery phrase.",
        });
      } else if (mode === "seed") {
        if (!seedInput.trim()) {
          setError("Enter your 24-word recovery phrase.");
          setBusy(false);
          return;
        }
        const { backupHex, birthdayMs } = await seedPhraseToWallet(seedInput);
        const err = await restoreWallet(backupHex, "mainnet", pin);
        if (err) {
          setError(err);
          setBusy(false);
          return;
        }
        setWalletBirthday(birthdayMs);
        toast({
          tone: "success",
          title: "Wallet restored — scanning for your funds",
          message: `Auto-scanning mainnet from your wallet's birthday (your wallet's birthday). Track progress in Settings → Live chain scan.`,
        });
      } else {
        if (!backup.trim()) {
          setError("Paste your enciphered backup hex first.");
          setBusy(false);
          return;
        }
        const err = await restoreWallet(backup, "mainnet", pin);
        if (err) {
          setError(err);
          setBusy(false);
          return;
        }
        toast({ tone: "success", title: "Wallet restored" });
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not import this recovery phrase — check the words and try again.",
      );
    }
    setBusy(false);
  };

  return (
    <div
      className="relative z-10 flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10"
      style={{ background: "var(--tari-bg)" }}
    >
      <div className="logo-pulse mb-8">
        <Logo size={72} />
      </div>

      <Card className="animate-fade-up w-full max-w-md p-7 sm:p-8">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--tari-text)]">
            Tari L1 Wallet
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
            Self-custodial Minotari · keys & Bulletproofs+ forged in your browser via WASM.
          </p>
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
                  <Sparkles size={13} /> Create
                </span>
              ),
            },
            {
              value: "seed",
              label: (
                <span className="flex items-center justify-center gap-1.5">
                  <ShieldCheck size={13} /> Seed phrase
                </span>
              ),
            },
            {
              value: "backup",
              label: (
                <span className="flex items-center justify-center gap-1.5">
                  <KeyRound size={13} /> Backup hex
                </span>
              ),
            },
          ]}
        />

        {mode === "seed" && (
          <div className="animate-fade-up mb-5">
            <Field
              label="24-word recovery phrase"
              hint={
                seedInput.trim()
                  ? seedPlausible
                    ? "Looks like a valid Tari phrase ✓ — enter your passphrase if you used one"
                    : "Not a valid 24-word Tari recovery phrase (yet)"
                  : "Words separated by spaces · any of Tari's 7 languages"
              }
            >
              <textarea
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder="word one word two …"
                className="w-full rounded-xl border border-black/10 bg-black/[0.03] p-3.5 text-sm text-[var(--tari-text)] placeholder-zinc-400 focus:border-[#9330ff]/60 focus:ring-2 focus:ring-[#9330ff]/30 focus:outline-none dark:border-white/10 dark:bg-black/40 dark:text-zinc-100 dark:placeholder-zinc-600"
              />
            </Field>
          </div>
        )}

        {mode === "backup" && (
          <div className="animate-fade-up mb-5">
            <Field label="Enciphered backup hex">
              <textarea
                value={backup}
                onChange={(e) => setBackup(e.target.value)}
                rows={4}
                spellCheck={false}
                placeholder="Paste the hex blob exported from this wallet…"
                className="w-full rounded-xl border border-white/10 bg-black/40 p-3.5 font-mono text-[12px] break-all text-zinc-100 placeholder-zinc-600 focus:border-[#9330ff]/60 focus:ring-2 focus:ring-[#9330ff]/30 focus:outline-none"
              />
            </Field>
          </div>
        )}

        <Field label="Network">
          <div className="rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
            <span className="block text-xs font-semibold text-[var(--tari-text)]">MainNet</span>
            <span className="text-[10px] text-[#7CD9A7]">layer 1 · minotari</span>
          </div>
        </Field>

        <div className="animate-fade-up mt-5 grid grid-cols-2 gap-3">
          <Field label="Choose a PIN" hint={`At least ${MIN_PIN_LENGTH} characters`}>
            <TextInput
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
            />
          </Field>
          <Field label="Confirm PIN">
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
          Encrypts your seed on this device and lets you lock the wallet without erasing it.
          There's no reset — losing both your PIN and your recovery phrase loses the funds.
        </p>

        {error && (
          <div className="animate-pop mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-sm text-red-300">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

          <Button size="lg" className="mt-6 w-full" loading={busy} onClick={go}>
            {busy
              ? "Deriving keys…"
              : mode === "create"
                ? "Create new wallet"
                : mode === "seed"
                  ? "Restore from seed phrase"
                  : "Restore from backup hex"}
          </Button>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-zinc-600">
          No mining · no airdrops · no bridges — just pure L1 payments.
        </p>
      </Card>
    </div>
  );
}
