import { useEffect, useMemo, useRef } from "react";
import { Check } from "lucide-react";
import { Logo } from "./ui";

const DURATION_MS = 2600;
const PARTICLES = 22;
/** Stage size; every path and position below is in these pixels. */
const W = 320;
const H = 150;
const FROM = { x: 58, y: 78 };
const TO = { x: 262, y: 78 };

/**
 * Plays once after a burn is broadcast: the coin on the L1 side dissolves into embers that travel
 * along an arc into the Ootle ring, which fills as they arrive. Purely a confirmation of what just
 * happened — the burn itself is already on its way when this starts.
 */
export function BurnAnimation({
  amountLabel,
  receiveLabel,
  onDone,
}: {
  amountLabel: string;
  receiveLabel: string;
  onDone: () => void;
}) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    const t = window.setTimeout(() => onDoneRef.current(), reducedMotion ? 900 : DURATION_MS + 700);
    return () => clearTimeout(t);
  }, [reducedMotion]);

  // Each ember takes its own arc, so the stream reads as many particles rather than one moving
  // dot. Deterministic per index so a re-render never reshuffles them mid-flight.
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLES }, (_, i) => {
        const spread = ((i * 37) % 23) / 22 - 0.5; // -0.5 .. 0.5
        const lift = 46 + ((i * 53) % 34);
        const startX = FROM.x + spread * 26;
        const startY = FROM.y + (((i * 29) % 17) - 8);
        const cx = (FROM.x + TO.x) / 2 + spread * 40;
        const cy = FROM.y - lift;
        return {
          path: `path('M ${startX} ${startY} Q ${cx} ${cy} ${TO.x} ${TO.y}')`,
          delay: 250 + i * 55,
          duration: 1100 + ((i * 71) % 400),
          size: 3 + ((i * 13) % 4),
        };
      }),
    [],
  );

  return (
    <div
      className="relative mx-auto flex flex-col items-center py-4"
      role="status"
      aria-live="polite"
      aria-label={`${amountLabel}. ${receiveLabel}`}
    >
      <div className="relative" style={{ width: W, height: H }}>
        {/* Arc guide */}
        <svg className="absolute inset-0" width={W} height={H} aria-hidden="true">
          <path
            d={`M ${FROM.x} ${FROM.y} Q ${(FROM.x + TO.x) / 2} ${FROM.y - 62} ${TO.x} ${TO.y}`}
            fill="none"
            stroke="var(--tari-border)"
            strokeWidth="1.5"
            strokeDasharray="3 5"
          />
        </svg>

        {/* L1 coin */}
        <div
          className={reducedMotion ? "absolute opacity-40" : "burn-coin absolute"}
          style={{ left: FROM.x - 28, top: FROM.y - 28, animationDuration: `${DURATION_MS}ms` }}
        >
          <div className="burn-coin-glow grid size-14 place-items-center rounded-full border border-[var(--tari-border)] bg-[var(--tari-bg-deep)] text-[var(--tari-text)]">
            <Logo size={26} />
          </div>
        </div>

        {/* Embers */}
        {!reducedMotion &&
          particles.map((p, i) => (
            <span
              key={i}
              className="burn-ember absolute top-0 left-0 rounded-full"
              style={{
                width: p.size,
                height: p.size,
                offsetPath: p.path,
                animationDelay: `${p.delay}ms`,
                animationDuration: `${p.duration}ms`,
              }}
            />
          ))}

        {/* Ootle ring */}
        <div className="absolute" style={{ left: TO.x - 30, top: TO.y - 30 }}>
          <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden="true">
            <circle cx="30" cy="30" r="25" fill="var(--tari-bg-deep)" stroke="var(--tari-border)" strokeWidth="3" />
            <circle
              className={reducedMotion ? undefined : "burn-ring"}
              cx="30"
              cy="30"
              r="25"
              fill="none"
              stroke="var(--tari-purple)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="157"
              strokeDashoffset={reducedMotion ? 0 : 157}
              transform="rotate(-90 30 30)"
              style={{ animationDuration: `${DURATION_MS - 600}ms`, animationDelay: "700ms" }}
            />
          </svg>
          <span
            className={
              reducedMotion
                ? "absolute inset-0 grid place-items-center text-[var(--tari-purple)]"
                : "burn-check absolute inset-0 grid place-items-center text-[var(--tari-purple)]"
            }
            style={{ animationDelay: `${DURATION_MS}ms` }}
          >
            <Check size={22} strokeWidth={2.5} />
          </span>
        </div>

        <span className="absolute text-[10px] font-semibold tracking-wide text-zinc-500 uppercase" style={{ left: FROM.x - 40, width: 80, top: FROM.y + 36, textAlign: "center" }}>
          Tari L1
        </span>
        <span className="absolute text-[10px] font-semibold tracking-wide text-zinc-500 uppercase" style={{ left: TO.x - 40, width: 80, top: FROM.y + 36, textAlign: "center" }}>
          Ootle
        </span>
      </div>

      <p className="tabular mt-3 text-lg font-bold text-[var(--tari-text)]">{amountLabel}</p>
      <p className="mt-1 text-xs text-zinc-500">{receiveLabel}</p>
    </div>
  );
}
