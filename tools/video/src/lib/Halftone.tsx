import React from "react";
import { C } from "./brand";

// Deterministic halftone dot-matrix — ported 1:1 from apps/web Halftone.tsx so
// the deck cards carry the same terracotta "wax seal" texture in the film.
function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function makeNoise(rand: () => number, lw: number, lh: number) {
  const lattice: number[] = [];
  for (let i = 0; i < (lw + 1) * (lh + 1); i++) lattice.push(rand());
  return (u: number, v: number): number => {
    const x = u * lw;
    const y = v * lh;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const at = (gx: number, gy: number) => lattice[gy * (lw + 1) + gx] ?? 0;
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bot * fy;
  };
}

export const Halftone: React.FC<{ seed: string; cols?: number; rows?: number }> = ({ seed, cols = 24, rows = 14 }) => {
  const rand = mulberry32(hashSeed(seed));
  const lw = 2 + Math.floor(rand() * 3);
  const lh = 2 + Math.floor(rand() * 2);
  const noise = makeNoise(rand, lw, lh);
  const ox = rand();
  const oy = rand();

  const cell = 10;
  const w = cols * cell;
  const h = rows * cell;
  const maxR = cell * 0.62;

  const dots: Array<{ cx: number; cy: number; r: number }> = [];
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const u = (gx + 0.5) / cols;
      const v = (gy + 0.5) / rows;
      let n = noise((u + ox) % 1, (v + oy) % 1);
      n = n < 0.34 ? 0 : (n - 0.34) / 0.66;
      const r = Math.pow(n, 1.35) * maxR;
      if (r < 0.45) continue;
      dots.push({ cx: gx * cell + cell / 2, cy: gy * cell + cell / 2, r });
    }
  }

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.4 }}>
      {dots.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill={C.or} />
      ))}
    </svg>
  );
};
