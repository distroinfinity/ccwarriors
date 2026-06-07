// Harvests the full viberank user base from public pages:
// sitemap (all profile slugs) -> profile pages (total spend) -> computed rank
// -> GitHub contact channels. Writes viberank-users.json for gen-queue.
//
//   node scripts/outreach/harvest-viberank.mjs
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 1) all profile slugs from the sitemap
const sitemap = await (await fetch("https://www.viberank.app/sitemap.xml")).text();
let slugs = [...sitemap.matchAll(/viberank\.app\/profile\/([^<]+)/g)].map((m) => decodeURIComponent(m[1]));
slugs = [...new Set(slugs)].filter((s) => !/^test-user-/i.test(s));
console.log(`sitemap slugs: ${slugs.length}`);

// skip people already on our board — they converted, no outreach needed
const ours = new Set();
for (let offset = 0; ; offset += 30) {
  const d = await (await fetch(`https://api.ccwarriors.xyz/leaderboard?offset=${offset}&limit=30`)).json();
  for (const e of d.entries) ours.add(e.githubLogin.toLowerCase());
  if (ours.size >= d.count || d.entries.length === 0) break;
}
const before = slugs.length;
slugs = slugs.filter((s) => !ours.has(s.toLowerCase()));
console.log(`already on ccwarriors, skipped: ${before - slugs.length}`);

// 2) spend per profile (server-rendered; take the max $ figure on the page)
async function spendOf(slug) {
  try {
    const res = await fetch(`https://www.viberank.app/profile/${encodeURIComponent(slug)}`, {
      headers: { "user-agent": "Mozilla/5.0 (research; contact manurajput2911@gmail.com)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const amounts = [...html.matchAll(/\$([0-9][0-9,]*)(?:\.\d+)?/g)].map((m) => Number(m[1].replaceAll(",", "")));
    if (!amounts.length) return null;
    return Math.max(...amounts);
  } catch {
    return null;
  }
}

const users = [];
const POOL = 8;
let done = 0;
for (let i = 0; i < slugs.length; i += POOL) {
  const batch = slugs.slice(i, i + POOL);
  const spends = await Promise.all(batch.map(spendOf));
  batch.forEach((slug, j) => {
    if (spends[j] !== null) users.push({ github: slug, spend: spends[j] });
  });
  done += batch.length;
  if (done % 120 < POOL) console.log(`profiles fetched: ${done}/${slugs.length}`);
  await new Promise((r) => setTimeout(r, 150)); // politeness
}
console.log(`profiles with spend: ${users.length}`);

// 3) rank by spend, descending
users.sort((a, b) => b.spend - a.spend);
users.forEach((u, i) => (u.vrank = i + 1));

// 4) contact channels from GitHub (authenticated gh: 5000 req/hr)
function contactsFor(login) {
  let u;
  try {
    u = JSON.parse(execFileSync("gh", ["api", `users/${login}`], { encoding: "utf8" }));
  } catch {
    return { name: login, bio: "", contacts: [] };
  }
  const contacts = [];
  const blob = `${u.blog ?? ""} ${u.bio ?? ""}`;
  if (u.twitter_username) contacts.push({ type: "x", label: `X DM @${u.twitter_username}`, url: `https://x.com/${u.twitter_username}` });
  const xInBlob = blob.match(/(?:x|twitter)\.com\/(\w+)/);
  if (!u.twitter_username && xInBlob) contacts.push({ type: "x", label: `X DM @${xInBlob[1]}`, url: `https://x.com/${xInBlob[1]}` });
  if (u.email) contacts.push({ type: "email", label: u.email, url: `mailto:${u.email}` });
  const tg = blob.match(/t\.me\/(\w+)/);
  if (tg) contacts.push({ type: "telegram", label: `t.me/${tg[1]}`, url: `https://t.me/${tg[1]}` });
  const li = blob.match(/linkedin\.com\/in\/([\w-]+)/);
  if (li) contacts.push({ type: "linkedin", label: `linkedin/${li[1]}`, url: `https://www.linkedin.com/in/${li[1]}` });
  return { name: u.name ?? login, bio: (u.bio ?? "").slice(0, 100), contacts };
}

let reachable = 0;
for (const [i, u] of users.entries()) {
  Object.assign(u, contactsFor(u.github));
  if (u.contacts.length) reachable++;
  if (i % 100 === 0) console.log(`contacts resolved: ${i}/${users.length} (reachable so far: ${reachable})`);
}

const out = path.join(HERE, "viberank-users.json");
writeFileSync(out, JSON.stringify(users, null, 1) + "\n");
const emailOnly = users.filter((u) => u.contacts.length && u.contacts.every((c) => c.type === "email")).length;
const withX = users.filter((u) => u.contacts.some((c) => c.type === "x")).length;
console.log(`\nharvest complete → ${out}`);
console.log(`total users: ${users.length} · reachable: ${reachable} · email-only: ${emailOnly} · with X: ${withX}`);
