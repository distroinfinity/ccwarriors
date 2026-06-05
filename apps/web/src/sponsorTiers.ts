// Single source of truth for donation tiers. Everything displays in USD;
// the server converts to INR at the live rate (GET /donate/rate) and
// Razorpay charges rupees. Custom bounds mirror MIN_USD/MAX_USD server-side.
export interface Tier {
  usd: number;
  name: string;
  glyph: string;
  copy: string;
}

export const TIERS: Tier[] = [
  { usd: 4, name: "Wood", glyph: "wood", copy: "buys the planks" },
  { usd: 8, name: "Stone", glyph: "stone", copy: "cobblestone crew" },
  { usd: 16, name: "Iron", glyph: "iron", copy: "ironclad backer" },
  { usd: 32, name: "Gold", glyph: "gold", copy: "gilded patron" },
  { usd: 64, name: "Diamond", glyph: "diamond", copy: "diamond hands" },
  { usd: 256, name: "Netherite", glyph: "netherite", copy: "netherite legend" },
];

export const DEFAULT_TIER = 2; // Iron / $16

export const MIN_CUSTOM_USD = 1;
export const MAX_CUSTOM_USD = 1000;
export const CUSTOM_TIER = -1; // tierIdx sentinel for the custom cell
export const CUSTOM_COPY = "any amount helps";

// Index-safe accessor (noUncheckedIndexedAccess): out-of-range falls back to Wood.
export function tierAt(i: number): Tier {
  return TIERS[i] ?? (TIERS[0] as Tier);
}

export const GH_SPONSOR = "distroinfinity";

// Self-custody wallets for the crypto tab. A chain hides when its address is
// unset; the whole tab hides when both are.
export const EVM_ADDRESS = import.meta.env.VITE_EVM_ADDRESS ?? "";
export const SOL_ADDRESS = import.meta.env.VITE_SOL_ADDRESS ?? "";
