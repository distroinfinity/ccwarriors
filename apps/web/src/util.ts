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
export function tierLabel(tier: string): string {
  const g = TIER_GLYPH[tier.toLowerCase()];
  const up = tier.toUpperCase();
  return g ? `${g} ${up}` : up;
}
