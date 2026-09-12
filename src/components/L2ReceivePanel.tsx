import { QrCode } from "lucide-react";
import { useStore } from "../store";
import { AddressQr } from "./Dashboard";
import { OOTLE_NETWORK_LABEL } from "../ootle";
import { copyText } from "../lib/format";
import { useToast } from "./toast";

/**
 * Everything needed to be paid on L2.
 *
 * The wallet address is what a person sends to; the account component address is what an
 * instruction or dApp targets — different things, so they are labelled rather than stacked as two
 * anonymous hashes. Neither belongs on the balance card, which is why they live here.
 */
export function L2ReceivePanel() {
  const store = useStore();
  const toast = useToast();
  const identity = store.l2.identity;

  if (!identity) {
    return <p className="py-8 text-center text-sm text-zinc-500">Switch to L2 first.</p>;
  }

  return (
    <div>
      <h2 className="mb-5 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
        <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#9d6bff] to-[#6d28d9]">
          <QrCode size={15} />
        </span>
        Receive on Ootle
      </h2>

      <div className="flex justify-center">
        <AddressQr value={identity.address} />
      </div>

      <div className="mt-6 space-y-3">
        <AddressField
          label="Ootle address"
          hint="Where someone sends you funds on L2."
          value={identity.address}
          onCopied={() => toast({ tone: "success", title: "Ootle address copied" })}
        />
        <AddressField
          label="Account component"
          hint="The on-chain account a dApp or instruction targets — not a payment address."
          value={identity.componentAddress}
          onCopied={() => toast({ tone: "success", title: "Component address copied" })}
        />
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-zinc-500">
        These addresses are on {OOTLE_NETWORK_LABEL}. MainNet XTM sent here will not arrive.
      </p>
    </div>
  );
}

function AddressField({
  label,
  hint,
  value,
  onCopied,
}: {
  label: string;
  hint: string;
  value: string;
  onCopied: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-4">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold text-[var(--tari-text)]">{label}</p>
        <button
          className="text-[10px] font-bold text-[var(--st-violet)]"
          onClick={() => void copyText(value).then((ok) => ok && onCopied())}
        >
          Copy
        </button>
      </div>
      <p className="font-mono text-[11px] break-all text-zinc-400">{value}</p>
      <p className="mt-1.5 text-[10px] text-zinc-500">{hint}</p>
    </div>
  );
}
