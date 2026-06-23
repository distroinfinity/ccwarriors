// Modern, punchy electronic bed for "The New Signal" — bright plucky arp, tight
// kick, crisp hats, warm sub. Fresh dev-launch energy (NOT cinematic/ambient).
// Sits under the voiceover (ducked in the mix). ~57s. Synthesized, no samples.
// Output: public/sfx/signal-music.wav (16-bit stereo)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 48000;
const BPM = 120;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const SIXT = BEAT / 4;
const DUR = 57;
const N = Math.ceil(DUR * SR);
const L = new Float64Array(N);
const R = new Float64Array(N);
const n2f = (m) => 440 * 2 ** ((m - 69) / 12);

let seed = 0x2f9a13c7;
const rnd = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 4294967296) * 2 - 1;
};

// Bright, hopeful, modern: A · E · F#m · D  (I–V–vi–IV in A major)
const PROG = [
  { root: 45, triad: [57, 61, 64] },
  { root: 40, triad: [56, 59, 64] },
  { root: 42, triad: [54, 57, 61] },
  { root: 38, triad: [50, 54, 57] },
];
const PENTA = [57, 59, 61, 64, 66, 69, 71, 73]; // A major pentatonic
const ARP = [0, 2, 4, 2, 4, 5, 4, 2, 1, 3, 5, 3, 5, 6, 5, 3];

const barT = (b) => b * BAR;
const chordOf = (b) => PROG[((b % 4) + 4) % 4];

function kick(t, vol = 1) {
  const s = Math.floor(t * SR);
  let ph = 0;
  for (let i = 0; i < 0.3 * SR && s + i < N; i++) {
    const tt = i / SR;
    const f = 50 + 110 * Math.exp(-tt * 24);
    ph += (2 * Math.PI * f) / SR;
    const click = tt < 0.003 ? rnd() * 0.5 * (1 - tt / 0.003) : 0;
    const v = (Math.sin(ph) * Math.exp(-tt * 8) + click) * vol * 0.9;
    L[s + i] += v;
    R[s + i] += v;
  }
}
function hat(t, open, vol) {
  const s = Math.floor(t * SR);
  const dec = open ? 10 : 55;
  let prev = 0;
  for (let i = 0; i < (open ? 0.22 : 0.05) * SR && s + i < N; i++) {
    const tt = i / SR;
    const n = rnd();
    const hp = n - prev;
    prev = n;
    const v = hp * Math.exp(-tt * dec) * vol;
    L[s + i] += v * 0.8;
    R[s + i] += v * 1.1;
  }
}
function clap(t, vol) {
  const s = Math.floor(t * SR);
  for (const off of [0, 0.01, 0.02]) {
    const o = Math.floor(off * SR);
    let lp = 0;
    for (let i = 0; i < 0.18 * SR && s + o + i < N; i++) {
      const tt = i / SR;
      const n = rnd();
      lp += 0.25 * (n - lp);
      const v = (n - lp) * Math.exp(-tt * 17) * vol * 0.5;
      L[s + o + i] += v * 0.9;
      R[s + o + i] += v * 1.1;
    }
  }
}
function sub(t, dur, freq, vol) {
  const s = Math.floor(t * SR);
  let ph = 0;
  for (let i = 0; i < dur * SR && s + i < N; i++) {
    const tt = i / SR;
    ph += (2 * Math.PI * freq) / SR;
    const env = Math.min(1, tt / 0.006) * Math.min(1, Math.max(0, (dur - tt) / 0.04));
    const v = Math.sin(ph) * env * vol;
    L[s + i] += v;
    R[s + i] += v;
  }
}
function pluck(t, freq, vol, pan = 0) {
  const s = Math.floor(t * SR);
  let ph = 0, lp = 0;
  const a = 1 - Math.exp((-2 * Math.PI * 4200) / SR);
  for (let i = 0; i < 0.26 * SR && s + i < N; i++) {
    const tt = i / SR;
    ph = (ph + freq / SR) % 1;
    const sq = ph < 0.5 ? 1 : -1;
    lp += a * (sq - lp);
    const v = lp * Math.exp(-tt * 13) * vol;
    L[s + i] += v * (1 - Math.max(0, pan));
    R[s + i] += v * (1 + Math.min(0, pan));
  }
}
function pad(t, dur, freq, vol, cutoff, pan) {
  const s = Math.floor(t * SR);
  const det = [-0.005, 0, 0.005];
  const ph = det.map(() => 0);
  let lp = 0;
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
  for (let i = 0; i < dur * SR && s + i < N; i++) {
    const tt = i / SR;
    let x = 0;
    for (let d = 0; d < det.length; d++) {
      ph[d] = (ph[d] + (freq * (1 + det[d])) / SR) % 1;
      x += ph[d] * 2 - 1;
    }
    x /= det.length;
    lp += a * (x - lp);
    const env = Math.min(1, tt / 0.4) * Math.min(1, Math.max(0, (dur - tt) / 0.5));
    const v = lp * env * vol;
    L[s + i] += v * (1 - Math.max(0, pan));
    R[s + i] += v * (1 + Math.min(0, pan));
  }
}

const NB = Math.floor(DUR / BAR); // ~28 bars
const GROOVE_IN = 7; // beat enters ~14s (the code reveal)
const OUTRO = 25; // drums out for the close

for (let b = 0; b < NB; b++) {
  const ch = chordOf(b);
  const groove = b >= GROOVE_IN && b < OUTRO;

  // warm pad under everything (quiet)
  for (const m of ch.triad) pad(barT(b), BAR * 1.02, n2f(m), 0.05, 1300, m % 2 ? 0.25 : -0.25);

  // bright pluck arp — runs throughout (sparser in intro)
  const oct = b >= 18 ? 12 : 0; // lift an octave later (profile reveal / CTA)
  for (let stp = 0; stp < 16; stp++) {
    const intro = b < GROOVE_IN;
    if (intro && stp % 2 !== 0) continue; // 8ths in intro, 16ths in groove
    const note = PENTA[ARP[stp] % PENTA.length] + 12 + oct;
    pluck(barT(b) + stp * SIXT, n2f(note), intro ? 0.1 : 0.12, stp % 2 ? 0.4 : -0.4);
  }

  if (groove) {
    for (let q = 0; q < 4; q++) kick(barT(b) + q * BEAT, 0.95);
    for (let e = 0; e < 8; e++) sub(barT(b) + e * BEAT * 0.5, BEAT * 0.46, n2f(ch.root), e % 2 ? 0.32 : 0.26);
    clap(barT(b) + BEAT, 0.4);
    clap(barT(b) + 3 * BEAT, 0.4);
    for (const e of [1, 3, 5, 7]) hat(barT(b) + e * BEAT * 0.5 + SIXT, e === 3 || e === 7, 0.12);
    for (const e of [2, 6, 10, 14]) hat(barT(b) + e * SIXT, false, 0.08);
  } else {
    // intro/outro: just a soft offbeat hat to keep pulse
    if (b >= 2) for (const e of [2, 6, 10, 14]) hat(barT(b) + e * SIXT, false, 0.06);
  }
}

// master: soft fades + light glue
const fadeIn = 1.0 * SR;
const fadeOut = 2.2 * SR;
for (let i = 0; i < N; i++) {
  let g = 1;
  if (i < fadeIn) g = i / fadeIn;
  if (i > N - fadeOut) g = Math.min(g, (N - i) / fadeOut);
  L[i] = Math.tanh(L[i] * g * 1.1);
  R[i] = Math.tanh(R[i] * g * 1.1);
}
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const norm = 0.9 / peak;

const out = Buffer.alloc(44 + N * 4);
out.write("RIFF", 0);
out.writeUInt32LE(36 + N * 4, 4);
out.write("WAVEfmt ", 8);
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20);
out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * 4, 28);
out.writeUInt16LE(4, 32);
out.writeUInt16LE(16, 34);
out.write("data", 36);
out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), 46 + i * 4);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), "../public/sfx");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "signal-music.wav"), out);
console.log(`signal-music.wav written: ${DUR}s modern groove (norm ${norm.toFixed(2)}x)`);
