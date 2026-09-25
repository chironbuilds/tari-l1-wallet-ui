import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useStore } from "../store";
import { L1_SWITCHABLE_NETWORKS, networkLabel, type NetworkId } from "../lib/tari";
import { cn } from "./ui";

/**
 * Flips the L1 wallet between MainNet and the testnet. The seed is the same on both; everything the
 * chain owns (UTXOs, scan progress, activity, burns) is kept separately per network, so the balance
 * shown after a switch is only ever that network's own.
 *
 * `tone="card"` sits on the purple wallet card; `tone="plain"` on the regular surfaces.
 */
export function NetworkSwitch({ tone = "plain", className }: { tone?: "card" | "plain"; className?: string }) {
  const store = useStore();
  const [switchingTo, setSwitchingTo] = useState<NetworkId | null>(null);

  const go = (next: NetworkId) => {
    if (next === store.network || switchingTo) return;
    setSwitchingTo(next);
    // Reloads the page on success; only returns when the switch could not be saved.
    store.switchNetwork(next);
    setSwitchingTo(null);
  };

  const hint = store.hasPin && !store.walletLocked ? " You will be asked for your PIN again." : "";

  return (
    <div
      role="radiogroup"
      aria-label="L1 network"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full p-0.5",
        tone === "card" ? "bg-black/25" : "border border-[var(--tari-border)] bg-[var(--tari-bg-input)]",
        className,
      )}
    >
      {L1_SWITCHABLE_NETWORKS.map((n) => {
        const active = store.network === n.id;
        return (
          <button
            key={n.id}
            role="radio"
            aria-checked={active}
            disabled={switchingTo !== null}
            title={active ? `On ${networkLabel(n.id)}` : `Switch the L1 wallet to ${networkLabel(n.id)}.${hint}`}
            onClick={() => go(n.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide uppercase transition-colors",
              active
                ? tone === "card"
                  ? "bg-white text-black"
                  : "btn-primary shadow"
                : tone === "card"
                  ? "opacity-70 hover:bg-white/10 hover:opacity-100"
                  : "text-[var(--tari-text-dim)] hover:text-[var(--tari-text)]",
            )}
          >
            {switchingTo === n.id && <Loader2 size={10} className="animate-spin" />}
            {n.short}
          </button>
        );
      })}
    </div>
  );
}
