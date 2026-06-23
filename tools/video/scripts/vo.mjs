// Generates the voiceover with OpenAI gpt-4o-mini-tts as PER-BEAT segments, so
// the narration syncs to the cuts and goes quiet between thoughts (music fills
// the gaps) — not one continuous track. Warm, natural female delivery.
// Reads OPENAI_API_KEY from env or apps/server/.env.
// Usage: node scripts/vo.mjs [voice]   (coral | shimmer | nova | sage | alloy)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

async function getKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const env = await readFile(join(here, "../../../apps/server/.env"), "utf8");
  const m = env.match(/^OPENAI_API_KEY=(.+)$/m);
  if (!m) throw new Error("OPENAI_API_KEY not found (env or apps/server/.env)");
  return m[1].trim();
}

const VOICE = process.argv[2] ?? "coral";

const INSTRUCTIONS =
  "Warm, natural, conversational female narrator — the calm, human tone of an Apple product film. Unhurried, with genuine, gentle emphasis and natural intonation, and small breaths between thoughts. Quietly confident and a little proud. Never robotic, announcer-like, or salesy.";

// One short line per beat — synced to what's on screen; silence between is fine.
const SEGMENTS = [
  ["01_resume", "We used to know a developer by a résumé."],
  ["02_stars", "By their stars."],
  ["03_years", "Their years on a team."],
  ["04_turn", "But that's not how anyone builds anymore."],
  ["05_meet", "Meet distroinfinity. The Falconer — sets the agent loose on long runs, and trusts it to come back with the kill."],
  ["06_signal", "One cent per surviving line. That's not spending. That's craft."],
  ["07_board", "And they're one of many — a whole board of builders, burning live."],
  ["08_page", "It all lives on one page. Who they are, how they build, and what survives."],
  ["09_cta", "The new signal for how the world builds."],
];

const key = await getKey();
const outDir = join(here, "../public/sfx/vo");
await mkdir(outDir, { recursive: true });

for (const [name, text] of SEGMENTS) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: VOICE, input: text, instructions: INSTRUCTIONS, response_format: "wav" }),
  });
  if (!res.ok) throw new Error(`TTS failed for ${name} (${res.status}): ${await res.text()}`);
  await writeFile(join(outDir, `${name}.wav`), Buffer.from(await res.arrayBuffer()));
  console.log(`✓ ${name}.wav (voice=${VOICE})`);
}
console.log(`done — ${SEGMENTS.length} segments in public/sfx/vo/`);
