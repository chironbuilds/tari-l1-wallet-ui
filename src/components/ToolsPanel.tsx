import { useMemo, useState } from "react";
import { FlaskConical, Hash, Lock, ShieldCheck } from "lucide-react";
import {
  WasmKeyPair,
  WasmSchnorrSignature,
  blake2b256Hex,
  blake2b512Hex,
  commitValue,
  openValue,
} from "@chironbuilder/tari-l1-wasm";
import { copyText } from "../lib/format";
import { useToast } from "./toast";
import { Badge, Button, Card, Field, TextInput } from "./ui";

const te = new TextEncoder();

function randomHex(bytes: number): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function ToolsPanel() {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <HashLab />
      <SchnorrLab />
      <CommitLab />
    </div>
  );
}

function LabCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="h-fit p-6">
      <h3 className="mb-5 flex items-center gap-2.5 text-sm font-bold tracking-wide text-[var(--tari-text)] uppercase">
        <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 text-[var(--tari-text)]">
          {icon}
        </span>
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function MonoOut({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold tracking-wider text-zinc-600 uppercase">{label}</p>
      <button
        onClick={() => value && void copyText(value)}
        className="w-full cursor-pointer rounded-xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-3 text-left font-mono text-[11px] break-all text-[var(--st-cyan)] transition-colors hover:border-cyan-500/30"
        title="Click to copy"
      >
        {value || <span className="text-zinc-700">—</span>}
      </button>
    </div>
  );
}

function HashLab() {
  const [msg, setMsg] = useState("Hello Tari");
  const h256 = useMemo(() => blake2b256Hex(te.encode(msg)), [msg]);
  const h512 = useMemo(() => blake2b512Hex(te.encode(msg)), [msg]);
  return (
    <LabCard title="Blake2b hashing" icon={<Hash size={14} />}>
      <Field label="Message">
        <TextInput value={msg} onChange={(e) => setMsg(e.target.value)} />
      </Field>
      <MonoOut label="blake2b-256" value={h256} />
      <MonoOut label="blake2b-512" value={h512} />
      <p className="text-[11px] leading-relaxed text-zinc-600">
        The 512 digest is what Tari uses for Schnorr challenges.
      </p>
    </LabCard>
  );
}

function SchnorrLab() {
  const toast = useToast();
  const [kp, setKp] = useState<WasmKeyPair | null>(null);
  const [msg, setMsg] = useState("sign me");
  const [sig, setSig] = useState<WasmSchnorrSignature | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);

  return (
    <LabCard title="Ristretto Schnorr signatures" icon={<Lock size={14} />}>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => {
          setKp(WasmKeyPair.generate());
          setSig(null);
          setVerified(null);
          toast({ tone: "info", title: "New keypair generated" });
        }}
      >
        Generate keypair
      </Button>
      {kp && (
        <>
          <MonoOut label="public key" value={kp.publicKeyHex} />
          <Field label="Message bytes (utf-8)">
            <TextInput value={msg} onChange={(e) => { setMsg(e.target.value); setSig(null); setVerified(null); }} />
          </Field>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              try {
                const s = WasmSchnorrSignature.sign(kp.secretKeyHex, te.encode(msg));
                setSig(s);
                setVerified(null);
              } catch (e) {
                toast({ tone: "error", title: "Signing failed", message: String(e) });
              }
            }}
          >
            Sign
          </Button>
          {sig && (
            <>
              <MonoOut label="public nonce" value={sig.publicNonceHex} />
              <MonoOut label="signature" value={sig.signatureHex} />
              <div className="flex items-center justify-between gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setVerified(
                      WasmSchnorrSignature.verify(
                        kp.publicKeyHex,
                        sig.publicNonceHex,
                        sig.signatureHex,
                        te.encode(msg),
                      ),
                    )
                  }
                >
                  Verify
                </Button>
                {verified !== null && (
                  <Badge tone={verified ? "green" : "red"}>
                    <ShieldCheck size={12} /> {verified ? "valid signature" : "invalid"}
                  </Badge>
                )}
              </div>
            </>
          )}
          <p className="text-[11px] leading-relaxed text-zinc-600">
            The secret key never leaves WASM memory — only hex is surfaced to the UI.
          </p>
        </>
      )}
    </LabCard>
  );
}

function CommitLab() {
  const toast = useToast();
  const [blind, setBlind] = useState(() => randomHex(32));
  const [value, setValue] = useState("1000000");
  const [commitment, setCommitment] = useState<string | null>(null);
  const [opens, setOpens] = useState<boolean | null>(null);

  const micro = /^\d+$/.test(value.trim()) ? BigInt(value.trim()) : null;

  return (
    <LabCard title="Pedersen commitments" icon={<FlaskConical size={14} />}>
      <Field label="Blinding factor (hex)">
        <TextInput mono value={blind} onChange={(e) => { setBlind(e.target.value); setCommitment(null); setOpens(null); }} spellCheck={false} />
      </Field>
      <Field label="Value (µT)">
        <TextInput inputMode="numeric" value={value} onChange={(e) => { setValue(e.target.value); setOpens(null); }} error={micro === null} />
      </Field>
      <Button
        variant="outline"
        className="w-full"
        disabled={micro === null || blind.trim().length === 0}
        onClick={() => {
          try {
            setCommitment(commitValue(blind.trim(), micro!));
            setOpens(null);
          } catch (e) {
            toast({ tone: "error", title: "Commitment failed", message: String(e) });
          }
        }}
      >
        Commit
      </Button>
      <MonoOut label="commitment" value={commitment} />
      {commitment && (
        <div className="flex items-center justify-between gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpens(openValue(blind.trim(), micro!, commitment))}
          >
            Open check
          </Button>
          {opens !== null && (
            <Badge tone={opens ? "green" : "red"}>{opens ? "opens ✓" : "does not open"}</Badge>
          )}
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-zinc-600">
        Same primitive that hides amounts in every Minotari output.
      </p>
    </LabCard>
  );
}
