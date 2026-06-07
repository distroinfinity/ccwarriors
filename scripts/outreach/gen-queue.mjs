// Outreach queue generator: finds targets, drafts copy, builds a click-through
// HTML queue. Machines draft, the human presses send — never auto-sends.
//
//   node scripts/outreach/gen-queue.mjs
//
// Sources: viberank top N (public board, scraped once) + targets.json extras.
// Contact channels resolved from GitHub profiles (X, email, telegram, linkedin).
// Targets with no reachable channel are dropped — no point drafting for them.
// Output: scripts/outreach/queue-<date>.html — open in a browser, work top down.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATE = new Date().toISOString().slice(0, 10);
const VIBERANK_TOP_N = 80; // scan deep; unreachable people get dropped anyway

// ---- copy rules: fellow dev to fellow dev. Short, simple english, zero shill,
// no hyphens, no em dashes, no marketing words. Deterministic on purpose.
const BANNED = ["—", "–", "-", "check out", "excited", "thrilled", "amazing", "game changer", "revolutionary", "powerful", "seamless"];
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

// Short skeleton: hello, their number, what I built in one line, soft close.
function draftViberank(t, ours) {
  const openers = t.vrank
    ? [
        `saw that you are #${t.vrank} on viberank with ${t.vspend} burned.`,
        `saw that you are #${t.vrank} on viberank, ${t.vspend} burned. solid numbers.`,
      ]
    : [
        `saw that you are on the viberank board with ${t.vspend} burned.`,
        `saw that you are on viberank, ${t.vspend} burned. solid numbers.`,
      ];
  const middles = [
    `I built ccwarriors.xyz, same idea but it counts all your agents, Claude Code, Codex and 13 more. same local data, one curl and you are on it.`,
    `I built ccwarriors.xyz, it reads the same local data viberank does but counts every agent you use, not just Claude Code. one curl and you are on it.`,
  ];
  const closers = [
    `trying to get feedback from people who actually burn tokens. no pressure!`,
    `early days, so feedback from real users like you helps a lot. no pressure!`,
  ];
  const text = [
    "hey,",
    openers[t.index % openers.length],
    middles[t.index % middles.length],
    closers[t.index % closers.length],
    "best,\nManu",
  ].join("\n\n");
  return lint(text);
}

function draftManual(t, ours) {
  return lint(
    t.draft
      .replaceAll("{count}", String(ours.count))
      .replaceAll("{burned}", "$" + ours.burned.toLocaleString("en-US"))
      .replaceAll("{top}", "$" + ours.top.toLocaleString("en-US")),
  );
}

// ---- viberank scrape: homepage shows top 25 per view; union the time/sort
// filter combos (All/7d/30d × Cost/Tokens) to surface more unique people. ----
async function viberankTop(n) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("https://www.viberank.app", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const collect = () =>
    page.evaluate(() => {
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

  const byUser = new Map();
  let canonicalOrder = []; // All × Cost view = the rank we quote
  for (const time of ["All", "7d", "30d"]) {
    for (const sort of ["Cost", "Tokens"]) {
      try {
        await page.getByText(time, { exact: true }).first().click();
        await page.waitForTimeout(900);
        await page.getByText(sort, { exact: true }).first().click();
        await page.waitForTimeout(1200);
      } catch {
        continue;
      }
      const rows = await collect();
      if (time === "All" && sort === "Cost") canonicalOrder = rows.map((r) => r.github);
      for (const r of rows) if (!byUser.has(r.github)) byUser.set(r.github, r);
    }
  }
  await browser.close();

  const all = [...byUser.values()];
  // canonical (All×Cost) ranks first, then everyone else in discovery order
  all.sort((a, b) => {
    const ia = canonicalOrder.indexOf(a.github);
    const ib = canonicalOrder.indexOf(b.github);
    return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
  });
  return all.slice(0, n).map((r) => {
    const m = r.rowText.match(/\$([\d,]+)(?:\.\d+)?/);
    const idx = canonicalOrder.indexOf(r.github);
    return { github: r.github, vrank: idx === -1 ? null : idx + 1, vspend: m ? "$" + m[1] : "their tokens" };
  });
}

// ---- contact resolution: X > email > telegram > linkedin. None = dropped. ----
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

// ---- build ----
const ours = await ourTotals();
console.log(`ccwarriors live: ${ours.count} devs, $${ours.burned} 30d`);

console.log(`scraping viberank top ${VIBERANK_TOP_N}…`);
const vr = await viberankTop(VIBERANK_TOP_N);
console.log(`viberank rows found: ${vr.length}`);

const targets = [];
let dropped = 0;
for (const [i, t] of vr.entries()) {
  const c = contactsFor(t.github);
  if (c.contacts.length === 0) {
    dropped++;
    continue; // nobody home: no X, no email, no telegram, no linkedin
  }
  targets.push({ kind: "viberank", index: targets.length, github: t.github, vrank: t.vrank, vspend: t.vspend, ...c });
}
console.log(`reachable: ${targets.length}, dropped (no contact channel): ${dropped}`);

const manualPath = path.join(HERE, "targets.json");
if (existsSync(manualPath)) {
  const manual = JSON.parse(readFileSync(manualPath, "utf8"));
  for (const [i, t] of manual.entries()) {
    targets.push({
      kind: "manual",
      index: i,
      github: t.github,
      name: t.name,
      bio: "",
      draft: t.draft,
      contacts: [{ type: "x", label: `X DM @${t.x}`, url: `https://x.com/${t.x}` }],
    });
  }
}

const items = targets.map((t) => ({
  ...t,
  text: t.kind === "viberank" ? draftViberank(t, ours) : draftManual(t, ours),
}));

const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Outreach queue ${DATE}</title>
<style>
  body{font-family:ui-monospace,monospace;background:#FAFAF8;color:#1c1c1a;max-width:860px;margin:30px auto;padding:0 16px}
  h1{font-size:20px} .sub{color:#8a8a82;font-size:13px;margin-bottom:24px}
  .t{background:#fff;border:1.5px solid #1c1c1a;margin:14px 0;padding:14px 16px;box-shadow:4px 4px 0 rgba(28,28,26,.12)}
  .t.done{opacity:.35}
  .hd{display:flex;justify-content:space-between;align-items:center;font-weight:700}
  .meta{color:#8a8a82;font-size:12px;margin:4px 0 10px}
  textarea{width:100%;height:170px;font:13px ui-monospace,monospace;border:1px solid #ddd;padding:8px;box-sizing:border-box}
  .row{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
  button,a.btn{font:13px ui-monospace,monospace;border:1.5px solid #1c1c1a;background:#fff;padding:6px 12px;cursor:pointer;text-decoration:none;color:#1c1c1a}
  button:hover,a.btn:hover{background:#C2683E;color:#fff}
</style></head><body>
<h1>Outreach queue · ${DATE}</h1>
<div class="sub">${items.length} reachable targets (${dropped} dropped, no contact channel) · copy, open, paste, send. Checkbox saves locally.</div>
${items
  .map(
    (t, i) => `<div class="t" id="t${i}" data-key="${esc(t.github)}">
  <div class="hd"><span>${i + 1}. ${esc(t.name)} ${t.kind === "viberank" ? `· viberank #${t.vrank}` : ""}</span>
  <label><input type="checkbox" onchange="mark('${esc(t.github)}',${i},this.checked)"> sent</label></div>
  <div class="meta">${t.contacts.map((c) => esc(c.label)).join(" · ")}${t.bio ? " · " + esc(t.bio) : ""}</div>
  <textarea id="x${i}">${esc(t.text)}</textarea>
  <div class="row">
    <button onclick="navigator.clipboard.writeText(document.getElementById('x${i}').value)">copy text</button>
    ${t.contacts
      .map((c) =>
        c.type === "email"
          ? // mailto with subject + the current textarea content as body
            `<button onclick="sendMail('${esc(c.url.replace("mailto:", ""))}',${i})">email</button>`
          : `<a class="btn" href="${esc(c.url)}" target="_blank">${c.type}</a>`,
      )
      .join("\n    ")}
    <a class="btn" href="https://github.com/${esc(t.github)}" target="_blank">github</a>
  </div>
</div>`,
  )
  .join("\n")}
<script>
const SUBJECT = "fellow dev - asking for feedback on a product";
function sendMail(addr,i){
  const body = document.getElementById('x'+i).value;
  location.href = 'mailto:'+addr+'?subject='+encodeURIComponent(SUBJECT)+'&body='+encodeURIComponent(body);
}
// sent-state keyed by github login so regenerating the queue never loses progress
function mark(key,i,v){document.getElementById('t'+i).classList.toggle('done',v);const s=JSON.parse(localStorage.qk||'{}');s[key]=v;localStorage.qk=JSON.stringify(s);}
const s=JSON.parse(localStorage.qk||'{}');
document.querySelectorAll('.t').forEach(el=>{const k=el.getAttribute('data-key');if(s[k]){el.classList.add('done');el.querySelector('input').checked=true}});
</script>
</body></html>`;

const out = path.join(HERE, `queue-${DATE}.html`);
writeFileSync(out, html);
console.log(`queue: ${out} (${items.length} targets)`);
