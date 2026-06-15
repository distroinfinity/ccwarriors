// Snapshot the live leaderboard so renders are deterministic and offline.
// Writes data/leaderboard.json and mirrors avatars into public/avatars/.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
const API = process.env.CCW_API ?? "https://api.ccwarriors.xyz";
const LIMIT = 15;

const res = await fetch(`${API}/leaderboard?board=30d&limit=${LIMIT}`);
if (!res.ok) throw new Error(`leaderboard fetch failed: ${res.status}`);
const board = await res.json();

await mkdir(join(root, "data"), { recursive: true });
await mkdir(join(root, "public/avatars"), { recursive: true });

const entries = [];
for (const e of board.entries) {
  let avatar = null;
  if (e.avatarUrl) {
    try {
      const img = await fetch(e.avatarUrl + (e.avatarUrl.includes("?") ? "&" : "?") + "s=128");
      if (img.ok) {
        const buf = Buffer.from(await img.arrayBuffer());
        avatar = `avatars/${e.githubLogin}.png`;
        await writeFile(join(root, "public", avatar), buf);
      }
    } catch {
      // monogram fallback renders instead
    }
  }
  entries.push({
    id: e.id,
    login: e.githubLogin,
    tier: e.tier,
    cost30d: e.cost30d,
    costAllTime: e.costAllTime,
    avatar,
  });
}

const snapshot = {
  fetchedAt: new Date().toISOString(),
  totalBurned30d: board.totals?.burned30d ?? entries.reduce((s, e) => s + e.cost30d, 0),
  warriorCount: board.totals?.count ?? board.count,
  entries,
};
await writeFile(join(root, "data/leaderboard.json"), JSON.stringify(snapshot, null, 2));
console.log(
  `snapshot: ${entries.length} warriors, $${snapshot.totalBurned30d.toLocaleString()} burned, ` +
    `${entries.filter((e) => e.avatar).length} avatars saved`
);
