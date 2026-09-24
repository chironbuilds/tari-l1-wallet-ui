import { useState } from "react";
import { Check, ChevronDown, Copy, Coins } from "lucide-react";
import { QRCode } from "react-qrcode-logo";
import { useStore } from "../store";
import { parseAddress } from "../lib/tari";
import { formatMicro, humanizeFlag } from "../lib/format";
import { useToast } from "./toast";
import { copyText } from "../lib/format";
import { Badge, Button, Card, Field, Segmented, TextInput } from "./ui";

export function ReceivePanel() {
  const store = useStore();
  const toast = useToast();
  const [useEmoji, setUseEmoji] = useState(false);
  const [copied, setCopied] = useState(false);
  const [faucetAmount, setFaucetAmount] = useState("5");

  if (!store.wallet || !store.addressInfo) return null;
  const addr = store.addressInfo;
  // The switcher on the wallet card decides which address is being presented, so the QR and the
  // copy field here have to agree with it — otherwise the two disagree about what to hand out.
  const activeSub = store.subAddresses.find((s) => s.label === store.activeSubAddress) ?? null;
  const shownBase58 = activeSub?.base58 ?? addr.base58;
  // A sub-address has no separate emoji form cached; derive it so the toggle still works.
  const shownEmoji = activeSub ? (parseAddress(activeSub.base58)?.toEmoji() ?? addr.emoji) : addr.emoji;
  const display = useEmoji ? shownEmoji : shownBase58;
  const qrValue = `tari://mainnet/transactions/send?tariAddress=${shownBase58}`;

  return (
    <div className="flex flex-col items-center">
      <div className="w-[240px] rounded-[24px] bg-white p-4 shadow-[0_0_45px_-8px_rgba(147,48,255,.5)]">
        <QRCode
          value={qrValue}
          ecLevel="H"
          size={220}
          quietZone={16}
          logoImage="/tari-outline.svg"
          logoPaddingStyle="circle"
          logoPadding={12}
          qrStyle="dots"
          removeQrCodeBehindLogo={true}
          eyeRadius={12}
          style={{ width: "100%", height: "auto" }}
        />
      </div>

      <Segmented
        value={useEmoji ? "emoji" : "base58"}
        onChange={(v) => setUseEmoji(v === "emoji")}
        className="mt-5"
        options={[
          { value: "base58", label: "Base58" },
          { value: "emoji", label: "Emoji ID" },
        ]}
      />

      <p className="mt-4 max-w-full rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-3.5 text-center font-mono text-[11px] break-all text-[var(--tari-text)]">
        {display}
      </p>
      {useEmoji && (
        <p className="mt-2 text-center text-[11px] text-zinc-500">
          For the Tari Universe desktop app — this wallet's own Send only accepts Base58 or hex.
        </p>
      )}

      <Button
        size="lg"
        className="mt-5 w-full max-w-sm"
        variant={copied ? "outline" : "primary"}
        onClick={async () => {
          const ok = await copyText(display);
          if (ok) {
            setCopied(true);
            toast({ tone: "success", title: "Address copied" });
            setTimeout(() => setCopied(false), 2000);
          }
        }}
      >
        {copied ? <Check size={16} className="text-[var(--st-green)]" /> : <Copy size={16} />}
        {copied ? "Copied" : "Copy address"}
      </Button>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Badge tone={addr.isDual ? "green" : "red"}>
          {addr.isDual ? "One-sided payments supported" : "Single address"}
        </Badge>
        {addr.features.length > 0 && (
          <Badge tone="slate">{addr.features.map(humanizeFlag).join(" · ")}</Badge>
        )}
      </div>

      <p className="mt-4 text-center text-xs leading-relaxed text-zinc-500">
        Scan with any Tari wallet, or share the address — senders can pay one-sidedly
        without you being online.
      </p>

      <details className="mt-6 w-full">
        <summary className="flex cursor-pointer items-center justify-between text-sm font-bold tracking-wide text-[var(--tari-text)] uppercase select-none">
          <span className="flex items-center gap-2">
            <Coins size={15} className="text-[var(--st-green)]" /> Advanced: import a scanned output
          </span>
          <ChevronDown size={16} className="text-zinc-500" />
        </summary>
        <ScannedImport />
      </details>
    </div>
  );
}

function ScannedImport() {
  const store = useStore();
  const toast = useToast();
  const empty = {
    commitment: "",
    encryptedData: "",
    senderOffsetPub: "",
    script: "",
    metadataSig: "",
    minPromise: "0",
    maturity: "0",
    outputType: "0",
    rangeProofType: "0",
    coinbaseExtra: "",
    covenant: "00",
    rangeProof: "",
    outputHash: "",
  };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  if (!store.wallet) return null;

  return (
    <div className="animate-fade-up mt-5 space-y-4">
      <p className="text-xs leading-relaxed text-zinc-500">
        Recover a spendable output owned by this wallet from scanned chain data
        (view-key / stealth DH decryption happens in WASM). Hex fields without 0x prefix.
      </p>
      <Field label="Commitment hex"><TextInput mono value={f.commitment} onChange={set("commitment")} /></Field>
      <Field label="Encrypted data hex"><TextInput mono value={f.encryptedData} onChange={set("encryptedData")} /></Field>
      <Field label="Sender offset public key hex"><TextInput mono value={f.senderOffsetPub} onChange={set("senderOffsetPub")} /></Field>
      <Field label="Script hex"><TextInput mono value={f.script} onChange={set("script")} /></Field>
      <Field label="Metadata signature hex"><TextInput mono value={f.metadataSig} onChange={set("metadataSig")} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Min value promise (µT)"><TextInput inputMode="numeric" value={f.minPromise} onChange={set("minPromise")} /></Field>
        <Field label="Maturity (height)"><TextInput inputMode="numeric" value={f.maturity} onChange={set("maturity")} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Output type byte"><TextInput inputMode="numeric" value={f.outputType} onChange={set("outputType")} /></Field>
        <Field label="Range proof type byte"><TextInput inputMode="numeric" value={f.rangeProofType} onChange={set("rangeProofType")} /></Field>
      </div>
      <Field label="Coinbase extra hex — optional"><TextInput mono value={f.coinbaseExtra} onChange={set("coinbaseExtra")} /></Field>
      <Field label="Covenant hex — usually 00"><TextInput mono value={f.covenant} onChange={set("covenant")} /></Field>
      <Field label="Range proof hex — required for spendable imports"><TextInput mono value={f.rangeProof} onChange={set("rangeProof")} /></Field>
      <Field label="Output hash hex — chain hash for compact spending"><TextInput mono value={f.outputHash} onChange={set("outputHash")} /></Field>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => {
          try {
            const handle = store.wallet!.importScannedOutput(
              f.commitment.trim(),
              f.encryptedData.trim(),
              f.senderOffsetPub.trim(),
              f.script.trim(),
              f.metadataSig.trim(),
              BigInt(f.minPromise || "0"),
              BigInt(f.maturity || "0"),
              Number(f.outputType || "0"),
              Number(f.rangeProofType || "0"),
              f.coinbaseExtra.trim(),
              f.covenant.trim() || "00",
              f.rangeProof.trim(),
              f.outputHash.trim(),
            );
            // Mined height is unknown for a hand-entered output; maturity is what gates spending.
            // The typed-in fields are kept so a reload can re-import this output too.
            store.addScannedOutput(handle, 0, Number(f.maturity || "0"), {
              commitment_hex: f.commitment.trim(),
              hash_hex: f.outputHash.trim(),
              encrypted_data_hex: f.encryptedData.trim(),
              sender_offset_pub_hex: f.senderOffsetPub.trim(),
              script_hex: f.script.trim(),
              metadata_sig_hex: f.metadataSig.trim(),
              minimum_value_promise: f.minPromise || "0",
              maturity: f.maturity || "0",
              output_type_byte: Number(f.outputType || "0"),
              range_proof_type_byte: Number(f.rangeProofType || "0"),
              coinbase_extra_hex: f.coinbaseExtra.trim(),
              covenant_hex: f.covenant.trim() || "00",
              range_proof_hex: f.rangeProof.trim(),
            });
            toast({
              tone: "success",
              title: "Output recovered",
              message: `Decrypted value: ${formatMicro(handle.valueMicro)} XTM — now spendable.`,
            });
            setF(empty);
          } catch (e) {
            toast({
              tone: "error",
              title: "Import failed",
              message:
                (e instanceof Error ? e.message : String(e)) + " — is this output yours?",
            });
          }
        }}
      >
        Decrypt & import output
      </Button>
    </div>
  );
}
