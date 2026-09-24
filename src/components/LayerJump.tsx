import { useEffect, useMemo, useRef } from "react";
import { ArrowRight, Layers } from "lucide-react";
import { Logo } from "./ui";
import type { Layer } from "../store";

const DURATION_MS = 700;

export interface LayerJumpProps {
  /** The layer being switched to. */
  to: Layer;
  onDone: () => void;
}

/**
 * A brief transition between layers: the two layers side by side with a progress bar, so the
 * switch reads as deliberate without holding the user up.
 */
export function LayerJump({ to, onDone }: LayerJumpProps) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    // A timer rather than animationend: it fires even when the tab is hidden, so the switch can
    // never be left stranded behind the overlay.
    const t = window.setTimeout(() => onDoneRef.current(), reducedMotion ? 0 : DURATION_MS);
    return () => clearTimeout(t);
  }, [to, reducedMotion]);

  if (reducedMotion) return null;

  const toL2 = to === "L2";
  const from = toL2 ? { label: "Tari L1", icon: <Logo size={16} /> } : { label: "Ootle L2", icon: <Layers size={16} /> };
  const dest = toL2 ? { label: "Ootle L2", icon: <Layers size={16} /> } : { label: "Tari L1", icon: <Logo size={16} /> };

  return (
    <div
      className="animate-pop pointer-events-auto fixed inset-0 z-50 grid place-items-center backdrop-blur-sm"
      style={{ background: "color-mix(in srgb, var(--tari-bg) 70%, transparent)" }}
      role="status"
      aria-live="polite"
      aria-label={toL2 ? "Switching to Ootle, layer 2" : "Switching to Tari layer 1"}
    >
      <div className="un-card w-[280px] p-5">
        <div className="flex items-center justify-between text-xs font-semibold text-[var(--tari-text)]">
          <span className="flex items-center gap-2 opacity-60">
            {from.icon}
            {from.label}
          </span>
          <ArrowRight size={14} className="text-zinc-500" />
          <span className="flex items-center gap-2">
            {dest.icon}
            {dest.label}
          </span>
        </div>
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--tari-text)_10%,transparent)]">
          <div className="layer-progress h-full rounded-full bg-[var(--tari-purple)]" style={{ animationDuration: `${DURATION_MS}ms` }} />
        </div>
      </div>
    </div>
  );
}
