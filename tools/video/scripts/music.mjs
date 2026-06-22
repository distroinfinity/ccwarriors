// Synthesizes the launch-film EDM track from scratch (no samples, no licenses).
// 120 BPM, A minor, 43s — sections aligned to the film's scene cuts:
//   bar 0 intro · 1 build · 2-5 DROP1 (counter) · 6-9 groove (board) ·
//   10 breakdown · 11 build2 · 12-15 DROP2 (hero climb) · 16-17 sustain
//   (flurry) · 18-21.5 outro (CTA)
// Output: public/sfx/track.wav (16-bit stereo)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 48000;
const BPM = 120;
const BEAT = 60 / BPM; // 0.5s
const BAR = BEAT * 4; // 2s
const SIXT = BEAT / 4; // 0.125s
const TOTAL = 43;
const N = Math.ceil(TOTAL * SR);

const L = new Float64Array(N);
const R = new Float64Array(N);

const n2f = (m) => 440 * 2 ** ((m - 69) / 12);
// Am F C G — roots + triad voicings with smooth voice leading
const PROG = [
  { root: 33, triad: [57, 60, 64] }, // Am
  { root: 29, triad: [53, 57, 60] }, // F
  { root: 36, triad: [55, 60, 64] }, // C
  { root: 31, triad: [55, 59, 62] }, // G
];
const PENTA = [57, 60, 62, 64, 67, 69, 72, 74]; // A minor pentatonic spread

// ── deterministic noise ────────────────────────────────────────────────────
let seed = 0x9e3779b9;
const rand = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 4294967296) * 2 - 1;
};

// ── sidechain duck envelope (driven by drop/groove kick grid) ─────────────
const duck = new Float64Array(N).fill(1);
function duckAt(tKick) {
  const start = Math.floor(tKick * SR);
  const len = Math.floor(0.42 * SR);
  for (let i = 0; i < len && start + i < N; i++) {
    const p = i / len;
    const v = 0.22 + 0.78 * Math.min(1, p * p * 1.4);
    if (v < duck[start + i]) duck[start + i] = v;
  }
}

// ── voices ────────────────────────────────────────────────────────────────
function kick(t, vol = 1) {
  const start = Math.floor(t * SR);
  const dur = 0.34;
  let phase = 0;
  for (let i = 0; i < dur * SR && start + i < N; i++) {
    const tt = i / SR;
    const f = 46 + 130 * Math.exp(-tt * 22);
    phase += (2 * Math.PI * f) / SR;
    const click = tt < 0.004 ? rand() * 0.6 * (1 - tt / 0.004) : 0;
    const s = (Math.sin(phase) * Math.exp(-tt * 7.5) + click) * vol * 0.95;
    L[start + i] += s;
    R[start + i] += s;
  }
  duckAt(t);
}

function clap(t, vol = 0.5) {
  const start = Math.floor(t * SR);
  for (const off of [0, 0.012, 0.025]) {
    const o = Math.floor(off * SR);
    let lp = 0;
    for (let i = 0; i < 0.22 * SR && start + o + i < N; i++) {
      const tt = i / SR;
      const n = rand();
      lp += 0.25 * (n - lp); // crude band shaping
      const s = (n - lp) * Math.exp(-tt * 16) * vol * 0.5;
      L[start + o + i] += s * 0.9;
      R[start + o + i] += s * 1.1;
    }
  }
}

function hat(t, open = false, vol = 0.18) {
  const start = Math.floor(t * SR);
  const decay = open ? 9 : 48;
  let prev = 0;
  for (let i = 0; i < (open ? 0.3 : 0.07) * SR && start + i < N; i++) {
    const tt = i / SR;
    const n = rand();
    const hp = n - prev; // 1st-order highpass
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
    const body = Math.sin(2 * Math.PI * 190 * tt) * Math.exp(-tt * 30) * 0.6;
    const hp = lp - prev;
    prev = lp;
    const s = (hp * 4 * Math.exp(-tt * 22) + body) * vol;
    L[start + i] += s;
    R[start + i] += s;
  }
}

// saw with one-pole lowpass + duck
function sawNote(t, dur, freq, vol, cutoff, { detunes = [0], pan = 0, ducked = true, glideTo = 0 } = {}) {
  const start = Math.floor(t * SR);
  const phases = detunes.map(() => Math.random() * 0); // deterministic zero start
  let lp = 0;
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
  const gl = pan < 0 ? 1 : 1; // placeholder to keep signature simple
  for (let i = 0; i < dur * SR && start + i < N; i++) {
    const tt = i / SR;
    const f = glideTo > 0 ? freq * (glideTo / freq) ** Math.min(1, tt / dur) : freq;
    let s = 0;
    for (let d = 0; d < detunes.length; d++) {
      phases[d] = (phases[d] + (f * (1 + detunes[d])) / SR) % 1;
      s += phases[d] * 2 - 1;
    }
    s /= detunes.length;
    lp += a * (s - lp);
    const env = Math.min(1, tt / 0.01) * Math.exp(-tt * (3.2 / dur));
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

function pluck(t, freq, vol, pan = 0) {
  const start = Math.floor(t * SR);
  let phase = 0,
    lp = 0;
  const a = 1 - Math.exp((-2 * Math.PI * 3800) / SR);
  for (let i = 0; i < 0.3 * SR && start + i < N; i++) {
    const tt = i / SR;
    phase = (phase + freq / SR) % 1;
    const sq = phase < 0.5 ? 1 : -1;
    lp += a * (sq - lp);
    const s = lp * Math.exp(-tt * 14) * vol * duck[start + i];
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
  for (let i = 0; i < 1.2 * SR && start + i < N; i++) {
    const tt = i / SR;
    const f = 26 + 60 * Math.exp(-tt * 9);
    phase += (2 * Math.PI * f) / SR;
    const s = Math.sin(phase) * Math.exp(-tt * 3) * vol;
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
    const f = n2f(57) * 2 ** (p * 2); // A3 → A5 gliss
    phase = (phase + f / SR) % 1;
    const saw = (phase * 2 - 1) * 0.35;
    const env = p * p;
    const s = (lp * 0.8 + saw) * env * vol;
    L[start + i] += s * (1 - 0.3 * Math.sin(tt * 5));
    R[start + i] += s * (1 + 0.3 * Math.sin(tt * 5));
  }
}

// ── arrangement ───────────────────────────────────────────────────────────
const barT = (b) => b * BAR;
const chordOf = (b) => PROG[((b % 4) + 4) % 4];

// pre-place all kicks first so the duck envelope exists before melodic parts
const kickBars = [];
for (let b = 2; b <= 9; b++) kickBars.push(b);
for (let b = 12; b <= 17; b++) kickBars.push(b);
for (let b = 18; b <= 19; b++) kickBars.push(b);
for (const b of kickBars) for (let q = 0; q < 4; q++) kick(barT(b) + q * BEAT);

// intro: soft arp + sub + hat ticks (bar 0)
for (let b = 0; b < 1; b++) {
  subNote(barT(b), BAR, n2f(33), 0.22, false);
  for (let s = 0; s < 16; s += 2) {
    const note = PENTA[(s / 2 + b * 3) % PENTA.length];
    pluck(barT(b) + s * SIXT, n2f(note), 0.12, s % 4 === 0 ? -0.4 : 0.4);
    if (s % 4 === 2) hat(barT(b) + s * SIXT, false, 0.06);
  }
}

// build 1 (bar 1): snare roll + riser
riser(barT(1), BAR, 0.55);
subNote(barT(1), BAR, n2f(33), 0.24, false);
for (let s = 0; s < 16; s++) {
  const t = barT(1) + s * SIXT;
  const sub = s >= 12; // 32nds in the last beat
  snare(t, 0.16 + (s / 16) * 0.4);
  if (sub) snare(t + SIXT / 2, 0.3 + (s / 16) * 0.4);
  pluck(t, n2f(PENTA[s % PENTA.length] + (s >= 8 ? 12 : 0)), 0.16, s % 2 ? 0.4 : -0.4);
}

// DROP 1 (counter, bars 2-5) + groove (board, bars 6-9)
crash(barT(2), 0.4);
impact(barT(2), 0.85);
for (let b = 2; b <= 9; b++) {
  const ch = chordOf(b - 2);
  // rolling bass: 8ths, sub + saw layer
  for (let e = 0; e < 8; e++) {
    const t = barT(b) + e * BEAT * 0.5;
    subNote(t, BEAT * 0.46, n2f(ch.root), e % 2 ? 0.5 : 0.42);
    sawNote(t, BEAT * 0.4, n2f(ch.root + 12), 0.16, 700, { detunes: [0, 0.004] });
  }
  // offbeat supersaw stabs
  for (const e of [2, 6, 10, 14]) {
    const t = barT(b) + e * SIXT;
    for (const m of ch.triad) {
      sawNote(t, SIXT * 1.7, n2f(m), 0.11, b >= 7 ? 3200 : 2500, {
        detunes: [-0.008, -0.004, 0, 0.004, 0.008],
        pan: m % 2 ? 0.35 : -0.35,
      });
    }
    hat(t, false, 0.2);
  }
  clap(barT(b) + BEAT, 0.5);
  clap(barT(b) + 3 * BEAT, 0.5);
  hat(barT(b) + 3.5 * BEAT, true, 0.13);
  // groove bars add the 16th arp hook
  if (b >= 6) {
    const HOOK = [0, 2, 4, 3, 2, 0, 1, 0, 4, 3, 2, 3, 2, 1, 0, 1];
    for (let s = 0; s < 16; s++) {
      pluck(barT(b) + s * SIXT, n2f(PENTA[HOOK[s]] + 12), 0.13, s % 2 ? 0.45 : -0.45);
    }
  }
}

// breakdown (bar 10): pads, soft sub, sparse echo plucks
for (let b = 10; b <= 10; b++) {
  const ch = chordOf(0);
  for (const m of ch.triad) {
    sawNote(barT(b), BAR, n2f(m), 0.10, 1100, {
      detunes: [-0.006, 0, 0.006],
      pan: m % 2 ? 0.3 : -0.3,
      ducked: false,
    });
    sawNote(barT(b), BAR, n2f(m + 12), 0.05, 1600, {
      detunes: [-0.004, 0.004],
      pan: m % 2 ? -0.3 : 0.3,
      ducked: false,
    });
  }
  subNote(barT(b), BAR, n2f(ch.root), 0.3, false);
  for (const s of [0, 6, 11]) {
    pluck(barT(b) + s * SIXT, n2f(PENTA[(s + b) % PENTA.length] + 12), 0.14, s % 2 ? 0.5 : -0.5);
  }
}

// build 2 (bar 11): pads brighten + accelerating roll + big riser
riser(barT(11), BAR, 0.7);
for (let b = 11; b <= 11; b++) {
  const ch = chordOf(1);
  for (const m of ch.triad) {
    sawNote(barT(b), BAR, n2f(m), 0.12, 2600, {
      detunes: [-0.007, 0, 0.007],
      pan: m % 2 ? 0.3 : -0.3,
      ducked: false,
    });
  }
  subNote(barT(b), BAR, n2f(ch.root), 0.3, false);
  for (let s = 0; s < 16; s++) {
    const t = barT(b) + s * SIXT;
    snare(t, 0.16 + (s / 16) * 0.45);
    if (s >= 8) snare(t + SIXT / 2, 0.35 + (s / 16) * 0.3);
  }
}

// DROP 2 (hero climb, bars 12-15) + sustain (flurry, bars 16-17)
crash(barT(12), 0.45);
impact(barT(12), 0.95);
// 2-bar lead phrase (sixteenth grid, -1 = rest, values = PENTA index + octave up)
const LEAD = [
  [4, -1, 4, 3, -1, 2, -1, 3, 2, -1, 0, -1, 1, 2, 1, 0],
  [4, -1, 5, 4, -1, 3, -1, 2, 3, -1, 4, -1, 2, -1, 0, -1],
];
for (let b = 12; b <= 17; b++) {
  const ch = chordOf(b - 12);
  for (let e = 0; e < 8; e++) {
    const t = barT(b) + e * BEAT * 0.5;
    subNote(t, BEAT * 0.46, n2f(ch.root), e % 2 ? 0.52 : 0.44);
    sawNote(t, BEAT * 0.4, n2f(ch.root + 12), 0.18, 900, { detunes: [0, 0.004] });
  }
  for (const e of [2, 6, 10, 14]) {
    const t = barT(b) + e * SIXT;
    for (const m of ch.triad) {
      sawNote(t, SIXT * 1.7, n2f(m + 12), 0.10, 3800, {
        detunes: [-0.009, -0.0045, 0, 0.0045, 0.009],
        pan: m % 2 ? 0.4 : -0.4,
      });
    }
    hat(t, false, 0.22);
  }
  clap(barT(b) + BEAT, 0.55);
  clap(barT(b) + 3 * BEAT, 0.55);
  hat(barT(b) + 3.5 * BEAT, true, 0.15);
  const phrase = LEAD[(b - 12) % 2];
  for (let s = 0; s < 16; s++) {
    if (phrase[s] < 0) continue;
    const m = PENTA[phrase[s] % PENTA.length] + 12 + (b >= 16 && b % 2 ? 12 : 0);
    sawNote(barT(b) + s * SIXT, SIXT * 1.6, n2f(m), 0.15, 4500, {
      detunes: [-0.005, 0, 0.005],
      pan: s % 2 ? 0.25 : -0.25,
    });
  }
}

// outro (bars 18-21.5): final impact, fading groove, long tail
crash(barT(18), 0.4);
impact(barT(18), 0.9);
for (let b = 18; b <= 19; b++) {
  const ch = chordOf(b - 18);
  const fade = 1 - (b - 18) * 0.35;
  for (let e = 0; e < 8; e++) {
    subNote(barT(b) + e * BEAT * 0.5, BEAT * 0.46, n2f(ch.root), 0.4 * fade);
  }
  for (const e of [2, 6, 10, 14]) {
    const t = barT(b) + e * SIXT;
    for (const m of ch.triad) {
      sawNote(t, SIXT * 1.7, n2f(m), 0.09 * fade, 2400 - (b - 22) * 1200, {
        detunes: [-0.006, 0, 0.006],
        pan: m % 2 ? 0.3 : -0.3,
      });
    }
    hat(t, false, 0.14 * fade);
  }
  clap(barT(b) + BEAT, 0.4 * fade);
  clap(barT(b) + 3 * BEAT, 0.4 * fade);
}
// closing pad: Am held, slowly dying — under the domain lockup
for (const m of [45, 57, 60, 64]) {
  sawNote(barT(20), BAR * 1.5, n2f(m), m === 45 ? 0.16 : 0.08, 1100, {
    detunes: [-0.005, 0, 0.005],
    pan: m % 2 ? 0.25 : -0.25,
    ducked: false,
  });
}

// ── master: global fade-out tail, soft clip, write ────────────────────────
const fadeStart = Math.floor(40.5 * SR);
for (let i = fadeStart; i < N; i++) {
  const g = Math.max(0, 1 - (i - fadeStart) / (2.4 * SR));
  L[i] *= g;
  R[i] *= g;
}
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 1.15);
  R[i] = Math.tanh(R[i] * 1.15);
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
writeFileSync(join(dir, "track.wav"), out);
console.log(`track.wav written: ${TOTAL}s, peak-normalized (${norm.toFixed(2)}x)`);
