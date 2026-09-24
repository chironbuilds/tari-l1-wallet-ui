import { useState } from "react";
import { KeyRound, TriangleAlert } from "lucide-react";
import { useStore } from "../store";
import { truncMiddle } from "../lib/format";
import { Button, Card, Field, Logo, TextInput } from "./ui";

export function LockScreen() {
  const { unlock, forget, lockedAddressHint } = useStore();
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
      setError("Incorrect PIN.");
      setPin("");
    }
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
            Wallet locked
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
            {lockedAddressHint
              ? `Enter your PIN to unlock ${truncMiddle(lockedAddressHint, 8, 8)}.`
              : "Enter your PIN to unlock this wallet."}
          </p>
        </div>

        <Field label="PIN">
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
          <KeyRound size={16} /> Unlock
        </Button>

        <button
          className="mt-5 block w-full text-center text-[11px] text-zinc-600 underline decoration-dotted hover:text-zinc-400"
          onClick={() => {
            if (
              confirm(
                "Forgot your PIN? This erases the wallet from this browser. You will need your 24-word recovery phrase or backup hex to restore it. This cannot be undone. Continue?",
              )
            ) {
              forget();
            }
          }}
        >
          Forgot your PIN?
        </button>
      </Card>
    </div>
  );
}
