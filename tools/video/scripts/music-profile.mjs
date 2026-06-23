// Profile-teaser music — synthesized from scratch (no samples). Deliberately a
// DIFFERENT song from the leaderboard track: E-minor, an Em–C–G–D anthem with a
// warm bell/marimba lead and sustained pads instead of the aggressive supersaw
// stabs. Still 120 BPM so every cut lands on a bar; the two big drops hit the
// masthead (4s) and the Craft reveal (12s).
// Output: public/sfx/track-profile.wav (16-bit stereo)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 48000;
const BPM = 120;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const SIXT = BEAT / 4;
const TOTAL = 40;
const N = Math.ceil(TOTAL * SR);

const L = new Float64Array(N);
const R = new Float64Array(N);

const n2f = (m) => 440 * 2 ** ((m - 69) / 12);

// E minor anthem: Em – C – G – D (i – VI – III – VII), melodic bass.
const PROG = [
  { root: 40, triad: [52, 55, 59] }, // Em  (E2 · E3 G3 B3)
  { root: 36, triad: [48, 52, 55] }, // C   (C2 · C3 E3 G3)
  { root: 43, triad: [50, 55, 59] }, // G   (G2 · D3 G3 B3)
  { root: 38, triad: [50, 54, 57] }, // D   (D2 · D3 F#3 A3)
];
// E minor pentatonic spread for the bell lead/arps.
const PENTA = [52, 55, 57, 59, 62, 64, 67, 69]; // E3 G3 A3 B3 D4 E4 G4 A4

let seed = 0x1f2e3d4c;
const rand = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 4294967296) * 2 - 1;
};

const duck = new Float64Array(N).fill(1);
function duckAt(tKick) {
  const start = Math.floor(tKick * SR);
  const len = Math.floor(0.4 * SR);
  for (let i = 0; i < len && start + i < N; i++) {
    const p = i / len;
    const v = 0.28 + 0.72 * Math.min(1, p * p * 1.4);
    if (v < duck[start + i]) duck[start + i] = v;
  }
}

function kick(t, vol = 1) {
  const start = Math.floor(t * SR);
  let phase = 0;
  for (let i = 0; i < 0.34 * SR && start + i < N; i++) {
    const tt = i / SR;
    const f = 48 + 120 * Math.exp(-tt * 20);
    phase += (2 * Math.PI * f) / SR;
    const click = tt < 0.004 ? rand() * 0.55 * (1 - tt / 0.004) : 0;
    const s = (Math.sin(phase) * Math.exp(-tt * 7) + click) * vol * 0.95;
    L[start + i] += s;
    R[start + i] += s;
  }
  duckAt(t);
}

function clap(t, vol = 0.5) {
  const start = Math.floor(t * SR);
  for (const off of [0, 0.011, 0.023]) {
    const o = Math.floor(off * SR);
    let lp = 0;
    for (let i = 0; i < 0.22 * SR && start + o + i < N; i++) {
      const tt = i / SR;
      const n = rand();
      lp += 0.25 * (n - lp);
      const s = (n - lp) * Math.exp(-tt * 15) * vol * 0.5;
      L[start + o + i] += s * 0.9;
      R[start + o + i] += s * 1.1;
    }
  }
}

function hat(t, open = false, vol = 0.16) {
  const start = Math.floor(t * SR);
  const decay = open ? 9 : 46;
  let prev = 0;
  for (let i = 0; i < (open ? 0.3 : 0.07) * SR && start + i < N; i++) {
    const tt = i / SR;
    const n = rand();
    const hp = n - prev;
    prev = n;
    const s = hp * Math.exp(-tt * decay) * vol;
    L[start + i] += s * 0.7;
    R[start + i] += s * 1.2;
  }
}

function snare(t, vol = 0.5) {
  const start = Math.floor(t * SR);
  let lp = 0,
    prev = 0;
  for (let i = 0; i < 0.16 * SR && start + i < N; i++) {
    const tt = i / SR;
    const n = rand();
    lp += 0.18 * (n - lp);
    const body = Math.sin(2 * Math.PI * 185 * tt) * Math.exp(-tt * 30) * 0.55;
    const hp = lp - prev;
    prev = lp;
    const s = (hp * 4 * Math.exp(-tt * 22) + body) * vol;
    L[start + i] += s;
    R[start + i] += s;
  }
}

// warm saw used only for pads (low cutoff, no duck) — never as a stab
function saw(t, dur, freq, vol, cutoff, { detunes = [0], pan = 0, ducked = false } = {}) {
  const start = Math.floor(t * SR);
  const phases = detunes.map(() => 0);
  let lp = 0;
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
  for (let i = 0; i < dur * SR && start + i < N; i++) {
    const tt = i / SR;
    let s = 0;
    for (let d = 0; d < detunes.length; d++) {
      phases[d] = (phases[d] + (freq * (1 + detunes[d])) / SR) % 1;
      s += phases[d] * 2 - 1;
    }
    s /= detunes.length;
    lp += a * (s - lp);
    const env = Math.min(1, tt / 0.05) * Math.min(1, Math.max(0, (dur - tt) / 0.2));
    let out = lp * env * vol;
    if (ducked) out *= duck[start + i];
    L[start + i] += out * (1 - Math.max(0, pan));
    R[start + i] += out * (1 + Math.min(0, pan));
  }
}

function subNote(t, dur, freq, vol, ducked = true) {
  const start = Math.floor(t * SR);
  let phase = 0;
  for (let i = 0; i < dur * SR && start + i < N; i++) {
    const tt = i / SR;
    phase += (2 * Math.PI * freq) / SR;
    const env = Math.min(1, tt / 0.008) * Math.min(1, Math.max(0, (dur - tt) / 0.05));
    let s = Math.sin(phase) * env * vol;
    if (ducked) s *= duck[start + i];
    L[start + i] += s;
    R[start + i] += s;
  }
}

// Bell / marimba lead: sine fundamental + quick-decaying harmonics. The voice
// that makes this track its own thing.
function bell(t, freq, vol, pan = 0) {
  const start = Math.floor(t * SR);
  let p1 = 0,
    p2 = 0,
    p3 = 0;
  for (let i = 0; i < 0.7 * SR && start + i < N; i++) {
    const tt = i / SR;
    p1 += (2 * Math.PI * freq) / SR;
    p2 += (2 * Math.PI * freq * 2) / SR;
    p3 += (2 * Math.PI * freq * 3.01) / SR;
    const env = Math.min(1, tt / 0.004) * Math.exp(-tt * 4.2);
    const s =
      (Math.sin(p1) + 0.34 * Math.sin(p2) * Math.exp(-tt * 7) + 0.12 * Math.sin(p3) * Math.exp(-tt * 11)) *
      env *
      vol *
      duck[start + i];
    L[start + i] += s * (1 - Math.max(0, pan));
    R[start + i] += s * (1 + Math.min(0, pan));
  }
}

function crash(t, vol = 0.35) {
  const start = Math.floor(t * SR);
  let prev = 0;
  for (let i = 0; i < 1.8 * SR && start + i < N; i++) {
    const tt = i / SR;
    const n = rand();
    const hp = n - prev;
    prev = n;
    const s = hp * Math.exp(-tt * 2.4) * vol;
    L[start + i] += s * 1.1;
    R[start + i] += s * 0.9;
  }
}

function impact(t, vol = 0.8) {
  const start = Math.floor(t * SR);
  let phase = 0;
  for (let i = 0; i < 1.3 * SR && start + i < N; i++) {
    const tt = i / SR;
    const f = 28 + 64 * Math.exp(-tt * 8);
    phase += (2 * Math.PI * f) / SR;
    const s = Math.sin(phase) * Math.exp(-tt * 2.8) * vol;
    L[start + i] += s;
    R[start + i] += s;
  }
  crash(t, 0.3);
}

function riser(t, dur, vol = 0.5) {
  const start = Math.floor(t * SR);
  let lp = 0,
    phase = 0;
  for (let i = 0; i < dur * SR && start + i < N; i++) {
    const p = i / (dur * SR);
    const tt = i / SR;
    const cutoff = 250 * (8000 / 250) ** p;
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
    lp += a * (rand() - lp);
    const f = n2f(52) * 2 ** (p * 2);
    phase = (phase + f / SR) % 1;
    const sawv = (phase * 2 - 1) * 0.35;
    const env = p * p;
    const s = (lp * 0.8 + sawv) * env * vol;
    L[start + i] += s * (1 - 0.3 * Math.sin(tt * 5));
    R[start + i] += s * (1 + 0.3 * Math.sin(tt * 5));
  }
}

const barT = (b) => b * BAR;
const chordOf = (b) => PROG[((b % 4) + 4) % 4];

// A singable pentatonic anthem motif (16th grid, -1 = rest) — two phrases.
const MOTIF_A = [4, -1, -1, 2, 5, -1, 4, -1, 2, -1, -1, 3, 4, -1, -1, -1];
const MOTIF_B = [3, -1, -1, 1, 4, -1, 2, -1, 0, -1, -1, 2, 3, -1, 4, -1];

function pad(b, vol = 0.1, cutoff = 1300) {
  const ch = chordOf(b);
  for (const m of ch.triad) {
    saw(barT(b), BAR, n2f(m), vol, cutoff, { detunes: [-0.006, 0, 0.006], pan: m % 2 ? 0.3 : -0.3 });
    saw(barT(b), BAR, n2f(m + 12), vol * 0.45, cutoff + 500, { detunes: [-0.004, 0.004], pan: m % 2 ? -0.25 : 0.25 });
  }
}

function bassline(b, vol = 0.5) {
  const ch = chordOf(b);
  for (let e = 0; e < 8; e++) {
    const t = barT(b) + e * BEAT * 0.5;
    subNote(t, BEAT * 0.46, n2f(ch.root), e % 2 ? vol : vol * 0.82);
  }
}

function beat(b, { clapVol = 0.5, ohVol = 0.13 } = {}) {
  clap(barT(b) + BEAT, clapVol);
  clap(barT(b) + 3 * BEAT, clapVol);
  for (const e of [2, 6, 10, 14]) hat(barT(b) + e * SIXT, false, 0.14);
  hat(barT(b) + 3.5 * BEAT, true, ohVol);
}

function motif(b, phrase, vol = 0.22, oct = 12) {
  for (let s = 0; s < 16; s++) {
    if (phrase[s] < 0) continue;
    const m = PENTA[phrase[s] % PENTA.length] + oct;
    bell(barT(b) + s * SIXT, n2f(m), vol, s % 2 ? 0.2 : -0.2);
  }
}

// ── pre-place kicks so the duck envelope exists before melodic parts ──
const kickBars = [2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
for (const b of kickBars) for (let q = 0; q < 4; q++) kick(barT(b) + q * BEAT);

// intro (bar 0): pad + a soft rising bell arpeggio
pad(0, 0.08, 1000);
subNote(barT(0), BAR, n2f(chordOf(0).root), 0.2, false);
for (let s = 0; s < 16; s += 2) {
  bell(barT(0) + s * SIXT, n2f(PENTA[(s / 2) % PENTA.length] + 12), 0.1, s % 4 === 0 ? -0.4 : 0.4);
}

// build 1 (bar 1): riser + snare roll + rising bells → DROP1
riser(barT(1), BAR, 0.55);
pad(1, 0.09, 1500);
subNote(barT(1), BAR, n2f(chordOf(1).root), 0.22, false);
for (let s = 0; s < 16; s++) {
  snare(barT(1) + s * SIXT, 0.16 + (s / 16) * 0.4);
  if (s >= 12) snare(barT(1) + s * SIXT + SIXT / 2, 0.3 + (s / 16) * 0.4);
  bell(barT(1) + s * SIXT, n2f(PENTA[s % PENTA.length] + (s >= 8 ? 24 : 12)), 0.1, s % 2 ? 0.4 : -0.4);
}

// DROP 1 (masthead, bars 2-4)
crash(barT(2), 0.42);
impact(barT(2), 0.95);
for (let b = 2; b <= 4; b++) {
  bassline(b, 0.5);
  pad(b, 0.11, 1600);
  beat(b);
}
motif(3, MOTIF_A, 0.17, 12);
motif(4, MOTIF_B, 0.17, 12);

// build 2 (bar 5): pad swell + accelerating roll + big riser → DROP2
riser(barT(5), BAR, 0.72);
pad(5, 0.13, 2400);
subNote(barT(5), BAR, n2f(chordOf(5).root), 0.28, false);
for (let s = 0; s < 16; s++) {
  snare(barT(5) + s * SIXT, 0.16 + (s / 16) * 0.45);
  if (s >= 8) snare(barT(5) + s * SIXT + SIXT / 2, 0.35 + (s / 16) * 0.3);
}

// DROP 2 (craft hero, bars 6-11) — the anthem peak: bell motif leads over pads
crash(barT(6), 0.5);
impact(barT(6), 1.05);
for (let b = 6; b <= 11; b++) {
  bassline(b, 0.52);
  pad(b, 0.13, 1900);
  beat(b, { clapVol: 0.55 });
  motif(b, (b - 6) % 2 ? MOTIF_B : MOTIF_A, 0.26, 12);
}

// sustain (flurry, bars 12-15) — keep the anthem moving, a touch lighter
for (let b = 12; b <= 15; b++) {
  bassline(b, 0.46);
  pad(b, 0.1, 1600);
  beat(b, { clapVol: 0.46 });
  motif(b, b % 2 ? MOTIF_B : MOTIF_A, 0.18, 12);
}

// outro (CTA, bars 16-17): final impact, resolving groove
crash(barT(16), 0.42);
impact(barT(16), 0.92);
for (let b = 16; b <= 17; b++) {
  const fade = 1 - (b - 16) * 0.4;
  bassline(b, 0.4 * fade);
  pad(b, 0.1 * fade, 1300);
  beat(b, { clapVol: 0.36 * fade });
}

// tail (bars 18-19): Em resolution held, bells ring out under the lockup
for (const m of [40, 52, 55, 59, 64]) {
  saw(barT(18), BAR * 1.5, n2f(m), m === 40 ? 0.17 : 0.07, 1000, { detunes: [-0.005, 0, 0.005], pan: m % 2 ? 0.25 : -0.25 });
}
bell(barT(18), n2f(64), 0.18, -0.2);
bell(barT(18) + 2 * BEAT, n2f(67), 0.13, 0.2);
bell(barT(18) + 4 * BEAT, n2f(71), 0.1, 0);

// ── master: global fade-out tail, soft clip, write ──
const fadeStart = Math.floor(37.5 * SR);
for (let i = fadeStart; i < N; i++) {
  const g = Math.max(0, 1 - (i - fadeStart) / (2.4 * SR));
  L[i] *= g;
  R[i] *= g;
}
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 1.1);
  R[i] = Math.tanh(R[i] * 1.1);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.94 / peak;

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
writeFileSync(join(dir, "track-profile.wav"), out);
console.log(`track-profile.wav written: ${TOTAL}s E-minor anthem, peak-normalized (${norm.toFixed(2)}x)`);
