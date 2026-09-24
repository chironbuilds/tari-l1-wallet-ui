import { useMemo, useState } from "react";
import { Check, FileInput, TriangleAlert, Upload } from "lucide-react";
import { parseConsoleWalletBurnProof, type BurnClaimProofContents } from "@chironbuilder/ootle-sdk";
import { formatMicro, truncMiddle } from "../lib/format";
import { useStore } from "../store";
import { useToast } from "./toast";
import { Button, Field } from "./ui";

/**
 * Claims a burn made from another wallet — typically `minotari_console_wallet`, which writes a
 * proof file per confirmed burn. Burns made from this wallet are tracked and claimed on their own
 * and never need this.
 */
export function ClaimBurnPanel() {
  const store = useStore();
  const toast = useToast();
  const [text, setText] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState<bigint | null>(null);

  const parsed = useMemo((): { proof: BurnClaimProofContents | null; error: string | null } => {
    if (!text.trim()) return { proof: null, error: null };
    try {
      return { proof: parseConsoleWalletBurnProof(text), error: null };
    } catch (e) {
      return { proof: null, error: e instanceof Error ? e.message : "Not a valid burn proof" };
    }
  }, [text]);

  async function readFile(file: File) {
    setText(await file.text());
    setClaimed(null);
  }

  async function claim() {
    const account = store.l2.identity?.account;
    if (!parsed.proof || !account) return;
    setClaiming(true);
    try {
      const { claimedAmount } = await account.claimBurn(parsed.proof);
      setClaimed(claimedAmount);
      store.refreshL2();
      toast({ tone: "success", title: "Burn claimed", message: `${formatMicro(claimedAmount)} tTARI added to your private balance.` });
    } catch (e) {
      toast({ tone: "error", title: "Claim not accepted", message: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    } finally {
      setClaiming(false);
    }
  }

  const value = parsed.proof ? BigInt(parsed.proof.claim_proof.value) : null;

  return (
    <div className="animate-fade-up">
      <h2 className="flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
        <span className="grid size-9 place-items-center rounded-full bg-[var(--tari-purple)] text-white">
          <FileInput size={16} />
        </span>
        Claim an L1 burn
      </h2>
      <p className="mt-2 mb-5 text-xs leading-relaxed text-zinc-500">
        Paste or upload a burn proof addressed to this Ootle account — for example a file from the Minotari
        console wallet&apos;s <span className="font-mono">burn_proofs</span> folder. Burns made from this wallet
        are claimed automatically.
      </p>

      <Field label="Burn proof (JSON)" hint={parsed.error ?? undefined}>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setClaimed(null);
          }}
          rows={6}
          spellCheck={false}
          placeholder='{"claim_proof": { … }, "encrypted_data": "…"}'
          className="w-full rounded-xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-3.5 font-mono text-[11px] break-all text-[var(--tari-text)] placeholder-[var(--tari-text-dim)] focus:border-[#9330ff]/60 focus:ring-2 focus:ring-[#9330ff]/30 focus:outline-none"
        />
      </Field>
      <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--tari-text)] hover:opacity-80">
        <Upload size={13} /> Upload file
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readFile(f);
          }}
        />
      </label>

      {parsed.proof && value !== null && (
        <dl className="mt-5 space-y-2.5 rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Burned amount</dt>
            <dd className="tabular font-mono text-[var(--tari-text)]">{formatMicro(value)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Commitment</dt>
            <dd className="font-mono text-[var(--tari-text)]">{truncMiddle(parsed.proof.claim_proof.commitment, 8, 6)}</dd>
          </div>
        </dl>
      )}

      {!store.l2.identity && (
        <p className="mt-4 flex items-center gap-2 text-xs text-[var(--st-amber)]">
          <TriangleAlert size={13} /> Waiting for the Ootle account to load.
        </p>
      )}

      {claimed !== null ? (
        <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-[var(--st-green)]">
          <Check size={16} /> Claimed {formatMicro(claimed)} tTARI
        </p>
      ) : (
        <Button
          size="lg"
          className="mt-5 w-full"
          disabled={!parsed.proof || !store.l2.identity}
          loading={claiming}
          onClick={() => void claim()}
        >
          {claiming ? "Claiming…" : "Claim"}
        </Button>
      )}
    </div>
  );
}
