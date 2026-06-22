import React from "react";
import { random, spring, useCurrentFrame, useVideoConfig } from "remotion";

// Pixel grid ported 1:1 from apps/web/src/components/ClawdLogo.tsx, but as
// pure data so the CTA can assemble the mascot pixel by pixel.
const OR = "#CC785C",
  BL = "#9aa6b3",
  BH = "#dfe6ec",
  ST = "#3f4854",
  GR = "#74471f",
  SH = "#aeb7c2",
  RM = "#434b56";
const CELL = 7,
  OX = 60,
  OY = 24;

export interface Px {
  c: number;
  r: number;
  col: string;
}

function buildPixels(): Px[] {
  const px: Px[] = [];
  const put = (c: number, r: number, col: string) => px.push({ c, r, col });
  const eye = (c: number, r: number) =>
    ((c === 4 || c === 5) && r >= 4 && r <= 7) || ((c === 18 || c === 19) && r >= 4 && r <= 7);
  for (let c = 0; c <= 23; c++) for (let r = 0; r <= 15; r++) if (!eye(c, r)) put(c, r, OR);
  for (let nr = 8; nr <= 11; nr++) {
    put(-2, nr, OR);
    put(-1, nr, OR);
    put(24, nr, OR);
    put(25, nr, OR);
  }
  for (const p of [
    [4, 5],
    [8, 9],
    [14, 15],
    [18, 19],
  ]) {
    for (let lr = 16; lr <= 19; lr++) {
      put(p[0]!, lr, OR);
      put(p[1]!, lr, OR);
    }
  }
  for (let b = -2; b <= 6; b++) {
    put(26, b, BH);
    put(27, b, BL);
  }
  for (const g of [25, 26, 27, 28]) put(g, 7, ST);
  for (let gr = 8; gr <= 10; gr++) {
    put(26, gr, GR);
    put(27, gr, GR);
  }
  put(26, 11, ST);
  put(27, 11, ST);
  const s = (c: number, r: number, rim: boolean) => put(c, r, rim ? RM : SH);
  s(-6, 6, true);
  s(-5, 6, true);
  s(-4, 6, true);
  for (let sr = 7; sr <= 11; sr++) {
    s(-7, sr, true);
    s(-6, sr, false);
    s(-5, sr, false);
    s(-4, sr, false);
    s(-3, sr, true);
  }
  s(-6, 12, true);
  s(-5, 12, false);
  s(-4, 12, true);
  s(-5, 13, true);
  for (const p of [
    [-5, 8],
    [-6, 9],
    [-5, 9],
    [-4, 9],
    [-5, 10],
  ]) {
    put(p[0]!, p[1]!, OR);
  }
  return px;
}

export const PIXELS = buildPixels();

/**
 * Clawd that assembles pixel-by-pixel: each rect springs in, staggered by
 * distance from the face center plus deterministic jitter.
 */
export const ClawdAssemble: React.FC<{ startFrame?: number; width: number }> = ({
  startFrame = 0,
  width,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <svg viewBox="0 0 280 210" style={{ width, display: "block", imageRendering: "pixelated" }}>
      {PIXELS.map((p, i) => {
        const dist = Math.abs(p.c - 11) + Math.abs(p.r - 8);
        const delay = startFrame + dist * 0.9 + random(`cl${i}`) * 6;
        const sc = spring({ frame: frame - delay, fps, config: { damping: 13, mass: 0.4 } });
        if (sc < 0.01) return null;
        return (
          <rect
            key={i}
            x={OX + p.c * CELL}
            y={OY + p.r * CELL}
            width={CELL + 0.4}
            height={CELL + 0.4}
            fill={p.col}
            style={{
              transform: `scale(${sc})`,
              transformBox: "fill-box",
              transformOrigin: "center",
            }}
          />
        );
      })}
    </svg>
  );
};
