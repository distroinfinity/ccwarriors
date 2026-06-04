import { useEffect, useRef, useState } from "react";

const FLASH_MS = 900;

// Cached once — `.matches` is still read live, so mid-session OS toggles apply
// on the next target change (CSS @media gates the visuals instantly).
const rmQuery =
  typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
const reducedMotion = () => rmQuery?.matches ?? false;

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
  // Seeded to the mount-time target, so rows mounting with live values don't
  // flash. The header mounts at 0, so its first 0→N snapshot flashes once —
  // it lands with the skeleton→number reveal and reads as intentional.
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
      if (flashRef.current) clearTimeout(flashRef.current);
      setFlashing(false);
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
