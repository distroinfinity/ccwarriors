// Generates the cinematic b-roll via the Runway dev API.
// Reads RUNWAY_API_KEY from apps/server/.env. Hard credit cap enforced.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
const API = "https://api.dev.runwayml.com";
const VERSION = "2024-11-06";
const CREDIT_CAP = 15000;

const env = await readFile(join(root, "../../apps/server/.env"), "utf8");
const KEY = env.match(/^RUNWAY_API_KEY=(.+)$/m)?.[1]?.trim();
if (!KEY) throw new Error("RUNWAY_API_KEY not found in apps/server/.env");

const headers = {
  Authorization: `Bearer ${KEY}`,
  "X-Runway-Version": VERSION,
  "Content-Type": "application/json",
};

async function credits() {
  const r = await fetch(`${API}/v1/organization`, { headers });
  const j = await r.json();
  return j.creditBalance;
}

async function createTask(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(j)}`);
  return j.id;
}

async function poll(id) {
  for (let i = 0; i < 180; i++) {
    await new Promise((res) => setTimeout(res, 5000));
    const r = await fetch(`${API}/v1/tasks/${id}`, { headers });
    const j = await r.json();
    if (j.status === "SUCCEEDED") return j.output;
    if (j.status === "FAILED") throw new Error(`task ${id} failed: ${j.failure ?? j.failureCode}`);
    process.stdout.write(".");
  }
  throw new Error(`task ${id} timed out`);
}

const SHOTS = [
  {
    name: "ember-ignition",
    promptText:
      "Extreme macro of glowing embers igniting in pure darkness, a wave of orange sparks catching and rising in slow motion, deep black background, warm terracotta and amber tones, shallow depth of field, high contrast cinematic lighting, subtle film grain. No text, no logos, no people.",
  },
  {
    name: "molten-forge",
    promptText:
      "Molten orange metal flowing and sparking in darkness as an unseen hammer strikes, bursts of slow-motion sparks on impact, liquid metal glow, pure black background, amber rim light, extreme macro cinematic slow motion, high contrast. No text, no logos, no people.",
  },
];

const startBalance = await credits();
console.log(`credit balance: ${startBalance}`);
await mkdir(join(root, "public/runway"), { recursive: true });

for (const shot of SHOTS) {
  const spent = startBalance - (await credits());
  if (spent > CREDIT_CAP) throw new Error(`credit cap hit (${spent} spent) — stopping`);
  console.log(`\n→ ${shot.name}`);
  const id = await createTask("/v1/text_to_video", {
    model: "veo3.1_fast",
    promptText: shot.promptText,
    ratio: "1920:1080",
    duration: 8,
  });
  console.log(`  task ${id}`);
  const output = await poll(id);
  const url = Array.isArray(output) ? output[0] : output?.[0] ?? output;
  const vid = await fetch(url);
  await writeFile(join(root, "public/runway", `${shot.name}.mp4`), Buffer.from(await vid.arrayBuffer()));
  console.log(`\n  saved public/runway/${shot.name}.mp4`);
}

const endBalance = await credits();
console.log(`\ndone. credits spent: ${startBalance - endBalance} (balance ${endBalance})`);
