// Snapshot one warrior's live profile so renders are deterministic and offline.
// Writes data/profile.json and mirrors the avatar into public/avatars/.
// Usage: node scripts/fetch-profile.mjs [login]   (default: distroinfinity)
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
const API = process.env.CCW_API ?? "https://api.ccwarriors.xyz";
const LOGIN = process.argv[2] ?? "distroinfinity";

const res = await fetch(`${API}/profile/${encodeURIComponent(LOGIN)}`);
if (!res.ok) throw new Error(`profile fetch failed for ${LOGIN}: ${res.status}`);
const profile = await res.json();

await mkdir(join(root, "data"), { recursive: true });
await mkdir(join(root, "public/avatars"), { recursive: true });

// Mirror the avatar locally so the headless render never reaches out at frame time.
let avatar = null;
if (profile.avatarUrl) {
  try {
    const url = profile.avatarUrl + (profile.avatarUrl.includes("?") ? "&" : "?") + "s=256";
    const img = await fetch(url);
    if (img.ok) {
      const buf = Buffer.from(await img.arrayBuffer());
      avatar = `avatars/${profile.login}.png`;
      await writeFile(join(root, "public", avatar), buf);
    }
  } catch {
    // monogram fallback renders instead
  }
}

const snapshot = { fetchedAt: new Date().toISOString(), avatar, profile };
await writeFile(join(root, "data/profile.json"), JSON.stringify(snapshot, null, 2));

const ins = profile.insights && !profile.insights.locked ? profile.insights : null;
console.log(
  `profile snapshot: ${profile.login} · rank ${profile.rank30d ?? "—"} · ` +
    `craft ${ins?.craftScore ?? "—"} ${ins?.craftTier?.name ?? ""} · ` +
    `${avatar ? "avatar saved" : "no avatar"}`,
);
