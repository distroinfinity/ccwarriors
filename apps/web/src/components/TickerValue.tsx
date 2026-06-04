import { useTickerTween } from "../useTween";

/**
 * Leaf ticker span — owns the per-frame tween state so the ~60fps re-renders
 * during a glide stay confined to this one text node instead of the whole
 * row/header subtree. Carries the `.up` flash class; the row glow keys off it
 * via `.row:has(.up)::after` in CSS.
 */
export function TickerValue({
  target,
  durationMs,
  format,
  resetKey,
}: {
  target: number;
  durationMs: number;
  format: (n: number) => string;
  resetKey?: string | number;
}) {
  const { value, flashing } = useTickerTween(target, { durationMs, resetKey });
  return <span className={flashing ? "up" : undefined}>{format(value)}</span>;
}
