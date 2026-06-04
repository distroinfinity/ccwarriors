import { useEffect, useRef, useState } from "react";

const FLASH_MS = 900;

export interface TweenOptions {
  /** How long the count-up glides toward each new target. */
  durationMs?: number;
  /** When this changes, snap to target with no animation/flash (e.g. board switch). */
  resetKey?: string | number;
}

export interface TweenResult {
  /** The live eased value — render this. */
  value: number;
  /** True for ~900ms after the target increases (stock-ticker green flash). */
  flashing: boolean;
}

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Stock-ticker tween: eases the displayed value toward `target` on change and
 * signals `flashing` on increases. Only ever animates between confirmed values
 * (never extrapolates), so idle warriors sit still. Honors reduced motion.
 */
export function useTickerTween(target: number, opts: TweenOptions = {}): TweenResult {
  const { durationMs = 1100, resetKey } = opts;
  const [value, setValue] = useState(target);
  const [flashing, setFlashing] = useState(false);
  const fromRef = useRef(target);
  // Seeded to the initial target so the first snapshot doesn't flash everything.
  const prevTargetRef = useRef(target);
  const prevResetKeyRef = useRef(resetKey);
  const rafRef = useRef<number>();
  const flashRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    // Context switch (e.g. 30d ↔ allTime): snap, don't animate across boards.
    if (prevResetKeyRef.current !== resetKey) {
      prevResetKeyRef.current = resetKey;
      prevTargetRef.current = target;
      fromRef.current = target;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setValue(target);
      return;
    }

    const grew = target > prevTargetRef.current;
    prevTargetRef.current = target;

    const from = fromRef.current;
    if (from === target) return;

    if (reducedMotion()) {
      fromRef.current = target;
      setValue(target);
      return; // no count-up, no flash
    }

    if (grew) {
      if (flashRef.current) clearTimeout(flashRef.current);
      setFlashing(true);
      flashRef.current = setTimeout(() => setFlashing(false), FLASH_MS);
    }

    let start: number | null = null;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / durationMs, 1);
      const e = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * e;
      setValue(v);
      fromRef.current = v;
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs, resetKey]);

  // Clear the flash timer on unmount only.
  useEffect(
    () => () => {
      if (flashRef.current) clearTimeout(flashRef.current);
    },
    [],
  );

  return { value, flashing };
}

/** Eases the displayed value toward `target` on change (count-up ticker). */
export function useTween(target: number, durationMs = 1100): number {
  return useTickerTween(target, { durationMs }).value;
}
