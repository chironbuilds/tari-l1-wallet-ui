import { useState } from "react";
import { Check, ChevronDown, Copy, Coins } from "lucide-react";
import { QRCode } from "react-qrcode-logo";
import { useStore } from "../store";
import { parseAddress } from "../lib/tari";
import { formatMicro, humanizeFlag } from "../lib/format";
import { useToast } from "./toast";
import { copyText } from "../lib/format";
import { Badge, Button, Card, Field, Segmented, TextInput } from "./ui";
import { useI18n } from "../i18n";

export function ReceivePanel() {
  const { t } = useI18n();
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
  const qrValue = `tari://${store.network ?? "mainnet"}/transactions/send?tariAddress=${shownBase58}`;

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
          { value: "base58", label: t("receive.base58") },
          { value: "emoji", label: t("receive.emojiId") },
        ]}
      />

      <p className="mt-4 max-w-full rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-3.5 text-center font-mono text-[11px] break-all text-[var(--tari-text)]">
        {display}
      </p>
      {useEmoji && (
        <p className="mt-2 text-center text-[11px] text-zinc-500">
          {t("receive.emojiNote")}
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
            toast({ tone: "success", title: t("receive.addressCopied") });
            setTimeout(() => setCopied(false), 2000);
          }
        }}
      >
        {copied ? <Check size={16} className="text-[var(--st-green)]" /> : <Copy size={16} />}
        {copied ? t("receive.copied") : t("receive.copyAddress")}
      </Button>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Badge tone={addr.isDual ? "green" : "red"}>
          {addr.isDual ? t("receive.oneSided") : t("receive.singleAddress")}
        </Badge>
        {addr.features.length > 0 && (
          <Badge tone="slate">{addr.features.map(humanizeFlag).join(" · ")}</Badge>
        )}
      </div>

      <p className="mt-4 text-center text-xs leading-relaxed text-zinc-500">
        {t("receive.scanNote")}
      </p>

      <details className="mt-6 w-full">
        <summary className="flex cursor-pointer items-center justify-between text-sm font-bold tracking-wide text-[var(--tari-text)] uppercase select-none">
          <span className="flex items-center gap-2">
            <Coins size={15} className="text-[var(--st-green)]" /> {t("receive.advanced")}
          </span>
          <ChevronDown size={16} className="text-zinc-500" />
        </summary>
        <ScannedImport />
      </details>
    </div>
  );
}

function ScannedImport() {
  const { t } = useI18n();
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
        {t("receive.importIntro")}
      </p>
      <Field label={t("receive.commitment")}><TextInput mono value={f.commitment} onChange={set("commitment")} /></Field>
      <Field label={t("receive.encryptedData")}><TextInput mono value={f.encryptedData} onChange={set("encryptedData")} /></Field>
      <Field label={t("receive.senderOffset")}><TextInput mono value={f.senderOffsetPub} onChange={set("senderOffsetPub")} /></Field>
      <Field label={t("receive.script")}><TextInput mono value={f.script} onChange={set("script")} /></Field>
      <Field label={t("receive.metadataSig")}><TextInput mono value={f.metadataSig} onChange={set("metadataSig")} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t("receive.minPromise")}><TextInput inputMode="numeric" value={f.minPromise} onChange={set("minPromise")} /></Field>
        <Field label={t("receive.maturity")}><TextInput inputMode="numeric" value={f.maturity} onChange={set("maturity")} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t("receive.outputType")}><TextInput inputMode="numeric" value={f.outputType} onChange={set("outputType")} /></Field>
        <Field label={t("receive.rangeProofType")}><TextInput inputMode="numeric" value={f.rangeProofType} onChange={set("rangeProofType")} /></Field>
      </div>
      <Field label={t("receive.coinbaseExtra")}><TextInput mono value={f.coinbaseExtra} onChange={set("coinbaseExtra")} /></Field>
      <Field label={t("receive.covenant")}><TextInput mono value={f.covenant} onChange={set("covenant")} /></Field>
      <Field label={t("receive.rangeProof")}><TextInput mono value={f.rangeProof} onChange={set("rangeProof")} /></Field>
      <Field label={t("receive.outputHash")}><TextInput mono value={f.outputHash} onChange={set("outputHash")} /></Field>
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
              title: t("receive.recovered"),
              message: t("receive.decryptedValue", { amount: formatMicro(handle.valueMicro) }),
            });
            setF(empty);
          } catch (e) {
            toast({
              tone: "error",
              title: t("receive.importFailed"),
              message: (e instanceof Error ? e.message : String(e)) + t("receive.isYours"),
            });
          }
        }}
      >
        {t("receive.decryptImport")}
      </Button>
    </div>
  );
}
