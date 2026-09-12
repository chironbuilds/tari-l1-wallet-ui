import { useEffect, useMemo, useRef, useState } from "react";
import { Logo } from "./ui";
import type { Layer } from "../store";

/**
 * The transition between layers: an abstract energy cube arcs from the L1 pad across to the Ootle
 * pad, or drops back the other way.
 *
 * The whole thing is driven from one `t` in [0,1] rather than CSS keyframes, because the arc, the
 * squash-and-stretch, the tumble and the trail all have to agree about where the cube is at any
 * instant — three independent keyframe timelines drift apart the moment one duration is tweaked.
 * Position/rotation/squash are pure functions of `t` (`stateAt`) specifically so the trail can
 * resample the same motion a few frames in the past instead of hand-tracking history.
 */

const DURATION_MS = 3200;

export interface LayerJumpProps {
  /** The layer being travelled to. "L2" leaps up and across; "L1" drops back down. */
  to: Layer;
  onDone: () => void;
}

/** Ease that starts fast and settles — the leap should not feel linear. */
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

interface JumpState {
  x: number; // 0..1 across, left pad to right pad
  lift: number; // px above the baseline
  squash: number; // 1 at rest, <1 flattened, >1 stretched
  spin: number; // deg
  arc: number; // 0..1, how deep into the parabola (peaks at 1 mid-flight) — also drives the shadow
}

/** Pure function of a point in the timeline — see the module doc comment for why this matters. */
function stateAt(t: number, toL2: boolean): JumpState {
  const clamped = Math.min(1, Math.max(0, t));
  const crouch = Math.min(1, clamped / 0.18);
  const flight = clamped < 0.18 ? 0 : Math.min(1, (clamped - 0.18) / 0.58);
  const land = clamped < 0.76 ? 0 : Math.min(1, (clamped - 0.76) / 0.14);

  const travel = easeOutCubic(flight);
  const x = toL2 ? travel : 1 - travel;
  const arc = 4 * travel * (1 - travel); // parabola peaking mid-flight
  const lift = arc * (toL2 ? 112 : 74); // up to L2 arcs higher than the drop back down

  const squash =
    land > 0
      ? 1 - 0.2 * Math.sin(land * Math.PI) // absorb the landing
      : flight > 0
        ? 1 + 0.1 * Math.sin(flight * Math.PI) // stretch through the air
        : 1 - 0.16 * crouch; // gather before the leap

  // A tumble reads as a solid object thrown through the air; a face tilting side to side reads as
  // a character glancing around — this is the one number that most separates "object" from
  // "mascot" now that the art itself is gone.
  const spin = flight * 380 * (toL2 ? 1 : -1);

  return { x, lift, squash, spin, arc };
}

export function LayerJump({ to, onDone }: LayerJumpProps) {
  const [t, setT] = useState(0);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Someone who has asked for less motion should still get the layer change, just not the leap.
  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    if (reducedMotion) {
      onDoneRef.current();
      return;
    }
    let raf = 0;
    const start = performance.now();
    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDoneRef.current();
    };
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / DURATION_MS);
      setT(progress);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    raf = requestAnimationFrame(tick);
    // Browsers suspend rAF in a hidden tab, which would leave the switch stranded behind an
    // overlay that never advances. Timers are only clamped, not suspended, so this guarantees the
    // layer change lands whether or not anyone is watching it happen.
    const failsafe = window.setTimeout(finish, DURATION_MS + 400);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(failsafe);
    };
  }, [to, reducedMotion]);

  if (reducedMotion) return null;

  const toL2 = to === "L2";
  const current = stateAt(t, toL2);
  const inFlight = t >= 0.18 && t < 0.76;

  // A handful of recent-past samples, dimmer and smaller the further back they are — the "light
  // trail" a fast-moving object leaves, without tracking any history: `stateAt` is pure, so the
  // past is just the same function evaluated a little earlier.
  const trail = inFlight ? [0.045, 0.09, 0.135, 0.18].map((dt) => stateAt(t - dt, toL2)) : [];

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      style={{ background: "color-mix(in srgb, var(--tari-bg) 78%, transparent)" }}
      role="status"
      aria-live="polite"
      aria-label={toL2 ? "Switching to Ootle, layer 2" : "Returning to Tari layer 1"}
    >
      <div className="relative w-full max-w-[420px] px-6">
        <p className="mb-6 text-center text-sm font-bold tracking-wide text-[var(--tari-text)]">
          {toL2 ? "Bridging to Ootle…" : "Returning to layer 1…"}
        </p>

        {/* Flight path */}
        <div className="relative h-[150px]">
          {trail.map((s, i) => (
            <div
              key={i}
              className="absolute"
              style={{
                left: `${s.x * 100}%`,
                bottom: `${s.lift}px`,
                transform: `translateX(-50%) rotate(${s.spin}deg) scale(${s.squash})`,
                opacity: 0.28 - i * 0.06,
              }}
            >
              <EnergyCube size={54 - i * 8} />
            </div>
          ))}

          <div
            className="absolute"
            style={{
              left: `${current.x * 100}%`,
              bottom: `${current.lift}px`,
              transform: `translateX(-50%) rotate(${current.spin}deg) scaleY(${current.squash}) scaleX(${1 + (1 - current.squash) * 0.4})`,
              transformOrigin: "50% 85%",
            }}
          >
            <EnergyCube size={54} glow />
          </div>

          {/* The shadow tightens and darkens as the cube nears the ground — without it the arc
              reads as sliding rather than jumping. */}
          <div
            className="absolute bottom-0 rounded-[50%] bg-black"
            style={{
              left: `${current.x * 100}%`,
              width: `${44 - current.arc * 20}px`,
              height: `${9 - current.arc * 4}px`,
              opacity: 0.22 - current.arc * 0.14,
              transform: "translateX(-50%)",
            }}
          />
        </div>

        {/* Pads */}
        <div className="mt-3 flex items-start justify-between">
          <Pad label="Tari L1" sub="MainNet" active={current.x < 0.5} icon={<Logo size={18} />} />
          <div className="mt-5 flex-1 border-t border-dashed border-[var(--tari-border)]" />
          <Pad label="Ootle L2" sub="Esmeralda testnet" active={current.x >= 0.5} icon={<OotleGlyph />} />
        </div>
      </div>
    </div>
  );
}

/**
 * An abstract isometric cube standing in for the layer-jump's old mascot — three flat faces
 * (top/left/right) in the app's own purple family, so the motion reads as "an energy token making
 * the jump" rather than "a character," and ties visually back to the isometric block already used
 * on the dashboard. Pure CSS/SVG, no external asset.
 */
function EnergyCube({ size, glow = false }: { size: number; glow?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ filter: glow ? "drop-shadow(0 0 14px var(--tari-purple-light))" : undefined, display: "block" }}
      aria-hidden="true"
    >
      <polygon points="50,4 93,27 50,50 7,27" fill="var(--tari-purple-light)" />
      <polygon points="7,27 50,50 50,96 7,73" fill="var(--tari-purple-dark)" />
      <polygon points="93,27 50,50 50,96 93,73" fill="var(--tari-purple)" />
    </svg>
  );
}

function Pad({
  label,
  sub,
  active,
  icon,
}: {
  label: string;
  sub: string;
  active: boolean;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex w-[150px] flex-col items-center gap-1.5">
      <div
        className={
          active
            ? "grid size-12 place-items-center rounded-2xl border border-[#9d6bff]/60 bg-[#9d6bff]/20 text-[var(--tari-text)] shadow-lg transition-all"
            : "grid size-12 place-items-center rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] text-zinc-500 transition-all"
        }
      >
        {icon}
      </div>
      <span className="text-xs font-bold text-[var(--tari-text)]">{label}</span>
      <span className="text-[10px] text-zinc-500">{sub}</span>
    </div>
  );
}

function OotleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3.4" fill="currentColor" />
    </svg>
  );
}
