import { useCallback, useRef, useState } from "react";

/**
 * Folds a card's secondary rows away while a list below it is scrolled down, and brings them back
 * on scrolling up — the list gets the room. Hysteresis keeps it from flickering: collapse only past
 * 24px going down, expand after 40px of upward travel or at the top, and ignore scroll events for
 * the length of the animation, since the reflow itself moves scrollTop.
 *
 * Returns whether the rows are open, an onScroll handler for the list, and `reset` for when the
 * list is replaced (e.g. a tab switch) and starts at the top again.
 */
export function useCollapseOnScroll() {
  const [open, setOpen] = useState(true);
  const openRef = useRef(true);
  const state = useRef({ last: 0, lockUntil: 0, upTravel: 0 });

  const set = (next: boolean, now: number) => {
    openRef.current = next;
    setOpen(next);
    state.current.lockUntil = now + 350;
  };

  const onScroll = useCallback((el: HTMLElement) => {
    const now = performance.now();
    const st = el.scrollTop;
    const s = state.current;
    const dy = st - s.last;
    s.last = st;
    if (now < s.lockUntil) return;
    if (st <= 4) {
      s.upTravel = 0;
      if (!openRef.current) set(true, now);
      return;
    }
    if (dy > 0) {
      s.upTravel = 0;
      if (openRef.current && st > 24) set(false, now);
    } else if (dy < 0) {
      s.upTravel -= dy;
      if (!openRef.current && s.upTravel > 40) {
        s.upTravel = 0;
        set(true, now);
      }
    }
  }, []);

  const reset = useCallback(() => {
    openRef.current = true;
    setOpen(true);
    state.current = { last: 0, lockUntil: 0, upTravel: 0 };
  }, []);

  return { open, onScroll, reset };
}

/** Class names for the collapsing wrapper (an animated grid row) around the rows that fold away. */
export function collapseClass(open: boolean): string {
  return `grid transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`;
}
