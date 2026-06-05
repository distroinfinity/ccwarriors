// Monochrome tier glyphs for the sponsor amount grid — same hand-rolled,
// low-detail stroke style as ToolGlyph (a spark, a prompt…). currentColor so
// cards recolor on select/hover/theme. No literal emojis anywhere on the site.

import type { ReactNode } from "react";

const GLYPHS: Record<string, ReactNode> = {
  // Wood — two stacked planks, offset seams.
  wood: (
    <>
      <rect x="1.5" y="3" width="11" height="3.6" />
      <rect x="1.5" y="7.4" width="11" height="3.6" />
      <line x1="5" y1="3" x2="5" y2="6.6" />
      <line x1="9" y1="7.4" x2="9" y2="11" />
    </>
  ),
  // Stone — rough boulder with a crack.
  stone: (
    <>
      <path d="M3.2 10.8 L1.8 7.2 L3.4 4 L7 2.6 L10.6 4.2 L12.2 7.4 L10.6 10.8 Z" />
      <line x1="6" y1="5.4" x2="7.6" y2="8.2" />
    </>
  ),
  // Iron — pickaxe: arced head over a straight handle.
  iron: (
    <>
      <path d="M2.6 5 Q7 1.6 11.4 5" />
      <line x1="7" y1="3.2" x2="7" y2="12.4" />
    </>
  ),
  // Gold — coin with an inner ring.
  gold: (
    <>
      <circle cx="7" cy="7" r="5.2" />
      <circle cx="7" cy="7" r="2.2" />
    </>
  ),
  // Diamond — faceted gem.
  diamond: (
    <>
      <path d="M4.2 3 H9.8 L12.4 6.2 L7 12.2 L1.6 6.2 Z" />
      <line x1="1.6" y1="6.2" x2="12.4" y2="6.2" />
      <line x1="5.4" y1="6.2" x2="7" y2="12.2" />
      <line x1="8.6" y1="6.2" x2="7" y2="12.2" />
    </>
  ),
  // Netherite — flame with an inner tongue.
  netherite: (
    <>
      <path d="M7 1.6 C9.4 4 10.9 6 10.9 8.4 A3.9 3.9 0 0 1 3.1 8.4 C3.1 6.4 4.6 4.4 7 1.6 Z" />
      <path d="M7 7.2 C7.9 8.1 8.4 8.8 8.4 9.5 A1.4 1.4 0 0 1 5.6 9.5 C5.6 8.8 6.1 8.1 7 7.2 Z" />
    </>
  ),
  // Custom — plus in a dashed slot.
  custom: (
    <>
      <rect x="1.6" y="1.6" width="10.8" height="10.8" rx="2" strokeDasharray="2.4 2" />
      <line x1="7" y1="4.6" x2="7" y2="9.4" />
      <line x1="4.6" y1="7" x2="9.4" y2="7" />
    </>
  ),
};

export function TierGlyph({ tier }: { tier: string }) {
  return (
    <svg
      className="amt-glyph"
      viewBox="0 0 14 14"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {GLYPHS[tier]}
    </svg>
  );
}
