// Tiny monochrome glyphs for the tool filter chips — hand-rolled in the same
// low-detail, pixel-leaning spirit as ClawdLogo/PixelHeart. Stylized abstract
// marks (a spark, a prompt, a star…), deliberately NOT corporate logos.
// Everything inherits currentColor so chips recolor on hover/active/theme.

import type { ReactNode } from "react";

const GLYPHS: Record<string, ReactNode> = {
  // Claude Code — a radiant spark.
  claude: (
    <>
      <line x1="7" y1="1.5" x2="7" y2="4.5" />
      <line x1="7" y1="9.5" x2="7" y2="12.5" />
      <line x1="1.5" y1="7" x2="4.5" y2="7" />
      <line x1="9.5" y1="7" x2="12.5" y2="7" />
      <line x1="3.2" y1="3.2" x2="5.2" y2="5.2" />
      <line x1="8.8" y1="8.8" x2="10.8" y2="10.8" />
      <line x1="10.8" y1="3.2" x2="8.8" y2="5.2" />
      <line x1="5.2" y1="8.8" x2="3.2" y2="10.8" />
    </>
  ),
  // Codex — terminal prompt.
  codex: (
    <>
      <polyline points="2.5,3.5 6,7 2.5,10.5" />
      <line x1="8" y1="11" x2="12" y2="11" />
    </>
  ),
  // Gemini — four-point star.
  gemini: <path d="M7 1.5 L8.6 5.4 L12.5 7 L8.6 8.6 L7 12.5 L5.4 8.6 L1.5 7 L5.4 5.4 Z" />,
  // Copilot — paired goggles.
  copilot: (
    <>
      <circle cx="4.4" cy="7.5" r="2.6" />
      <circle cx="9.6" cy="7.5" r="2.6" />
      <line x1="4" y1="3" x2="10" y2="3" />
    </>
  ),
  // OpenCode — open angle brackets.
  opencode: (
    <>
      <polyline points="4.5,3.5 1.5,7 4.5,10.5" />
      <polyline points="9.5,3.5 12.5,7 9.5,10.5" />
    </>
  ),
  // Amp — bolt.
  amp: <polyline points="8,1.5 4,8 7,8 6,12.5 10,6 7,6 8,1.5" />,
  // Droid — boxy head, two eyes.
  droid: (
    <>
      <rect x="2.5" y="4" width="9" height="7.5" rx="1.5" />
      <line x1="7" y1="4" x2="7" y2="1.8" />
      <circle cx="5.2" cy="7.7" r="0.4" fill="currentColor" />
      <circle cx="8.8" cy="7.7" r="0.4" fill="currentColor" />
    </>
  ),
  // pi — π.
  pi: (
    <>
      <line x1="2" y1="4" x2="12" y2="4" />
      <line x1="4.5" y1="4" x2="4.5" y2="11.5" />
      <path d="M9.5 4 V10 q0 1.5 1.8 1.3" />
    </>
  ),
};

// Future/unknown tools degrade to a tidy monogram chip — no code change needed
// when ccusage learns a new agent.
function FallbackInitial({ tool }: { tool: string }) {
  return (
    <>
      <rect x="1.2" y="1.2" width="11.6" height="11.6" rx="2.5" />
      <text
        x="7"
        y="10.2"
        textAnchor="middle"
        fontSize="8"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
        fontFamily="'Geist Mono',monospace"
      >
        {(tool[0] ?? "?").toUpperCase()}
      </text>
    </>
  );
}

export function ToolGlyph({ tool }: { tool: string }) {
  return (
    <svg
      className="chip-glyph"
      viewBox="0 0 14 14"
      width={13}
      height={13}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {GLYPHS[tool] ?? <FallbackInitial tool={tool} />}
    </svg>
  );
}
