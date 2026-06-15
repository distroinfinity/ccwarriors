// Synthesizes the sound-design stems with ffmpeg — no licensed audio.
// Output: public/sfx/*.wav (48kHz mono), mixed into the Remotion timeline.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "../public/sfx");
mkdirSync(out, { recursive: true });

const gen = (name, args) => {
  execFileSync("ffmpeg", ["-y", ...args, join(out, name)], { stdio: "pipe" });
  console.log("✓", name);
};

// Low room hum — 55Hz + octave, slow tremolo
gen("hum.wav", [
  "-f", "lavfi",
  "-i", "aevalsrc=0.16*(sin(2*PI*55*t)+0.45*sin(2*PI*110*t))*(0.8+0.2*sin(2*PI*0.4*t)):d=8:s=48000",
  "-af", "lowpass=f=300,afade=t=in:d=0.8,afade=t=out:st=7:d=1",
]);

// Cinematic sub boom — pitch drop + fast decay
gen("boom.wav", [
  "-f", "lavfi",
  "-i", "aevalsrc=0.95*sin(2*PI*(150*exp(-7*t)+36)*t)*exp(-3.4*t):d=1.4:s=48000",
  "-af", "lowpass=f=320,volume=1.6",
]);

// Bigger terminal thump for the domain lockup
gen("thump.wav", [
  "-f", "lavfi",
  "-i", "aevalsrc=0.95*sin(2*PI*(190*exp(-6*t)+32)*t)*exp(-2.6*t):d=1.8:s=48000",
  "-af", "lowpass=f=280,volume=1.7",
]);

// Noise whoosh — band-passed swell
gen("whoosh.wav", [
  "-f", "lavfi",
  "-i", "anoisesrc=color=pink:d=1.1:sample_rate=48000:seed=7",
  "-af",
  "bandpass=f=750:w=900,afade=t=in:d=0.45:curve=exp,afade=t=out:st=0.5:d=0.6,volume=1.1",
]);

// Riser into a cut — filtered noise crescendo
gen("riser.wav", [
  "-f", "lavfi",
  "-i", "anoisesrc=color=pink:d=1.6:sample_rate=48000:seed=11",
  "-af", "highpass=f=300,lowpass=f=2400,afade=t=in:d=1.5:curve=cub,volume=0.9",
]);

// Tiny UI tick — for keystrokes and row arrivals
gen("tick.wav", [
  "-f", "lavfi",
  "-i", "aevalsrc=0.5*sin(2*PI*1700*t)*exp(-70*t):d=0.09:s=48000",
  "-af", "highpass=f=500",
]);
