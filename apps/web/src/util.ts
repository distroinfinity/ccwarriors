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
/** Compact token count: 1.2B, 480M, 9.5K, etc. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function tierLabel(tier: string): string {
  const g = TIER_GLYPH[tier.toLowerCase()];
  const up = tier.toUpperCase();
  return g ? `${g} ${up}` : up;
}
