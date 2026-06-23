import React from "react";
import { Audio, Sequence, staticFile } from "remotion";

// Audio: a modern electronic bed + the female voiceover as per-beat segments.
// The bed DUCKS under each VO line (sidechain-style) so the voice is always
// clearly audible, and returns to full in the gaps.
const vo = (n: string) => staticFile(`sfx/vo/${n}.wav`);

// [global start frame, segment]
const CUES: [number, string][] = [
  [14, "01_resume"],
  [135, "02_stars"],
  [232, "03_years"],
  [312, "04_turn"],
  [425, "05_meet"],
  [735, "06_signal"],
  [955, "07_board"],
  [1180, "08_page"],
  [1490, "09_cta"],
];

// VO [start, end] windows (frames) for ducking the music.
const DUCK: [number, number][] = [
  [14, 124], [135, 221], [232, 295], [312, 408], [425, 689],
  [735, 932], [955, 1107], [1180, 1399], [1490, 1594],
];
const FULL = 0.44;
const LOW = 0.08;
const RIN = 10;
const ROUT = 18;

const musicVol = (f: number) => {
  let d = 0;
  for (const [a, b] of DUCK) {
    let x = 0;
    if (f >= a && f <= b) x = 1;
    else if (f >= a - RIN && f < a) x = (f - (a - RIN)) / RIN;
    else if (f > b && f <= b + ROUT) x = 1 - (f - b) / ROUT;
    if (x > d) d = x;
  }
  return FULL - (FULL - LOW) * d;
};

// Subtle typewriter texture — soft key clicks across the typing windows and a
// light swipe on each cross-out. Sparse and quiet; sits under VO + music.
const range = (start: number, end: number, step: number) => {
  const a: number[] = [];
  for (let f = start; f < end; f += step) a.push(f);
  return a;
};
const KEYS = [
  ...range(8, 76, 5), // cold-open comment
  ...range(40, 53, 3), // résumé
  ...range(150, 163, 3), // stars
  ...range(238, 251, 3), // years
  ...range(416, 600, 6), // the code block
  ...range(1472, 1536, 5), // CTA tagline
];
const STRIKES = [100, 200, 268]; // résumé / stars / years cross-outs

export const SignalScore: React.FC = () => (
  <>
    <Audio src={staticFile("sfx/signal-music.wav")} volume={(f) => musicVol(f)} />
    {CUES.map(([f, n]) => (
      <Sequence key={n} from={f}>
        <Audio src={vo(n)} volume={1} />
      </Sequence>
    ))}
    {KEYS.map((f, i) => (
      <Sequence key={`k${i}`} from={f} durationInFrames={5}>
        <Audio src={staticFile("sfx/keyclick.wav")} volume={0.14} playbackRate={0.94 + (i % 4) * 0.04} />
      </Sequence>
    ))}
    {STRIKES.map((f, i) => (
      <Sequence key={`s${i}`} from={f} durationInFrames={8}>
        <Audio src={staticFile("sfx/strike.wav")} volume={0.26} />
      </Sequence>
    ))}
  </>
);
