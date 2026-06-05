// Single source of truth for donation tiers. The server's INR allow-list
// (apps/server/src/routes/donate.ts ALLOWED_INR) must equal TIERS.map(t => t.inr).
export interface Tier {
  usd: number;
  inr: number;
  name: string;
  emoji: string;
  copy: string;
}

export const TIERS: Tier[] = [
  { usd: 4, inr: 400, name: "Wood", emoji: "🪵", copy: "buys the planks" },
  { usd: 8, inr: 800, name: "Stone", emoji: "🪨", copy: "cobblestone crew" },
  { usd: 16, inr: 1600, name: "Iron", emoji: "⛏️", copy: "iron-clad backer" },
  { usd: 32, inr: 3200, name: "Gold", emoji: "🪙", copy: "gilded patron" },
  { usd: 64, inr: 6400, name: "Diamond", emoji: "💎", copy: "diamond hands" },
  { usd: 256, inr: 25600, name: "Netherite", emoji: "🔥", copy: "netherite legend" },
];

export const DEFAULT_TIER = 2; // Iron / $16

// Index-safe accessor (noUncheckedIndexedAccess): out-of-range falls back to Wood.
export function tierAt(i: number): Tier {
  return TIERS[i] ?? (TIERS[0] as Tier);
}

export const GH_SPONSOR = "distroinfinity";

// Self-custody EVM wallet for the crypto tab; the tab hides when unset.
export const EVM_ADDRESS = import.meta.env.VITE_EVM_ADDRESS ?? "";
