// Builds the click-through outreach queue from the harvested viberank dataset
// (viberank-users.json, produced by harvest-viberank.mjs) + targets.json extras.
// Machines draft, the human presses send. Email-only targets can be sent by
// send-emails.mjs; anyone with X/telegram/linkedin stays human.
//
//   node scripts/outreach/gen-queue-full.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATE = new Date().toISOString().slice(0, 10);

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

const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");

function draftViberank(t) {
  const openers = [
    `saw that you are #${t.vrank} on viberank with ${usd(t.spend)} burned.`,
    `saw that you are #${t.vrank} on viberank, ${usd(t.spend)} burned. solid numbers.`,
  ];
  const middles = [
    `I built ccwarriors.xyz, same idea but it counts all your agents, Claude Code, Codex and 13 more. same local data, one curl and you are on it.`,
    `I built ccwarriors.xyz, it reads the same local data viberank does but counts every agent you use, not just Claude Code. one curl and you are on it.`,
  ];
  const closers = [
    `trying to get feedback from people who actually burn tokens. no pressure!`,
    `early days, so feedback from real users like you helps a lot. no pressure!`,
  ];
  return lint(
    ["hey,", openers[t.vrank % openers.length], middles[t.vrank % middles.length], closers[t.vrank % closers.length], "best,\nManu"].join("\n\n"),
  );
}

function draftManual(t, ours) {
  return lint(
    t.draft
      .replaceAll("{count}", String(ours.count))
      .replaceAll("{burned}", "$" + ours.burned.toLocaleString("en-US"))
      .replaceAll("{top}", "$" + ours.top.toLocaleString("en-US")),
  );
}

const ours = await ourTotals();
const dataset = JSON.parse(readFileSync(path.join(HERE, "viberank-users.json"), "utf8"));
const reachable = dataset.filter((u) => u.contacts.length > 0);
console.log(`dataset: ${dataset.length} users, reachable: ${reachable.length}`);

const sentPath = path.join(HERE, "sent.json");
const sentLog = existsSync(sentPath) ? JSON.parse(readFileSync(sentPath, "utf8")) : {};

const targets = reachable.map((u) => ({ kind: "viberank", ...u }));
const manualPath = path.join(HERE, "targets.json");
if (existsSync(manualPath)) {
  for (const t of JSON.parse(readFileSync(manualPath, "utf8"))) {
    targets.push({
      kind: "manual",
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
  agentSent: !!sentLog[t.github],
  text: t.kind === "viberank" ? draftViberank(t) : draftManual(t, ours),
}));

const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Outreach queue ${DATE}</title>
<style>
  body{font-family:ui-monospace,monospace;background:#FAFAF8;color:#1c1c1a;max-width:860px;margin:30px auto;padding:0 16px}
  h1{font-size:20px} .sub{color:#8a8a82;font-size:13px;margin-bottom:8px}
  .filters{margin-bottom:18px;display:flex;gap:8px}
  .filters button{font:12px ui-monospace,monospace;border:1.5px solid #1c1c1a;background:#fff;padding:5px 10px;cursor:pointer}
  .filters button.on{background:#C2683E;color:#fff}
  .t{background:#fff;border:1.5px solid #1c1c1a;margin:14px 0;padding:14px 16px;box-shadow:4px 4px 0 rgba(28,28,26,.12)}
  .t.done{opacity:.35}
  .hd{display:flex;justify-content:space-between;align-items:center;font-weight:700}
  .meta{color:#8a8a82;font-size:12px;margin:4px 0 10px}
  textarea{width:100%;height:165px;font:13px ui-monospace,monospace;border:1px solid #ddd;padding:8px;box-sizing:border-box}
  .row{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
  button,a.btn{font:13px ui-monospace,monospace;border:1.5px solid #1c1c1a;background:#fff;padding:6px 12px;cursor:pointer;text-decoration:none;color:#1c1c1a}
  button:hover,a.btn:hover{background:#C2683E;color:#fff}
</style></head><body>
<h1>Outreach queue · ${DATE}</h1>
<div class="sub">${items.length} reachable targets of ${dataset.length} viberank users · copy, open, paste, send. Checkbox saves locally.</div>
<div class="filters">
  <button class="on" onclick="filt('all',this)">all</button>
  <button onclick="filt('todo',this)">to do</button>
  <button onclick="filt('x',this)">has x</button>
  <button onclick="filt('emailonly',this)">email only</button>
</div>
${items
  .map((t, i) => {
    const emailOnly = t.contacts.length && t.contacts.every((c) => c.type === "email");
    const hasX = t.contacts.some((c) => c.type === "x");
    return `<div class="t${t.agentSent ? " done" : ""}" id="t${i}" data-key="${esc(t.github)}" data-x="${hasX}" data-eo="${emailOnly}">
  <div class="hd"><span>${i + 1}. ${esc(t.name)} ${t.kind === "viberank" ? `· viberank #${t.vrank} · ${usd(t.spend)}` : ""}${t.agentSent ? " · emailed by agent" : ""}</span>
  <label><input type="checkbox" ${t.agentSent ? "checked " : ""}onchange="mark('${esc(t.github)}',${i},this.checked)"> sent</label></div>
  <div class="meta">${t.contacts.map((c) => esc(c.label)).join(" · ")}${t.bio ? " · " + esc(t.bio) : ""}</div>
  <textarea id="x${i}">${esc(t.text)}</textarea>
  <div class="row">
    <button onclick="navigator.clipboard.writeText(document.getElementById('x${i}').value)">copy text</button>
    ${t.contacts
      .map((c) =>
        c.type === "email"
          ? `<button onclick="sendMail('${esc(c.url.replace("mailto:", ""))}',${i})">email</button>`
          : `<a class="btn" href="${esc(c.url)}" target="_blank">${c.type}</a>`,
      )
      .join("\n    ")}
    <a class="btn" href="https://github.com/${esc(t.github)}" target="_blank">github</a>
  </div>
</div>`;
  })
  .join("\n")}
<script>
const SUBJECT = "fellow dev - asking for feedback on a product";
function sendMail(addr,i){
  const body = document.getElementById('x'+i).value;
  location.href = 'mailto:'+addr+'?subject='+encodeURIComponent(SUBJECT)+'&body='+encodeURIComponent(body);
}
function mark(key,i,v){document.getElementById('t'+i).classList.toggle('done',v);const s=JSON.parse(localStorage.qk||'{}');s[key]=v;localStorage.qk=JSON.stringify(s);}
const s=JSON.parse(localStorage.qk||'{}');
document.querySelectorAll('.t').forEach(el=>{const k=el.getAttribute('data-key');if(s[k]){el.classList.add('done');el.querySelector('input').checked=true}});
function filt(mode,btn){
  document.querySelectorAll('.filters button').forEach(b=>b.classList.remove('on'));btn.classList.add('on');
  document.querySelectorAll('.t').forEach(el=>{
    let show = true;
    if(mode==='todo') show = !el.classList.contains('done');
    if(mode==='x') show = el.getAttribute('data-x')==='true';
    if(mode==='emailonly') show = el.getAttribute('data-eo')==='true';
    el.style.display = show ? '' : 'none';
  });
}
</script>
</body></html>`;

const out = path.join(HERE, `queue-${DATE}.html`);
writeFileSync(out, html);
const emailOnly = items.filter((t) => t.contacts.length && t.contacts.every((c) => c.type === "email"));
console.log(`queue: ${out}`);
console.log(`targets: ${items.length} · email-only (agent-sendable): ${emailOnly.length} · with X (yours): ${items.filter((t) => t.contacts.some((c) => c.type === "x")).length}`);
