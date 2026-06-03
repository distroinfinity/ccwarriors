import { useEffect, useRef, useState } from "react";

/** Eases the displayed value toward `target` on change (count-up ticker). */
export function useTween(target: number, durationMs = 1100): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number>();

  useEffect(() => {
    const from = fromRef.current;
    const to = target;
    if (from === to) return;
    let start: number | null = null;

    const step = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / durationMs, 1);
      const e = 1 - Math.pow(1 - p, 3);
      const v = from + (to - from) * e;
      setValue(v);
      fromRef.current = v;
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return value;
}
