export const BLOCKS = "▁▂▃▄▅▆▇█";

export function formatUsd(n: number): string {
  // Cents keep the ticker visibly moving even for small spend deltas.
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Tier label with the mockup glyph prefix. */
const TIER_GLYPH: Record<string, string> = {
  netherite: "☄",
  diamond: "❖",
  gold: "◆",
  iron: "✦",
  stone: "⬡",
};
/** Compact token count: 1.2B, 480M, 9.5K, etc. Drops a trailing ".0". */
export function formatTokens(n: number): string {
  // Round at the tier boundary so 999,990 reads "1M", not "1000.0K".
  const tier = (v: number, suffix: string) => `${(v).toFixed(1).replace(/\.0$/, "")}${suffix}`;
  if (n >= 999_999_950) return tier(n / 1_000_000_000, "B");
  if (n >= 999_950) return tier(n / 1_000_000, "M");
  if (n >= 999.95) return tier(n / 1_000, "K");
  return String(Math.round(n));
}

export function tierLabel(tier: string): string {
  const g = TIER_GLYPH[tier.toLowerCase()];
  const up = tier.toUpperCase();
  return g ? `${g} ${up}` : up;
}

/** Glyph + name split apart so the row can align them on a shared center axis. */
export function tierParts(tier: string): { glyph: string | null; name: string } {
  return { glyph: TIER_GLYPH[tier.toLowerCase()] ?? null, name: tier.toUpperCase() };
}
