// Generates rank-card PNGs for every warrior on the live board + caption file.
// Cards are the production "Your card" panel rendered at ccwarriors.xyz/?u=<login>.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const DATE = "2026-06-06";
const DAYS_LIVE = 3; // board went live ~Jun 4
const OUT = `/Users/manu/.superset/projects/claude-warriors/assets/${DATE}`;
mkdirSync(OUT, { recursive: true });

// ---- fetch the full board (API pages at 30) ----
const entries = [];
for (let offset = 0; ; offset += 30) {
  const res = await fetch(`https://api.ccwarriors.xyz/leaderboard?offset=${offset}&limit=30`);
  const data = await res.json();
  entries.push(...data.entries);
  if (entries.length >= data.count || data.entries.length === 0) break;
}
console.log(`board: ${entries.length} warriors`);

// ---- render each card ----
const browser = await chromium.launch();
const failures = [];
for (let i = 0; i < entries.length; i++) {
  const e = entries[i];
  const rank = i + 1;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 3 });
  try {
    await page.goto(`https://ccwarriors.xyz/?u=${encodeURIComponent(e.githubLogin)}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".card", { timeout: 15000 });
    await page.waitForTimeout(5200); // ticker animation (4s) + avatar settle
    const card = page.locator(".card").first();
    // Filename leads with the posting-order index (rank N posts first, #1 last).
    const postIdx = String(entries.length - i).padStart(2, "0");
    await card.screenshot({ path: `${OUT}/${postIdx}-${e.githubLogin}.png` });
    console.log(`#${rank} ${e.githubLogin} ok`);
  } catch (err) {
    failures.push(e.githubLogin);
    console.log(`#${rank} ${e.githubLogin} FAILED: ${String(err).slice(0, 80)}`);
  } finally {
    await page.close();
  }
}
await browser.close();

// ---- captions, posting order rank N -> 1 ----
const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");
const topTool = (e) => {
  const parts = Object.entries(e.breakdown ?? {}).filter(([, v]) => typeof v === "number" && v > 0);
  if (parts.length < 2) return null;
  parts.sort((a, b) => b[1] - a[1]);
  return parts[0][0];
};
const who = (e) => (e.xHandle ? `@${e.xHandle}` : e.githubLogin);

function caption(e, rank, total) {
  const w = who(e);
  const burn = usd(e.cost30d);
  const tier = e.tier;
  const tool = topTool(e);
  const day = `day ${DAYS_LIVE} of the board.`;
  if (rank === 1)
    return `${day} and at the top of it all: ${w}. rank #1. ${burn} burned in 30 days. ${tier} tier. the throne is occupied. who's taking it? ⚔️\n\n→ ccwarriors.xyz`;
  if (rank === 2)
    return `${day} ${w} sits at #2 with ${burn} burned. ${tier} tier. one seat from the throne. ⚔️\n\n→ ccwarriors.xyz`;
  if (rank === 3)
    return `${day} podium watch: ${w} holds #3. ${burn} in 30 days. ${tier} tier. ⚔️\n\n→ ccwarriors.xyz`;
  // fresh enlistees: no spend on the card yet — salute the showing up, skip the $0
  if (e.cost30d < 1) {
    const f = [
      `${day} shoutout to ${w} for enlisting early. warrior #${rank} of ${total}. the first sync is coming and the climb starts there. ⚔️\n\n→ ccwarriors.xyz`,
      `${day} ${w} just enlisted. rank #${rank} and a clean slate. every Netherite started at Stone. ⚔️\n\n→ ccwarriors.xyz`,
      `${day} welcome to the board, ${w}. warrior #${rank} of ${total}. early names get remembered. ⚔️\n\n→ ccwarriors.xyz`,
    ];
    return f[rank % f.length];
  }
  const t = [
    `${day} shoutout to ${w} for showing up early and earning rank #${rank}. ${burn} burned in 30 days. ${tier} tier. ⚔️\n\n→ ccwarriors.xyz`,
    `${day} warrior #${rank}: ${w}. ${burn} across their AI coding tools this month. ${tier} tier. respect. ⚔️\n\n→ ccwarriors.xyz`,
    `${day} ${w} enlisted and burned their way to rank #${rank}. ${burn} in 30 days. ${tier} tier. the board sees you. ⚔️\n\n→ ccwarriors.xyz`,
    `${day} salute to ${w}. rank #${rank} of ${total}, ${burn} burned. ${tier} tier. early warriors get remembered. ⚔️\n\n→ ccwarriors.xyz`,
    `${day} ${w} holds rank #${rank} with ${burn} burned this month. ${tier} tier. climbing season is open. ⚔️\n\n→ ccwarriors.xyz`,
  ];
  let c = t[rank % t.length];
  if (tool && rank % 3 === 0) c = c.replace(". ⚔️", `. ${tool} is their weapon of choice. ⚔️`);
  return c;
}

let md = `# Warrior shoutout queue — ${DATE}\n\nPost order: rank ${entries.length} → 1 (finale = the throne). One post per warrior, attach \`assets/${DATE}/<login>.png\`.\nTag rule: X handle when known, github name otherwise (no DM, no pressure, pure salute).\nDays-live constant used: ${DAYS_LIVE} (board live since ~Jun 4). Adjust if you post later.\nPacing tip: 5-8 posts per hour max, spread across the day. 43 back-to-back posts trips spam heuristics.\n\n---\n\n`;
for (let i = entries.length - 1; i >= 0; i--) {
  const e = entries[i];
  const rank = i + 1;
  md += `## ${entries.length - i}. rank #${rank} — ${e.githubLogin}${e.xHandle ? ` (X: @${e.xHandle})` : " (no X handle on card)"}\n`;
  md += `image: \`assets/${DATE}/${String(entries.length - i).padStart(2, "0")}-${e.githubLogin}.png\`\n\n`;
  md += "```\n" + caption(e, rank, entries.length) + "\n```\n\n";
}
writeFileSync(`${OUT}/captions.md`, md);
console.log(`captions: ${OUT}/captions.md`);
if (failures.length) console.log("FAILED:", failures.join(", "));
