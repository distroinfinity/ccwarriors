// Deterministic halftone dot-matrix — the signature texture of every insight
// card. Seeded by the card key so each card carries a stable, distinct
// "topographic" field of terracotta dots, echoing YC Paxel's halftone look.
//
// How it works: a 32-bit hash of the seed feeds mulberry32 (a tiny, fast PRNG).
// That PRNG lays down a small lattice of random heights; we bilinearly
// interpolate the lattice into a smooth value-noise field sampled over the dot
// grid (so dots flow in soft ridges instead of TV static). The noise value at
// each cell maps to a dot radius — values below a floor collapse to nothing,
// the rest swell toward full — giving the blobby, ink-bled Paxel matrix.
//
// Pure SVG of <circle>s: crisp at any scale, captured cleanly by html-to-image,
// no animation, cheap to render (~24x14 dots).

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0; // FNV-1a basis
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

const smooth = (t: number) => t * t * (3 - 2 * t); // smoothstep ease

/** Bilinearly-interpolated value noise sampled on a LW x LH random lattice. */
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

export interface HalftoneProps {
  seed: string;
  cols?: number;
  rows?: number;
  className?: string;
}

export function Halftone({ seed, cols = 24, rows = 14, className }: HalftoneProps) {
  const rand = mulberry32(hashSeed(seed));
  // Lattice coarseness also varies per seed so some cards ripple, some pool.
  const lw = 2 + Math.floor(rand() * 3); // 2..4
  const lh = 2 + Math.floor(rand() * 2); // 2..3
  const noise = makeNoise(rand, lw, lh);
  // Per-seed phase nudges the field so two similar keys still diverge.
  const ox = rand();
  const oy = rand();

  const cell = 10; // viewBox units per cell
  const w = cols * cell;
  const h = rows * cell;
  const maxR = cell * 0.62;

  const dots: Array<{ cx: number; cy: number; r: number }> = [];
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const u = (gx + 0.5) / cols;
      const v = (gy + 0.5) / rows;
      let n = noise((u + ox) % 1, (v + oy) % 1);
      // Floor: collapse the low third so the field reads as blobs, not a wash.
      n = n < 0.34 ? 0 : (n - 0.34) / 0.66;
      const r = Math.pow(n, 1.35) * maxR; // ease the swell toward full
      if (r < 0.45) continue; // skip near-zero dots (keeps the SVG lean)
      dots.push({ cx: gx * cell + cell / 2, cy: gy * cell + cell / 2, r });
    }
  }

  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {dots.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill="var(--or)" />
      ))}
    </svg>
  );
}
