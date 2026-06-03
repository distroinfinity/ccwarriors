export const BLOCKS = "▁▂▃▄▅▆▇█";

/** Deterministic 8-bar sparkline derived from a hash of the id. */
export function sparkBars(id: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const bars: number[] = [];
  for (let i = 0; i < 8; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    bars.push((Math.abs(h) % 8) + 1); // 1..8 -> index into BLOCKS
  }
  return bars;
}

export function formatUsd(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
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
