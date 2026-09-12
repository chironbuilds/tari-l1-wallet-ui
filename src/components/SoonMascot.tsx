import soonJumping from "/soon-jumping.png";

/**
 * Soon™, Tari's turtle mascot — the official jumping artwork from kbw.tari.com.
 *
 * The pose is already mid-leap, which is exactly the frame the layer switch needs; `squash` bends
 * it into a crouch before the jump and an absorb on landing, so one asset covers the whole
 * animation without a sprite sheet.
 */
export function SoonMascot({
  size = 96,
  squash = 1,
  className,
  shadow = false,
}: {
  size?: number;
  /** 1 is at rest. Below 1 flattens for a crouch, above 1 stretches through the air. */
  squash?: number;
  className?: string;
  /** Adds a soft drop shadow — wanted for the big animated Soon, not for small inline ones. */
  shadow?: boolean;
}) {
  return (
    <img
      src={soonJumping}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{
        width: size,
        height: "auto",
        // Scaling about the feet is what sells weight: squashing into the ground should keep the
        // feet planted rather than shrinking Soon toward his middle.
        transform: `scaleY(${squash}) scaleX(${1 + (1 - squash) * 0.45})`,
        transformOrigin: "50% 92%",
        filter: shadow ? "drop-shadow(0 8px 14px rgba(0,0,0,0.28))" : undefined,
        userSelect: "none",
        pointerEvents: "none",
      }}
    />
  );
}
