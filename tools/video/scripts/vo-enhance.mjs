// Clarity/broadcast pass on the voiceover segments: high-pass rumble, trim low
// mud, lift presence (~3kHz) and air (~7kHz), gentle compression, limit, and
// resample to 48kHz. Makes the VO sit clearly above the music.
// Run after scripts/vo.mjs:  node scripts/vo-enhance.mjs
import { execFileSync } from "node:child_process";
import { readdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../public/sfx/vo");
const AF =
  "highpass=f=85," +
  "equalizer=f=250:width_type=q:w=1.0:g=-2.5," +
  "equalizer=f=3000:width_type=q:w=1.3:g=4," +
  "equalizer=f=7000:width_type=q:w=2:g=2," +
  "acompressor=threshold=-21dB:ratio=3.2:attack=8:release=140:makeup=4," +
  "alimiter=level_out=0.95";

const files = readdirSync(dir).filter((f) => /^\d.*\.wav$/.test(f));
for (const f of files) {
  const inp = join(dir, f);
  const tmp = join(dir, `_enh_${f}`);
  execFileSync("ffmpeg", ["-y", "-i", inp, "-af", AF, "-ar", "48000", tmp], { stdio: "pipe" });
  renameSync(tmp, inp);
  console.log("enhanced", f);
}
console.log(`done — ${files.length} segments enhanced`);
