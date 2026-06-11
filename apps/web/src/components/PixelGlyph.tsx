// Pixel-art UI glyphs — same rect-grid language as ClawdLogo/PixelHeart,
// drawn in currentColor so they follow text color and theme. Replaces every
// literal unicode/emoji glyph in the UI (design rule: no plain emojis).

const GLYPHS: Record<string, string[]> = {
  // Theme toggle
  sun: [
    "....X....",
    ".X..X..X.",
    "..XXXXX..",
    ".XX...XX.",
    "XXX.X.XXX",
    ".XX...XX.",
    "..XXXXX..",
    ".X..X..X.",
    "....X....",
  ],
  moon: [
    "..XXXXX..",
    ".XXXXX...",
    "XXXXX....",
    "XXXX.....",
    "XXXX.....",
    "XXXX.....",
    "XXXXX....",
    ".XXXXX...",
    "..XXXXX..",
  ],
  // End-of-board sword (Clawd's weapon, pointing up)
  sword: [
    "....X....",
    "....X....",
    "....X....",
    "....X....",
    "....X....",
    "..XXXXX..",
    "....X....",
    "...XXX...",
  ],
  // Org-step done
  check: [
    ".......X.",
    "......XX.",
    ".....XX..",
    "X...XX...",
    "XX.XX....",
    ".XXX.....",
    "..X......",
  ],
  // Dismiss
  x: [
    "X.....X",
    ".X...X.",
    "..X.X..",
    "...X...",
    "..X.X..",
    ".X...X.",
    "X.....X",
  ],
  // Under-review scale
  scale: [
    "....X....",
    ".XXXXXXX.",
    ".X..X..X.",
    "X.X.X.X.X",
    "XXX.X.XXX",
    "....X....",
    "....X....",
    "..XXXXX..",
  ],
  // Outdated-client refresh (circular arrow)
  refresh: [
    "..XXXX...",
    ".X....X..",
    "X......XX",
    "X.....XXX",
    "X......X.",
    "X........",
    ".X.....X.",
    "..XXXXX..",
  ],
  // Verify diamond (◈)
  diamond: [
    "....X....",
    "...XXX...",
    "..XX.XX..",
    ".XX.X.XX.",
    "XX.XXX.XX",
    ".XX.X.XX.",
    "..XX.XX..",
    "...XXX...",
    "....X....",
  ],
};

export type PixelGlyphName = keyof typeof GLYPHS;

export function PixelGlyph({
  name,
  size = 14,
  className,
}: {
  name: PixelGlyphName;
  size?: number;
  className?: string;
}) {
  const rows = GLYPHS[name] ?? [];
  const w = rows[0]?.length ?? 1;
  const h = rows.length || 1;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={size}
      height={Math.round((size * h) / w)}
      className={className}
      aria-hidden="true"
      style={{ imageRendering: "pixelated" }}
    >
      {rows.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "X" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" /> : null,
        ),
      )}
    </svg>
  );
}
