// Pixel sword for anonymous donors on the wall — same 2×2-rect pixel art
// style as PixelHeart, currentColor so it follows the avatar palette.

const ROWS = [
  ".....XX",
  "....XXX",
  "...XXX.",
  "X.XXX..",
  "XXXX...",
  ".XX....",
  "XX.X...",
];

export function PixelSword({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 14 14" width={size} height={size} aria-hidden>
      {ROWS.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "X" ? (
            <rect key={`${x}-${y}`} x={x * 2} y={y * 2} width="2" height="2" fill="currentColor" />
          ) : null,
        ),
      )}
    </svg>
  );
}
