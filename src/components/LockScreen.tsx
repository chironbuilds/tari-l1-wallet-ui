import { useState } from "react";
import { KeyRound, TriangleAlert } from "lucide-react";
import { useStore } from "../store";
import { truncMiddle } from "../lib/format";
import { Button, Card, Field, Logo, TextInput } from "./ui";
import { NetworkSwitch } from "./NetworkSwitch";
import { useI18n } from "../i18n";
import { LanguageSwitch } from "./LanguageSwitch";

export function LockScreen() {
  const { unlock, forget, lockedAddressHint } = useStore();
  const { t } = useI18n();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!pin) return;
    setBusy(true);
    setError(null);
    const ok = await unlock(pin);
    setBusy(false);
    if (!ok) {
      setError(t("lock.incorrect"));
      setPin("");
    }
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
            {t("lock.title")}
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
            {lockedAddressHint
              ? t("lock.unlockAddress", { address: truncMiddle(lockedAddressHint, 8, 8) })
              : t("lock.unlockThis")}
          </p>
          <NetworkSwitch className="mt-3" />
        </div>

        <Field label={t("lock.pin")}>
          <TextInput
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="••••"
            error={!!error}
          />
        </Field>

        {error && (
          <div className="animate-pop mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-sm text-[var(--st-red)]">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        <Button size="lg" className="mt-6 w-full" loading={busy} disabled={!pin} onClick={go}>
          <KeyRound size={16} /> {t("lock.unlock")}
        </Button>

        <button
          className="mt-5 block w-full text-center text-[11px] text-zinc-600 underline decoration-dotted hover:text-zinc-400"
          onClick={() => {
            if (
              confirm(t("lock.forgotConfirm"))
            ) {
              forget();
            }
          }}
        >
          {t("lock.forgot")}
        </button>
      </Card>
    </div>
  );
}
