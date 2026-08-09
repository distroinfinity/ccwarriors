// Pure presentation/number helpers for the coach domain. No DB, no I/O.

/** USD: whole dollars drop cents; sub-dollar keeps up to 3 sig digits; else 2dp. */
export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (Number.isInteger(n)) return `$${n}`;
  if (Math.abs(n) < 0.01) return `$${Number(n.toPrecision(1))}`;
  return `$${n.toFixed(2)}`;
}

/** A 0..1 ratio rendered as a whole percent, e.g. 0.413 -> "41%". */
export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Effective dollars per million tokens, or null when token count is zero. */
export function effectiveCostPerMtok(costUsd: number, totalTokens: number): number | null {
  if (totalTokens <= 0) return null;
  return Math.round((costUsd / (totalTokens / 1_000_000)) * 100) / 100;
}

// Mirrors the FAMILY_RE classifier in efficiency.ts (kept local to avoid editing
// that module; families must match: opus|sonnet|haiku|openai|gemini|other).
const FAMILY_RE: Array<[RegExp, string]> = [
  [/opus/i, "opus"],
  [/sonnet/i, "sonnet"],
  [/haiku/i, "haiku"],
  [/gpt|o[0-9]|codex/i, "openai"],
  [/gemini/i, "gemini"],
];

/** Classify a raw model id into a coarse family string. */
export function modelFamily(model: string): string {
  for (const [re, fam] of FAMILY_RE) if (re.test(model)) return fam;
  return "other";
}
