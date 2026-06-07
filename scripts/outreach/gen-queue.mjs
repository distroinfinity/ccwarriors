// Outreach queue generator: finds targets, drafts copy, builds a click-through
// HTML queue. Machines draft, the human presses send — never auto-sends.
//
//   node scripts/outreach/gen-queue.mjs
//
// Sources: viberank top N (public board, scraped once) + targets.json extras.
// X handles resolved from GitHub profiles (twitter_username field).
// Output: scripts/outreach/queue-<date>.html — open in a browser, work top down.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATE = new Date().toISOString().slice(0, 10);
const VIBERANK_TOP_N = 30;

// ---- copy rules: simple, direct, zero shill. The product is a tool that
// tracks and measures cost and throughput of AI coding tools. No hyphens,
// no em dashes, no marketing words. Templates are deterministic on purpose.
const BANNED = ["—", "–", "-", "check out", "excited", "thrilled", "would love", "amazing", "game changer", "revolutionary"];
function lint(text) {
  for (const b of BANNED) {
    if (text.toLowerCase().includes(b)) throw new Error(`banned phrase "${b}" in: ${text}`);
  }
  return text;
}

async function ourTotals() {
  const res = await fetch("https://api.ccwarriors.xyz/leaderboard");
  const d = await res.json();
  return { count: d.count, burned: Math.round(d.totals?.burned30d ?? 0), top: Math.round(d.entries?.[0]?.cost30d ?? 0) };
}

// Drafts. {them} = display handle, {vrank} = their viberank rank, {vspend} = their viberank spend.
function draftViberank(t, ours) {
  const variants = [
    `hey, saw you at #${t.vrank} on viberank with ${t.vspend} burned. built ccwarriors.xyz, it tracks token usage and throughput across Claude Code, Codex and 13 other agents, same local data, one curl and you are on this board too. ${ours.count} devs on it, $${ours.burned.toLocaleString("en-US")} tracked in 30 days. no ask, your numbers would slot right in near the top.`,
    `hey, you rank #${t.vrank} on viberank. built ccwarriors.xyz, it measures cost and throughput across 15 AI coding tools, not just Claude Code. reads the same local usage data, so one curl puts you on both boards. raw token counts only, open source.`,
    `hey, noticed your viberank profile, #${t.vrank} at ${t.vspend}. ccwarriors.xyz does the same measurement across Claude Code, Codex and 13 more agents, plus org boards for teams. one curl, same local data, both boards stay in sync. figured you would want your full numbers counted.`,
  ];
  return lint(variants[t.index % variants.length]);
}

function draftManual(t, ours) {
  // manual targets carry their own angle in targets.json
  return lint(
    t.draft
      .replaceAll("{count}", String(ours.count))
      .replaceAll("{burned}", "$" + ours.burned.toLocaleString("en-US"))
      .replaceAll("{top}", "$" + ours.top.toLocaleString("en-US")),
  );
}

// ---- viberank scrape (one page load, read the rendered table) ----
async function viberankTop(n) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("https://www.viberank.app", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const rows = await page.evaluate(() => {
    // grab anything that looks like a leaderboard row: profile links + visible text
    const out = [];
    const links = document.querySelectorAll('a[href*="/profile/"], a[href^="/u/"], a[href*="github.com/"]');
    const seen = new Set();
    for (const a of links) {
      const m = a.getAttribute("href")?.match(/(?:\/profile\/|\/u\/|github\.com\/)([\w-]+)/);
      if (!m) continue;
      const u = m[1];
      if (seen.has(u) || ["sculptdotfun", "viberank"].includes(u)) continue;
      seen.add(u);
      const row = a.closest("tr, li, [class*=row], [class*=Row]") ?? a;
      out.push({ github: u, rowText: (row.textContent ?? "").slice(0, 200) });
    }
    return out;
  });
  await browser.close();
  return rows.slice(0, n).map((r, i) => {
    const m = r.rowText.match(/\$([\d,]+)(?:\.\d+)?/);
    const spend = m ? "$" + m[1] : "their tokens";
    return { github: r.github, vrank: i + 1, vspend: spend };
  });
}

function githubProfile(login) {
  try {
    const raw = execFileSync("gh", ["api", `users/${login}`], { encoding: "utf8" });
    const u = JSON.parse(raw);
    return { x: u.twitter_username ?? null, name: u.name ?? login, bio: (u.bio ?? "").slice(0, 120) };
  } catch {
    return { x: null, name: login, bio: "" };
  }
}

// ---- build ----
const ours = await ourTotals();
console.log(`ccwarriors live: ${ours.count} devs, $${ours.burned} 30d`);

const targets = [];
console.log("scraping viberank top", VIBERANK_TOP_N, "…");
const vr = await viberankTop(VIBERANK_TOP_N);
console.log(`viberank rows found: ${vr.length}`);
for (const [i, t] of vr.entries()) {
  const gh = githubProfile(t.github);
  targets.push({
    kind: "viberank",
    index: i,
    github: t.github,
    vrank: t.vrank,
    vspend: t.vspend,
    x: gh.x,
    name: gh.name,
    bio: gh.bio,
  });
}

const manualPath = path.join(HERE, "targets.json");
if (existsSync(manualPath)) {
  const manual = JSON.parse(readFileSync(manualPath, "utf8"));
  for (const [i, t] of manual.entries()) targets.push({ kind: "manual", index: i, ...t });
}

const items = targets.map((t) => {
  const text = t.kind === "viberank" ? draftViberank(t, ours) : draftManual(t, ours);
  const profile = t.x ? `https://x.com/${t.x}` : `https://github.com/${t.github}`;
  return { ...t, text, profile, sendVia: t.x ? `X DM @${t.x}` : "no X handle, GitHub only (skip or find handle)" };
});

const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Outreach queue ${DATE}</title>
<style>
  body{font-family:ui-monospace,monospace;background:#FAFAF8;color:#1c1c1a;max-width:860px;margin:30px auto;padding:0 16px}
  h1{font-size:20px} .sub{color:#8a8a82;font-size:13px;margin-bottom:24px}
  .t{background:#fff;border:1.5px solid #1c1c1a;margin:14px 0;padding:14px 16px;box-shadow:4px 4px 0 rgba(28,28,26,.12)}
  .t.done{opacity:.35}
  .hd{display:flex;justify-content:space-between;align-items:center;font-weight:700}
  .meta{color:#8a8a82;font-size:12px;margin:4px 0 10px}
  textarea{width:100%;height:96px;font:13px ui-monospace,monospace;border:1px solid #ddd;padding:8px;box-sizing:border-box}
  .row{display:flex;gap:8px;margin-top:8px}
  button,a.btn{font:13px ui-monospace,monospace;border:1.5px solid #1c1c1a;background:#fff;padding:6px 12px;cursor:pointer;text-decoration:none;color:#1c1c1a}
  button:hover,a.btn:hover{background:#C2683E;color:#fff}
</style></head><body>
<h1>Outreach queue · ${DATE}</h1>
<div class="sub">${items.length} targets · copy, open, paste, send. Checkbox marks done (saved locally). Machines drafted, you send.</div>
${items
  .map(
    (t, i) => `<div class="t" id="t${i}">
  <div class="hd"><span>${i + 1}. ${esc(t.name)} ${t.kind === "viberank" ? `· viberank #${t.vrank}` : ""}</span>
  <label><input type="checkbox" onchange="mark(${i},this.checked)"> sent</label></div>
  <div class="meta">${esc(t.sendVia)}${t.bio ? " · " + esc(t.bio) : ""}</div>
  <textarea id="x${i}">${esc(t.text)}</textarea>
  <div class="row">
    <button onclick="navigator.clipboard.writeText(document.getElementById('x${i}').value)">copy text</button>
    <a class="btn" href="${t.profile}" target="_blank">open profile</a>
  </div>
</div>`,
  )
  .join("\n")}
<script>
function mark(i,v){document.getElementById('t'+i).classList.toggle('done',v);const s=JSON.parse(localStorage.q||'{}');s[i]=v;localStorage.q=JSON.stringify(s);}
const s=JSON.parse(localStorage.q||'{}');for(const k in s){if(s[k]){const el=document.getElementById('t'+k);if(el){el.classList.add('done');el.querySelector('input').checked=true}}}
</script>
</body></html>`;

const out = path.join(HERE, `queue-${DATE}.html`);
writeFileSync(out, html);
console.log(`queue: ${out} (${items.length} targets, ${items.filter((t) => t.x).length} with X handles)`);
