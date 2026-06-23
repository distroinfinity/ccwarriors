// Subtle sound design for the Signal film — a soft typewriter key click and a
// light strike "swipe". Synthesized with ffmpeg, no samples.
// Output: public/sfx/keyclick.wav, public/sfx/strike.wav
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

// soft mechanical key click — short, mid-bright, quick decay
gen("keyclick.wav", [
  "-f", "lavfi",
  "-i", "anoisesrc=color=white:d=0.04:sample_rate=48000:seed=3",
  "-af", "bandpass=f=2300:w=1700,afade=t=out:st=0.004:d=0.032,volume=0.5",
]);

// light strike swipe — a short pink-noise "fwip" for the cross-outs
gen("strike.wav", [
  "-f", "lavfi",
  "-i", "anoisesrc=color=pink:d=0.14:sample_rate=48000:seed=5",
  "-af", "bandpass=f=1050:w=1500,afade=t=in:d=0.02,afade=t=out:st=0.05:d=0.085,volume=0.6",
]);
