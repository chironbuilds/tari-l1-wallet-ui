import { useEffect, useRef } from "react";
import {
  loadTowerAnimation,
  removeTowerAnimation,
  setAnimationProperties,
  setAnimationState,
} from "@tari-project/tari-tower";

const CANVAS_ID = "tower-canvas";

const SB_SPACING = 15;
const SB_MINI_WIDTH = 78;
const SIDEBAR_OFFSET = SB_SPACING + SB_MINI_WIDTH;

export const animationDarkBg = [
  { property: "bgColor1", value: "#212121" },
  { property: "bgColor2", value: "#212121" },
  { property: "neutralColor", value: "#040723" },
  { property: "successColor", value: "#c9eb00" },
  { property: "mainColor", value: "#813bf5" },
  { property: "failColor", value: "#ff5610" },
  { property: "particlesColor", value: "#813bf5" },
  { property: "goboIntensity", value: 0.35 },
  { property: "particlesOpacity", value: 0.95 },
  { property: "particlesSize", value: 0.015 },
];

export const animationLightBg = [
  { property: "bgColor1", value: "#ffffff" },
  { property: "bgColor2", value: "#d0d0d0" },
  { property: "neutralColor", value: "#ffffff" },
  { property: "mainColor", value: "#0096ff" },
  { property: "successColor", value: "#00c881" },
  { property: "failColor", value: "#ca0101" },
  { property: "particlesColor", value: "#505050" },
  { property: "goboIntensity", value: 0.45 },
  { property: "particlesOpacity", value: 0.75 },
  { property: "particlesSize", value: 0.01 },
];

const MAX_BLOCKS = 22;

interface Props {
  successes: number;
  failures: number;
  theme: "light" | "dark";
}

export function TowerBackground({ successes, failures, theme }: Props) {
  const appliedRef = useRef(-1);
  const readyRef = useRef(false);

  useEffect(() => {
    if (readyRef.current) {
      setAnimationProperties(theme === "light" ? animationLightBg : animationDarkBg);
      return;
    }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setAnimationProperties(theme === "light" ? animationLightBg : animationDarkBg);
        await loadTowerAnimation({ canvasId: CANVAS_ID, offset: SIDEBAR_OFFSET });
        if (cancelled) return;
        readyRef.current = true;
        setAnimationState("showVisual");
        setAnimationState("start");
      } catch (e) {
        console.error("Could not enable visual mode. Error at loadTowerAnimation:", e);
      }
    })();
    return () => {
      cancelled = true;
      void removeTowerAnimation({ canvasId: CANVAS_ID }).catch(() => {});
      appliedRef.current = -1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const total = Math.min(MAX_BLOCKS, successes + failures);
    const prev = appliedRef.current;
    if (total <= prev) return;
    let delay = prev < 0 ? 900 : 150;
    for (let i = Math.max(prev, 0); i < total; i++) {
      const isFail = i >= successes;
      const tier = i % 9 === 4 ? "TWO" : "ONE";
      const t = window.setTimeout(
        () => {
          try {
            setAnimationState(isFail ? "fail" : tier);
          } catch {
            /* queue closed */
          }
        },
        delay,
      );
      delay += 900;
    }
    appliedRef.current = total;
  }, [successes, failures]);

  return null;
}
